import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	assertCanAccessOffering,
	lecturerAccessibleOfferingIds,
	lecturerProgramIds,
	logAudit,
	requireAdmin,
	requireActor,
	requireStaff
} from './auth';

// ---------------------------------------------------------------- semesters

export const listSemesters = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		const all = await ctx.db.query('semesters').order('desc').take(100);
		// Lecturers only see semesters their assigned offerings run in.
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = await ctx.db
				.query('offerings')
				.withIndex('by_lecturer', (q: any) => q.eq('lecturerId', actor.id))
				.take(500);
			const semIds = new Set(mine.map((o: any) => String(o.semesterId)));
			return all.filter((s: any) => semIds.has(String(s._id)));
		}
		return all;
	}
});

/**
 * Preconfigure a university year: Semester 1 and Semester 2. Idempotent —
 * whichever half already exists (same year + number) is skipped, so running
 * it twice never duplicates. Dates are the admin's call (every calendar
 * differs); the form prefills the two halves of the year.
 */
export const ensureAcademicYear = mutation({
	args: {
		token: v.string(),
		year: v.number(),
		sem1Start: v.string(),
		sem1End: v.string(),
		sem2Start: v.string(),
		sem2End: v.string()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100) {
			throw new Error('Enter a valid year.');
		}
		const halves = [
			{ number: 1, startDate: args.sem1Start, endDate: args.sem1End },
			{ number: 2, startDate: args.sem2Start, endDate: args.sem2End }
		];
		for (const h of halves) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(h.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(h.endDate)) {
				throw new Error('Enter dates as YYYY-MM-DD.');
			}
			if (h.startDate > h.endDate) throw new Error('Each semester must start on or before it ends.');
		}
		const existing = await ctx.db
			.query('semesters')
			.withIndex('by_year', (q) => q.eq('year', args.year))
			.take(10);
		const created: string[] = [];
		const skipped: string[] = [];
		for (const h of halves) {
			const name = `Semester ${h.number}`;
			if (existing.some((s: any) => s.number === h.number)) {
				skipped.push(name);
				continue;
			}
			await ctx.db.insert('semesters', {
				name,
				year: args.year,
				number: h.number,
				startDate: h.startDate,
				endDate: h.endDate,
				createdAt: Date.now()
			});
			created.push(name);
		}
		return { created, skipped };
	}
});

export const createSemester = mutation({
	args: {
		token: v.string(),
		name: v.string(),
		year: v.number(),
		number: v.number(),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const name = args.name.trim();
		if (!name) throw new Error('Give the semester a name.');
		if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100) throw new Error('Enter a valid year.');
		if (![1, 2, 3].includes(args.number)) throw new Error('Semester number must be 1, 2 or 3.');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(args.endDate)) {
			throw new Error('Enter dates as YYYY-MM-DD.');
		}
		if (args.startDate > args.endDate) throw new Error('The start date must be on or before the end date.');
		return await ctx.db.insert('semesters', {
			name,
			year: args.year,
			number: args.number,
			startDate: args.startDate,
			endDate: args.endDate,
			createdAt: Date.now()
		});
	}
});

export const removeSemester = mutation({
	args: { token: v.string(), id: v.id('semesters') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const offerings = await ctx.db
			.query('offerings')
			.withIndex('by_semester', (q) => q.eq('semesterId', args.id))
			.take(1);
		if (offerings.length > 0) throw new Error('This semester already has courses. Remove them first.');
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_semester', (q) => q.eq('semesterId', args.id))
			.take(1);
		if (sessions.length > 0) {
			throw new Error('This semester still has lecture records, which are kept as history.');
		}
		await ctx.db.delete('semesters', args.id);
		return { ok: true };
	}
});

// ---------------------------------------------------------------- programs

export const listPrograms = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		let rows = await ctx.db.query('programs').order('desc').take(200);
		// Lecturers only see programs they actually teach.
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = new Set(await lecturerProgramIds(ctx, actor.id));
			rows = rows.filter((p: any) => mine.has(String(p._id)));
		}
		return Promise.all(
			rows.map(async (p: any) => {
				const memberships = await ctx.db
					.query('programMembers')
					.withIndex('by_program', (q) => q.eq('programId', p._id))
					.take(2000);
				const members = (await Promise.all(memberships.map((m: any) => ctx.db.get('people', m.personId)))).filter(
					(person: any) => person && person.status !== 'blocked'
				);
				return {
					...p,
					studentCount: members.length
				};
			})
		);
	}
});

