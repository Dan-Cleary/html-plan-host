import { useState, useEffect } from "react";
import {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useConvexAuth,
  useQuery,
  useMutation,
} from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import PlanView from "./PlanView";
import "./App.css";

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

function SignIn({ intro }: { intro?: string }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="gate">
      <h1>
        <span className="dot" /> HTML Plan Host
      </h1>
      <p className="muted">
        {intro ??
          "Publish HTML plans from your coding agents and get a shareable URL."}{" "}
        {flow === "signIn" ? "Sign in" : "Create an account"} to start.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          const data = new FormData(e.currentTarget);
          data.set("flow", flow);
          try {
            await signIn("password", data);
          } catch {
            setError(
              flow === "signIn"
                ? "Couldn't sign in — check your email and password."
                : "Couldn't sign up — that email may already be registered.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <input name="email" type="email" placeholder="Email" autoComplete="email" required />
        <input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? "…" : flow === "signIn" ? "Sign in" : "Sign up"}
        </button>
      </form>
      {error && <p className="err">{error}</p>}
      <button
        className="link"
        onClick={() => {
          setError(null);
          setFlow(flow === "signIn" ? "signUp" : "signIn");
        }}
      >
        {flow === "signIn"
          ? "Need an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
      <p className="muted small selfhost">
        Your plans are private to you. Prefer to keep them off our backend? It's
        open source —{" "}
        <a href="https://github.com/Dan-Cleary/html-plan-host" target="_blank" rel="noreferrer">
          run your own instance
        </a>
        .
      </p>
    </div>
  );
}

function ApiKeys() {
  const keys = useQuery(api.plans.myApiKeys);
  const create = useMutation(api.plans.createApiKey);
  const revoke = useMutation(api.plans.revokeApiKey);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  return (
    <section className="keys">
      <div className="keys-head">
        <h2>API keys</h2>
        <button className="mini" onClick={() => void create({})}>
          + New key
        </button>
      </div>
      <p className="muted small">
        Generate a key and hand it to your coding agent — that's all it needs to
        publish. Point the agent at{" "}
        <a href="/llms.txt" target="_blank" rel="noreferrer">
          /llms.txt
        </a>{" "}
        for the full recipe, or give it this one-liner:
      </p>
      <pre className="snippet">
        curl -X POST {SITE_URL}/plans \{"\n"}
        {"  "}-H "Authorization: Bearer &lt;your key below&gt;" \{"\n"}
        {"  "}-H "content-type: application/json" \{"\n"}
        {"  "}-d '{"{"}"html":"&lt;!doctype html&gt;&lt;h1&gt;Hello&lt;/h1&gt;"{"}"}'
      </pre>
      {keys === undefined ? (
        <p className="muted">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="muted">No keys yet — generate one to let your agents publish.</p>
      ) : (
        <ul className="keylist">
          {keys.map((k) => (
            <li key={k._id}>
              <code className="key">{k.key}</code>
              <button className="mini" onClick={() => copy(k.key, k._id)}>
                {copied === k._id ? "Copied" : "Copy"}
              </button>
              <button className="mini danger" onClick={() => void revoke({ id: k._id })}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function expiryLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const d = ms / 86_400_000;
  if (d >= 1) return `expires in ${Math.round(d)}d`;
  const h = ms / 3_600_000;
  return h >= 1 ? `expires in ${Math.round(h)}h` : "expires soon";
}

function Dashboard() {
  const { signOut } = useAuthActions();
  const plans = useQuery(api.plans.listMine);
  const del = useMutation(api.plans.deletePlan);

  return (
    <>
      <header className="head">
        <h1>
          <span className="dot" /> HTML Plan Host
          <button className="link signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </h1>
        <p className="sub">Your published plans, newest first — live.</p>
      </header>

      <ApiKeys />

      <h2 className="plans-title">Plans</h2>
      {plans === undefined ? (
        <p className="muted">Loading…</p>
      ) : plans.length === 0 ? (
        <div className="empty">
          <p>No plans yet.</p>
          <p className="muted">
            Publish one with <code>publish-plan plan.html</code>
          </p>
        </div>
      ) : (
        <ul className="list">
          {plans.map((p) => (
            <li key={p.slug} className="row">
              <a className="card" href={`/p/${p.slug}`}>
                <span className="title">{p.title}</span>
                <span className="meta">
                  <span className="slug">/{p.slug}</span>
                  <span>{timeAgo(p.createdAt)}</span>
                  <span>
                    {p.views} {p.views === 1 ? "view" : "views"}
                  </span>
                  {p.expiresAt && <span className="exp">{expiryLabel(p.expiresAt)}</span>}
                </span>
              </a>
              <button
                className="mini danger del"
                title="Delete plan"
                onClick={() => void del({ id: p._id })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ClaimPage({ token }: { token: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const claim = useMutation(api.plans.claimWorkspace);
  const [status, setStatus] = useState<"idle" | "claiming" | "done" | "error">("idle");
  const [claimed, setClaimed] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated || status !== "idle") return;
    setStatus("claiming");
    claim({ token })
      .then((r) => {
        setClaimed(r.claimed);
        setStatus("done");
      })
      .catch((e) => {
        setError(String(e?.message ?? e).replace(/^.*Error:\s*/, ""));
        setStatus("error");
      });
  }, [isAuthenticated, status, claim, token]);

  if (isLoading) return <p className="muted">Loading…</p>;
  if (!isAuthenticated) {
    return (
      <SignIn intro="You're claiming a workspace an agent created for you. Its plans will move to your account and become permanent." />
    );
  }
  return (
    <div className="gate">
      <h1>
        <span className="dot" /> HTML Plan Host
      </h1>
      {status === "claiming" && <p className="muted">Claiming…</p>}
      {status === "done" && (
        <>
          <p>
            Workspace claimed — {claimed} {claimed === 1 ? "plan" : "plans"} added to
            your account.
          </p>
          <a className="mini" href="/">
            Go to dashboard
          </a>
        </>
      )}
      {status === "error" && (
        <>
          <p className="err">{error}</p>
          <a className="mini" href="/">
            Go to dashboard
          </a>
        </>
      )}
    </div>
  );
}

function App() {
  const path = window.location.pathname;
  const claimMatch = path.match(/^\/claim\/(.+)$/);
  const planMatch = path.match(/^\/(?:plan|p)\/(.+)$/);

  if (planMatch) {
    return <PlanView slug={decodeURIComponent(planMatch[1])} />;
  }

  return (
    <main className="wrap">
      {claimMatch ? (
        <ClaimPage token={claimMatch[1]} />
      ) : (
        <>
          <AuthLoading>
            <p className="muted">Loading…</p>
          </AuthLoading>
          <Unauthenticated>
            <SignIn />
          </Unauthenticated>
          <Authenticated>
            <Dashboard />
          </Authenticated>
        </>
      )}
    </main>
  );
}

export default App;
