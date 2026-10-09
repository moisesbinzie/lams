import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	assertCanAccessOffering,
	lecturerAccessibleOfferingIds,
	lecturerOfferings,
	lecturerProgramIds,
	logAudit,
	offeringLecturers,
	requireAdmin,
	requireActor,
	requireStaff
} from './auth';

// ---------------------------------------------------------------- semesters

/** YYYY-MM-DD, and the two dates the right way round. Shared by every writer. */
function validateDates(startDate: string, endDate: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
		throw new Error('Enter dates as YYYY-MM-DD.');
	}
	if (startDate > endDate) throw new Error('A semester must start on or before it ends.');
}

function validateYear(year: number): void {
	if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Enter a valid year.');
}

/** 1 and 2 are the two halves of a year; 3 is a summer session. */
function validateNumber(number: number): void {
	if (!Number.isInteger(number) || number < 1 || number > 3) {
		throw new Error('Semester number must be 1, 2 or 3 (3 for a summer session).');
	}
}

export const listSemesters = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		const all = await ctx.db.query('semesters').order('desc').take(100);
		// Lecturers only see semesters their assigned offerings run in.
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = await lecturerOfferings(ctx, actor.id);
			const semIds = new Set(mine.map((o: any) => String(o.semesterId)));
			return all.filter((s: any) => semIds.has(String(s._id)));
		}
		return all;
	}
});

/**
 * Preconfigure a university year: Semester 1 and Semester 2 in one step.
 * Idempotent — whichever half already exists (same year + number) is skipped,
 * so running it twice never duplicates. Dates are the admin's call (every
 * calendar differs); the form prefills the two halves of the year.
 *
 * A third, shorter semester (a summer session) is added one at a time with
 * `createSemester` below — that one has no sensible default, so it is never
 * created in a batch.
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
		validateYear(args.year);
		const halves = [
			{ number: 1, startDate: args.sem1Start, endDate: args.sem1End },
			{ number: 2, startDate: args.sem2Start, endDate: args.sem2End }
		];
		for (const h of halves) {
			validateDates(h.startDate, h.endDate);
			validateNumber(h.number);
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

/**
 * One semester on its own. Needed for the summer session (number 3) and for a
 * year that is being filled in one half at a time — `ensureAcademicYear` can
 * only ever write Semesters 1 and 2 together.
 */
export const createSemester = mutation({
	args: {
		token: v.string(),
		year: v.number(),
		number: v.number(),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		validateYear(args.year);
		validateNumber(args.number);
		validateDates(args.startDate, args.endDate);
		const existing = await ctx.db
			.query('semesters')
			.withIndex('by_year', (q) => q.eq('year', args.year))
			.take(10);
		if (existing.some((s: any) => s.number === args.number)) {
			throw new Error(`Semester ${args.number} already exists for ${args.year}. Edit it instead.`);
		}
		const name = `Semester ${args.number}`;
		await ctx.db.insert('semesters', {
			name,
			year: args.year,
			number: args.number,
			startDate: args.startDate,
			endDate: args.endDate,
			createdAt: Date.now()
		});
		return { name };
	}
});

/**
 * Move a semester's dates. The number and year are deliberately fixed: both are
 * what offerings and lecture records are keyed to, so changing them would
 * silently re-file history. Re-labelling is a remove-and-recreate decision.
 */
export const updateSemester = mutation({
	args: {
		token: v.string(),
		id: v.id('semesters'),
		startDate: v.string(),
		endDate: v.string()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const semester = await ctx.db.get('semesters', args.id);
		if (!semester) throw new Error('Semester not found.');
		validateDates(args.startDate, args.endDate);
		await ctx.db.patch(args.id, { startDate: args.startDate, endDate: args.endDate });
		return { ok: true };
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
		if (offerings.length > 0) {
			throw new Error('This semester still has courses placed in it. Remove them on the Programs tab first.');
		}
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

/**
 * The active academic year: the one that drives default semester pickers in
 * Setup (Programs board, Timetable). Any signed-in actor may read it;
 * only admins may set it. Null until the first year is marked active.
 */
export const getActiveYear = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireActor(ctx, args.token);
		const row = await ctx.db
			.query('appSettings')
			.withIndex('by_key', (q) => q.eq('key', 'activeYear'))
			.unique();
		return { activeYear: row?.year ?? null };
	}
});

