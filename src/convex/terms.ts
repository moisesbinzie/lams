import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAdmin } from './auth';

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('terms').order('desc').take(50);
	}
});

export const create = mutation({
	args: { password: v.string(), name: v.string(), startDate: v.string(), endDate: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const name = args.name.trim();
		if (!name) throw new Error('Term name required.');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(args.endDate))
			throw new Error('Term dates must be YYYY-MM-DD.');
		if (args.startDate > args.endDate) throw new Error('Term start must be on or before the end date.');
		return await ctx.db.insert('terms', { name, startDate: args.startDate, endDate: args.endDate, createdAt: Date.now() });
	}
});

export const remove = mutation({
	args: { password: v.string(), id: v.id('terms') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.password);
		const used = await ctx.db.query('courses').withIndex('by_term', (q) => q.eq('termId', args.id)).take(1);
		if (used.length > 0) throw new Error('Term has courses — delete or move them first.');
		await ctx.db.delete('terms', args.id);
		return { ok: true };
	}
});
