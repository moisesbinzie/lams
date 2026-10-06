import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	DEFAULT_STAFF_NAME,
	DEFAULT_STAFF_PASSWORD,
	DEFAULT_STAFF_USERNAME,
	ITERATIONS,
	SCHEME,
	SESSION_TTL_MS,
	hashSecret,
	normalizeUsername,
	randomSalt,
	requireStaff,
	resolveActor,
	verifySecret
} from './auth';
import { isBlocked, noteFailure, noteSuccess } from './ratelimit';
import { randomHex } from './helpers';

/**
 * Lecturer accounts. Unlike students, lecturers sign in with a username and a
 * shared password rather than a registration number and PIN — so a lecturer
 * account cannot be reached by guessing a student reg number, and does not need
 * student details to exist.
 */

export const setupState = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query('staff').take(100);
		return { seeded: rows.length > 0, count: rows.length };
	}
});

/**
 * Creates the default `admin` account if none exists. Safe to call repeatedly;
 * it never overwrites an existing password.
 */
export const ensureSeed = mutation({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db.query('staff').take(1);
		if (existing.length > 0) return { seeded: false };
		const salt = randomSalt();
		const passwordHash = await hashSecret(DEFAULT_STAFF_PASSWORD, salt);
		await ctx.db.insert('staff', {
			username: DEFAULT_STAFF_USERNAME,
			usernameNorm: normalizeUsername(DEFAULT_STAFF_USERNAME),
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			fullName: DEFAULT_STAFF_NAME,
			active: true,
			createdAt: Date.now()
		});
		return { seeded: true };
	}
});

/**
 * Lecturer sign-in.
 *
 * Wrong details and the lockout answer `{ ok: false, message }` instead of
 * throwing, for the same reason `people.login` does: they are things a person
 * brings on themselves, and logging them as uncaught server errors buries the
 * failures that are actually faults. The security trail is unaffected — every
 * failed attempt still goes through `noteFailure`, so `authAttempts` keeps the
 * count and the block.
 */
export const login = mutation({
	args: { username: v.string(), password: v.string() },
	handler: async (ctx, args) => {
		const usernameNorm = normalizeUsername(args.username);
		if (!usernameNorm) return { ok: false as const, message: 'Enter your username.' };
		const limiter = await ctx.db
			.query('authAttempts')
			.withIndex('by_key', (q) => q.eq('key', `staff:${usernameNorm}`))
			.unique();
		if (isBlocked(ctx, limiter)) {
			return {
				ok: false as const,
				message: 'Too many wrong attempts. Please wait 15 minutes and try again.'
			};
		}

		const staff = await ctx.db
			.query('staff')
			.withIndex('by_username', (q) => q.eq('usernameNorm', usernameNorm))
			.unique();
		// Same message for unknown user and wrong password, so the form does not
		// confirm which usernames exist.
		const refuse = async () => {
			await noteFailure(ctx, `staff:${usernameNorm}`);
			return { ok: false as const, message: 'Wrong username or password.' };
		};
		if (!staff || !staff.active) return await refuse();
		const ok = await verifySecret(staff as never, args.password);
		if (!ok) return await refuse();

		const token = randomHex(24);
		await ctx.db.insert('staffSessions', {
			staffId: staff._id,
			token,
			createdAt: Date.now(),
			expiresAt: Date.now() + SESSION_TTL_MS
		});
		await ctx.db.patch(staff._id, { lastLoginAt: Date.now() });
		await noteSuccess(ctx, `staff:${usernameNorm}`);
		return { ok: true as const, token, fullName: staff.fullName, username: staff.username };
	}
});

