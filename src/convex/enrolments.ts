import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	assertCanAccessOffering,
	canAccessOffering,
	lecturerProgramIds,
	requirePerson,
	requireRecorder,
	requireStaff
} from './auth';

/**
 * Two ways into a course:
 *  - a student adds one themselves from the open list;
 *  - a program rep or lecturer assigns one for them.
 * Both produce the same `enrolments` row, tagged so the lecturer can see who
 * chose what.
 */

/** What a student may add themselves to, across every program they belong to. */
export const listOpenForStudent = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		const doc = await ctx.db.get('people', person._id);
		if (!doc) return [];
		const memberships = await ctx.db
			.query('programMembers')
			.withIndex('by_person', (q: any) => q.eq('personId', person._id))
			.take(50);
		const mine = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const enrolledOfferingIds = new Set(
			mine.filter((e: any) => e.status === 'active').map((e: any) => String(e.offeringId))
		);
		const out: any[] = [];
		const seen = new Set<string>();
		for (const m of memberships) {
			const offerings = await ctx.db
				.query('offerings')
				.withIndex('by_program', (q) => q.eq('programId', m.programId))
				.take(200);
			for (const o of offerings) {
				if (!o.openForEnrolment) continue;
				if (seen.has(String(o._id))) continue;
				seen.add(String(o._id));
				const course = o.courseId ? await ctx.db.get('courses', o.courseId) : null;
				const semester = await ctx.db.get('semesters', o.semesterId);
				if (!course) continue;
				out.push({
					_id: o._id,
					courseId: o.courseId,
					courseCode: course.code,
					courseTitle: course.title,
					hoursPerWeek: course.hoursPerWeek ?? null,
					semesterName: semester?.name ?? '',
					programName: (o.programId ? await ctx.db.get('programs', o.programId) : null)?.name ?? '',
					alreadyEnrolled: enrolledOfferingIds.has(String(o._id))
				});
			}
		}
		return out;
	}
});

/** A student adds a course for themselves. Blocked once the lecturer closes it. */
export const enrolSelf = mutation({
	args: { token: v.string(), offeringId: v.id('offerings') },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person) throw new Error('Your sign-in has expired. Please sign in again.');
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('That course is no longer available.');
		if (!offering.openForEnrolment) {
			throw new Error('Your lecturer has closed enrolment for this course. Please see them.');
		}
		const doc = await ctx.db.get('people', person._id as never);
		if (!doc) throw new Error('Account not found.');
		const memberships = await ctx.db
			.query('programMembers')
			.withIndex('by_person', (q: any) => q.eq('personId', person._id))
			.take(50);
		// A student may join anything offered to a program they belong to — that is
		// how a repeating student picks up a course from a junior program.
		if (!memberships.some((m: any) => m.programId === offering.programId)) {
			throw new Error('That course is not offered to any of your programs. Please see your lecturer.');
		}
		const existing = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const dup = existing.find((e: any) => e.offeringId === args.offeringId && e.status === 'active');
		if (dup) throw new Error('You are already enrolled in that course.');
		// Re-adding after dropping reuses the row rather than piling up history.
		const dropped = existing.find((e: any) => e.offeringId === args.offeringId && e.status === 'dropped');
		if (dropped) {
			await ctx.db.patch(dropped._id, { status: 'active', createdAt: Date.now(), addedBy: 'self' });
			return { ok: true };
		}
		await ctx.db.insert('enrolments', {
			personId: person._id,
			courseId: offering.courseId,
			offeringId: offering._id,
			semesterId: offering.semesterId,
			programId: offering.programId,
			status: 'active',
			addedBy: 'self',
			createdAt: Date.now()
		});
		return { ok: true };
	}
});

