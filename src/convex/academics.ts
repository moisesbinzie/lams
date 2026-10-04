import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireActor, requireStaff } from './auth';

// ---------------------------------------------------------------- semesters

export const listSemesters = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireActor(ctx, args.token);
		return await ctx.db.query('semesters').order('desc').take(100);
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
		await requireStaff(ctx, args.token);
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
		await requireStaff(ctx, args.token);
		const offerings = await ctx.db
			.query('offerings')
			.withIndex('by_semester', (q) => q.eq('semesterId', args.id))
			.take(1);
		if (offerings.length > 0) throw new Error('This semester already has subjects. Remove them first.');
		const classes = await ctx.db.query('classes').withIndex('by_semester', (q) => q.eq('semesterId', args.id)).take(1);
		if (classes.length > 0) throw new Error('This semester already has classes. Remove them first.');
		await ctx.db.delete('semesters', args.id);
		return { ok: true };
	}
});

// ------------------------------------------------------------------ classes

export const listClasses = query({
	args: { token: v.string(), semesterId: v.optional(v.id('semesters')) },
	handler: async (ctx, args) => {
		await requireActor(ctx, args.token);
		const rows = args.semesterId
			? await ctx.db.query('classes').withIndex('by_semester', (q) => q.eq('semesterId', args.semesterId!)).take(200)
			: await ctx.db.query('classes').order('desc').take(200);
		return Promise.all(
			rows.map(async (c: any) => {
				const memberships = await ctx.db
					.query('classMembers')
					.withIndex('by_class', (q) => q.eq('classId', c._id))
					.take(2000);
				const members = (await Promise.all(memberships.map((m: any) => ctx.db.get('people', m.personId)))).filter(
					(p: any) => p && p.status !== 'blocked'
				);
				const semester = c.semesterId ? await ctx.db.get('semesters', c.semesterId) : null;
				return {
					...c,
					studentCount: members.length,
					semesterName: semester?.name ?? ''
				};
			})
		);
	}
});

export const createClass = mutation({
	args: {
		token: v.string(),
		name: v.string(),
		yearOfStudy: v.number(),
		semesterId: v.optional(v.id('semesters'))
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const name = args.name.trim();
		if (!name) throw new Error('Give the class a name.');
		if (args.yearOfStudy < 1 || args.yearOfStudy > 10) throw new Error('Year of study must be 1 to 10.');
		return await ctx.db.insert('classes', {
			name,
			yearOfStudy: args.yearOfStudy,
			...(args.semesterId ? { semesterId: args.semesterId } : {}),
			createdAt: Date.now()
		});
	}
});

export const updateClass = mutation({
	args: {
		token: v.string(),
		id: v.id('classes'),
		name: v.optional(v.string()),
		yearOfStudy: v.optional(v.number()),
		semesterId: v.optional(v.id('semesters'))
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const cls = await ctx.db.get('classes', args.id);
		if (!cls) throw new Error('Class not found.');
		const patch: Record<string, unknown> = {};
		if (args.name?.trim()) patch.name = args.name.trim();
		if (args.yearOfStudy !== undefined) {
			if (args.yearOfStudy < 1 || args.yearOfStudy > 10)
				throw new Error('Year of study must be 1 to 10.');
			patch.yearOfStudy = args.yearOfStudy;
		}
		if (args.semesterId !== undefined) patch.semesterId = args.semesterId;
		if (Object.keys(patch).length === 0) return { ok: true };
		await ctx.db.patch(args.id, patch);
		return { ok: true };
	}
});

export const removeClass = mutation({
	args: { token: v.string(), id: v.id('classes') },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const offerings = await ctx.db.query('offerings').withIndex('by_class', (q) => q.eq('classId', args.id)).take(1);
		if (offerings.length > 0) throw new Error('This class still has subjects. Remove them first.');
		await ctx.db.delete('classes', args.id);
		return { ok: true };
	}
});

// ----------------------------------------------------------------- subjects

/** The course catalogue — independent of any class or semester. */
export const listSubjects = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireActor(ctx, args.token);
		return await ctx.db.query('subjects').order('asc').take(500);
	}
});

export const createSubject = mutation({
	args: {
		token: v.string(),
		code: v.string(),
		title: v.string(),
		hoursPerWeek: v.optional(v.number()),
		lecturerId: v.optional(v.id('staff'))
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const code = args.code.trim().toUpperCase();
		const title = args.title.trim();
		if (!code) throw new Error('Enter a subject code.');
		if (!title) throw new Error('Enter a subject title.');
		const existing = await ctx.db
			.query('subjects')
			.withIndex('by_code', (q) => q.eq('code', code))
			.unique();
		if (existing) throw new Error('A subject with that code already exists.');
		return await ctx.db.insert('subjects', {
			code,
			title,
			openForEnrolment: false,
			...(args.hoursPerWeek ? { hoursPerWeek: args.hoursPerWeek } : {}),
			...(args.lecturerId ? { lecturerId: args.lecturerId } : {}),
			createdAt: Date.now()
		});
	}
});

