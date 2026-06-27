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

## The agent-facing CLI: `publish-plan`

Each **user** gets their own API key from the dashboard ("+ New key") and puts it in
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

## Notes / current posture

- **Privacy:** real per-user auth — your dashboard shows only your plans. The per-plan
  `/p/:slug` pages stay viewable by anyone with the unguessable slug (the share path).
- **Open sign-up:** anyone can register, which means you host arbitrary HTML from
  strangers (served from the sandboxed `*.convex.site` domain, not your apex). Inherent
  to a "publish HTML → URL" product; add per-user size/count caps before promoting widely.
- **API keys** are stored in plaintext so the dashboard can re-display them — fine for a
  small tool; switch to hashed-once-shown if that matters.
- **Size:** HTML is stored as a string field (Convex 1 MB/doc limit). Plans are well under.
- **Mobile:** HTML is served as-is — agents should include `<meta name="viewport">`
  (the `/publish-plan` command does this automatically).