/** A student drops a course themselves (before it is assessed). */
export const dropSelf = mutation({
	args: { token: v.string(), offeringId: v.id('offerings') },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person) throw new Error('Your sign-in has expired. Please sign in again.');
		const rows = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const row = rows.find((e: any) => e.offeringId === args.offeringId && e.status === 'active');
		if (!row) throw new Error('You are not enrolled in that course.');
		const recorded = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(1000);
		if (recorded.some((a: any) => a.offeringId === args.offeringId)) {
			throw new Error('Attendance has already been taken for this course. Please see your lecturer.');
		}
		await ctx.db.patch(row._id, { status: 'dropped' });
		return { ok: true };
	}
});

/**
 * The one place an enrolment is written by staff. Assigning from a course's
 * roster and ticking a list of courses from the student's own row differ only
 * in who is allowed to ask, so the write itself lives here: profile pickups,
 * the re-add-after-drop path, and the `addedBy` tag that records who chose it.
 */
async function assignOne(
	ctx: any,
	offering: any,
	personId: any,
	enroll: boolean,
	addedBy: 'rep' | 'lecturer'
): Promise<'added' | 'removed' | 'unchanged'> {
	const rows = await ctx.db.query('enrolments').withIndex('by_person', (q: any) => q.eq('personId', personId)).take(300);
	const existing = rows.find((e: any) => e.offeringId === offering._id);

	if (enroll) {
		if (existing?.status === 'active') return 'unchanged';
		if (existing) {
			await ctx.db.patch(existing._id, { status: 'active', createdAt: Date.now(), addedBy });
			return 'added';
		}
		await ctx.db.insert('enrolments', {
			personId,
			courseId: offering.courseId,
			offeringId: offering._id,
			semesterId: offering.semesterId,
			programId: offering.programId,
			status: 'active',
			addedBy,
			createdAt: Date.now()
		});
		return 'added';
	}

	if (!existing || existing.status === 'dropped') return 'unchanged';
	await ctx.db.patch(existing._id, { status: 'dropped' });
	return 'removed';
}

/** Staff assign or remove a course for one person. */
export const assignForPerson = mutation({
	args: { token: v.string(), personId: v.id('people'), offeringId: v.id('offerings'), enroll: v.boolean() },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Course offering not found.');

		const addedBy = actor.kind === 'staff' ? ('lecturer' as const) : ('rep' as const);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		}
		if (actor.kind !== 'staff') {
			// A rep may only touch their own program's courses.
			const repRows = await ctx.db
				.query('programReps')
				.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
				.take(200);
			if (!repRows.some((r: any) => r.programId === offering.programId)) {
				throw new Error('You are only a program rep for your own program.');
			}
		}

		await assignOne(ctx, offering, args.personId, args.enroll, addedBy);
		return { ok: true };
	}
});

/**
 * Set several of one student's courses at once — the Students tab's tick list.
 *
 * Written as one mutation rather than N calls so a single Save is a single
 * transaction: either the whole tick list lands or none of it does, and the
 * screen never has to reconcile a half-applied selection.
 */
