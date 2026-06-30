import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import DOMPurify from "dompurify";
import { api } from "../convex/_generated/api";
import "./PlanView.css";

const CLOUD_URL = import.meta.env.VITE_CONVEX_URL as string;
const SITE_URL =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ||
  CLOUD_URL.replace(".convex.cloud", ".convex.site");

const NAME_KEY = "planHostCommenterName";
const BLOCK_SELECTOR =
  "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,figcaption,dt,dd,img";

// Hover affordance + clickability only appear in comment mode (body.commenting),
// so the default view reads like a plain rendered page. A comment's block is
// only highlighted on demand — when you hover (.cmt-hover) or click (.cmt-flash)
// that comment in the sidebar. Nothing is persistently colored.
const FRAME_STYLE = `
  body.commenting [data-pi]{cursor:pointer;}
  body.commenting [data-pi]:hover{outline:2px solid rgba(34,197,94,.5);outline-offset:2px;}
  .cmt-hover{background:rgba(245,158,11,.16);box-shadow:inset 3px 0 0 #f59e0b;}
  .cmt-flash{animation:cmtflash 1.1s ease-out;}
  @keyframes cmtflash{0%{background:rgba(34,197,94,.45);}100%{background:transparent;}}
`;

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// "in 6 days" / "in 5 hours" / "soon" — for the temporary-plan banner.
function expiresInLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "soon";
  const d = ms / 86_400_000;
  if (d >= 1) return `in ${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}`;
  const h = ms / 3_600_000;
  if (h >= 1) return `in ${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  return "soon";
}

const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export default function PlanView({ slug }: { slug: string }) {
  const plan = useQuery(api.plans.getBySlug, { slug });
  const comments = useQuery(api.comments.list, { slug });
  const removeComment = useMutation(api.comments.remove);
  const { isAuthenticated } = useConvexAuth();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<Document | null>(null);
  const onPickRef = useRef<(idx: number, quote: string) => void>(() => {});
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  // Resolved comment -> current DOM element (after re-anchoring by content).
  const commentElsRef = useRef<Map<string, Element>>(new Map());
  const [orphanedIds, setOrphanedIds] = useState<Set<string>>(new Set());

  // Single-URL design: the page renders the plan clean by default; commenting is
  // a mode you toggle on. `commenting` drives both the layout and whether blocks
  // are clickable (gated through a ref so the iframe click listener stays fresh).
  const [commenting, setCommenting] = useState(false);
  const commentingRef = useRef(commenting);
  commentingRef.current = commenting;

  // Resolve each comment to a current block (for hover/click highlighting and
  // orphan detection) WITHOUT painting anything persistent. Resolution: trust the
  // stored index if its text still matches the quote; else search all blocks for
  // the quoted text (handles re-published plans whose indices shifted); else the
  // section is gone -> orphaned.
  const resolveAnchors = () => {
    const doc = docRef.current;
    const cs = commentsRef.current;
    if (!doc || !cs) return;
    const blocks = Array.from(doc.querySelectorAll("[data-pi]"));
    const elById = new Map<string, Element>();
    const orphans = new Set<string>();
    for (const c of cs) {
      const q = norm(c.quote);
      let el: Element | null = doc.querySelector(`[data-pi="${c.blockIndex}"]`);
      if (!(el && q && norm(el.textContent || "").includes(q))) {
        el = q ? blocks.find((b) => norm(b.textContent || "").includes(q)) ?? null : el;
      }
      if (el) elById.set(c._id, el);
      else orphans.add(c._id);
    }
    commentElsRef.current = elById;
    setOrphanedIds((prev) => (sameSet(prev, orphans) ? prev : orphans));
  };

  // Transient highlight while hovering a comment in the sidebar.
  function setCommentHover(id: string, on: boolean) {
    commentElsRef.current.get(id)?.classList.toggle("cmt-hover", on);
  }

  const [active, setActive] = useState<{ idx: number; quote: string } | null>(null);
  const [body, setBody] = useState("");
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [posting, setPosting] = useState(false);
  const [copied, setCopied] = useState(false);

  onPickRef.current = (idx, quote) => setActive({ idx, quote });

  const pageUrl = `${window.location.origin}/p/${slug}`;

  // Sanitize + tag block elements with a stable index, as a full srcDoc.
  const srcDoc = useMemo(() => {
    if (!plan) return "";
    const clean = DOMPurify.sanitize(plan.html, {
      WHOLE_DOCUMENT: true,
      ADD_TAGS: ["style"],
      // Sole XSS guard now that the iframe isn't sandboxed: DOMPurify already
      // drops <script> and on* handlers; also forbid tags that could pull in
      // external/active content.
      FORBID_TAGS: ["iframe", "object", "embed", "base", "form"],
    });
    const doc = new DOMParser().parseFromString(clean, "text/html");
    let i = 0;
    doc.body.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
      el.setAttribute("data-pi", String(i++));
    });
    const style = doc.createElement("style");
    style.textContent = FRAME_STYLE;
    doc.head.appendChild(style);
    return "<!doctype html>" + doc.documentElement.outerHTML;
  }, [plan]);

  // Wire up the iframe's document: size it, reflect comment-mode, and attach the
  // click-to-comment listener. Idempotent (a `wired` flag stops double-binding)
  // and only proceeds once the srcDoc content is actually in place — detected by
  // the presence of a [data-pi] block. Returns true once wired.
  const wireDoc = () => {
    const doc = iframeRef.current?.contentDocument ?? null;
    if (!doc || !doc.body || !doc.querySelector("[data-pi]")) return false;
    docRef.current = doc;
    const fit = () => {
      if (!iframeRef.current) return;
      const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      iframeRef.current.style.height = `${h + 48}px`;
    };
    fit();
    setTimeout(fit, 150);
    setTimeout(fit, 500);
    doc.body.classList.toggle("commenting", commentingRef.current);
    if (doc.body.dataset.wired !== "1") {
      doc.body.dataset.wired = "1";
      // Listen on the document (not just body) — more reliable across browsers.
      doc.addEventListener("click", (e) => {
        if (!commentingRef.current) return;
        const el = (e.target as Element | null)?.closest?.("[data-pi]");
        if (!el) return;
        const idx = Number(el.getAttribute("data-pi"));
        const quote = (el.textContent || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 300);
        onPickRef.current(idx, quote);
      });
    }
    resolveAnchors();
    return true;
  };

  const onFrameLoad = () => {
    wireDoc();
  };

  // Wire the iframe when its srcDoc changes. The `load` event timing is
  // unreliable for srcDoc iframes (notably in Safari), so poll until the
  // document is ready rather than trusting onLoad alone.
  useEffect(() => {
    if (!srcDoc) return;
    if (wireDoc()) return;
    let n = 0;
    const iv = setInterval(() => {
      if (wireDoc() || ++n > 40) clearInterval(iv);
    }, 50);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDoc]);

  // Re-resolve comment anchors whenever comments change.
  useEffect(() => {
    resolveAnchors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

  // Reflect comment-mode into the iframe (hover affordance + clickability).
  useEffect(() => {
    docRef.current?.body?.classList.toggle("commenting", commenting);
  }, [commenting]);

  function toggleCommenting() {
    setCommenting((on) => {
      if (on) setActive(null); // leaving comment mode closes any open composer
      return !on;
    });
  }

  function scrollToComment(id: string) {
    const el = commentElsRef.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("cmt-flash");
    setTimeout(() => el.classList.remove("cmt-flash"), 1100);
  }

  async function post() {
    if (!active || !body.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`${SITE_URL}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          blockIndex: active.idx,
          quote: active.quote,
          body: body.trim(),
          authorName: name.trim() || undefined,
        }),
      });
      if (res.ok) {
        if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
        setBody("");
        setActive(null);
      } else {
        alert(res.status === 429 ? "Slow down — too many comments." : "Couldn't post comment.");
      }
    } finally {
      setPosting(false);
    }
  }

  if (plan === undefined) return <p className="muted pv-load">Loading…</p>;
  if (plan === null)
    return (
      <div className="pv-load">
        <p>This plan doesn't exist or has expired.</p>
        <a className="mini" href="/">Home</a>
      </div>
    );

  const count = comments?.length ?? 0;

  return (
    <div className={`planview ${commenting ? "commenting" : ""}`}>
      <div className="pv-main">
        <div className="pv-bar">
          <a className="pv-back" href="/">← plans</a>
          <span className="pv-title">{plan.title}</span>
          <button
            className="mini"
            onClick={() => {
              void navigator.clipboard.writeText(pageUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            title="Copy this page's URL"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            className={`mini ${commenting ? "primary" : ""}`}
            onClick={toggleCommenting}
            title={commenting ? "Done commenting" : "Comment on the plan"}
          >
            {commenting ? "Done" : `💬 Comments${count ? ` (${count})` : ""}`}
          </button>
        </div>
        {plan.expiresAt && (
          <p className="pv-expiry" title="Anonymous plans are temporary. Claim the workspace to keep it permanently.">
            ⏳ Temporary — this plan expires {expiresInLabel(plan.expiresAt)}.
          </p>
        )}
        {commenting && (
          <p className="pv-hint">Click any part of the plan to comment on it.</p>
        )}
        {/* No `sandbox` attr: Safari treats a sandboxed srcdoc as an opaque
            origin, which blocks the parent from reaching contentDocument to wire
            click-to-comment. DOMPurify (below) is the XSS guard — it strips all
            scripts/handlers — and the iframe boundary alone isolates plan CSS. */}
        <iframe
          ref={iframeRef}
          className="pv-frame"
          srcDoc={srcDoc}
          onLoad={onFrameLoad}
          title={plan.title}
        />
      </div>

      {commenting && (
        <aside className="pv-side">
          <h2>Comments {comments ? `(${count})` : ""}</h2>

          {active && (
            <div className="pv-composer">
              <div className="pv-quote">“{active.quote.slice(0, 120)}{active.quote.length > 120 ? "…" : ""}”</div>
              <textarea
                autoFocus
                placeholder="Your comment…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <input
                placeholder="Your name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="pv-composer-actions">
                <button className="mini" onClick={() => setActive(null)}>Cancel</button>
                <button className="mini primary" disabled={posting || !body.trim()} onClick={() => void post()}>
                  {posting ? "…" : "Post"}
                </button>
              </div>
            </div>
          )}

          {comments === undefined ? (
            <p className="muted">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="muted">No comments yet. Click a section of the plan to add one.</p>
          ) : (
            <ul className="pv-comments">
              {comments.map((c) => (
                <li key={c._id} className="pv-comment">
                  {orphanedIds.has(c._id) ? (
                    <span className="pv-cquote pv-orphan" title="The section this referenced changed or was removed when the plan was re-published.">
                      ⚠ section changed — “{c.quote.slice(0, 60)}{c.quote.length > 60 ? "…" : ""}”
                    </span>
                  ) : (
                    <button
                      className="pv-cquote"
                      onClick={() => scrollToComment(c._id)}
                      onMouseEnter={() => setCommentHover(c._id, true)}
                      onMouseLeave={() => setCommentHover(c._id, false)}
                    >
                      “{c.quote.slice(0, 80) || "(section)"}{c.quote.length > 80 ? "…" : ""}”
                    </button>
                  )}
                  <div className="pv-cbody">{c.body}</div>
                  <div className="pv-cmeta">
                    <span>{c.authorName || "Anonymous"}</span>
                    <span>{timeAgo(c.createdAt)}</span>
                    {isAuthenticated && (
                      <button className="pv-del" onClick={() => void removeComment({ id: c._id })}>
                        delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}
