import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

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
// Auth: Authorization: Bearer <PUBLISH_TOKEN>
// Body: raw HTML, or JSON { title?, html }
// Returns: { id, url, title }
const publish = httpAction(async (ctx, request) => {
  const expected = process.env.PUBLISH_TOKEN;
  const auth = request.headers.get("Authorization") ?? "";
  if (!expected || auth !== `Bearer ${expected}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let html = "";
  let title = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { title?: unknown; html?: unknown };
    html = typeof body.html === "string" ? body.html : "";
    title = typeof body.title === "string" ? body.title : "";
  } else {
    html = await request.text();
  }

  if (!html.trim()) return json({ error: "missing html" }, 400);
  if (!title) title = extractTitle(html);

  const slug = makeSlug();
  await ctx.runMutation(internal.plans.create, { slug, title, html });
  const url = `${process.env.CONVEX_SITE_URL}/p/${slug}`;
  return json({ id: slug, url, title });
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
http.route({ path: "/plans", method: "POST", handler: publish });
http.route({ pathPrefix: "/p/", method: "GET", handler: view });

export default http;