export const createProgram = mutation({
	args: {
		token: v.string(),
		name: v.string(),
		durationYears: v.number()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const name = args.name.trim();
		if (!name) throw new Error('Give the program a name.');
		if (!Number.isInteger(args.durationYears) || args.durationYears < 1 || args.durationYears > 10) {
			throw new Error('Duration must be 1 to 10 years.');
		}
		const clash = await ctx.db
			.query('programs')
			.withIndex('by_name', (q) => q.eq('name', name))
			.unique();
		if (clash) throw new Error('A program with that name already exists.');
		return await ctx.db.insert('programs', {
			name,
			durationYears: args.durationYears,
			createdAt: Date.now()
		});
	}
});

export const updateProgram = mutation({
	args: {
		token: v.string(),
		id: v.id('programs'),
		name: v.optional(v.string()),
		durationYears: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const program = await ctx.db.get('programs', args.id);
		if (!program) throw new Error('Program not found.');
		const patch: Record<string, unknown> = {};
		if (args.name?.trim()) {
			const clash = await ctx.db
				.query('programs')
				.withIndex('by_name', (q) => q.eq('name', args.name!.trim()))
				.unique();
			if (clash && String(clash._id) !== String(args.id)) {
				throw new Error('A program with that name already exists.');
			}
			patch.name = args.name.trim();
		}
		if (args.durationYears !== undefined) {
			if (!Number.isInteger(args.durationYears) || args.durationYears < 1 || args.durationYears > 10) {
				throw new Error('Duration must be 1 to 10 years.');
			}
			patch.durationYears = args.durationYears;
		}
		if (Object.keys(patch).length === 0) return { ok: true };
		await ctx.db.patch(args.id, patch);
		return { ok: true };
	}
});

export const removeProgram = mutation({
	args: { token: v.string(), id: v.id('programs') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const offerings = await ctx.db
			.query('offerings')
			.withIndex('by_program', (q) => q.eq('programId', args.id))
			.take(1);
		if (offerings.length > 0) throw new Error('This program still has courses. Remove them first.');
		// Sessions reach the program only through their offering, so check
		// every offering — lecture records are history and block removal.
		// Students keep their accounts and can join another program.
		const allOfferings = await ctx.db
			.query('offerings')
			.withIndex('by_program', (q) => q.eq('programId', args.id))
			.take(200);
		for (const o of allOfferings) {
			const sessions = await ctx.db
				.query('sessions')
				.withIndex('by_offering', (q) => q.eq('offeringId', o._id))
				.take(1);
			if (sessions.length > 0) {
				throw new Error('This program still has lecture records, which are kept as history.');
			}
		}
		await ctx.db.delete('programs', args.id);
		return { ok: true };
	}
});

// ----------------------------------------------------------------- courses

/** The course catalogue — lecturers only see courses they teach. */
export const listCourses = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		const all = await ctx.db.query('courses').order('asc').take(500);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const accessible = await lecturerAccessibleOfferingIds(ctx, actor.id);
			const offs = await ctx.db.query('offerings').take(500);
			const courseIds = new Set(
				offs.filter((o: any) => accessible.has(String(o._id))).map((o: any) => String(o.courseId))
			);
			return all.filter((c: any) => courseIds.has(String(c._id)));
		}
		return all;
	}
});

export const createCourse = mutation({
	args: {
		token: v.string(),
		code: v.string(),
		title: v.string(),
		hoursPerWeek: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const code = args.code.trim().toUpperCase();
		const title = args.title.trim();
		if (!code) throw new Error('Enter a course code.');
		if (!title) throw new Error('Enter a course title.');
		const existing = await ctx.db
			.query('courses')
			.withIndex('by_code', (q) => q.eq('code', code))
			.unique();
		if (existing) throw new Error('A course with that code already exists.');
		return await ctx.db.insert('courses', {
			code,
			title,
			openForEnrolment: false,
			...(args.hoursPerWeek ? { hoursPerWeek: args.hoursPerWeek } : {}),
			createdAt: Date.now()
		});
	}
});

