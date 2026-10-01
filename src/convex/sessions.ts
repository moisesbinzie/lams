import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { checkAdminPassword, requireAdmin } from './auth';
import { randomHex } from './helpers';

/** Closes a session and materialises `Absent` for every roster no-show. */
async function closeSessionWithAbsents(ctx: any, s: any, now = Date.now()): Promise<number> {
	if (s.status === 'closed') return 0;
	await ctx.db.patch(s._id, { status: 'closed', closedAt: now });
	const roster = await ctx.db
		.query('students')
		.withIndex('by_course', (q: any) => q.eq('courseId', s.courseId))
		.take(1000);
	const existing = await ctx.db
		.query('attendance')
		.withIndex('by_session', (q: any) => q.eq('sessionId', s._id))
		.take(2000);
	const seen = new Set<string>(existing.map((a: any) => a.regNorm));
	let absentAdded = 0;
	for (const st of roster) {
		if (seen.has(st.regNorm)) continue;
		await ctx.db.insert('attendance', {
			sessionId: s._id,
			courseId: s.courseId,
			fullName: st.fullName,
			regNumber: st.regNumber,
			regNorm: st.regNorm,
			studentId: st.studentId,
			method: 'manual',
			status: 'Absent',
			submittedAt: now
		});
		absentAdded += 1;
	}
	return absentAdded;
}

export const create = mutation({
	args: {
		password: v.string(),
		courseId: v.id('courses'),
		lectureLat: v.number(),
		lectureLng: v.number(),
		radiusM: v.optional(v.number()),
		presentSec: v.optional(v.number()),
		totalSec: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		if (args.lectureLat < -90 || args.lectureLat > 90) throw new Error('Invalid latitude.');
		if (args.lectureLng < -180 || args.lectureLng > 180) throw new Error('Invalid longitude.');
		const radiusM = args.radiusM ?? 50;
		// Spec §16: each QR is valid for exactly 5 minutes by default.
		// The window stays adjustable + extendable per QA Q8 (flexible 5 min),
		// so a lecturer can allow a Late window (present < total) when needed.
		const presentSec = args.presentSec ?? 300;
		const totalSec = args.totalSec ?? 300;
		if (radiusM < 5 || radiusM > 2000) throw new Error('Radius must be 5–2000 m.');
		if (presentSec < 60 || presentSec > 7200) throw new Error('Present window 1–120 min.');
		if (totalSec < 60 || totalSec > 7200) throw new Error('Session length 1–120 min.');
		if (presentSec > totalSec) throw new Error('Present window cannot exceed session length.');
		const course = await ctx.db.get('courses', args.courseId);
		if (!course) throw new Error('Course not found.');
		// One live QR per course: a brand-new session retires older open ones.
		const open = await ctx.db
			.query('sessions')
			.withIndex('by_course', (q) => q.eq('courseId', args.courseId))
			.take(20);
		let closedOthers = 0;
		for (const prev of open) {
			if (prev.status !== 'open') continue;
			await closeSessionWithAbsents(ctx, prev);
			closedOthers += 1;
		}
		const now = Date.now();
		const token = randomHex(16);
		const id = await ctx.db.insert('sessions', {
			courseId: args.courseId,
			termId: course.termId,
			lectureLat: args.lectureLat,
			lectureLng: args.lectureLng,
			radiusM,
			presentSec,
			totalSec,
			token,
			tokenExp: now + totalSec * 1000,
			status: 'open',
			startedAt: now,
			closesAt: now + totalSec * 1000,
			createdAt: now
		});
		return { sessionId: id, token, closedOthers };
	}
});

export const getPublic = query({
	args: { sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const s = await ctx.db.get('sessions', args.sessionId);
		if (!s) return null;
		const now = Date.now();
		// An open session whose window has lapsed is reported closed even before
		// the auto-close cron flips the stored status.
		const effective: 'open' | 'closed' = s.status === 'open' && now < s.closesAt ? 'open' : 'closed';
		const course = await ctx.db.get('courses', s.courseId);
		return {
			_id: s._id,
			courseId: s.courseId,
			courseCode: course?.code ?? '',
			courseTitle: course?.title ?? '',
			status: effective,
			startedAt: s.startedAt,
			closesAt: s.closesAt,
			tokenExp: s.tokenExp,
			presentSec: s.presentSec,
			totalSec: s.totalSec,
			radiusM: s.radiusM,
			now
		};
	}
});

export const getForLecturer = query({
	args: { password: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const ok = await checkAdminPassword(ctx, args.password);
		if (!ok) throw new Error('Invalid admin password.');
		const s = await ctx.db.get('sessions', args.sessionId);
		if (!s) return null;
		return s;
	}
});

export const listByCourse = query({
	args: { courseId: v.id('courses') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('sessions')
			.withIndex('by_course', (q) => q.eq('courseId', args.courseId))
			.order('desc')
			.take(100);
	}
});

export const extend = mutation({
	args: { password: v.string(), sessionId: v.id('sessions'), extraSec: v.number() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		if (args.extraSec < 60 || args.extraSec > 3600) throw new Error('Extension 1–60 min.');
		const s = await ctx.db.get('sessions', args.sessionId);
		if (!s) throw new Error('Session not found.');
		if (s.status !== 'open') throw new Error('Session already closed.');
		const now = Date.now();
		const closesAt = Math.max(s.closesAt, now) + args.extraSec * 1000;
		await ctx.db.patch(s._id, { closesAt, tokenExp: closesAt, totalSec: s.totalSec + args.extraSec });
		return { closesAt };
	}
});

export const close = mutation({
	args: { password: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const s = await ctx.db.get('sessions', args.sessionId);
		if (!s) throw new Error('Session not found.');
		if (s.status === 'closed') return { ok: true, absentAdded: 0 };
		const absentAdded = await closeSessionWithAbsents(ctx, s);
		return { ok: true, absentAdded };
	}
});

/**
 * Closes a session the moment its window lapses. Safe to call from any client:
 * it only ever acts on sessions that are already past `closesAt`.
 */
export const expireIfDue = mutation({
	args: { sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const s = await ctx.db.get('sessions', args.sessionId);
		if (!s) return { status: 'closed' as const };
		if (s.status !== 'open') return { status: 'closed' as const };
		if (Date.now() < s.closesAt) return { status: 'open' as const };
		await closeSessionWithAbsents(ctx, s);
		return { status: 'closed' as const };
	}
});

/** Cron target: retires every open session whose window has lapsed. */
export const autoCloseExpired = internalMutation({
	args: {},
	handler: async (ctx) => {
		const open = await ctx.db
			.query('sessions')
			.withIndex('by_status', (q) => q.eq('status', 'open'))
			.take(200);
		const now = Date.now();
		let closed = 0;
		let absentAdded = 0;
		for (const s of open) {
			if (now < s.closesAt) continue;
			absentAdded += await closeSessionWithAbsents(ctx, s, now);
			closed += 1;
		}
		return { closed, absentAdded };
	}
});
