import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { checkAdminPassword, requireAdmin } from './auth';
import { computeAutoStatus, haversineM, normalizeId, normalizeReg } from './helpers';

function checkSessionOpen(session: any, token?: string) {
	if (!session) throw new Error('Session not found.');
	if (session.status !== 'open') throw new Error('Session is closed.');
	const now = Date.now();
	if (now > session.closesAt || now > session.tokenExp) throw new Error('Session expired.');
	if (token !== undefined && token !== session.token) throw new Error('Invalid QR token.');
}

export const submitSelf = mutation({
	args: {
		sessionId: v.id('sessions'),
		token: v.string(),
		fullName: v.string(),
		regNumber: v.string(),
		studentId: v.string(),
		studentLat: v.optional(v.number()),
		studentLng: v.optional(v.number()),
		accuracyM: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const s = await ctx.db.get('sessions', args.sessionId);
		checkSessionOpen(s, args.token);
		const regNorm = normalizeReg(args.regNumber);
		if (!regNorm) throw new Error('Registration number required.');
		// Scan-and-go: if name/ID are blank but the reg number is on the roster,
		// resolve them server-side from the roster record.
		let fullName = args.fullName.trim();
		let studentIdRaw = args.studentId.trim();
		if (!fullName || !studentIdRaw) {
			const roster = await ctx.db
				.query('students')
				.withIndex('by_course_and_reg', (q) => q.eq('courseId', s!.courseId).eq('regNorm', regNorm))
				.unique();
			if (!roster) {
				if (!fullName) throw new Error('Full name required (reg number not on roster).');
				if (!normalizeId(studentIdRaw)) throw new Error('Student ID required (reg number not on roster).');
			} else {
				if (!fullName) fullName = roster.fullName;
				if (!studentIdRaw) studentIdRaw = roster.studentId;
			}
		}
		const idNorm = normalizeId(studentIdRaw);
		if (!idNorm) throw new Error('Student ID required.');
		const dup = await ctx.db
			.query('attendance')
			.withIndex('by_session_and_reg', (q) => q.eq('sessionId', args.sessionId).eq('regNorm', regNorm))
			.unique();
		if (dup) throw new Error('Attendance already recorded for this registration number.');
		let distanceM: number | undefined = undefined;
		if (args.studentLat !== undefined && args.studentLng !== undefined) {
			distanceM = Math.round(haversineM(s!.lectureLat, s!.lectureLng, args.studentLat, args.studentLng));
		}
		const elapsedSec = Math.floor((Date.now() - s!.startedAt) / 1000);
		const status = computeAutoStatus(elapsedSec, s!.presentSec, distanceM ?? null, s!.radiusM);
		const id = await ctx.db.insert('attendance', {
			sessionId: args.sessionId,
			courseId: s!.courseId,
			fullName,
			regNumber: args.regNumber.trim(),
			regNorm,
			studentId: studentIdRaw,
			method: 'self',
			studentLat: args.studentLat,
			studentLng: args.studentLng,
			accuracyM: args.accuracyM,
			distanceM,
			status,
			submittedAt: Date.now()
		});
		return { id, status, distanceM: distanceM ?? null };
	}
});

export const submitRepBatch = mutation({
	args: {
		password: v.string(),
		sessionId: v.id('sessions'),
		repName: v.string(),
		repRegNumber: v.optional(v.string()),
		repLat: v.optional(v.number()),
		repLng: v.optional(v.number()),
		entries: v.array(v.object({ fullName: v.string(), regNumber: v.string(), studentId: v.string() }))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const s = await ctx.db.get('sessions', args.sessionId);
		checkSessionOpen(s);
		const repName = args.repName.trim();
		if (!repName) throw new Error('Class rep name required.');
		// Spec §7.1–7.2: only an authorized class representative may use the
		// multi-student option. When the course roster flags any class reps,
		// the submitter must prove it with their own roster reg number.
		const roster = await ctx.db
			.query('students')
			.withIndex('by_course', (q: any) => q.eq('courseId', s!.courseId))
			.take(1000);
		const flagged = roster.filter((st: any) => st.isClassRep);
		let repRegTrimmed: string | undefined = undefined;
		if (flagged.length > 0) {
			const repRegNorm = normalizeReg(args.repRegNumber ?? '');
			if (!repRegNorm) throw new Error('Your own registration number is required (only flagged class reps may submit).');
			const me = flagged.find((st: any) => st.regNorm === repRegNorm);
			if (!me) throw new Error('Only an authorized class representative may register students.');
			repRegTrimmed = me.regNumber;
		} else if (args.repRegNumber?.trim()) {
			repRegTrimmed = args.repRegNumber.trim();
		}
		// Spec §6/§7.7 — a rep registers two or more students in one batch.
		if (args.entries.length < 2 || args.entries.length > 50)
			throw new Error('Enter between 2 and 50 students per batch.');
		let repDistance: number | null = null;
		if (args.repLat !== undefined && args.repLng !== undefined) {
			repDistance = Math.round(haversineM(s!.lectureLat, s!.lectureLng, args.repLat, args.repLng));
		}
		const elapsedSec = Math.floor((Date.now() - s!.startedAt) / 1000);
		const status = computeAutoStatus(elapsedSec, s!.presentSec, repDistance, s!.radiusM);
		let added = 0;
		let skipped = 0;
		for (const e of args.entries) {
			const fullName = e.fullName.trim();
			const regNorm = normalizeReg(e.regNumber);
			const idNorm = normalizeId(e.studentId);
			if (!fullName || !regNorm || !idNorm) {
				skipped += 1;
				continue;
			}
			const dup = await ctx.db
				.query('attendance')
				.withIndex('by_session_and_reg', (q) => q.eq('sessionId', args.sessionId).eq('regNorm', regNorm))
				.unique();
			if (dup) {
				skipped += 1;
				continue;
			}
			await ctx.db.insert('attendance', {
				sessionId: args.sessionId,
				courseId: s!.courseId,
				fullName,
				regNumber: e.regNumber.trim(),
				regNorm,
				studentId: e.studentId.trim(),
				method: 'rep',
				repName,
				...(repRegTrimmed ? { repRegNumber: repRegTrimmed } : {}),
				studentLat: args.repLat,
				studentLng: args.repLng,
				distanceM: repDistance ?? undefined,
				status,
				submittedAt: Date.now()
			});
			added += 1;
		}
		return { added, skipped, status };
	}
});

