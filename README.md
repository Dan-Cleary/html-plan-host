# HTML Plan Host

A tiny service for hosting **HTML plan files** so coding agents (Claude Code, Codex, …)
can publish a plan/review/spec and get back a clickable URL — zero human involvement.

The loop:

1. Agent generates a self-contained HTML document.
2. Agent `POST`s it → gets a short, shareable URL back.
3. You read it in a browser or on your phone.
4. You paste the URL to another agent: "go deal with this." The URL is a
   context-passing primitive between agents, not just a human viewer.

Inspired by Anthropic's "HTML is the new Markdown" thesis and Theo's self-built plan host.

## Multi-tenant

Open sign-up (email + password via **Convex Auth**). Each user sees only their own
plans; their agents publish with a **personal API key** generated in the dashboard.
The per-plan `/p/:slug` pages stay viewable by anyone with the (unguessable) link —
that's the share mechanism.

## Architecture

- **Convex** backend (`convex/`):
  - **Auth** (`auth.ts`) — Convex Auth, email + password.
  - `POST /plans` (`http.ts`) — publish endpoint. `Authorization: Bearer <personal
    API key>` is resolved to the owning user; accepts raw HTML or `{ title, html, slug }`
    JSON. Returns `{ id, url, title, updated }`.
  - `GET /p/:slug` (`http.ts`) — renders the stored HTML as-is, `text/html`, on the
    `*.convex.site` domain, so the agent loop has no frontend dependency.
  - `plans.listMine` / `plans.myApiKeys` / `createApiKey` — per-user, auth-scoped.
- **React + Vite** frontend (`src/`) — sign-in screen → dashboard with your live plan
  list and API-key management. Deployed to Vercel.

## Setup

```sh
npm install
npx convex dev                                   # provisions the deployment, writes .env.local
npx @convex-dev/auth --web-server-url http://localhost:5173   # sets JWT keys + SITE_URL
npm run dev                                       # http://localhost:5173
```

For production, run `npx @convex-dev/auth --prod --web-server-url <your-vercel-url>`
and `npx convex deploy`.

## Agent self-provisioning + claim links

Agents can start publishing with **zero human involvement** — no signup first:

1. `publish-plan` with no key configured calls `POST /provision`, which mints an
   **anonymous workspace** (a user + API key + a one-time claim link). The key is saved
   to the config and the plan is published — all in one run.
2. The CLI prints a **claim link**. A human opens it, signs in/up, and the workspace's
   plans + API keys move to their account (and the plans become permanent).
3. Unclaimed (anonymous) workspaces are **throwaway**: their plans default to a 7-day
   TTL and a 25-plan cap, so they evaporate unless someone claims them. `/provision` is
   IP rate-limited.

So an agent on a fresh machine literally just runs `publish-plan plan.html` → it works,
and surfaces a claim link for the human to pick up later.

## The agent-facing CLI: `publish-plan`

After claiming (or via the dashboard "+ New key"), a user's key lives in
`~/.config/plan-host/config`:

```
PLAN_HOST_URL=https://<deployment>.convex.site
PLAN_HOST_TOKEN=phk_<your personal API key>
```

Usage (prints **only the URL** to stdout — easy for an agent to capture):

```sh
publish-plan plan.html
publish-plan --title "PR #39 Review" plan.html
publish-plan --slug auth-refactor plan.html   # stable URL; re-publishing the
                                               # same slug updates it in place
publish-plan --expires 7d plan.html            # auto-expire after 7d (also 12h)
cat plan.html | publish-plan          # read from stdin
```

**Stable / updatable URLs:** pass `--slug <name>` (or `slug` in the JSON body)
to control the URL. Publishing the same slug again overwrites that plan in place
(view count preserved), so the link you handed another agent stays current as the
plan is revised. Omit it to get a random unguessable slug.

There's also a global Claude Code command at `~/.claude/commands/publish-plan.md`,
so `/publish-plan` works from any repo: it writes a clean mobile-friendly HTML doc and
publishes it in one shot.

### Raw curl (for Codex / any agent)

```sh
curl -sS -X POST "$PLAN_HOST_URL/plans" \
  -H "Authorization: Bearer $PLAN_HOST_TOKEN" \
  -H "content-type: text/html" \
  --data-binary @plan.html
# -> {"id":"...","url":"https://....convex.site/p/...","title":"..."}
```

## Self-hosting

Don't want your plans on someone else's backend? This is open source — run your own
instance (see Setup above; Convex + Vercel free tiers cover it). Your plans then live on
*your* deployment. The hosted instance at html-plan-host.vercel.app is just a convenience.

## Notes / current posture

- **Privacy:** real per-user auth — your dashboard shows only your plans, and you can
  **delete** any of them. The per-plan `/p/:slug` pages stay viewable by anyone with the
  unguessable slug (the share path).
- **Expiry:** opt-in via `--expires 7d`. Expired plans 404 immediately and a daily cron
  (`convex/crons.ts`) deletes them. Omit for a permanent plan.
- **Abuse guards (hosted):** per-plan HTML capped at ~900 KB (413), max 1000 plans per
  user (429). Open sign-up still means you host strangers' HTML from the sandboxed
  `*.convex.site` domain — keep an eye on it if it gets popular.
- **API keys** are stored in plaintext so the dashboard can re-display them — fine for a
  small tool; switch to hashed-once-shown if that matters.
- **Mobile:** HTML is served as-is — agents should include `<meta name="viewport">`
  (the `/publish-plan` command does this automatically).