export const updateCourse = mutation({
	args: {
		token: v.string(),
		id: v.id('courses'),
		title: v.optional(v.string()),
		hoursPerWeek: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const patch: Record<string, unknown> = {};
		if (args.title?.trim()) patch.title = args.title.trim();
		if (args.hoursPerWeek !== undefined) patch.hoursPerWeek = args.hoursPerWeek;
		if (Object.keys(patch).length === 0) return { ok: true };
		await ctx.db.patch(args.id, patch);
		return { ok: true };
	}
});

export const removeCourse = mutation({
	args: { token: v.string(), id: v.id('courses') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const offerings = await ctx.db
			.query('offerings')
			.withIndex('by_course', (q) => q.eq('courseId', args.id))
			.take(1);
		if (offerings.length > 0) throw new Error('This course is offered to a program. Remove it there first.');
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_course', (q) => q.eq('courseId', args.id))
			.take(1);
		if (sessions.length > 0) {
			throw new Error('This course still has lecture records, which are kept as history.');
		}
		await ctx.db.delete('courses', args.id);
		return { ok: true };
	}
});

// ---------------------------------------------------------------- offerings

/** A course offered to one program year in one semester. Lecturers only see their own. */
export const listOfferings = query({
	args: {
		token: v.string(),
		programId: v.optional(v.id('programs')),
		semesterId: v.optional(v.id('semesters')),
		yearOfStudy: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		let rows: any[];
		if (actor.kind === 'staff' && !actor.isAdmin) {
			// Own offerings plus unassigned ones in programs already taught
			// (substitute cover) — mirroring `canAccessOffering`.
			const accessible = await lecturerAccessibleOfferingIds(ctx, actor.id);
			rows = (await ctx.db.query('offerings').take(500)).filter((o: any) =>
				accessible.has(String(o._id))
			);
		} else {
			rows = await ctx.db.query('offerings').take(500);
		}
		if (args.programId) rows = rows.filter((o: any) => String(o.programId) === String(args.programId));
		if (args.semesterId) rows = rows.filter((o: any) => String(o.semesterId) === String(args.semesterId));
		if (args.yearOfStudy !== undefined) rows = rows.filter((o: any) => o.yearOfStudy === args.yearOfStudy);
		return Promise.all(
			rows.map(async (o: any) => {
				const course = o.courseId ? await ctx.db.get('courses', o.courseId) : null;
				const program = o.programId ? await ctx.db.get('programs', o.programId) : null;
				const semester = await ctx.db.get('semesters', o.semesterId);
				const lecturer = o.lecturerId ? await ctx.db.get('staff', o.lecturerId) : null;
				const count = await ctx.db
					.query('enrolments')
					.withIndex('by_offering', (q) => q.eq('offeringId', o._id))
					.take(1000);
				return {
					_id: o._id,
					courseId: o.courseId ?? null,
					courseCode: course?.code ?? '',
					courseTitle: course?.title ?? '',
					hoursPerWeek: course?.hoursPerWeek ?? null,
					programId: o.programId ?? null,
					programName: program?.name ?? '',
					yearOfStudy: o.yearOfStudy ?? null,
					semesterId: o.semesterId,
					semesterName: semester?.name ?? '',
					openForEnrolment: o.openForEnrolment,
					lecturerId: o.lecturerId ?? null,
					lecturerName: lecturer?.fullName ?? null,
					lecturerUsername: lecturer?.username ?? null,
					studentCount: count.filter((e: any) => e.status === 'active').length
				};
			})
		);
	}
});