export const assignCoursesForStudent = mutation({
	args: {
		token: v.string(),
		personId: v.id('people'),
		/** Courses the student should be taking after this call. */
		enrolOfferingIds: v.array(v.id('offerings')),
		/** Courses to withdraw them from. Ignored if an id appears in both. */
		dropOfferingIds: v.optional(v.array(v.id('offerings')))
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = new Set(await lecturerProgramIds(ctx, actor.id));
			const memberships = await ctx.db
				.query('programMembers')
				.withIndex('by_person', (q) => q.eq('personId', args.personId))
				.take(50);
			if (!memberships.some((m: any) => mine.has(String(m.programId)))) {
				throw new Error('That student is not in a program you teach.');
			}
		}
		const addedBy = actor.kind === 'staff' ? ('lecturer' as const) : ('rep' as const);

		// De-duplicate before touching anything: a doubled id would otherwise be
		// applied twice and count as two changes in the answer below.
		const uniq = (ids: any[]) => ids.filter((id, i, all) => all.findIndex((x) => String(x) === String(id)) === i);
		const toEnroll = uniq(args.enrolOfferingIds);
		const enrollSet = new Set(toEnroll.map(String));
		const toDrop = uniq(args.dropOfferingIds ?? []).filter((id) => !enrollSet.has(String(id)));

		let added = 0;
		let removed = 0;
		let unchanged = 0;
		// Guards run before any write so a bad id cannot leave the student half-set.
		const resolved: any[] = [];
		for (const offeringId of [...toEnroll, ...toDrop]) {
			const offering = await ctx.db.get('offerings', offeringId);
			if (!offering) throw new Error('One of those courses no longer exists.');
			if (actor.kind === 'staff' && !actor.isAdmin) {
				await assertCanAccessOffering(ctx, actor, offering);
			}
			if (actor.kind !== 'staff') {
				const repRows = await ctx.db
					.query('programReps')
					.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
					.take(200);
				if (!repRows.some((r: any) => r.programId === offering.programId)) {
					throw new Error('You are only a program rep for your own program.');
				}
			}
			resolved.push({ offering, enroll: enrollSet.has(String(offeringId)) });
		}

		for (const step of resolved) {
			const outcome = await assignOne(ctx, step.offering, args.personId, step.enroll, addedBy);
			if (outcome === 'added') added += 1;
			else if (outcome === 'removed') removed += 1;
			else unchanged += 1;
		}
		return { added, removed, unchanged };
	}
});

/**
 * Enrol every member of one program into every course placed for one year of
 * study (optionally one semester). The new-intake case: Year 1 arrives, one
 * click gives all of them the Year-1 courses. Already-enrolled students are
 * skipped, so re-running is safe.
 */
export const enrolProgramYear = mutation({
	args: {
		token: v.string(),
		programId: v.id('programs'),
		yearOfStudy: v.number(),
		semesterId: v.optional(v.id('semesters'))
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const program = await ctx.db.get('programs', args.programId);
		if (!program) throw new Error('Program not found.');
		if (!Number.isInteger(args.yearOfStudy) || args.yearOfStudy < 1 || args.yearOfStudy > 10) {
			throw new Error('Year of study must be 1 to 10.');
		}
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = await lecturerProgramIds(ctx, actor.id);
			if (!mine.includes(String(args.programId))) {
				throw new Error('That program is not assigned to you.');
			}
		}
		if (actor.kind !== 'staff') {
			const repRows = await ctx.db
				.query('programReps')
				.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
				.take(200);
			if (!repRows.some((r: any) => String(r.programId) === String(args.programId))) {
				throw new Error('You are only a program rep for your own program.');
			}
		}
		let offerings = await ctx.db
			.query('offerings')
			.withIndex('by_program', (q) => q.eq('programId', args.programId))
			.take(200);
		offerings = offerings.filter((o: any) => o.yearOfStudy === args.yearOfStudy);
		if (args.semesterId) {
			offerings = offerings.filter((o: any) => String(o.semesterId) === String(args.semesterId));
		}
		if (offerings.length === 0) {
			throw new Error('No courses are placed for that year yet. Place them on the Programs tab first.');
		}
		const memberships = await ctx.db
			.query('programMembers')
			.withIndex('by_program', (q: any) => q.eq('programId', args.programId))
			.take(1000);
		const addedBy = actor.kind === 'staff' ? ('lecturer' as const) : ('rep' as const);
		let students = 0;
		let added = 0;
		let unchanged = 0;
		for (const m of memberships.slice(0, 1000)) {
			students += 1;
			for (const offering of offerings) {
				const outcome = await assignOne(ctx, offering, m.personId, true, addedBy);
				if (outcome === 'added') added += 1;
				else unchanged += 1;
			}
		}
		return { students, courses: offerings.length, added, unchanged };
	}
});

