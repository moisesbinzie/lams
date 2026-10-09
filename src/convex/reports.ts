import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	assertCanAccessOffering,
	lecturerAccessibleOfferingIds,
	logAudit,
	requireActor,
	requirePerson,
	requireRecorder,
	requireStaff
} from './auth';

/**
 * Attendance reporting. Records live across a student's whole time at the
 * school, so every view is scoped by one of: a single course, a semester, or
 * an arbitrary date range. That is what lets someone check a semester, a month
 * or a week from the same records.
 */

/** Per-student summary for one course. Lecturers only see assigned offerings. */
export const courseReport = query({
	args: { token: v.string(), offeringId: v.id('offerings') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Course not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		}
		if (actor.role === 'rep') {
			const repRows = await ctx.db
				.query('programReps')
				.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
				.take(200);
			if (
				!repRows.some(
					(r: any) => String(r.programId) === String(offering.programId ?? offering.classId)
				)
			) {
				throw new Error('You are only a program rep for your own program.');
			}
		}
		const course = offering.courseId ? await ctx.db.get('courses', offering.courseId) : null;
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.offeringId))
			.order('desc')
			.take(300);
		const closed = sessions.filter((s) => s.status === 'closed');
		const enrolments = await ctx.db
			.query('enrolments')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.offeringId))
			.take(1000);

		// One fetch per lecture instead of one per student per lecture.
		const statusBySession = new Map<string, Map<string, string>>();
		for (const s of closed) {
			const recs = await ctx.db
				.query('attendance')
				.withIndex('by_session', (q) => q.eq('sessionId', s._id))
				.take(2000);
			statusBySession.set(
				String(s._id),
				new Map(recs.map((r: any) => [r.regNorm, r.status]))
			);
		}

		const rows: any[] = [];
		for (const e of enrolments) {
			if (e.status !== 'active') continue;
			const person = await ctx.db.get('people', e.personId);
			if (!person) continue;
			// Only lectures since they joined count — joining mid-term no
			// longer backdates absences for lectures that ran before.
			const inScope = closed.filter((s) => s.startedAt >= e.createdAt);
			let present = 0;
			let late = 0;
			let outOfRange = 0;
			let absent = 0;
			let excused = 0;
			for (const s of inScope) {
				const st = statusBySession.get(String(s._id))?.get(person.regNorm);
				if (!st) absent += 1;
				else if (st === 'Present') present += 1;
				else if (st === 'Late') late += 1;
				else if (st === 'Out_of_Range') outOfRange += 1;
				else if (st === 'Absent') absent += 1;
				else if (st === 'Excused') excused += 1;
			}
			// An excused lecture leaves the denominator so a documented absence
			// never counts against the student.
			const counted = inScope.length - excused;
			rows.push({
				personId: person._id,
				fullName: person.fullName,
				regNumber: person.regNumber,
				present,
				late,
				outOfRange,
				absent,
				excused,
				lectures: inScope.length,
				attendPct: counted > 0 ? Math.round(((present + late) / counted) * 100) : 0
			});
		}
		rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
		return {
			courseCode: course?.code ?? '',
			courseTitle: course?.title ?? '',
			totalLectures: closed.length,
			rows
		};
	}
});

/**
 * A person's full record, grouped by course across the whole programme.
 * `semesterId` narrows to one semester; omitting it covers their entire time
 * at the school.
 */
