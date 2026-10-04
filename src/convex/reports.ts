import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireActor, requirePerson, requireRecorder, requireStaff } from './auth';

/**
 * Attendance reporting. Records live across a student's whole time at the
 * school, so every view is scoped by one of: a single subject, a semester, or
 * an arbitrary date range. That is what lets someone check a semester, a month
 * or a week from the same records.
 */

/** Per-student summary for one subject. */
export const subjectReport = query({
	args: { token: v.string(), offeringId: v.id('offerings') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Subject not found.');
		if (actor.role === 'rep') {
			const repRows = await ctx.db
				.query('classReps')
				.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
				.take(200);
			if (!repRows.some((r: any) => r.classId === offering.classId)) {
				throw new Error('You are only a class rep for your own class.');
			}
		}
		const subject = await ctx.db.get('subjects', offering.subjectId);
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

		const rows: any[] = [];
		for (const e of enrolments) {
			if (e.status !== 'active') continue;
			const person = await ctx.db.get('people', e.personId);
			if (!person) continue;
			let present = 0;
			let late = 0;
			let outOfRange = 0;
			let absent = 0;
			let excused = 0;
			for (const s of closed) {
				const rec = await ctx.db
					.query('attendance')
					.withIndex('by_session_and_reg', (q) => q.eq('sessionId', s._id).eq('regNorm', person.regNorm))
					.unique();
				if (!rec) absent += 1;
				else if (rec.status === 'Present') present += 1;
				else if (rec.status === 'Late') late += 1;
				else if (rec.status === 'Out_of_Range') outOfRange += 1;
				else if (rec.status === 'Absent') absent += 1;
				else if (rec.status === 'Excused') excused += 1;
			}
			// An excused lecture leaves the denominator so a documented absence
			// never counts against the student.
			const counted = closed.length - excused;
			rows.push({
				personId: person._id,
				fullName: person.fullName,
				regNumber: person.regNumber,
				present,
				late,
				outOfRange,
				absent,
				excused,
				attendPct: counted > 0 ? Math.round(((present + late) / counted) * 100) : 0
			});
		}
		rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
		return {
			subjectCode: subject?.code ?? '',
			subjectTitle: subject?.title ?? '',
			totalLectures: closed.length,
			rows
		};
	}
});

/**
 * A person's full record, grouped by subject across the whole programme.
 * `semesterId` narrows to one semester; omitting it covers their entire time
 * at the school.
 */
export const personReport = query({
	args: { token: v.string(), personId: v.id('people'), semesterId: v.optional(v.id('semesters')) },
	handler: async (ctx, args) => {
		await requireRecorder(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');

		const records = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(5000);
		const sessions = await ctx.db.query('sessions').take(2000);
		const sessionById = new Map(sessions.map((s: any) => [String(s._id), s]));

		const bySubject = new Map<string, any>();
		for (const r of records) {
			if (args.semesterId && r.semesterId !== args.semesterId) continue;
			const key = String(r.subjectId);
			if (!bySubject.has(key)) {
				const subject = await ctx.db.get('subjects', r.subjectId);
				bySubject.set(key, {
					subjectId: r.subjectId,
					subjectCode: subject?.code ?? '',
					subjectTitle: subject?.title ?? '',
					present: 0,
					late: 0,
					outOfRange: 0,
					absent: 0,
					excused: 0,
					lectures: 0
				});
			}
			const bucket = bySubject.get(key);
			if (r.status === 'Present') bucket.present += 1;
			else if (r.status === 'Late') bucket.late += 1;
			else if (r.status === 'Out_of_Range') bucket.outOfRange += 1;
			else if (r.status === 'Absent') bucket.absent += 1;
			else if (r.status === 'Excused') bucket.excused += 1;
		}

		// Count every closed lecture in scope, not just ones with a record, so a
		// student who never registered still shows the right denominator.
		for (const s of sessions) {
			if (s.status !== 'closed') continue;
			if (args.semesterId && s.semesterId !== args.semesterId) continue;
			const bucket = bySubject.get(String(s.subjectId));
			if (bucket) bucket.lectures += 1;
		}

		const rows = Array.from(bySubject.values()).map((b) => {
			const counted = b.lectures - b.excused;
			return {
				...b,
				attendPct: counted > 0 ? Math.round(((b.present + b.late) / counted) * 100) : 0
			};
		});
		rows.sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
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

		let present = 0;
		let late = 0;
		let outOfRange = 0;
		let absent = 0;
		let excused = 0;
		let total = 0;

		for (const s of sessions) {
			if (s.status !== 'closed') continue;
			if (args.semesterId && s.semesterId !== args.semesterId) continue;
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
		await requireStaff(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) return [];
		const records = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(1000);
		const recent = records.sort((a, b) => b.submittedAt - a.submittedAt).slice(0, args.limit ?? 100);
		const out: any[] = [];
		for (const r of recent) {
			const subject = await ctx.db.get('subjects', r.subjectId);
			const session = await ctx.db.get('sessions', r.sessionId);
			out.push({
				_id: r._id,
				subjectCode: subject?.code ?? '',
				subjectTitle: subject?.title ?? '',
				startedAt: session?.startedAt ?? r.submittedAt,
				status: r.status,
				method: r.method,
				recordedBy: r.recordedBy ?? null,
				flagged: r.flagged ?? false,
				flagReason: r.flagReason ?? null,
				disputed: r.disputed ?? false,
				disputeNote: r.disputeNote ?? null,
				overriddenBy: r.overriddenBy ?? null,
				prevStatus: r.prevStatus ?? null
			});
		}
		return out;
	}
});

/**
 * Sets a bulk excused window for a subject — the "I was away for two weeks"
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
		return { changed };
	}
});