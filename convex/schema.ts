import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  plans: defineTable({
    // Short, URL-safe public identifier used in /p/:slug.
    slug: v.string(),
    // Human-readable title (from request, or extracted from <title>/<h1>).
    title: v.string(),
    // The raw HTML document, served as-is.
    html: v.string(),
    // How many times the plan has been viewed.
    views: v.number(),
  }).index("by_slug", ["slug"]),
});