export const personReport = query({
	args: { token: v.string(), personId: v.id('people'), semesterId: v.optional(v.id('semesters')) },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');

		// Lecturers only see records from their own offerings — never another
		// lecturer's courses, even for a shared student.
		let allowedOfferingIds: Set<string> | null = null;
		if (actor.kind === 'staff' && !actor.isAdmin) {
			allowedOfferingIds = await lecturerAccessibleOfferingIds(ctx, actor.id);
		}

		// Active enrolments bound the denominator: lectures that ran before
		// the person joined an offering never count against them.
		const enrolRows = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(300);
		const enrolledAt = new Map<string, number>();
		for (const e of enrolRows) {
			if (e.status !== 'active') continue;
			const key = String(e.offeringId);
			const prev = enrolledAt.get(key);
			if (prev === undefined || e.createdAt < prev) enrolledAt.set(key, e.createdAt);
		}
		const inScope = (s: any) => {
			const since = enrolledAt.get(String(s.offeringId));
			return since !== undefined && s.startedAt >= since;
		};

		const records = (
			await ctx.db
				.query('attendance')
				.withIndex('by_person', (q) => q.eq('personId', args.personId))
				.take(5000)
		).filter((r: any) => !allowedOfferingIds || allowedOfferingIds.has(String(r.offeringId)));
		const sessions = (await ctx.db.query('sessions').take(2000)).filter(
			(s: any) => !allowedOfferingIds || allowedOfferingIds.has(String(s.offeringId))
		);
		const sessionById = new Map(sessions.map((s: any) => [String(s._id), s]));

		const byCourse = new Map<string, any>();
		for (const r of records) {
			if (args.semesterId && r.semesterId !== args.semesterId) continue;
			const session = sessionById.get(String(r.sessionId));
			if (session && !inScope(session)) continue;
			const key = String(r.courseId);
			if (!byCourse.has(key)) {
				const course = r.courseId ? await ctx.db.get('courses', r.courseId) : null;
				byCourse.set(key, {
					courseId: r.courseId,
					courseCode: course?.code ?? '',
					courseTitle: course?.title ?? '',
					present: 0,
					late: 0,
					outOfRange: 0,
					absent: 0,
					excused: 0,
					lectures: 0
				});
			}
			const bucket = byCourse.get(key);
			if (r.status === 'Present') bucket.present += 1;
			else if (r.status === 'Late') bucket.late += 1;
			else if (r.status === 'Out_of_Range') bucket.outOfRange += 1;
			else if (r.status === 'Absent') bucket.absent += 1;
			else if (r.status === 'Excused') bucket.excused += 1;
		}

		// Count every closed lecture in scope, not just ones with a record, so a
		// student who never registered still shows the right denominator —
		// but only lectures since they joined the offering.
		for (const s of sessions) {
			if (s.status !== 'closed') continue;
			if (args.semesterId && s.semesterId !== args.semesterId) continue;
			if (!inScope(s)) continue;
			const bucket = byCourse.get(String(s.courseId));
			if (bucket) bucket.lectures += 1;
		}

		const rows = Array.from(byCourse.values()).map((b) => {
			const counted = b.lectures - b.excused;
			return {
				...b,
				attendPct: counted > 0 ? Math.round(((b.present + b.late) / counted) * 100) : 0
			};
		});
		rows.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
		return { fullName: person.fullName, regNumber: person.regNumber, rows };
	}
});

/** Headline percentages for a signed-in person, over a chosen window. */
export const mySummary = query({
	args: { token: v.string(), semesterId: v.optional(v.id('semesters')), from: v.optional(v.string()), to: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		const records = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(5000);
		const sessions = await ctx.db.query('sessions').take(2000);
		const sessionById = new Map(sessions.map((s: any) => [String(s._id), s]));
		// Only the student's own enrolled offerings count — previously every
		// closed lecture in the system fed this headline.
		const enrolRows = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const enrolledAt = new Map<string, number>();
		for (const e of enrolRows) {
			if (e.status !== 'active') continue;
			const key = String(e.offeringId);
			const prev = enrolledAt.get(key);
			if (prev === undefined || e.createdAt < prev) enrolledAt.set(key, e.createdAt);
		}

		let present = 0;
		let late = 0;
		let outOfRange = 0;
		let absent = 0;
		let excused = 0;
		let total = 0;

		for (const s of sessions) {
			if (s.status !== 'closed') continue;
			if (args.semesterId && s.semesterId !== args.semesterId) continue;
			const since = enrolledAt.get(String(s.offeringId));
			if (since === undefined || s.startedAt < since) continue;
			const date = new Date(s.startedAt).toISOString().slice(0, 10);
			if (args.from && date < args.from) continue;
			if (args.to && date > args.to) continue;
			total += 1;
			const rec = records.find((r: any) => String(r.sessionId) === String(s._id));
			if (!rec) absent += 1;
			else if (rec.status === 'Present') present += 1;
			else if (rec.status === 'Late') late += 1;
			else if (rec.status === 'Out_of_Range') outOfRange += 1;
			else if (rec.status === 'Absent') absent += 1;
			else if (rec.status === 'Excused') excused += 1;
		}

		const counted = total - excused;
		return {
			totalLectures: total,
			present,
			late,
			outOfRange,
			absent,
			excused,
			attendPct: counted > 0 ? Math.round(((present + late) / counted) * 100) : 0
		};
	}
});

