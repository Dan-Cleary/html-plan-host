import { useState } from "react";
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

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const AGENT_PROMPT =
  "Read https://html-plan-host.vercel.app/llms.txt and follow it to publish an HTML plan, then give me the shareable URL.";

function SignIn({ intro }: { intro?: string }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
      <div className="agents-cta">
        <span className="muted small">Publishing from a coding agent?</span>
        <button
          className="mini"
          onClick={() => {
            void navigator.clipboard.writeText(AGENT_PROMPT);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copy a ready-to-paste prompt for Claude Code, Codex, etc."
        >
          {copied ? "Copied" : "Copy agent prompt"}
        </button>
        <a className="muted small" href="/llms.txt" target="_blank" rel="noreferrer">
          or read llms.txt
        </a>
      </div>

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

const MAX_API_KEYS = 10;
const maskKey = (k: string) => `${k.slice(0, 8)}…${k.slice(-4)}`;

function ApiKeys() {
  const keys = useQuery(api.plans.myApiKeys);
  const create = useMutation(api.plans.createApiKey);
  const revoke = useMutation(api.plans.revokeApiKey);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const copy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };
  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const count = keys?.length ?? 0;
  const atCap = count >= MAX_API_KEYS;

  return (
    <section className="keys">
      <div className="keys-head">
        <h2>API keys</h2>
        <button
          className="mini"
          disabled={atCap}
          title={atCap ? `Limit ${MAX_API_KEYS} — revoke one first` : "Generate a new key"}
          onClick={() => void create({})}
        >
          + New key
        </button>
      </div>
      <p className="muted small">
        Generate a key and hand it to your coding agent — that's all it needs to
        publish. Point it at{" "}
        <a href="/llms.txt" target="_blank" rel="noreferrer">/llms.txt</a> for how.
      </p>
      <button
        className="mini"
        onClick={() => copy(AGENT_PROMPT, "prompt")}
        title="Copy a ready-to-paste prompt for your agent"
      >
        {copied === "prompt" ? "Copied" : "Copy agent prompt"}
      </button>

      {keys === undefined ? (
        <p className="muted">Loading…</p>
      ) : count === 0 ? (
        <p className="muted">No keys yet — generate one to let your agents publish.</p>
      ) : (
        <div className="keys-block">
          <button className="link keys-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "▾" : "▸"} {open ? "Hide" : "Show"} keys ({count})
          </button>
          {open && (
            <ul className="keylist">
              {keys.map((k) => (
                <li key={k._id}>
                  <code className="key">
                    {revealed.has(k._id) ? k.key : maskKey(k.key)}
                  </code>
                  <button className="mini" onClick={() => toggleReveal(k._id)}>
                    {revealed.has(k._id) ? "Hide" : "Reveal"}
                  </button>
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
        </div>
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
  const preview = useQuery(api.plans.claimPreview, { token });
  const claim = useMutation(api.plans.claimWorkspace);
  const [status, setStatus] = useState<"idle" | "claiming" | "done" | "error">("idle");
  const [claimed, setClaimed] = useState(0);
  const [error, setError] = useState("");

  const count = preview?.count ?? 0;
  const planWord = count === 1 ? "plan" : "plans";

  if (isLoading || preview === undefined) return <p className="muted">Loading…</p>;

  // Invalid / expired token — nothing to claim.
  if (preview === null) {
    return (
      <div className="gate">
        <h1>
          <span className="dot" /> HTML Plan Host
        </h1>
        <p className="err">This claim link is invalid or has expired.</p>
        <a className="mini" href="/">Go to dashboard</a>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <SignIn
        intro={`You're claiming a workspace an agent created for you — ${count} ${planWord}. Sign in and they'll move to your account and become permanent.`}
      />
    );
  }

  async function doClaim() {
    setStatus("claiming");
    try {
      const r = await claim({ token });
      setClaimed(r.claimed);
      setStatus("done");
    } catch (e) {
      setError(String((e as Error)?.message ?? e).replace(/^.*Error:\s*/, ""));
      setStatus("error");
    }
  }

  return (
    <div className="gate">
      <h1>
        <span className="dot" /> HTML Plan Host
      </h1>
      {status === "idle" && (
        <>
          <p>
            Claim this workspace? Its {count} {planWord} will move to your account
            and stop expiring.
          </p>
          {preview.titles.length > 0 && (
            <ul className="claim-list">
              {preview.titles.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
              {count > preview.titles.length && (
                <li className="muted">+ {count - preview.titles.length} more</li>
              )}
            </ul>
          )}
          <button className="mini primary" onClick={() => void doClaim()}>
            Claim {count} {planWord}
          </button>
        </>
      )}
      {status === "claiming" && <p className="muted">Claiming…</p>}
      {status === "done" && (
        <>
          <p>
            Workspace claimed — {claimed} {claimed === 1 ? "plan" : "plans"} added to
            your account.
          </p>
          <a className="mini" href="/">Go to dashboard</a>
        </>
      )}
      {status === "error" && (
        <>
          <p className="err">{error}</p>
          <a className="mini" href="/">Go to dashboard</a>
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
