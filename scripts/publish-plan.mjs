#!/usr/bin/env node
// Publish an HTML plan and print its URL to stdout (agent-friendly).
//
// Usage:
//   publish-plan plan.html
//   publish-plan --title "PR #39 Review" plan.html
//   publish-plan --slug auth-refactor plan.html   # stable URL; re-publishing
//                                                  # the same slug updates it
//   cat plan.html | publish-plan            # read HTML from stdin
//
// Config (env wins over file): ~/.config/plan-host/config
//   PLAN_HOST_URL    e.g. https://helpful-oriole-502.convex.site
//   PLAN_HOST_TOKEN  the bearer token
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadConfig() {
  const path =
    process.env.PLAN_HOST_CONFIG || join(homedir(), ".config/plan-host/config");
  let url = process.env.PLAN_HOST_URL;
  let token = process.env.PLAN_HOST_TOKEN;
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(
        /^\s*(?:export\s+)?(PLAN_HOST_URL|PLAN_HOST_TOKEN)\s*=\s*"?([^"\n]*)"?\s*$/,
      );
      if (!m) continue;
      if (m[1] === "PLAN_HOST_URL" && !url) url = m[2];
      if (m[1] === "PLAN_HOST_TOKEN" && !token) token = m[2];
    }
  } catch {
    /* no config file — env only */
  }
  return { url, token };
}

const args = process.argv.slice(2);
let title = "";
let slug = "";
let file = "";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--title") title = args[++i];
  else if (a.startsWith("--title=")) title = a.slice(8);
  else if (a === "--slug") slug = args[++i];
  else if (a.startsWith("--slug=")) slug = a.slice(7);
  else if (a === "-h" || a === "--help") {
    console.log(
      "usage: publish-plan [--title T] [--slug S] [file.html]  (reads stdin if no file)",
    );
    process.exit(0);
  } else file = a;
}

const { url, token } = loadConfig();
if (!url || !token) {
  console.error(
    "publish-plan: set PLAN_HOST_URL and PLAN_HOST_TOKEN (env or ~/.config/plan-host/config)",
  );
  process.exit(1);
}

const html = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
if (!html.trim()) {
  console.error("publish-plan: empty HTML");
  process.exit(1);
}

// Send JSON when we have structured fields (title/slug); otherwise raw HTML.
const useJson = Boolean(title || slug);
const res = await fetch(`${url.replace(/\/$/, "")}/plans`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": useJson ? "application/json" : "text/html",
  },
  body: useJson
    ? JSON.stringify({ ...(title && { title }), ...(slug && { slug }), html })
    : html,
});

if (!res.ok) {
  console.error(`publish-plan: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
console.error(`✓ ${data.updated ? "updated" : "published"}: ${data.title}`); // stderr
console.log(data.url); // the URL on stdout, nothing else