export const createOffering = mutation({
	args: {
		token: v.string(),
		courseId: v.id('courses'),
		programId: v.id('programs'),
		semesterId: v.id('semesters'),
		yearOfStudy: v.number(),
		openForEnrolment: v.optional(v.boolean()),
		lecturerId: v.optional(v.id('staff'))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const program = await ctx.db.get('programs', args.programId);
		if (!program) throw new Error('Program not found.');
		const course = await ctx.db.get('courses', args.courseId);
		if (!course) throw new Error('Course not found.');
		if (
			!Number.isInteger(args.yearOfStudy) ||
			args.yearOfStudy < 1 ||
			args.yearOfStudy > (program.durationYears ?? 10)
		) {
			throw new Error(`Year of study must be 1 to ${program.durationYears ?? 10} for this program.`);
		}
		const existing = await ctx.db
			.query('offerings')
			.withIndex('by_program_and_semester', (q) =>
				q.eq('programId', args.programId).eq('semesterId', args.semesterId)
			)
			.take(100);
		if (
			existing.some(
				(o: any) => String(o.courseId) === String(args.courseId) && o.yearOfStudy === args.yearOfStudy
			)
		) {
			throw new Error('That course is already offered to this program year this semester.');
		}
		if (args.lecturerId) {
			const lecturer = await ctx.db.get('staff', args.lecturerId);
			if (!lecturer || !lecturer.active) throw new Error('That lecturer account is not active.');
		}
		return await ctx.db.insert('offerings', {
			courseId: args.courseId,
			programId: args.programId,
			semesterId: args.semesterId,
			yearOfStudy: args.yearOfStudy,
			openForEnrolment: args.openForEnrolment ?? false,
			...(args.lecturerId ? { lecturerId: args.lecturerId } : {}),
			createdAt: Date.now()
		});
	}
});

/** Admin assigns (or unassigns) the lecturer teaching one offering. */
export const setOfferingLecturer = mutation({
	args: { token: v.string(), id: v.id('offerings'), lecturerId: v.optional(v.union(v.id('staff'), v.null())) },
	handler: async (ctx, args) => {
		const actor = await requireAdmin(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.id);
		if (!offering) throw new Error('Course offering not found.');
		const course = offering.courseId ? await ctx.db.get('courses', offering.courseId) : null;
		const program = offering.programId ? await ctx.db.get('programs', offering.programId) : null;
		let targetName: string | undefined;
		if (args.lecturerId) {
			const lecturer = await ctx.db.get('staff', args.lecturerId);
			if (!lecturer || !lecturer.active) throw new Error('That lecturer account is not active.');
			await ctx.db.patch(args.id, { lecturerId: args.lecturerId });
			targetName = lecturer.username;
		} else {
			await ctx.db.patch(args.id, { lecturerId: undefined });
		}
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: 'offering.assign-lecturer',
			targetKind: 'offering',
			targetId: args.id,
			targetName: `${course?.code ?? ''} · ${program?.name ?? ''}`,
			...(targetName ? { detail: targetName } : { detail: 'unassigned' })
		});
		return { ok: true };
	}
});

/**
 * Opening an offering to self-enrolment is the lecturer's decision; admins
 * may do it for any offering.
 */
export const setOfferingOpen = mutation({
	args: { token: v.string(), id: v.id('offerings'), open: v.boolean() },
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		if (!actor.isAdmin) {
			const offering = await ctx.db.get('offerings', args.id);
			if (!offering) throw new Error('Course offering not found.');
			await assertCanAccessOffering(ctx, actor, offering);
		}
		await ctx.db.patch(args.id, { openForEnrolment: args.open });
		return { ok: true };
	}
});

export const removeOffering = mutation({
	args: { token: v.string(), id: v.id('offerings') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		// Lecture records are history: an offering that ever ran keeps its
		// sessions and attendance, so it cannot be removed at all.
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.id))
			.take(1);
		if (sessions.length > 0) {
			throw new Error('This course has lecture records, which are kept as history. It cannot be removed.');
		}
		const enrolments = await ctx.db
			.query('enrolments')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.id))
			.take(1000);
		if (enrolments.length > 0) throw new Error('Students are enrolled in this course. Remove them first.');
		const meetings = await ctx.db.query('meetings').withIndex('by_offering', (q) => q.eq('offeringId', args.id)).take(200);
		for (const m of meetings) await ctx.db.delete('meetings', m._id);
		await ctx.db.delete('offerings', args.id);
		return { ok: true };
	}
});
