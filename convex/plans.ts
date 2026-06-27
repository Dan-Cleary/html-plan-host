import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function randomToken(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

// Create or update a plan by slug, scoped to an owner. Called from the HTTP
// publish action after it resolves the API key to a userId.
//   new slug          -> insert  ("created")
//   own existing slug -> overwrite title/html, preserve views ("updated")
//   someone else's    -> refuse ("conflict") — slugs are a global namespace
export const upsert = internalMutation({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    title: v.string(),
    html: v.string(),
  },
  returns: v.union(
    v.literal("created"),
    v.literal("updated"),
    v.literal("conflict"),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) {
      if (existing.userId !== args.userId) return "conflict";
      await ctx.db.patch(existing._id, { title: args.title, html: args.html });
      return "updated";
    }
    await ctx.db.insert("plans", {
      userId: args.userId,
      slug: args.slug,
      title: args.title,
      html: args.html,
      views: 0,
    });
    return "created";
  },
});

// Public: fetch a plan's title + html for rendering at /p/:slug.
// Intentionally NOT owner-scoped — anyone with the unguessable slug can view.
export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(v.object({ title: v.string(), html: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    return plan ? { title: plan.title, html: plan.html } : null;
  },
});

export const incrementViews = internalMutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (plan) await ctx.db.patch(plan._id, { views: plan.views + 1 });
    return null;
  },
});

// The signed-in user's own plans, newest first (no HTML bodies).
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      slug: v.string(),
      title: v.string(),
      views: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const plans = await ctx.db
      .query("plans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return plans.map((p) => ({
      slug: p.slug,
      title: p.title,
      views: p.views,
      createdAt: p._creationTime,
    }));
  },
});

// Resolve an API key to its owning user. Internal; used by the publish action.
export const userIdByApiKey = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("apiKeys")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return row ? row.userId : null;
  },
});

// --- API key management (signed-in users) ---

export const myApiKeys = query({
  args: {},
  returns: v.array(
    v.object({ _id: v.id("apiKeys"), key: v.string(), label: v.string() }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return keys.map((k) => ({ _id: k._id, key: k.key, label: k.label }));
  },
});

export const createApiKey = mutation({
  args: { label: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const key = `phk_${randomToken(32)}`;
    await ctx.db.insert("apiKeys", {
      userId,
      key,
      label: args.label?.trim() || "default",
    });
    return key;
  },
});

export const revokeApiKey = mutation({
  args: { id: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (row && row.userId === userId) await ctx.db.delete(args.id);
    return null;
  },
});

// Admin maintenance: delete every plan. Internal-only.
//   npx convex run plans:clearAll '{}' --prod
export const clearAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const all = await ctx.db.query("plans").collect();
    for (const p of all) await ctx.db.delete(p._id);
    return all.length;
  },
});
