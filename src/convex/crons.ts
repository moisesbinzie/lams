import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Retires lapsed attendance windows and writes their Absent rows, so a lecture
// that nobody closes by hand still completes on its own.
const crons = cronJobs();

crons.interval('auto close expired lectures', { minutes: 1 }, internal.attendance.autoCloseExpired, {});

export default crons;