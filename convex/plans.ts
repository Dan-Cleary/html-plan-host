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

// Per-user limit on stored plans (abuse guard for the hosted service).
const MAX_PLANS_PER_USER = 1000;
// Anonymous (agent-provisioned, unclaimed) workspaces are throwaway: tighter cap
// and a default expiry so they evaporate unless a human claims them.
const ANON_MAX_PLANS = 25;
const ANON_PLAN_TTL_MS = 7 * 86_400_000;

// Create or update a plan by slug, scoped to an owner. Called from the HTTP
// publish action after it resolves the API key to a userId.
//   new slug          -> insert  ("created")
//   own existing slug -> overwrite title/html, preserve views ("updated")
//   someone else's    -> refuse ("conflict") — slugs are a global namespace
//   over quota         -> refuse ("limit")
export const upsert = internalMutation({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    title: v.string(),
    html: v.string(),
    expiresAt: v.optional(v.number()),
  },
  returns: v.union(
    v.literal("created"),
    v.literal("updated"),
    v.literal("conflict"),
    v.literal("limit"),
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    const isAnon = user?.isAnonymous === true;
    // Anonymous workspaces default to a TTL unless the caller set one explicitly.
    const expiresAt =
      args.expiresAt ?? (isAnon ? Date.now() + ANON_PLAN_TTL_MS : undefined);

    const existing = await ctx.db
      .query("plans")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) {
      if (existing.userId !== args.userId) return "conflict";
      await ctx.db.patch(existing._id, {
        title: args.title,
        html: args.html,
        expiresAt,
      });
      return "updated";
    }
    const mine = await ctx.db
      .query("plans")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (mine.length >= (isAnon ? ANON_MAX_PLANS : MAX_PLANS_PER_USER)) {
      return "limit";
    }
    await ctx.db.insert("plans", {
      userId: args.userId,
      slug: args.slug,
      title: args.title,
      html: args.html,
      views: 0,
      expiresAt,
    });
    return "created";
  },
});

// Public: fetch a plan's title + html for rendering at /p/:slug.
// Intentionally NOT owner-scoped — anyone with the unguessable slug can view.
export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(
    v.object({
      title: v.string(),
      html: v.string(),
      expiresAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!plan) return null;
    if (plan.expiresAt && plan.expiresAt < Date.now()) return null; // expired
    return { title: plan.title, html: plan.html, expiresAt: plan.expiresAt };
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

// The signed-in user's own plans, newest first (no HTML bodies). Excludes expired.
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("plans"),
      slug: v.string(),
      title: v.string(),
      views: v.number(),
      createdAt: v.number(),
      expiresAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const now = Date.now();
    const plans = await ctx.db
      .query("plans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    return plans
      .filter((p) => !p.expiresAt || p.expiresAt > now)
      .slice(0, 100)
      .map((p) => ({
        _id: p._id,
        slug: p.slug,
        title: p.title,
        views: p.views,
        createdAt: p._creationTime,
        expiresAt: p.expiresAt,
      }));
  },
});

