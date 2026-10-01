import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAdmin } from './auth';
import { normalizeId, normalizeReg } from './helpers';

export const listByCourse = query({
	args: { courseId: v.id('courses') },
	handler: async (ctx, args) => {
		return await ctx.db.query('students').withIndex('by_course', (q) => q.eq('courseId', args.courseId)).order('asc').take(1000);
	}
});

export const upsert = mutation({
	args: {
		password: v.string(),
		courseId: v.id('courses'),
		fullName: v.string(),
		regNumber: v.string(),
		studentId: v.string()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const fullName = args.fullName.trim();
		if (!fullName) throw new Error('Full name required.');
		const regNorm = normalizeReg(args.regNumber);
		const idNorm = normalizeId(args.studentId);
		if (!regNorm || !idNorm) throw new Error('Registration number and student ID required.');
		const existing = await ctx.db
			.query('students')
			.withIndex('by_course_and_reg', (q) => q.eq('courseId', args.courseId).eq('regNorm', regNorm))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, { fullName, regNumber: args.regNumber.trim(), studentId: args.studentId.trim(), idNorm });
			return existing._id;
		}
		return await ctx.db.insert('students', {
			courseId: args.courseId,
			fullName,
			regNumber: args.regNumber.trim(),
			regNorm,
			studentId: args.studentId.trim(),
			idNorm,
			isClassRep: false,
			createdAt: Date.now()
		});
	}
});

export const importBatch = mutation({
	args: {
		password: v.string(),
		courseId: v.id('courses'),
		rows: v.array(v.object({ fullName: v.string(), regNumber: v.string(), studentId: v.string() }))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		if (args.rows.length > 1000) throw new Error('Max 1000 rows per import.');
		let added = 0;
		let updated = 0;
		for (const row of args.rows) {
			const fullName = row.fullName.trim();
			const regNorm = normalizeReg(row.regNumber);
			const idNorm = normalizeId(row.studentId);
			if (!fullName || !regNorm || !idNorm) continue;
			const existing = await ctx.db
				.query('students')
				.withIndex('by_course_and_reg', (q) => q.eq('courseId', args.courseId).eq('regNorm', regNorm))
				.unique();
			if (existing) {
				await ctx.db.patch(existing._id, { fullName, regNumber: row.regNumber.trim(), studentId: row.studentId.trim(), idNorm });
				updated += 1;
			} else {
				await ctx.db.insert('students', {
					courseId: args.courseId,
					fullName,
					regNumber: row.regNumber.trim(),
					regNorm,
					studentId: row.studentId.trim(),
					idNorm,
					isClassRep: false,
					createdAt: Date.now()
				});
				added += 1;
			}
		}
		return { added, updated };
	}
});

export const setClassRep = mutation({
	args: { password: v.string(), studentId: v.id('students'), isClassRep: v.boolean() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		await ctx.db.patch(args.studentId, { isClassRep: args.isClassRep });
		return { ok: true };
	}
});

export const remove = mutation({
	args: { password: v.string(), id: v.id('students') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		await ctx.db.delete('students', args.id);
		return { ok: true };
	}
});

// Public lookup so the attendance form can auto-fill name + student ID from
// the reg number. Returns minimal fields only; null when not on the roster.
export const findByReg = query({
	args: { sessionId: v.id('sessions'), regNumber: v.string() },
	handler: async (ctx, args) => {
		const regNorm = normalizeReg(args.regNumber);
		if (!regNorm) return null;
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session || session.status !== 'open') return null;
		const match = await ctx.db
			.query('students')
			.withIndex('by_course_and_reg', (q) => q.eq('courseId', session.courseId).eq('regNorm', regNorm))
			.unique();
		if (!match) return null;
		return { fullName: match.fullName, regNumber: match.regNumber, studentId: match.studentId, isClassRep: match.isClassRep };
	}
});