export const setActiveYear = mutation({
	args: { token: v.string(), year: v.number() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		validateYear(args.year);
		const sems = await ctx.db
			.query('semesters')
			.withIndex('by_year', (q) => q.eq('year', args.year))
			.take(1);
		if (sems.length === 0) {
			throw new Error(`No semesters exist for ${args.year} yet. Create them first.`);
		}
		const existing = await ctx.db
			.query('appSettings')
			.withIndex('by_key', (q) => q.eq('key', 'activeYear'))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, { year: args.year, updatedAt: Date.now() });
		} else {
			await ctx.db.insert('appSettings', { key: 'activeYear', year: args.year, updatedAt: Date.now() });
		}
		return { activeYear: args.year };
	}
});

/**
 * Remove a whole academic year at once. Every semester in it must be empty
 * (no placements, no lecture records) — the same guards as `removeSemester`,
 * checked before anything is deleted so a bad year leaves nothing half-removed.
 */
export const removeAcademicYear = mutation({
	args: { token: v.string(), year: v.number() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		validateYear(args.year);
		const sems = await ctx.db
			.query('semesters')
			.withIndex('by_year', (q) => q.eq('year', args.year))
			.take(10);
		if (sems.length === 0) throw new Error(`No semesters exist for ${args.year}.`);
		for (const s of sems) {
			const offerings = await ctx.db
				.query('offerings')
				.withIndex('by_semester', (q) => q.eq('semesterId', s._id))
				.take(1);
			if (offerings.length > 0) {
				throw new Error(
					`${s.name} ${args.year} still has courses placed in it. Remove them on the Programs tab first.`
				);
			}
			const sessions = await ctx.db
				.query('sessions')
				.withIndex('by_semester', (q) => q.eq('semesterId', s._id))
				.take(1);
			if (sessions.length > 0) {
				throw new Error(`${s.name} ${args.year} still has lecture records, which are kept as history.`);
			}
		}
		for (const s of sems) await ctx.db.delete('semesters', s._id);
		const active = await ctx.db
			.query('appSettings')
			.withIndex('by_key', (q) => q.eq('key', 'activeYear'))
			.unique();
		if (active && active.year === args.year) {
			await ctx.db.patch(active._id, { year: undefined, updatedAt: Date.now() });
		}
		return { removed: sems.length };
	}
});

/** How many course placements each semester carries — for the year list. */
export const semesterUsage = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireActor(ctx, args.token);
		const sems = await ctx.db.query('semesters').take(100);
		const out: { semesterId: string; placements: number }[] = [];
		for (const s of sems) {
			const rows = await ctx.db
				.query('offerings')
				.withIndex('by_semester', (q) => q.eq('semesterId', s._id))
				.take(500);
			out.push({ semesterId: String(s._id), placements: rows.length });
		}
		return out;
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
				// Courses placed in this program, across every semester. Counted
				// here so the program list can show what each one carries without
				// a second round trip per program.
				const offerings = await ctx.db
					.query('offerings')
					.withIndex('by_program', (q) => q.eq('programId', p._id))
					.take(500);
				return {
					...p,
					studentCount: members.length,
					courseCount: offerings.length
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
		// How many programs take each course, and which ones. Joined here so
		// the catalogue can show at a glance what is actually being taught,
		// what is dead weight, and where a shared course already lives.
		const withCounts = await Promise.all(
			all.map(async (c: any) => {
				const placements = await ctx.db
					.query('offerings')
					.withIndex('by_course', (q) => q.eq('courseId', c._id))
					.take(200);
				const names = new Set<string>();
				for (const p of placements.slice(0, 30)) {
					if (!p.programId) continue;
					const prog = await ctx.db.get('programs', p.programId);
					if (prog) names.add(prog.name);
				}
				const programNames = [...names].sort().slice(0, 5);
				return { ...c, placementCount: placements.length, programNames };
			})
		);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const accessible = await lecturerAccessibleOfferingIds(ctx, actor.id);
			const offs = await ctx.db.query('offerings').take(500);
			const courseIds = new Set(
				offs.filter((o: any) => accessible.has(String(o._id))).map((o: any) => String(o.courseId))
			);
			return withCounts.filter((c: any) => courseIds.has(String(c._id)));
		}
		return withCounts;
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

/**
 * One offering, resolved into everything a screen needs to draw it.
 *
 * Kept as a plain builder rather than a registered function on purpose:
 * `listOfferings`, `listProgramBoard` and the timetable all speak the same row
 * shape, and three copies of it would drift the first time a field is added.
 * Display names are stored next to their ids so the client never has to join.
 */
