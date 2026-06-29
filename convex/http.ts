import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

// Short, URL-safe, unguessable slug (36^8 ≈ 2.8e12 space).
function makeSlug(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

// Best-effort title: explicit -> <title> -> first <h1> -> fallback.
function extractTitle(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t && t[1].trim()) return t[1].replace(/<[^>]+>/g, "").trim();
  const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h && h[1].trim()) return h[1].replace(/<[^>]+>/g, "").trim();
  return "Untitled plan";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// CORS for browser-called endpoints (the comment composer fetches cross-origin
// from the frontend to this *.convex.site origin).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// POST /plans — the agent-facing endpoint.
// Auth: Authorization: Bearer <per-user API key> (phk_...)
// Body: raw HTML, or JSON { title?, html, slug? }
// Returns: { id, url, title, updated }
const publish = httpAction(async (ctx, request) => {
  const header = request.headers.get("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = key
    ? await ctx.runQuery(internal.plans.userIdByApiKey, { key })
    : null;
  if (!userId) return json({ error: "unauthorized" }, 401);

  let html = "";
  let title = "";
  let slug = "";
  let expiresInDays = 0;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      title?: unknown;
      html?: unknown;
      slug?: unknown;
      expiresInDays?: unknown;
    };
    html = typeof body.html === "string" ? body.html : "";
    title = typeof body.title === "string" ? body.title : "";
    slug = typeof body.slug === "string" ? body.slug : "";
    expiresInDays =
      typeof body.expiresInDays === "number" ? body.expiresInDays : 0;
  } else {
    html = await request.text();
  }

  if (!html.trim()) return json({ error: "missing html" }, 400);
  // Size cap (Convex doc limit is ~1 MB; leave headroom for other fields).
  if (html.length > 900_000) {
    return json({ error: "html too large (max ~900 KB)" }, 413);
  }
  if (!title) title = extractTitle(html);
  const expiresAt =
    expiresInDays > 0 ? Date.now() + expiresInDays * 86_400_000 : undefined;

  // Optional custom slug enables stable, updatable URLs: publishing the same
  // slug again overwrites the plan in place. Must be URL-safe.
  if (slug) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug)) {
      return json({ error: "invalid slug: use 1-64 chars [a-z0-9-]" }, 400);
    }
  } else {
    slug = makeSlug();
  }

  const result = await ctx.runMutation(internal.plans.upsert, {
    userId,
    slug,
    title,
    html,
    expiresAt,
  });
  if (result === "conflict") {
    return json({ error: `slug '${slug}' is already taken` }, 409);
  }
  if (result === "limit") {
    return json({ error: "plan limit reached for this account" }, 429);
  }
  const url = `${process.env.CONVEX_SITE_URL}/p/${slug}`;
  // Human-facing collaborative view lives on the frontend (SITE_URL), so agents
  // can hand a person the commentable link without reconstructing the host.
  const collabUrl = `${process.env.SITE_URL}/plan/${slug}`;
  return json({ id: slug, url, collabUrl, title, updated: result === "updated" });
});

// POST /provision — unauthenticated agent self-signup.
// Returns { apiKey, claimUrl }. Rate-limited per IP.
const provision = httpAction(async (ctx, request) => {
  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
  const result = await ctx.runMutation(internal.plans.provisionWorkspace, { ip });
  if (result === "rate_limited") {
    return json({ error: "rate limited — try again later" }, 429);
  }
  const claimUrl = `${process.env.SITE_URL}/claim/${result.claimToken}`;
  return json({ apiKey: result.apiKey, claimUrl });
});

// POST /comments — anonymous human comment on a plan. IP rate-limited.
// Body JSON: { slug, blockIndex, quote, body, authorName? }
const addComment = httpAction(async (ctx, request) => {
  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
  let b: {
    slug?: unknown;
    blockIndex?: unknown;
    quote?: unknown;
    body?: unknown;
    authorName?: unknown;
  };
  try {
    b = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (typeof b.slug !== "string" || typeof b.body !== "string") {
    return corsJson({ error: "slug and body required" }, 400);
  }
  const result = await ctx.runMutation(internal.comments.add, {
    slug: b.slug,
    blockIndex: typeof b.blockIndex === "number" ? b.blockIndex : -1,
    quote: typeof b.quote === "string" ? b.quote : "",
    body: b.body,
    authorName: typeof b.authorName === "string" ? b.authorName : undefined,
    ip,
  });
  if (result === "rate_limited") return corsJson({ error: "rate limited" }, 429);
  if (result === "invalid") return corsJson({ error: "invalid comment" }, 400);
  return corsJson({ ok: true });
});

// CORS preflight for the comment endpoint.
const commentsPreflight = httpAction(
  async () => new Response(null, { status: 204, headers: CORS }),
);

// GET /agent — plain-text self-onboarding for agents that only have the API
// host. Mirrors /llms.txt on the frontend so the publish endpoint self-describes.
const AGENT_DOC = `HTML Plan Host — publish HTML, get a shareable URL.

Two steps, no account needed:

  HOST=${"https://"}${"vibrant-barracuda-527.convex.site"}
  KEY=$(curl -s -X POST "$HOST/provision" | sed -n 's/.*"apiKey":"\\([^"]*\\)".*/\\1/p')
  curl -s -X POST "$HOST/plans" \\
    -H "Authorization: Bearer $KEY" -H "content-type: application/json" \\
    -d '{"title":"My Plan","html":"<!doctype html><h1>Hello</h1>"}'

The response "url" renders your HTML as-is (raw shareable link); "collabUrl" is
the human view where anyone can comment on sections — hand that to a person.

Body fields: html (required, self-contained doc, inline CSS), title (optional),
slug (optional stable/updatable URL), expiresInDays (optional auto-delete).
Full docs: https://html-plan-host.vercel.app/llms.txt
`;
const agentDoc = httpAction(
  async () =>
    new Response(AGENT_DOC, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", ...CORS },
    }),
);

// GET /p/:slug — render the stored HTML as-is.
const view = httpAction(async (ctx, request) => {
  const slug = new URL(request.url).pathname.replace(/^\/p\//, "");
  const plan = await ctx.runQuery(api.plans.getBySlug, { slug });
  if (!plan) {
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Not found</title><body style='font-family:system-ui;padding:2rem'>Plan not found.</body>",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  await ctx.runMutation(internal.plans.incrementViews, { slug });
  return new Response(plan.html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});

const http = httpRouter();
auth.addHttpRoutes(http); // /api/auth/* routes for Convex Auth
http.route({ path: "/provision", method: "POST", handler: provision });
http.route({ path: "/comments", method: "POST", handler: addComment });
http.route({ path: "/comments", method: "OPTIONS", handler: commentsPreflight });
http.route({ path: "/plans", method: "POST", handler: publish });
http.route({ path: "/agent", method: "GET", handler: agentDoc });
http.route({ pathPrefix: "/p/", method: "GET", handler: view });

export default http;
