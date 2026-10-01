import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Spec §22.11 — "After 5 minutes, the system automatically closes the
// attendance session." Every minute, open sessions past their window are
// closed and roster no-shows are materialised as Absent.
crons.interval('auto-close expired sessions', { minutes: 1 }, internal.sessions.autoCloseExpired, {});

export default crons;
