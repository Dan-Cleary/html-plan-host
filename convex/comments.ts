import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const MAX_BODY = 2000;
const MAX_QUOTE = 400;
const MAX_NAME = 80;
const COMMENTS_PER_IP_PER_HOUR = 40;

// Public: live list of comments for a plan (newest first). No IP exposed.
export const list = query({
  args: { slug: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("comments"),
      blockIndex: v.number(),
      quote: v.string(),
      body: v.string(),
      authorName: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("comments")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .order("desc")
      .take(500);
    return rows.map((c) => ({
      _id: c._id,
      blockIndex: c.blockIndex,
      quote: c.quote,
      body: c.body,
      authorName: c.authorName,
      createdAt: c._creationTime,
    }));
  },
});

// Internal: insert a comment. Called from the IP-aware POST /comments action.
export const add = internalMutation({
  args: {
    slug: v.string(),
    blockIndex: v.number(),
    quote: v.string(),
    body: v.string(),
    authorName: v.optional(v.string()),
    ip: v.string(),
  },
  returns: v.union(v.literal("ok"), v.literal("rate_limited"), v.literal("invalid")),
  handler: async (ctx, args) => {
    const body = args.body.trim();
    if (!body || body.length > MAX_BODY) return "invalid";
    // The plan must exist (don't accept comments on nothing).
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!plan) return "invalid";

    if (args.ip !== "unknown") {
      const since = Date.now() - 60 * 60 * 1000;
      const recent = await ctx.db
        .query("comments")
        .withIndex("by_ip", (q) => q.eq("ip", args.ip))
        .collect();
      if (recent.filter((r) => r._creationTime > since).length >= COMMENTS_PER_IP_PER_HOUR) {
        return "rate_limited";
      }
    }

    const name = args.authorName?.trim().slice(0, MAX_NAME) || undefined;
    await ctx.db.insert("comments", {
      slug: args.slug,
      blockIndex: args.blockIndex,
      quote: args.quote.slice(0, MAX_QUOTE),
      body,
      authorName: name,
      ip: args.ip,
    });
    return "ok";
  },
});

// Delete a comment — only the owner of the plan it's on may do this.
export const remove = mutation({
  args: { id: v.id("comments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const comment = await ctx.db.get(args.id);
    if (!comment) return null;
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_slug", (q) => q.eq("slug", comment.slug))
      .unique();
    if (plan && plan.userId === userId) await ctx.db.delete(args.id);
    return null;
  },
});