function offeringRow(
	offering: any,
	course: { code: string; title: string; hoursPerWeek?: number; openForEnrolment?: boolean } | null,
	program: { name: string } | null,
	semester: { name: string; year: number; number: number } | null,
	lecturers: { _id: unknown; fullName: string; username: string }[],
	studentCount: number,
	meetingCount: number
) {
	return {
		_id: offering._id,
		courseId: offering.courseId ?? null,
		courseCode: course?.code ?? '',
		courseTitle: course?.title ?? '',
		hoursPerWeek: course?.hoursPerWeek ?? null,
		courseOpenForEnrolment: course?.openForEnrolment ?? false,
		programId: offering.programId ?? null,
		programName: program?.name ?? '',
		yearOfStudy: offering.yearOfStudy ?? null,
		semesterId: offering.semesterId,
		semesterName: semester?.name ?? '',
		semesterYear: semester?.year ?? null,
		semesterNumber: semester?.number ?? null,
		openForEnrolment: offering.openForEnrolment,
		lecturerIds: lecturers.map((l) => l._id),
		lecturerNames: lecturers.map((l) => l.fullName),
		lecturerUsernames: lecturers.map((l) => l.username),
		lecturerId: lecturers[0]?._id ?? null,
		lecturerName: lecturers[0]?.fullName ?? null,
		lecturerUsername: lecturers[0]?.username ?? null,
		studentCount,
		meetingCount,
		createdAt: offering.createdAt
	};
}

/** Resolves the join rows for one offering. */
async function offeringRowFor(ctx: any, offering: any) {
	const course = offering.courseId ? await ctx.db.get('courses', offering.courseId) : null;
	const program = offering.programId ? await ctx.db.get('programs', offering.programId) : null;
	const semester = await ctx.db.get('semesters', offering.semesterId);
	const holders = offeringLecturers(offering);
	const lecturers = (
		await Promise.all(holders.map((id: string) => ctx.db.get('staff', id as never)))
	).filter(Boolean);
	const enrolments = await ctx.db
		.query('enrolments')
		.withIndex('by_offering', (q: any) => q.eq('offeringId', offering._id))
		.take(1000);
	const meetings = await ctx.db
		.query('meetings')
		.withIndex('by_offering', (q: any) => q.eq('offeringId', offering._id))
		.take(200);
	return offeringRow(
		offering,
		course,
		program,
		semester,
		lecturers as never,
		enrolments.filter((e: any) => e.status === 'active').length,
		meetings.length
	);
}

/** Every offering a program carries — the Programs tab and the board. */
export const listProgramBoard = query({
	args: { token: v.string(), programId: v.id('programs') },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		const program = await ctx.db.get('programs', args.programId);
		if (!program) throw new Error('Program not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = await lecturerProgramIds(ctx, actor.id);
			if (!mine.includes(String(args.programId))) {
				throw new Error('That program is not assigned to you.');
			}
		}
		let rows = await ctx.db
			.query('offerings')
			.withIndex('by_program', (q) => q.eq('programId', args.programId))
			.take(500);
		// A lecturer sees only the courses they hold, plus any still waiting for
		// a lecturer in a program they already teach in (substitute cover) —
		// exactly the rule `canAccessOffering` applies everywhere else.
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const accessible = await lecturerAccessibleOfferingIds(ctx, actor.id);
			rows = rows.filter((o: any) => accessible.has(String(o._id)));
		}
		return Promise.all(rows.map((o: any) => offeringRowFor(ctx, o)));
	}
});

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
		return Promise.all(rows.map((o: any) => offeringRowFor(ctx, o)));
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
		lecturerId: v.optional(v.id('staff')),
		lecturerIds: v.optional(v.array(v.id('staff')))
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
		const lecturerIds = [
			...(args.lecturerIds ?? []),
			...(args.lecturerId ? [args.lecturerId] : [])
		].filter((id, i, arr) => arr.findIndex((x) => String(x) === String(id)) === i);
		for (const lid of lecturerIds) {
			const lecturer = await ctx.db.get('staff', lid);
			if (!lecturer || !lecturer.active) throw new Error('That lecturer account is not active.');
		}
		return await ctx.db.insert('offerings', {
			courseId: args.courseId,
			programId: args.programId,
			semesterId: args.semesterId,
			yearOfStudy: args.yearOfStudy,
			openForEnrolment: args.openForEnrolment ?? false,
			...(lecturerIds.length > 0 ? { lecturerIds, lecturerId: lecturerIds[0] } : {}),
			createdAt: Date.now()
		});
	}
});

