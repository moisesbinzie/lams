import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	assertCanAccessOffering,
	canAccessOffering,
	requirePerson,
	requireRecorder,
	requireStaff
} from './auth';

/**
 * Two ways into a subject:
 *  - a student adds one themselves from the open list;
 *  - a class rep or lecturer assigns one for them.
 * Both produce the same `enrolments` row, tagged so the lecturer can see who
 * chose what.
 */

/** What a student may add themselves to, across every class they belong to. */
export const listOpenForStudent = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		const doc = await ctx.db.get('people', person._id);
		if (!doc) return [];
		const memberships = await ctx.db
			.query('classMembers')
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
				.withIndex('by_class', (q) => q.eq('classId', m.classId))
				.take(200);
			for (const o of offerings) {
				if (!o.openForEnrolment) continue;
				if (seen.has(String(o._id))) continue;
				seen.add(String(o._id));
				const subject = await ctx.db.get('subjects', o.subjectId);
				const semester = await ctx.db.get('semesters', o.semesterId);
				if (!subject) continue;
				out.push({
					_id: o._id,
					subjectId: o.subjectId,
					subjectCode: subject.code,
					subjectTitle: subject.title,
					hoursPerWeek: subject.hoursPerWeek ?? null,
					semesterName: semester?.name ?? '',
					className: (await ctx.db.get('classes', o.classId))?.name ?? '',
					alreadyEnrolled: enrolledOfferingIds.has(String(o._id))
				});
			}
		}
		return out;
	}
});

/** A student adds a subject for themselves. Blocked once the lecturer closes it. */
export const enrolSelf = mutation({
	args: { token: v.string(), offeringId: v.id('offerings') },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person) throw new Error('Your sign-in has expired. Please sign in again.');
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('That subject is no longer available.');
		if (!offering.openForEnrolment) {
			throw new Error('Your lecturer has closed enrolment for this subject. Please see them.');
		}
		const doc = await ctx.db.get('people', person._id as never);
		if (!doc) throw new Error('Account not found.');
		const memberships = await ctx.db
			.query('classMembers')
			.withIndex('by_person', (q: any) => q.eq('personId', person._id))
			.take(50);
		// A student may join anything offered to a class they belong to — that is
		// how a repeating student picks up a subject from a junior class.
		if (!memberships.some((m: any) => m.classId === offering.classId)) {
			throw new Error('That subject is not offered to any of your classes. Please see your lecturer.');
		}
		const existing = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const dup = existing.find((e: any) => e.offeringId === args.offeringId && e.status === 'active');
		if (dup) throw new Error('You are already enrolled in that subject.');
		// Re-adding after dropping reuses the row rather than piling up history.
		const dropped = existing.find((e: any) => e.offeringId === args.offeringId && e.status === 'dropped');
		if (dropped) {
			await ctx.db.patch(dropped._id, { status: 'active', createdAt: Date.now(), addedBy: 'self' });
			return { ok: true };
		}
		await ctx.db.insert('enrolments', {
			personId: person._id,
			subjectId: offering.subjectId,
			offeringId: offering._id,
			semesterId: offering.semesterId,
			classId: offering.classId,
			status: 'active',
			addedBy: 'self',
			createdAt: Date.now()
		});
		return { ok: true };
	}
});

/** A student drops a subject themselves (before it is assessed). */
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
		if (!row) throw new Error('You are not enrolled in that subject.');
		const recorded = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(1000);
		if (recorded.some((a: any) => a.offeringId === args.offeringId)) {
			throw new Error('Attendance has already been taken for this subject. Please see your lecturer.');
		}
		await ctx.db.patch(row._id, { status: 'dropped' });
		return { ok: true };
	}
});

/** Staff assign or remove a subject for one person. */
export const assignForPerson = mutation({
	args: { token: v.string(), personId: v.id('people'), offeringId: v.id('offerings'), enroll: v.boolean() },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Subject offering not found.');

		const addedBy = actor.kind === 'staff' ? ('lecturer' as const) : ('rep' as const);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			await assertCanAccessOffering(ctx, actor, offering);
		}
		if (actor.kind !== 'staff') {
			// A rep may only touch their own class's subjects.
			const repRows = await ctx.db
				.query('classReps')
				.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
				.take(200);
			if (!repRows.some((r: any) => r.classId === offering.classId)) {
				throw new Error('You are only a class rep for your own class.');
			}
		}

		const rows = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(300);
		const existing = rows.find((e: any) => e.offeringId === args.offeringId);

		if (args.enroll) {
			if (existing?.status === 'active') return { ok: true };
			if (existing) {
				await ctx.db.patch(existing._id, { status: 'active', createdAt: Date.now(), addedBy });
				return { ok: true };
			}
			await ctx.db.insert('enrolments', {
				personId: args.personId,
				subjectId: offering.subjectId,
				offeringId: offering._id,
				semesterId: offering.semesterId,
				classId: offering.classId,
				status: 'active',
				addedBy,
				createdAt: Date.now()
			});
			return { ok: true };
		}

		if (!existing || existing.status === 'dropped') throw new Error('That person is not enrolled.');
		await ctx.db.patch(existing._id, { status: 'dropped' });
		return { ok: true };
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
			const subject = await ctx.db.get('subjects', e.subjectId);
			const semester = await ctx.db.get('semesters', e.semesterId);
			const classDoc = await ctx.db.get('classes', e.classId);
			const meetings = await ctx.db
				.query('meetings')
				.withIndex('by_offering', (q) => q.eq('offeringId', e.offeringId))
				.take(20);
			out.push({
				_id: e._id,
				offeringId: e.offeringId,
				subjectId: e.subjectId,
				subjectCode: subject?.code ?? '',
				subjectTitle: subject?.title ?? '',
				semesterName: semester?.name ?? '',
				className: classDoc?.name ?? '',
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

/** Enrolled people for a subject within a class — lecturers only see offerings they may touch. */
export const listForSubject = query({
	args: { token: v.string(), subjectId: v.id('subjects'), classId: v.optional(v.id('classes')) },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const candidates = await ctx.db
				.query('offerings')
				.withIndex('by_subject', (q) => q.eq('subjectId', args.subjectId))
				.take(100);
			let ok = false;
			for (const o of candidates) {
				if (args.classId && String(o.classId) !== String(args.classId)) continue;
				if (await canAccessOffering(ctx, actor, o)) {
					ok = true;
					break;
				}
			}
			if (!ok) throw new Error('This subject is not assigned to you. Ask the admin to assign it.');
		}
		const rows = await ctx.db
			.query('enrolments')
			.withIndex('by_subject', (q) => q.eq('subjectId', args.subjectId))
			.take(2000);
		const out: any[] = [];
		for (const e of rows) {
			if (e.status !== 'active') continue;
			if (args.classId && e.classId !== args.classId) continue;
			const person = await ctx.db.get('people', e.personId);
			if (!person) continue;
			out.push({
				personId: person._id,
				fullName: person.fullName,
				regNumber: person.regNumber,
				studentId: person.studentId,
				classId: e.classId,
				semesterId: e.semesterId
			});
		}
		return out;
	}
});