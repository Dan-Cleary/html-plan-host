import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import "./App.css";

// Derive the HTTP-actions (.convex.site) origin from the client URL so the
// frontend only needs VITE_CONVEX_URL set in production.
const CLOUD_URL = import.meta.env.VITE_CONVEX_URL as string;
const SITE_URL =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ||
  CLOUD_URL.replace(".convex.cloud", ".convex.site");

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function App() {
  const plans = useQuery(api.plans.listRecent);

  return (
    <main className="wrap">
      <header className="head">
        <h1>
          <span className="dot" /> HTML Plan Host
        </h1>
        <p className="sub">
          Plans your agents publish, live. Newest first — this list updates in
          real time as plans come in.
        </p>
      </header>

      {plans === undefined ? (
        <p className="muted">Loading…</p>
      ) : plans.length === 0 ? (
        <div className="empty">
          <p>No plans yet.</p>
          <p className="muted">
            Publish one with{" "}
            <code>POST {SITE_URL}/plans</code>
          </p>
        </div>
      ) : (
        <ul className="list">
          {plans.map((p) => (
            <li key={p.slug}>
              <a className="card" href={`${SITE_URL}/p/${p.slug}`} target="_blank" rel="noreferrer">
                <span className="title">{p.title}</span>
                <span className="meta">
                  <span className="slug">/{p.slug}</span>
                  <span>{timeAgo(p.createdAt)}</span>
                  <span>{p.views} {p.views === 1 ? "view" : "views"}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default App;
