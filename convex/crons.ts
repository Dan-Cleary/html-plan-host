import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up expired plans once a day.
crons.daily(
  "delete expired plans",
  { hourUTC: 7, minuteUTC: 0 },
  internal.plans.deleteExpired,
);

// Garbage-collect stale anonymous workspaces + provisioning leftovers.
crons.daily(
  "gc anonymous workspaces",
  { hourUTC: 7, minuteUTC: 15 },
  internal.plans.gcAnonymous,
);

export default crons;
