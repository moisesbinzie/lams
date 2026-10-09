import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { lecturerProgramIds, logAudit, requireActor, requireRecorder, requireStaff } from './auth';

/**
 * Program-rep rights are scoped to a program, not a subject or person. A rep of a
 * program can take attendance for anything that program is taking. Several people
 * may represent one program, and one person may represent several — the join
 * table is what keeps that flexible without over-granting.
 */

/** The programs a person represents — lecturers only see programs they teach. */
export const listForPerson = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		if (actor.kind === 'staff' && actor.isAdmin) {
			const programs = await ctx.db.query('programs').order('asc').take(200);
			return programs.map((c: any) => ({ programId: c._id, programName: c.name }));
		}
		if (actor.kind === 'staff') {
			const mine = await ctx.db
				.query('offerings')
				.withIndex('by_lecturer', (q: any) => q.eq('lecturerId', actor.id))
				.take(500);
			const programIds = [...new Set(mine.map((o: any) => String(o.programId)))];
			const out: any[] = [];
			for (const id of programIds) {
				const cls = await ctx.db.get('programs', id as never);
				if (cls) out.push({ programId: cls._id, programName: (cls as any).name });
			}
			return out;
		}
		if (actor.role !== 'rep') return [];
		const rows = await ctx.db
			.query('programReps')
			.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
			.take(200);
		const out: any[] = [];
		for (const r of rows) {
			const cls = await ctx.db.get('programs', r.programId);
			if (cls) out.push({ programId: cls._id, programName: cls.name });
		}
		return out;
	}
});

/** Everyone representing a program — lecturers only see programs they teach. */
export const listForProgram = query({
	args: { token: v.string(), programId: v.id('programs') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		if (actor.kind === 'staff' && !actor.isAdmin) {
			const mine = await lecturerProgramIds(ctx, actor.id);
			if (!mine.includes(String(args.programId))) {
				throw new Error('That program is not assigned to you.');
			}
		}
		const rows = await ctx.db
			.query('programReps')
			.withIndex('by_program', (q: any) => q.eq('programId', args.programId))
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
 * Promote or demote a rep for a program. A rep must already be an active person,
 * otherwise they would hold rights they can never exercise.
 */
export const setRep = mutation({
	args: { token: v.string(), programId: v.id('programs'), personId: v.id('people'), isRep: v.boolean() },
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		if (!actor.isAdmin) {
			const mine = await lecturerProgramIds(ctx, actor.id);
			if (!mine.includes(String(args.programId))) {
				throw new Error('That program is not assigned to you.');
			}
		}
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		const cls = await ctx.db.get('programs', args.programId);
		if (!cls) throw new Error('Program not found.');

		const existing = await ctx.db
			.query('programReps')
			.withIndex('by_person', (q: any) => q.eq('personId', args.personId))
			.take(200);
		const row = existing.find((r: any) => r.programId === args.programId);

		if (args.isRep) {
			if (person.status === 'blocked') {
				throw new Error('That account is suspended. Unblock them before making them a rep.');
			}
			if (!row) {
				await ctx.db.insert('programReps', {
					personId: args.personId,
					programId: args.programId,
					createdAt: Date.now()
				});
			}
			// Reflect the promotion on the person's record so their home screen
			// shows rep tools without a second lookup.
			if (person.role !== 'rep') {
				await ctx.db.patch(args.personId, { role: 'rep' });
			}
		} else if (row) {
			await ctx.db.delete('programReps', row._id);
			// Demote only when they represent nothing else.
			const remaining = await ctx.db
				.query('programReps')
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