// Delete one of the signed-in user's own plans.
export const deletePlan = mutation({
  args: { id: v.id("plans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const plan = await ctx.db.get(args.id);
    if (plan && plan.userId === userId) await ctx.db.delete(args.id);
    return null;
  },
});

// Cron: delete plans whose expiry has passed.
export const deleteExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db.query("plans").collect();
    let n = 0;
    for (const p of all) {
      if (p.expiresAt && p.expiresAt < now) {
        await ctx.db.delete(p._id);
        n++;
      }
    }
    return n;
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

// --- Agent self-provisioning + human claim ---

const PROVISION_PER_IP_PER_HOUR = 10;
const CLAIM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Create an anonymous workspace (user + API key + claim token). Called by the
// unauthenticated POST /provision endpoint, so it rate-limits by IP.
export const provisionWorkspace = internalMutation({
  args: { ip: v.string() },
  returns: v.union(
    v.literal("rate_limited"),
    v.object({ apiKey: v.string(), claimToken: v.string() }),
  ),
  handler: async (ctx, args) => {
    if (args.ip !== "unknown") {
      const since = Date.now() - 60 * 60 * 1000;
      const recent = await ctx.db
        .query("provisionLog")
        .withIndex("by_ip", (q) => q.eq("ip", args.ip))
        .collect();
      if (recent.filter((r) => r._creationTime > since).length >= PROVISION_PER_IP_PER_HOUR) {
        return "rate_limited";
      }
    }
    await ctx.db.insert("provisionLog", { ip: args.ip });

    const userId = await ctx.db.insert("users", { isAnonymous: true });
    const apiKey = `phk_${randomToken(32)}`;
    await ctx.db.insert("apiKeys", { userId, key: apiKey, label: "agent" });
    const claimToken = randomToken(40);
    await ctx.db.insert("claimTokens", {
      token: claimToken,
      workspaceUserId: userId,
      expiresAt: Date.now() + CLAIM_TOKEN_TTL_MS,
    });
    return { apiKey, claimToken };
  },
});

// A signed-in human claims an anonymous workspace: its plans + API keys move to
// their account and the plans become permanent. The agent's key keeps working.
export const claimWorkspace = mutation({
  args: { token: v.string() },
  returns: v.object({ claimed: v.number() }),
  handler: async (ctx, args) => {
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Sign in to claim this workspace");
    const ct = await ctx.db
      .query("claimTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!ct || ct.expiresAt < Date.now()) {
      throw new Error("This claim link is invalid or has expired");
    }
    const anonId = ct.workspaceUserId;

    const plans = await ctx.db
      .query("plans")
      .withIndex("by_user", (q) => q.eq("userId", anonId))
      .collect();
    for (const p of plans) {
      await ctx.db.patch(p._id, { userId: me, expiresAt: undefined }); // make permanent
    }
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", anonId))
      .collect();
    for (const k of keys) await ctx.db.patch(k._id, { userId: me });

    await ctx.db.delete(ct._id);
    const anon = await ctx.db.get(anonId);
    if (anon && anon.isAnonymous && anonId !== me) await ctx.db.delete(anonId);

    return { claimed: plans.length };
  },
});

// Cron: garbage-collect leftovers from anonymous provisioning.
//   - expired claim tokens
//   - stale per-IP rate-limit log rows
//   - empty, stale, unclaimed anonymous users (+ their API keys)
const ANON_GC_AGE_MS = 7 * 86_400_000;
export const gcAnonymous = internalMutation({
  args: {},
  returns: v.object({
    users: v.number(),
    tokens: v.number(),
    logs: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();

    let tokens = 0;
    for (const t of await ctx.db.query("claimTokens").collect()) {
      if (t.expiresAt < now) {
        await ctx.db.delete(t._id);
        tokens++;
      }
    }

    let logs = 0;
    const logCutoff = now - 60 * 60 * 1000;
    for (const l of await ctx.db.query("provisionLog").collect()) {
      if (l._creationTime < logCutoff) {
        await ctx.db.delete(l._id);
        logs++;
      }
    }

    let users = 0;
    for (const u of await ctx.db.query("users").collect()) {
      if (u.isAnonymous !== true) continue;
      if (now - u._creationTime < ANON_GC_AGE_MS) continue;
      const plans = await ctx.db
        .query("plans")
        .withIndex("by_user", (q) => q.eq("userId", u._id))
        .take(1);
      if (plans.length > 0) continue; // still has plans; let them expire first
      for (const k of await ctx.db
        .query("apiKeys")
        .withIndex("by_user", (q) => q.eq("userId", u._id))
        .collect()) {
        await ctx.db.delete(k._id);
      }
      await ctx.db.delete(u._id);
      users++;
    }
    return { users, tokens, logs };
  },
});

// Admin: fully delete a user by email (plans, keys, auth records). Internal-only.
//   npx convex run plans:deleteUserByEmail '{"email":"x@y.com"}' --prod
export const deleteUserByEmail = internalMutation({
  args: { email: v.string() },
  returns: v.object({ deleted: v.boolean(), plans: v.number() }),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) return { deleted: false, plans: 0 };

    let plans = 0;
    for (const p of await ctx.db
      .query("plans")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) {
      await ctx.db.delete(p._id);
      plans++;
    }
    for (const k of await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) {
      await ctx.db.delete(k._id);
    }
    for (const s of await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .collect()) {
      for (const rt of await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect()) {
        await ctx.db.delete(rt._id);
      }
      await ctx.db.delete(s._id);
    }
    for (const a of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
      .collect()) {
      await ctx.db.delete(a._id);
    }
    await ctx.db.delete(user._id);
    return { deleted: true, plans };
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

// Wipe test data for a clean slate: all plans + comments + claim tokens +
// provision log, plus throwaway anonymous workspaces and their keys. KEEPS real
// signed-up users and their API keys, so a human can re-test without re-auth.
export const resetTestData = internalMutation({
  args: {},
  returns: v.object({
    plans: v.number(),
    comments: v.number(),
    claimTokens: v.number(),
    provisionLog: v.number(),
    anonUsers: v.number(),
    anonKeys: v.number(),
  }),
  handler: async (ctx) => {
    let plans = 0;
    for (const p of await ctx.db.query("plans").collect()) {
      await ctx.db.delete(p._id);
      plans++;
    }
    let comments = 0;
    for (const c of await ctx.db.query("comments").collect()) {
      await ctx.db.delete(c._id);
      comments++;
    }
    let claimTokens = 0;
    for (const t of await ctx.db.query("claimTokens").collect()) {
      await ctx.db.delete(t._id);
      claimTokens++;
    }
    let provisionLog = 0;
    for (const l of await ctx.db.query("provisionLog").collect()) {
      await ctx.db.delete(l._id);
      provisionLog++;
    }
    const anonIds = new Set<string>();
    let anonUsers = 0;
    for (const u of await ctx.db.query("users").collect()) {
      if (u.isAnonymous === true) {
        anonIds.add(u._id);
        await ctx.db.delete(u._id);
        anonUsers++;
      }
    }
    let anonKeys = 0;
    for (const k of await ctx.db.query("apiKeys").collect()) {
      if (anonIds.has(k.userId)) {
        await ctx.db.delete(k._id);
        anonKeys++;
      }
    }
    return { plans, comments, claimTokens, provisionLog, anonUsers, anonKeys };
  },
});