/** A signed-in person's enrolments, joined for display. */
export const listMine = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		const rows = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const out: any[] = [];
		for (const e of rows) {
			if (e.status !== 'active') continue;
			const course = e.courseId ? await ctx.db.get('courses', e.courseId) : null;
			const semester = await ctx.db.get('semesters', e.semesterId);
			const programDoc = e.programId ? await ctx.db.get('programs', e.programId) : null;
			const meetings = await ctx.db
				.query('meetings')
				.withIndex('by_offering', (q) => q.eq('offeringId', e.offeringId))
				.take(20);
			out.push({
				_id: e._id,
				offeringId: e.offeringId,
				courseId: e.courseId,
				courseCode: course?.code ?? '',
				courseTitle: course?.title ?? '',
				semesterName: semester?.name ?? '',
				programName: programDoc?.name ?? '',
				addedBy: e.addedBy,
				meetings: meetings.map((m: any) => ({
					_id: m._id,
					kind: m.kind,
					dayOfWeek: m.dayOfWeek ?? null,
					date: m.date ?? null,
					startTime: m.startTime,
					endTime: m.endTime,
					room: m.room ?? ''
				}))
			});
		}
		return out;
	}
});

/**
 * What one student is studying, joined for display. This is the read side of
 * the Students tab: a student's courses are reached from the student, not by
 * hunting for the offering that carries them.
 */
export const listForPerson = query({
	args: { token: v.string(), personId: v.id('people') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			// A lecturer may look at a student in a program they teach in.
			const mine = new Set(await lecturerProgramIds(ctx, actor.id));
			const memberships = await ctx.db
				.query('programMembers')
				.withIndex('by_person', (q) => q.eq('personId', args.personId))
				.take(50);
			if (!memberships.some((m: any) => mine.has(String(m.programId)))) {
				throw new Error('That student is not in a program you teach.');
			}
		}
		const rows = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(300);
		const out: any[] = [];
		for (const e of rows) {
			if (e.status !== 'active') continue;
			const course = e.courseId ? await ctx.db.get('courses', e.courseId) : null;
			const program = e.programId ? await ctx.db.get('programs', e.programId) : null;
			const semester = await ctx.db.get('semesters', e.semesterId);
			const offering = await ctx.db.get('offerings', e.offeringId);
			const meetings = await ctx.db
				.query('meetings')
				.withIndex('by_offering', (q) => q.eq('offeringId', e.offeringId))
				.take(20);
			out.push({
				enrolmentId: e._id,
				offeringId: e.offeringId,
				courseId: e.courseId ?? null,
				courseCode: course?.code ?? '',
				courseTitle: course?.title ?? '',
				programId: e.programId ?? null,
				programName: program?.name ?? '',
				yearOfStudy: offering?.yearOfStudy ?? null,
				semesterId: e.semesterId,
				semesterName: semester?.name ?? '',
				semesterYear: semester?.year ?? null,
				addedBy: e.addedBy,
				meetingCount: meetings.length,
				enrolledAt: e.createdAt
			});
		}
		return out.sort(
			(a, b) =>
				String(a.programName).localeCompare(String(b.programName)) ||
				Number(a.yearOfStudy ?? 0) - Number(b.yearOfStudy ?? 0) ||
				String(a.courseCode).localeCompare(String(b.courseCode))
		);
	}
});

/**
 * Every course one student could be given, from every program they belong to,
 * each flagged with whether they already have it. A repeating student belongs
 * to more than one program, so this is the union — which is the point of the
 * Students tab: one place to see and set everything they study.
 *
 * Read-only for a student's own use? No — this is a staff screen. Students
 * still see their own courses through `listMine`.
 */