/**
 * Individual attendance records for one student — the lecturer's drill-down.
 * Each row carries its flags and dispute so the lecturer can decide and
 * override from one place.
 */
export const personRecords = query({
	args: { token: v.string(), personId: v.id('people'), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) return [];
		let allowedOfferingIds: Set<string> | null = null;
		if (!actor.isAdmin) {
			allowedOfferingIds = await lecturerAccessibleOfferingIds(ctx, actor.id);
		}
		const records = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(1000);
		const recent = records
			.filter((r: any) => !allowedOfferingIds || allowedOfferingIds.has(String(r.offeringId)))
			.sort((a, b) => b.submittedAt - a.submittedAt)
			.slice(0, args.limit ?? 100);
		const out: any[] = [];
		for (const r of recent) {
			const course = r.courseId ? await ctx.db.get('courses', r.courseId) : null;
			const session = await ctx.db.get('sessions', r.sessionId);
			out.push({
				_id: r._id,
				courseCode: course?.code ?? '',
				courseTitle: course?.title ?? '',
				startedAt: session?.startedAt ?? r.submittedAt,
				status: r.status,
				method: r.method,
				recordedBy: r.recordedBy ?? null,
				flagged: r.flagged ?? false,
				flagReason: r.flagReason ?? null,
				disputed: r.disputed ?? false,
				disputeNote: r.disputeNote ?? null,
				disputeResolvedBy: r.disputeResolvedBy ?? null,
				overriddenBy: r.overriddenBy ?? null,
				prevStatus: r.prevStatus ?? null
			});
		}
		return out;
	}
});

/**
 * Sets a bulk excused window for a course — the "I was away for two weeks"
 * case. Lecturer-only, and every change is written to the record.
 */
export const excuseRange = mutation({
	args: {
		token: v.string(),
		offeringId: v.id('offerings'),
		personIds: v.array(v.id('people')),
		status: v.union(v.literal('Excused'), v.literal('Present'), v.literal('Absent'))
	},
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		if (!actor.isAdmin) {
			const offering = await ctx.db.get('offerings', args.offeringId);
			await assertCanAccessOffering(ctx, actor, offering);
		}
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.offeringId))
			.take(300);
		const closed = sessions.filter((s) => s.status === 'closed');
		let changed = 0;
		for (const personId of args.personIds.slice(0, 500)) {
			const person = await ctx.db.get('people', personId);
			if (!person) continue;
			for (const s of closed) {
				const rec = await ctx.db
					.query('attendance')
					.withIndex('by_session_and_reg', (q) => q.eq('sessionId', s._id).eq('regNorm', person.regNorm))
					.unique();
				if (!rec || rec.status === args.status) continue;
				await ctx.db.patch(rec._id, {
					prevStatus: rec.status,
					status: args.status,
					overriddenBy: actor.name,
					overriddenAt: Date.now()
				});
				changed += 1;
			}
		}
		const excusedOffering = await ctx.db.get('offerings', args.offeringId);
		const excusedCourse = excusedOffering?.courseId ? await ctx.db.get('courses', excusedOffering.courseId) : null;
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: 'attendance.excuse-range',
			targetKind: 'offering',
			targetId: args.offeringId,
			targetName: excusedCourse?.code ?? '',
			detail: `${changed} record(s) set to ${args.status}`
		});
		return { changed };
	}
});