export const manualAdd = mutation({
	args: {
		password: v.string(),
		sessionId: v.id('sessions'),
		fullName: v.string(),
		regNumber: v.string(),
		studentId: v.string(),
		status: v.union(v.literal('Present'), v.literal('Late'), v.literal('Out_of_Range'), v.literal('Absent'), v.literal('Excused'))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const s = await ctx.db.get('sessions', args.sessionId);
		if (!s) throw new Error('Session not found.');
		const regNorm = normalizeReg(args.regNumber);
		if (!args.fullName.trim() || !regNorm || !normalizeId(args.studentId)) throw new Error('Name, reg number and student ID required.');
		const dup = await ctx.db
			.query('attendance')
			.withIndex('by_session_and_reg', (q) => q.eq('sessionId', args.sessionId).eq('regNorm', regNorm))
			.unique();
		if (dup) throw new Error('Attendance already recorded for this registration number.');
		await ctx.db.insert('attendance', {
			sessionId: args.sessionId,
			courseId: s.courseId,
			fullName: args.fullName.trim(),
			regNumber: args.regNumber.trim(),
			regNorm,
			studentId: args.studentId.trim(),
			method: 'manual',
			status: args.status,
			submittedAt: Date.now(),
			overriddenBy: 'lecturer'
		});
		return { ok: true };
	}
});

export const override = mutation({
	args: {
		password: v.string(),
		attendanceId: v.id('attendance'),
		status: v.union(
			v.literal('Present'),
			v.literal('Late'),
			v.literal('Out_of_Range'),
			v.literal('Absent'),
			v.literal('Excused')
		)
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const doc = await ctx.db.get('attendance', args.attendanceId);
		if (!doc) throw new Error('Record not found.');
		await ctx.db.patch(doc._id, {
			prevStatus: doc.status,
			status: args.status,
			overriddenBy: 'lecturer',
			overriddenAt: Date.now()
		});
		return { ok: true };
	}
});

export const remove = mutation({
	args: { password: v.string(), attendanceId: v.id('attendance') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		await ctx.db.delete('attendance', args.attendanceId);
		return { ok: true };
	}
});

export const listBySession = query({
	args: { password: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const ok = await checkAdminPassword(ctx, args.password);
		if (!ok) throw new Error('Invalid admin password.');
		return await ctx.db.query('attendance').withIndex('by_session', (q) => q.eq('sessionId', args.sessionId)).order('asc').take(2000);
	}
});

export const reportByCourse = query({
	args: { password: v.string(), courseId: v.id('courses') },
	handler: async (ctx, args) => {
		const ok = await checkAdminPassword(ctx, args.password);
		if (!ok) throw new Error('Invalid admin password.');
		const allSessions = await ctx.db.query('sessions').withIndex('by_course', (q) => q.eq('courseId', args.courseId)).order('desc').take(200);
		const closed = allSessions.filter((s) => s.status === 'closed');
		const totalSessions = closed.length;
		const roster = await ctx.db.query('students').withIndex('by_course', (q) => q.eq('courseId', args.courseId)).take(1000);
		const rows: Array<{
			fullName: string;
			regNumber: string;
			studentId: string;
			present: number;
			late: number;
			outOfRange: number;
			absent: number;
			excused: number;
			attendPct: number;
			presentPct: number;
			latePct: number;
			absentPct: number;
			excusedPct: number;
		}> = [];
		for (const st of roster) {
			let present = 0;
			let late = 0;
			let outOfRange = 0;
			let absent = 0;
			let excused = 0;
			for (const s of closed) {
				const rec = await ctx.db
					.query('attendance')
					.withIndex('by_session_and_reg', (q) => q.eq('sessionId', s._id).eq('regNorm', st.regNorm))
					.unique();
				if (!rec) {
					absent += 1;
				} else if (rec.status === 'Present') present += 1;
				else if (rec.status === 'Late') late += 1;
				else if (rec.status === 'Out_of_Range') outOfRange += 1;
				else if (rec.status === 'Absent') absent += 1;
				else if (rec.status === 'Excused') excused += 1;
			}
			// Excused sessions leave the denominator so a documented excuse never
			// drags the attendance percentage down (DECISIONS Q15).
			const counted = totalSessions - excused;
			rows.push({
				fullName: st.fullName,
				regNumber: st.regNumber,
				studentId: st.studentId,
				present,
				late,
				outOfRange,
				absent,
				excused,
				attendPct: counted ? Math.round(((present + late) / counted) * 100) : 0,
				presentPct: counted ? Math.round((present / counted) * 100) : 0,
				latePct: counted ? Math.round((late / counted) * 100) : 0,
				absentPct: counted ? Math.round((absent / counted) * 100) : 0,
				excusedPct: totalSessions ? Math.round((excused / totalSessions) * 100) : 0
			});
		}
		return { totalSessions, rows };
	}
});
