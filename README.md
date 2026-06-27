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

## Architecture

- **Convex** backend (`convex/`):
  - `POST /plans` (`http.ts`) — bearer-auth'd publish endpoint. Accepts raw HTML or
    `{ title, html }` JSON. Stores it, returns `{ id, url, title }`.
  - `GET /p/:slug` (`http.ts`) — renders the stored HTML as-is, `text/html`.
  - The returned URL lives on the `*.convex.site` domain, so it renders **without**
    the frontend — the agent loop has no frontend dependency.
- **React + Vite** frontend (`src/`) — a live, real-time index of recent plans
  (`plans.listRecent`). Optional; deploy to Vercel/Convex hosting or just run locally.

## Setup

```sh
npm install
npx convex dev          # provisions the deployment, writes .env.local
npx convex env set PUBLISH_TOKEN "$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
npm run dev             # the live index at http://localhost:5173
```

## The agent-facing CLI: `publish-plan`

Installed at `~/bin/publish-plan`, configured via `~/.config/plan-host/config`:

```
PLAN_HOST_URL=https://<deployment>.convex.site
PLAN_HOST_TOKEN=<the PUBLISH_TOKEN>
```

Usage (prints **only the URL** to stdout — easy for an agent to capture):

```sh
publish-plan plan.html
publish-plan --title "PR #39 Review" plan.html
cat plan.html | publish-plan          # read from stdin
```

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

- **Privacy:** plan slugs are unguessable (36^8), but the live index page is currently
  public and lists titles + links. Fine for a personal/team tool; token-gate `listRecent`
  if that changes.
- **Size:** HTML is stored as a string field (Convex 1 MB/doc limit). Plans are well under.
- **Mobile:** HTML is served as-is — agents should include `<meta name="viewport">`
  (the `/publish-plan` command does this automatically).
