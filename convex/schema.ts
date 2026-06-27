import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Convex Auth tables (users, authAccounts, authSessions, ...).
  ...authTables,

  plans: defineTable({
    // Owner. Optional so pre-multi-tenant plans remain valid; new plans always
    // set it. Plans only appear in their owner's dashboard.
    userId: v.optional(v.id("users")),
    // Short, URL-safe public identifier used in /p/:slug. Globally unique.
    slug: v.string(),
    // Human-readable title (from request, or extracted from <title>/<h1>).
    title: v.string(),
    // The raw HTML document, served as-is.
    html: v.string(),
    // How many times the plan has been viewed.
    views: v.number(),
    // Optional auto-expiry (ms epoch). Past this, the plan 404s and a daily
    // cron deletes it. Omitted = permanent.
    expiresAt: v.optional(v.number()),
  })
    .index("by_slug", ["slug"])
    .index("by_user", ["userId"]),

  // Per-user API keys: agents publish with one of these (Bearer token) and the
  // publish endpoint resolves it to the owning user.
  apiKeys: defineTable({
    userId: v.id("users"),
    key: v.string(),
    label: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_user", ["userId"]),

  // One-time links that let a human claim an anonymous (agent-provisioned)
  // workspace, taking ownership of its plans + keys.
  claimTokens: defineTable({
    token: v.string(),
    workspaceUserId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // Lightweight per-IP log to rate-limit anonymous provisioning.
  provisionLog: defineTable({
    ip: v.string(),
  }).index("by_ip", ["ip"]),
});
