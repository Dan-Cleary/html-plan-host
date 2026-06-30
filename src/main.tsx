import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import PlanView from "./PlanView";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
const root = createRoot(document.getElementById("root")!);

// Plan pages are public and read-mostly. Render them directly (PlanView is in the
// entry chunk, so there's no extra round-trip to fetch it) with a plain Convex
// provider — no auth provider and no auth bundle. Everything else dynamically
// imports the auth app, keeping the auth/dashboard code off the plan-page path.
const planMatch = window.location.pathname.match(/^\/(?:p|plan)\/(.+)$/);

if (planMatch) {
  root.render(
    <StrictMode>
      <ConvexProvider client={convex}>
        <PlanView slug={decodeURIComponent(planMatch[1])} />
      </ConvexProvider>
    </StrictMode>,
  );
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
