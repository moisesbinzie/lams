import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	assertCanAccessOffering,
	canRecordFor,
	requirePerson,
	requireRecorder,
	requireStaff
} from './auth';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function validateTime(value: string, label: string): string {
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${label} must be in 24-hour form, e.g. 09:00.`);
	return value;
}

/**
 * Weekly meeting slots. These are what make a timetable possible: a repeating
 * day + time + room per course. A make-up lecture is a one-off `makeup`
 * meeting with a date and no recurrence.
 */
export const createWeekly = mutation({
	args: {
		token: v.string(),
		offeringId: v.id('offerings'),
		dayOfWeek: v.number(),
		startTime: v.string(),
		endTime: v.string(),
		room: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Course offering not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		} else if (!(await canRecordFor(ctx, actor, offering.programId))) {
			throw new Error('You are only a program representative for your own program.');
		}
		if (args.dayOfWeek < 0 || args.dayOfWeek > 6) throw new Error('Choose a day of the week.');
		const start = validateTime(args.startTime, 'Start time');
		const end = validateTime(args.endTime, 'End time');
		if (end <= start) throw new Error('The end time must be after the start time.');
		return await ctx.db.insert('meetings', {
			offeringId: offering._id,
			courseId: offering.courseId,
			kind: 'weekly',
			dayOfWeek: args.dayOfWeek,
			startTime: start,
			endTime: end,
			...(args.room?.trim() ? { room: args.room.trim() } : {}),
			createdAt: Date.now()
		});
	}
});

export const createMakeup = mutation({
	args: {
		token: v.string(),
		offeringId: v.id('offerings'),
		date: v.string(),
		startTime: v.string(),
		endTime: v.string(),
		room: v.optional(v.string()),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Course offering not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		} else if (!(await canRecordFor(ctx, actor, offering.programId))) {
			throw new Error('You are only a program representative for your own program.');
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('Enter the date as YYYY-MM-DD.');
		const start = validateTime(args.startTime, 'Start time');
		const end = validateTime(args.endTime, 'End time');
		if (end <= start) throw new Error('The end time must be after the start time.');
		return await ctx.db.insert('meetings', {
			offeringId: offering._id,
			courseId: offering.courseId,
			kind: 'makeup',
			date: args.date,
			startTime: start,
			endTime: end,
			...(args.room?.trim() ? { room: args.room.trim() } : {}),
			...(args.note?.trim() ? { note: args.note.trim() } : {}),
			createdAt: Date.now()
		});
	}
});

export const updateMeeting = mutation({
	args: {
		token: v.string(),
		id: v.id('meetings'),
		dayOfWeek: v.optional(v.number()),
		date: v.optional(v.string()),
		startTime: v.optional(v.string()),
		endTime: v.optional(v.string()),
		room: v.optional(v.string()),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const meeting = await ctx.db.get('meetings', args.id);
		if (!meeting) throw new Error('Meeting not found.');
		const offering = await ctx.db.get('offerings', meeting.offeringId);
		if (!offering) throw new Error('Course offering not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		} else if (!(await canRecordFor(ctx, actor, offering.programId))) {
			throw new Error('You are only a program representative for your own program.');
		}
		const start = args.startTime ? validateTime(args.startTime, 'Start time') : meeting.startTime;
		const end = args.endTime ? validateTime(args.endTime, 'End time') : meeting.endTime;
		if (end <= start) throw new Error('The end time must be after the start time.');
		if (args.date !== undefined && args.date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
			throw new Error('Enter the date as YYYY-MM-DD.');
		}
		await ctx.db.patch(args.id, {
			startTime: start,
			endTime: end,
			...(args.dayOfWeek !== undefined ? { dayOfWeek: args.dayOfWeek } : {}),
			...(args.date !== undefined ? { date: args.date } : {}),
			...(args.room !== undefined ? { room: args.room } : {}),
			...(args.note !== undefined ? { note: args.note } : {})
		});
		return { ok: true };
	}
});

export const removeMeeting = mutation({
	args: { token: v.string(), id: v.id('meetings') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const meeting = await ctx.db.get('meetings', args.id);
		if (!meeting) throw new Error('Meeting not found.');
		const offering = await ctx.db.get('offerings', meeting.offeringId);
		if (!offering) throw new Error('Course offering not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		} else if (!(await canRecordFor(ctx, actor, offering.programId))) {
			throw new Error('You are only a program representative for your own program.');
		}
		// Refuse to drop a slot that already has attendance recorded against it.
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_offering', (q) => q.eq('offeringId', meeting.offeringId))
			.take(200);
		for (const s of sessions) {
			if (s.meetingId === args.id) {
				throw new Error('Attendance has already been taken for this slot. Remove that session instead.');
			}
		}
		await ctx.db.delete('meetings', args.id);
		return { ok: true };
	}
});

/** Every meeting for one offering — the timetable editor's data. */
export const listForOffering = query({
	args: { token: v.string(), offeringId: v.id('offerings') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Course offering not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		} else if (!(await canRecordFor(ctx, actor, offering.programId))) {
			throw new Error('You are only a program representative for your own program.');
		}
		const rows = await ctx.db
			.query('meetings')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.offeringId))
			.take(100);
		return rows.map((m: any) => ({
			_id: m._id,
			kind: m.kind,
			dayName: m.kind === 'weekly' ? DAY_NAMES[m.dayOfWeek] : m.date,
			dayOfWeek: m.dayOfWeek ?? null,
			date: m.date ?? null,
			startTime: m.startTime,
			endTime: m.endTime,
			room: m.room ?? '',
			note: m.note ?? ''
		}));
	}
});

/**
 * A signed-in person's own timetable, grouped by day for weekly slots, with
 * one-off make-up dates listed separately.
 */
export const myTimetable = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person) return { weekly: [], makeups: [] };
		const enrolments = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const weekly: any[] = [];
		const makeups: any[] = [];
		for (const e of enrolments) {
			if (e.status !== 'active') continue;
			const course = e.courseId ? await ctx.db.get('courses', e.courseId) : null;
			const meetings = await ctx.db
				.query('meetings')
				.withIndex('by_offering', (q) => q.eq('offeringId', e.offeringId))
				.take(20);
			for (const m of meetings) {
				const entry = {
					meetingId: m._id,
					offeringId: e.offeringId,
					courseCode: course?.code ?? '',
					courseTitle: course?.title ?? '',
					room: m.room ?? '',
					startTime: m.startTime,
					endTime: m.endTime
				};
				if (m.kind === 'weekly' && m.dayOfWeek !== undefined) {
									weekly.push({
										...entry,
										dayOfWeek: m.dayOfWeek,
										dayName: DAY_NAMES[m.dayOfWeek]
									});
								} else {
									makeups.push({ ...entry, date: m.date ?? '', note: m.note ?? '' });
								}
							}
						}
						weekly.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
						makeups.sort((a, b) => String(a.date).localeCompare(String(b.date)));
						return { weekly, makeups };
					}
				});

				/** The timetable for a whole program — lecturers only see their own offerings. */
export const listForProgram = query({
	args: { token: v.string(), programId: v.id('programs') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		let offerings = await ctx.db
			.query('offerings')
			.withIndex('by_program', (q) => q.eq('programId', args.programId))
			.take(200);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			// Own offerings plus unassigned ones in this program (substitute cover).
			offerings = offerings.filter(
				(o: any) => String(o.lecturerId ?? '') === String(actor.id) || !o.lecturerId
			);
		}
		const weekly: any[] = [];
		const makeups: any[] = [];
		for (const o of offerings) {
			const course = o.courseId ? await ctx.db.get('courses', o.courseId) : null;
			const meetings = await ctx.db
				.query('meetings')
				.withIndex('by_offering', (q) => q.eq('offeringId', o._id))
				.take(20);
			for (const m of meetings) {
				const entry = {
					meetingId: m._id,
					offeringId: o._id,
					courseCode: course?.code ?? '',
					courseTitle: course?.title ?? '',
					room: m.room ?? '',
					startTime: m.startTime,
					endTime: m.endTime
				};
				if (m.kind === 'weekly' && m.dayOfWeek !== undefined) {
					weekly.push({
						...entry,
						dayOfWeek: m.dayOfWeek,
						dayName: DAY_NAMES[m.dayOfWeek]
					});
				} else {
					makeups.push({ ...entry, date: m.date ?? '', note: m.note ?? '' });
				}
			}
		}
		weekly.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
		makeups.sort((a, b) => String(a.date).localeCompare(String(b.date)));
		return { weekly, makeups };
	}
});

/** Meetings happening today for a program — drives "start attendance". */
export const listTodayForProgram = query({
	args: { token: v.string(), programId: v.id('programs'), dayOfWeek: v.number() },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		let offerings = await ctx.db
			.query('offerings')
			.withIndex('by_program', (q) => q.eq('programId', args.programId))
			.take(200);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			// Own offerings plus unassigned ones in this program (substitute cover).
			offerings = offerings.filter(
				(o: any) => String(o.lecturerId ?? '') === String(actor.id) || !o.lecturerId
			);
		}
		const out: any[] = [];
		for (const o of offerings) {
			const course = o.courseId ? await ctx.db.get('courses', o.courseId) : null;
			const meetings = await ctx.db
				.query('meetings')
				.withIndex('by_offering', (q) => q.eq('offeringId', o._id))
				.take(20);
			for (const m of meetings) {
				if (m.kind !== 'weekly' || m.dayOfWeek !== args.dayOfWeek) continue;
				out.push({
					meetingId: m._id,
					offeringId: o._id,
					courseId: o.courseId,
					courseCode: course?.code ?? '',
					courseTitle: course?.title ?? '',
					startTime: m.startTime,
					endTime: m.endTime,
					room: m.room ?? ''
				});
			}
		}
		return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
	}
});

/**
 * Cross-program clash check: warns when a new slot overlaps an existing one for
 * the same program, so a timetable cannot quietly contain impossible weeks.
 */
export const findClashes = query({
	args: {
		token: v.string(),
		programId: v.id('programs'),
		dayOfWeek: v.number(),
		startTime: v.string(),
		endTime: v.string(),
		ignoreMeetingId: v.optional(v.id('meetings'))
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		let offerings = await ctx.db
			.query('offerings')
			.withIndex('by_program', (q) => q.eq('programId', args.programId))
			.take(200);
		// Lecturers only compare against their own offerings.
		if (actor.kind === 'staff' && !actor.isAdmin) {
			// Own offerings plus unassigned ones in this program (substitute cover).
			offerings = offerings.filter(
				(o: any) => String(o.lecturerId ?? '') === String(actor.id) || !o.lecturerId
			);
		}
		const clashes: string[] = [];
		for (const o of offerings) {
			const course = o.courseId ? await ctx.db.get('courses', o.courseId) : null;
			const meetings = await ctx.db
				.query('meetings')
				.withIndex('by_offering', (q) => q.eq('offeringId', o._id))
				.take(20);
			for (const m of meetings) {
				if (m.kind !== 'weekly') continue;
				if (m.dayOfWeek !== args.dayOfWeek) continue;
				if (args.ignoreMeetingId && m._id === args.ignoreMeetingId) continue;
				if (args.startTime < m.endTime && m.startTime < args.endTime) {
					clashes.push(`${course?.code ?? 'A course'} ${m.startTime}–${m.endTime}`);
				}
			}
		}
		return clashes;
	}
});