/**
 * Place one catalogue course into several programs at once, at the same year
 * and semester. One call so the shared-course case ("BIT 221 is taught in
 * three programs") is one decision, not three dialogs. Duplicates and
 * out-of-range years are skipped with reasons — never half-failing.
 */
export const createOfferingsBulk = mutation({
	args: {
		token: v.string(),
		courseId: v.id('courses'),
		programIds: v.array(v.id('programs')),
		semesterId: v.id('semesters'),
		yearOfStudy: v.number(),
		openForEnrolment: v.optional(v.boolean()),
		lecturerIds: v.optional(v.array(v.id('staff')))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		if (args.programIds.length === 0) throw new Error('Choose at least one program.');
		if (args.programIds.length > 20) throw new Error('Place into at most 20 programs at once.');
		if (!Number.isInteger(args.yearOfStudy) || args.yearOfStudy < 1 || args.yearOfStudy > 10) {
			throw new Error('Year of study must be 1 to 10.');
		}
		const course = await ctx.db.get('courses', args.courseId);
		if (!course) throw new Error('Course not found.');
		const semester = await ctx.db.get('semesters', args.semesterId);
		if (!semester) throw new Error('Semester not found.');
		const uniqueLecturers = (args.lecturerIds ?? []).filter(
			(id, i, arr) => arr.findIndex((x) => String(x) === String(id)) === i
		);
		for (const lid of uniqueLecturers) {
			const lecturer = await ctx.db.get('staff', lid);
			if (!lecturer || !lecturer.active) throw new Error('That lecturer account is not active.');
		}
		const created: string[] = [];
		const skipped: { program: string; reason: string }[] = [];
		const seen = new Set(args.programIds.map(String));
		for (const pid of seen) {
			const program = await ctx.db.get('programs', pid as never);
			if (!program) {
				skipped.push({ program: String(pid), reason: 'Program not found.' });
				continue;
			}
			if (args.yearOfStudy > (program.durationYears ?? 10)) {
				skipped.push({
					program: program.name,
					reason: `Year ${args.yearOfStudy} is past its ${program.durationYears}-year run.`
				});
				continue;
			}
			const existing = await ctx.db
				.query('offerings')
				.withIndex('by_program_and_semester', (q) =>
					q.eq('programId', program._id).eq('semesterId', args.semesterId)
				)
				.take(100);
			if (
				existing.some(
					(o: any) => String(o.courseId) === String(args.courseId) && o.yearOfStudy === args.yearOfStudy
				)
			) {
				skipped.push({ program: program.name, reason: 'Already placed there.' });
				continue;
			}
			await ctx.db.insert('offerings', {
				courseId: args.courseId,
				programId: program._id,
				semesterId: args.semesterId,
				yearOfStudy: args.yearOfStudy,
				openForEnrolment: args.openForEnrolment ?? false,
				...(uniqueLecturers.length > 0
					? { lecturerIds: uniqueLecturers, lecturerId: uniqueLecturers[0] }
					: {}),
				createdAt: Date.now()
			});
			created.push(program.name);
		}
		return { created, skipped };
	}
});

/** Admin sets the lecturers teaching one offering (empty unassigns all). */
export const setOfferingLecturers = mutation({
	args: { token: v.string(), id: v.id('offerings'), lecturerIds: v.array(v.id('staff')) },
	handler: async (ctx, args) => {
		const actor = await requireAdmin(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.id);
		if (!offering) throw new Error('Course offering not found.');
		const course = offering.courseId ? await ctx.db.get('courses', offering.courseId) : null;
		const program = offering.programId ? await ctx.db.get('programs', offering.programId) : null;
		const unique = args.lecturerIds.filter(
			(id, i, arr) => arr.findIndex((x) => String(x) === String(id)) === i
		);
		const names: string[] = [];
		for (const lid of unique) {
			const lecturer = await ctx.db.get('staff', lid);
			if (!lecturer || !lecturer.active) throw new Error('That lecturer account is not active.');
			names.push(lecturer.username);
		}
		await ctx.db.patch(args.id, {
			lecturerIds: unique.length > 0 ? unique : undefined,
			lecturerId: unique.length > 0 ? unique[0] : undefined
		});
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: 'offering.assign-lecturer',
			targetKind: 'offering',
			targetId: args.id,
			targetName: `${course?.code ?? ''} · ${program?.name ?? ''}`,
			detail: names.length > 0 ? names.join(', ') : 'unassigned'
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