/** Who the current token belongs to, for either kind of identity. */
export const me = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await resolveActor(ctx, args.token);
		if (!actor) return null;
		if (actor.kind === 'staff') {
			return {
				kind: 'staff' as const,
				id: String(actor.id),
				role: 'lecturer' as const,
				fullName: actor.name,
				username: actor.username
			};
		}
		const doc = await ctx.db.get('people', actor.id);
		if (!doc) return null;
		const memberships = await ctx.db
			.query('classMembers')
			.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
			.take(50);
		const classNames: string[] = [];
		for (const m of memberships) {
			const cls = await ctx.db.get('classes', m.classId);
			if (cls) classNames.push(cls.name);
		}
		return {
			kind: 'person' as const,
			id: String(doc._id),
			role: doc.role,
			fullName: doc.fullName,
			regNumber: doc.regNumber,
			studentId: doc.studentId,
			email: doc.email ?? '',
			phone: doc.phone ?? '',
			classNames
		};
	}
});

export const changePassword = mutation({
	args: { token: v.string(), currentPassword: v.string(), newPassword: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		if (args.newPassword.length < 6) {
			throw new Error('Choose a password of at least 6 characters.');
		}
		if (args.newPassword === DEFAULT_STAFF_PASSWORD) {
			throw new Error('Please choose something other than the default password.');
		}
		const staff = await ctx.db.get('staff', actor.id);
		if (!staff) throw new Error('Account not found.');
		const ok = await verifySecret(staff as never, args.currentPassword);
		if (!ok) throw new Error('Your current password is not right.');

		const salt = randomSalt();
		const passwordHash = await hashSecret(args.newPassword, salt);
		await ctx.db.patch(staff._id, { passwordHash, salt, scheme: SCHEME, iterations: ITERATIONS });
		return { ok: true };
	}
});

/** Add another lecturer, for institutions with more than one. */
export const createStaff = mutation({
	args: { token: v.string(), username: v.string(), password: v.string(), fullName: v.string() },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const usernameNorm = normalizeUsername(args.username);
		if (!usernameNorm) throw new Error('Enter a username.');
		if (args.password.length < 6) throw new Error('Choose a password of at least 6 characters.');
		const name = args.fullName.trim();
		if (name.length < 2) throw new Error("Enter the lecturer's name.");
		const clash = await ctx.db
			.query('staff')
			.withIndex('by_username', (q) => q.eq('usernameNorm', usernameNorm))
			.unique();
		if (clash) throw new Error('That username is already taken.');

		const salt = randomSalt();
		const passwordHash = await hashSecret(args.password, salt);
		return await ctx.db.insert('staff', {
			username: args.username.trim(),
			usernameNorm,
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			fullName: name,
			active: true,
			createdAt: Date.now()
		});
	}
});

export const listStaff = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const rows = await ctx.db.query('staff').order('asc').take(200);
		return rows.map((s: any) => ({
			_id: s._id,
			username: s.username,
			fullName: s.fullName,
			active: s.active,
			lastLoginAt: s.lastLoginAt ?? null,
			isDefault: s.usernameNorm === normalizeUsername(DEFAULT_STAFF_USERNAME)
		}));
	}
});

export const setActive = mutation({
	args: { token: v.string(), staffId: v.id('staff'), active: v.boolean() },
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		if (actor.id === args.staffId) {
			throw new Error('You cannot switch off the account you are signed in with.');
		}
		const staff = await ctx.db.get('staff', args.staffId);
		if (!staff) throw new Error('Account not found.');
		if (!args.active) {
			const sessions = await ctx.db
				.query('staffSessions')
				.withIndex('by_staff', (q) => q.eq('staffId', args.staffId))
				.take(20);
			for (const s of sessions) await ctx.db.delete('staffSessions', s._id);
		}
		await ctx.db.patch(args.staffId, { active: args.active });
		return { ok: true };
	}
});

/** Clears this lecturer's own sessions everywhere. */
export const signOutEverywhere = mutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		const sessions = await ctx.db
			.query('staffSessions')
			.withIndex('by_staff', (q) => q.eq('staffId', actor.id))
			.take(50);
		for (const s of sessions) await ctx.db.delete('staffSessions', s._id);
		return { ok: true };
	}
});