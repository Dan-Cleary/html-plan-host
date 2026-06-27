import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Email + password sign-in. No email verification for v1 (keeps it dependency-
// free); the Password provider handles both the signUp and signIn flows.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
