import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up expired plans once a day.
crons.daily(
  "delete expired plans",
  { hourUTC: 7, minuteUTC: 0 },
  internal.plans.deleteExpired,
);

export default crons;
