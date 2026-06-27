import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Insert a new plan. Called only from the HTTP publish action.
export const create = internalMutation({
  args: { slug: v.string(), title: v.string(), html: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("plans", { ...args, views: 0 });
    return null;
  },
});

// Fetch a plan's title + html for rendering. Returns null if not found.
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

// Bump the view counter for a plan.
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

// Maintenance: delete every plan. Internal-only (not callable from clients).
// Run with: npx convex run plans:clearAll '{}' --prod
export const clearAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const all = await ctx.db.query("plans").collect();
    for (const p of all) await ctx.db.delete(p._id);
    return all.length;
  },
});

// Metadata for the live index page (no HTML bodies, kept light).
export const listRecent = query({
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
    const plans = await ctx.db.query("plans").order("desc").take(100);
    return plans.map((p) => ({
      slug: p.slug,
      title: p.title,
      views: p.views,
      createdAt: p._creationTime,
    }));
  },
});
