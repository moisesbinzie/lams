import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAdmin } from './auth';

export const list = query({
	args: { termId: v.optional(v.id('terms')) },
	handler: async (ctx, args) => {
		if (args.termId) {
			return await ctx.db.query('courses').withIndex('by_term', (q) => q.eq('termId', args.termId)).order('desc').take(100);
		}
		return await ctx.db.query('courses').order('desc').take(100);
	}
});

export const create = mutation({
	args: { password: v.string(), termId: v.optional(v.id('terms')), code: v.string(), title: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const code = args.code.trim();
		const title = args.title.trim();
		if (!code || !title) throw new Error('Course code and title required.');
		return await ctx.db.insert('courses', { termId: args.termId, code, title, createdAt: Date.now() });
	}
});

export const remove = mutation({
	args: { password: v.string(), id: v.id('courses') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		// Cascade: sessions + their attendance rows first, then the roster.
		const sessions = await ctx.db.query('sessions').withIndex('by_course', (q) => q.eq('courseId', args.id)).take(200);
		for (const sess of sessions) {
			const rows = await ctx.db.query('attendance').withIndex('by_session', (q) => q.eq('sessionId', sess._id)).take(2000);
			for (const r of rows) await ctx.db.delete('attendance', r._id);
			await ctx.db.delete('sessions', sess._id);
		}
		const roster = await ctx.db.query('students').withIndex('by_course', (q) => q.eq('courseId', args.id)).take(1000);
		for (const s of roster) await ctx.db.delete('students', s._id);
		await ctx.db.delete('courses', args.id);
		return { ok: true };
	}
});
