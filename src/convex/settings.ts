import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	ADMIN_KEY,
	DEFAULT_PASSWORD,
	ITERATIONS,
	SCHEME,
	hashPassword,
	randomSalt,
	verifyPassword,
	type AdminDoc
} from './auth';

export { DEFAULT_PASSWORD };

export const getSetupState = query({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', ADMIN_KEY)).unique();
		return { seeded: existing !== null };
	}
});

export const ensureSeed = mutation({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', ADMIN_KEY)).unique();
		if (existing) return { seeded: false };
		const salt = randomSalt();
		const adminHash = await hashPassword(DEFAULT_PASSWORD, salt);
		await ctx.db.insert('settings', {
			key: ADMIN_KEY,
			adminHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			updatedAt: Date.now()
		});
		return { seeded: true };
	}
});

export const verifyAdmin = mutation({
	args: { password: v.string() },
	handler: async (ctx, args) => {
		const doc = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', ADMIN_KEY)).unique();
		if (!doc) return { ok: false };
		const ok = await verifyPassword(ctx, doc as unknown as AdminDoc, args.password);
		return { ok };
	}
});

export const setPassword = mutation({
	args: { oldPassword: v.string(), newPassword: v.string() },
	handler: async (ctx, args) => {
		if (args.newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
		const doc = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', ADMIN_KEY)).unique();
		if (!doc) throw new Error('Admin not initialised. Run setup first.');
		const ok = await verifyPassword(ctx, doc as unknown as AdminDoc, args.oldPassword);
		if (!ok) throw new Error('Old password is incorrect.');
		const salt = randomSalt();
		const adminHash = await hashPassword(args.newPassword, salt);
		await ctx.db.patch(doc._id, {
			adminHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			updatedAt: Date.now()
		});
		return { ok: true };
	}
});

