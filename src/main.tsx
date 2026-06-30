import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
const root = createRoot(document.getElementById("root")!);

// Plan pages are public and read-mostly: render them on a lean path with no auth
// provider (and no auth bundle), so they boot fast. Everything else gets the full
// auth app. Each branch dynamically imports its code so the chunks stay separate.
const planMatch = window.location.pathname.match(/^\/(?:p|plan)\/(.+)$/);

if (planMatch) {
  const slug = decodeURIComponent(planMatch[1]);
  void import("./PlanView").then(({ default: PlanView }) => {
    root.render(
      <StrictMode>
        <ConvexProvider client={convex}>
          <PlanView slug={slug} />
        </ConvexProvider>
      </StrictMode>,
    );
  });
} else {
  void Promise.all([
    import("@convex-dev/auth/react"),
    import("./App"),
  ]).then(([{ ConvexAuthProvider }, { default: App }]) => {
    root.render(
      <StrictMode>
        <ConvexAuthProvider client={convex}>
          <App />
        </ConvexAuthProvider>
      </StrictMode>,
    );
  });
}