export const updateSubject = mutation({
	args: {
		token: v.string(),
		id: v.id('subjects'),
		title: v.optional(v.string()),
		hoursPerWeek: v.optional(v.number()),
		lecturerId: v.optional(v.id('staff'))
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const patch: Record<string, unknown> = {};
		if (args.title?.trim()) patch.title = args.title.trim();
		if (args.hoursPerWeek !== undefined) patch.hoursPerWeek = args.hoursPerWeek;
		if (args.lecturerId !== undefined) patch.lecturerId = args.lecturerId;
		if (Object.keys(patch).length === 0) return { ok: true };
		await ctx.db.patch(args.id, patch);
		return { ok: true };
	}
});

export const removeSubject = mutation({
	args: { token: v.string(), id: v.id('subjects') },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const offerings = await ctx.db
			.query('offerings')
			.withIndex('by_subject', (q) => q.eq('subjectId', args.id))
			.take(1);
		if (offerings.length > 0) throw new Error('This subject is offered to a class. Remove it there first.');
		await ctx.db.delete('subjects', args.id);
		return { ok: true };
	}
});

// ---------------------------------------------------------------- offerings

/** A subject offered to a class in a semester. */
export const listOfferings = query({
	args: {
		token: v.string(),
		classId: v.optional(v.id('classes')),
		semesterId: v.optional(v.id('semesters'))
	},
	handler: async (ctx, args) => {
		await requireActor(ctx, args.token);
		let rows: any[];
		if (args.classId && args.semesterId) {
			rows = await ctx.db
				.query('offerings')
				.withIndex('by_class_and_semester', (q) =>
					q.eq('classId', args.classId!).eq('semesterId', args.semesterId!)
				)
				.take(200);
		} else if (args.classId) {
			rows = await ctx.db.query('offerings').withIndex('by_class', (q) => q.eq('classId', args.classId!)).take(200);
		} else if (args.semesterId) {
			rows = await ctx.db
				.query('offerings')
				.withIndex('by_semester', (q) => q.eq('semesterId', args.semesterId!))
				.take(200);
		} else {
			rows = await ctx.db.query('offerings').take(200);
		}
		return Promise.all(
			rows.map(async (o: any) => {
				const subject = await ctx.db.get('subjects', o.subjectId);
				const classDoc = await ctx.db.get('classes', o.classId);
				const semester = await ctx.db.get('semesters', o.semesterId);
				const count = await ctx.db
					.query('enrolments')
					.withIndex('by_offering', (q) => q.eq('offeringId', o._id))
					.take(1000);
				return {
					_id: o._id,
					subjectId: o.subjectId,
					subjectCode: subject?.code ?? '',
					subjectTitle: subject?.title ?? '',
					hoursPerWeek: subject?.hoursPerWeek ?? null,
					classId: o.classId,
					className: classDoc?.name ?? '',
					semesterId: o.semesterId,
					semesterName: semester?.name ?? '',
					openForEnrolment: o.openForEnrolment,
					studentCount: count.filter((e: any) => e.status === 'active').length
				};
			})
		);
	}
});

export const createOffering = mutation({
	args: {
		token: v.string(),
		subjectId: v.id('subjects'),
		classId: v.id('classes'),
		semesterId: v.id('semesters'),
		openForEnrolment: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const existing = await ctx.db
			.query('offerings')
			.withIndex('by_class_and_semester', (q) =>
				q.eq('classId', args.classId).eq('semesterId', args.semesterId)
			)
			.take(50);
		if (existing.some((o: any) => o.subjectId === args.subjectId)) {
			throw new Error('That subject is already offered to this class this semester.');
		}
		return await ctx.db.insert('offerings', {
			subjectId: args.subjectId,
			classId: args.classId,
			semesterId: args.semesterId,
			openForEnrolment: args.openForEnrolment ?? false,
			createdAt: Date.now()
		});
	}
});

export const setOfferingOpen = mutation({
	args: { token: v.string(), id: v.id('offerings'), open: v.boolean() },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		await ctx.db.patch(args.id, { openForEnrolment: args.open });
		return { ok: true };
	}
});

export const removeOffering = mutation({
	args: { token: v.string(), id: v.id('offerings') },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const enrolments = await ctx.db
			.query('enrolments')
			.withIndex('by_offering', (q) => q.eq('offeringId', args.id))
			.take(1000);
		if (enrolments.length > 0) throw new Error('Students are enrolled in this subject. Remove them first.');
		const meetings = await ctx.db.query('meetings').withIndex('by_offering', (q) => q.eq('offeringId', args.id)).take(200);
		for (const m of meetings) await ctx.db.delete('meetings', m._id);
		await ctx.db.delete('offerings', args.id);
		return { ok: true };
	}
});