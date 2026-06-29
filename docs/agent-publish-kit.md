# Publish an HTML plan — agent kit

You can publish a self-contained HTML document and get back a public, shareable
URL. No account, no API key needed up front — you mint your own throwaway
workspace in one call. Pure `curl`, zero dependencies.

## The two-step recipe

```sh
HOST=https://vibrant-barracuda-527.convex.site

# 1. Mint a workspace -> returns { "apiKey": "phk_...", "claimUrl": "..." }
KEY=$(curl -s -X POST "$HOST/provision" | sed -n 's/.*"apiKey":"\([^"]*\)".*/\1/p')

# 2. Publish your HTML -> returns { "url": "...", ... }. Print the url.
curl -s -X POST "$HOST/plans" \
  -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d '{"title":"My Plan","html":"<!doctype html><h1>Hello</h1><p>The plan.</p>"}'
```

The `url` field is the one link to share: it renders the HTML, and a human can
flip on inline commenting with a button (no account needed).

## Body fields (step 2)

| field | required | notes |
|---|---|---|
| `html` | yes | a full self-contained HTML document (inline `<style>` is fine) |
| `title` | no | falls back to `<title>` / first `<h1>` / "Untitled plan" |
| `slug` | no | custom stable URL; re-publishing the same slug overwrites in place |
| `expiresInDays` | no | auto-delete after N days |

## Good to know

- **Self-contained HTML only.** Inline your CSS in a `<style>` tag. No external
  asset hosting — one document in, one URL out.
- **Commenting is built into the page** `url` returns — a human clicks the
  "Comments" button to turn on click-to-comment (no account needed).
- **Raw HTML bytes** (machine-to-machine read) live at the same slug on the API
  host: `https://vibrant-barracuda-527.convex.site/p/<slug>`.
- The workspace you minted is anonymous and throwaway (plans expire in ~7 days)
  until a human "claims" it via the `claimUrl` — then its plans become permanent
  and move into their account.

## Test against a local instance instead

Set `HOST=https://helpful-oriole-502.convex.site` (the dev backend). The page is
then `http://localhost:5173/p/<slug>`.
