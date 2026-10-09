import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { lecturerClassIds, logAudit, requireActor, requireRecorder, requireStaff } from './auth';

/**
 * Class-rep rights are scoped to a class, not a subject or person. A rep of a
 * class can take attendance for anything that class is taking. Several people
 * may represent one class, and one person may represent several — the join
 * table is what keeps that flexible without over-granting.
 */

/** The classes a person represents — lecturers only see classes they teach. */
export const listForPerson = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		if (actor.kind === 'staff' && actor.isAdmin) {
			const classes = await ctx.db.query('classes').order('asc').take(200);
			return classes.map((c: any) => ({ classId: c._id, className: c.name }));
		}
		if (actor.kind === 'staff') {
			const mine = await ctx.db
				.query('offerings')
				.withIndex('by_lecturer', (q: any) => q.eq('lecturerId', actor.id))
				.take(500);
			const classIds = [...new Set(mine.map((o: any) => String(o.classId)))];
			const out: any[] = [];
			for (const id of classIds) {
				const cls = await ctx.db.get('classes', id as never);
				if (cls) out.push({ classId: cls._id, className: (cls as any).name });
			}
			return out;
		}
		if (actor.role !== 'rep') return [];
		const rows = await ctx.db
			.query('classReps')
			.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
			.take(200);
		const out: any[] = [];
		for (const r of rows) {
			const cls = await ctx.db.get('classes', r.classId);
			if (cls) out.push({ classId: cls._id, className: cls.name });
		}
		return out;
	}
});

/** Everyone representing a class — lecturers only see classes they teach. */
export const listForClass = query({
	args: { token: v.string(), classId: v.id('classes') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = await lecturerClassIds(ctx, actor.id);
			if (!mine.includes(String(args.classId))) {
				throw new Error('That class is not assigned to you.');
			}
		}
		const rows = await ctx.db
			.query('classReps')
			.withIndex('by_class', (q: any) => q.eq('classId', args.classId))
			.take(100);
		const out: any[] = [];
		for (const r of rows) {
			const person = await ctx.db.get('people', r.personId);
			if (person)
				out.push({ personId: person._id, fullName: person.fullName, regNumber: person.regNumber });
		}
		return out;
	}
});

/**
 * Promote or demote a rep for a class. A rep must already be an active person,
 * otherwise they would hold rights they can never exercise.
 */
export const setRep = mutation({
	args: { token: v.string(), classId: v.id('classes'), personId: v.id('people'), isRep: v.boolean() },
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		if (!actor.isAdmin) {
			const mine = await lecturerClassIds(ctx, actor.id);
			if (!mine.includes(String(args.classId))) {
				throw new Error('That class is not assigned to you.');
			}
		}
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		const cls = await ctx.db.get('classes', args.classId);
		if (!cls) throw new Error('Class not found.');

		const existing = await ctx.db
			.query('classReps')
			.withIndex('by_person', (q: any) => q.eq('personId', args.personId))
			.take(200);
		const row = existing.find((r: any) => r.classId === args.classId);

		if (args.isRep) {
			if (person.status === 'blocked') {
				throw new Error('That account is suspended. Unblock them before making them a rep.');
			}
			if (!row) {
				await ctx.db.insert('classReps', {
					personId: args.personId,
					classId: args.classId,
					createdAt: Date.now()
				});
			}
			// Reflect the promotion on the person's record so their home screen
			// shows rep tools without a second lookup.
			if (person.role !== 'rep') {
				await ctx.db.patch(args.personId, { role: 'rep' });
			}
		} else if (row) {
			await ctx.db.delete('classReps', row._id);
			// Demote only when they represent nothing else.
			const remaining = await ctx.db
				.query('classReps')
				.withIndex('by_person', (q: any) => q.eq('personId', args.personId))
				.take(200);
			if (remaining.length === 0 && person.role === 'rep') {
				await ctx.db.patch(args.personId, { role: 'student' });
			}
		}
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: args.isRep ? 'rep.grant' : 'rep.revoke',
			targetKind: 'person',
			targetId: args.personId,
			targetName: person.fullName,
			detail: cls.name
		});
		return { ok: true };
	}
});