export const listStudentCourses = query({
	args: { token: v.string(), personId: v.id('people') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const mine = new Set(
			actor.kind === 'staff' && !actor.isAdmin ? await lecturerProgramIds(ctx, actor.id) : []
		);
		const memberships = await ctx.db
			.query('programMembers')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(50);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			if (!memberships.some((m: any) => mine.has(String(m.programId)))) {
				throw new Error('That student is not in a program you teach.');
			}
		}
		const enrolled = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(300);
		const activeByOffering = new Map<string, any>();
		for (const e of enrolled) {
			if (e.status === 'active') activeByOffering.set(String(e.offeringId), e);
		}
		const out: any[] = [];
		const seen = new Set<string>();
		for (const m of memberships) {
			if (actor.kind === 'staff' && !actor.isAdmin && !mine.has(String(m.programId))) continue;
			const program = await ctx.db.get('programs', m.programId);
			const offerings = await ctx.db
				.query('offerings')
				.withIndex('by_program', (q) => q.eq('programId', m.programId))
				.take(200);
			for (const o of offerings) {
				if (seen.has(String(o._id))) continue;
				seen.add(String(o._id));
				const course = o.courseId ? await ctx.db.get('courses', o.courseId) : null;
				if (!course) continue;
				const semester = await ctx.db.get('semesters', o.semesterId);
				const existing = activeByOffering.get(String(o._id));
				out.push({
					offeringId: o._id,
					courseId: o.courseId,
					courseCode: course.code,
					courseTitle: course.title,
					hoursPerWeek: course.hoursPerWeek ?? null,
					programId: m.programId,
					programName: program?.name ?? '',
					yearOfStudy: o.yearOfStudy ?? null,
					semesterId: o.semesterId,
					semesterName: semester?.name ?? '',
					semesterYear: semester?.year ?? null,
					openForEnrolment: o.openForEnrolment,
					enrolled: Boolean(existing),
					addedBy: existing?.addedBy ?? null
				});
			}
		}
		return out.sort(
			(a, b) =>
				String(a.programName).localeCompare(String(b.programName)) ||
				Number(a.yearOfStudy ?? 0) - Number(b.yearOfStudy ?? 0) ||
				String(a.semesterName).localeCompare(String(b.semesterName)) ||
				String(a.courseCode).localeCompare(String(b.courseCode))
		);
	}
});

/** Everyone enrolled in one offering — lecturers only see offerings they may touch. */
export const listForOffering = query({
	args: { token: v.string(), offeringId: v.id('offerings') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const offering = await ctx.db.get('offerings', args.offeringId);
			await assertCanAccessOffering(ctx, actor, offering);
		}
		const rows = await ctx.db
			.query('enrolments')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.offeringId))
			.take(1000);
		const out: any[] = [];
		for (const e of rows) {
			if (e.status !== 'active') continue;
			const person = await ctx.db.get('people', e.personId);
			if (!person) continue;
			out.push({
				_id: e._id,
				personId: person._id,
				fullName: person.fullName,
				regNumber: person.regNumber,
				studentId: person.studentId,
				status: person.status,
				addedBy: e.addedBy
			});
		}
		return out;
	}
});

/** Enrolled people for a course within a program — lecturers only see offerings they may touch. */
export const listForCourse = query({
	args: { token: v.string(), courseId: v.id('courses'), programId: v.optional(v.id('programs')) },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const candidates = await ctx.db
				.query('offerings')
				.withIndex('by_course', (q) => q.eq('courseId', args.courseId))
				.take(100);
			let ok = false;
			for (const o of candidates) {
				if (args.programId && String(o.programId) !== String(args.programId)) continue;
				if (await canAccessOffering(ctx, actor, o)) {
					ok = true;
					break;
				}
			}
			if (!ok) throw new Error('This course is not assigned to you. Ask the admin to assign it.');
		}
		const rows = await ctx.db
			.query('enrolments')
			.withIndex('by_course', (q) => q.eq('courseId', args.courseId))
			.take(2000);
		const out: any[] = [];
		for (const e of rows) {
			if (e.status !== 'active') continue;
			if (args.programId && e.programId !== args.programId) continue;
			const person = await ctx.db.get('people', e.personId);
			if (!person) continue;
			out.push({
				personId: person._id,
				fullName: person.fullName,
				regNumber: person.regNumber,
				studentId: person.studentId,
				programId: e.programId,
				semesterId: e.semesterId
			});
		}
		return out;
	}
});