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
  return json({ id: slug, url, title, updated: result === "updated" });
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
http.route({ path: "/plans", method: "POST", handler: publish });
http.route({ pathPrefix: "/p/", method: "GET", handler: view });

export default http;
