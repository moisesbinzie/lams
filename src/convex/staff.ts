import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	DEFAULT_STAFF_NAME,
	DEFAULT_STAFF_PASSWORD,
	DEFAULT_STAFF_USERNAME,
	ITERATIONS,
	SCHEME,
	SESSION_TTL_MS,
	generateTempPassword,
	hashSecret,
	isAdminStaff,
	lecturerOfferings,
	logAudit,
	normalizeUsername,
	offeringLecturers,
	randomSalt,
	requireAdmin,
	requireStaff,
	resolveActor,
	staffRoleOf,
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
 * Creates the default `admin` account if none exists, and backfills the `role`
 * column on deployments created before roles existed. Safe to call repeatedly;
 * it never overwrites an existing password.
 *
 * Migration rule: the default username becomes the admin, everyone else
 * becomes a lecturer.
 */
export const ensureSeed = mutation({
	args: {},
	handler: async (ctx) => {
		let migrated = 0;
		const all = await ctx.db.query('staff').take(200);
		for (const s of all as any[]) {
			if (s.role === 'admin' || s.role === 'lecturer') continue;
			const role =
				s.usernameNorm === normalizeUsername(DEFAULT_STAFF_USERNAME) ? ('admin' as const) : ('lecturer' as const);
			await ctx.db.patch(s._id, { role });
			migrated += 1;
		}
		if (all.length > 0) return { seeded: false, migrated };
		const salt = randomSalt();
		const passwordHash = await hashSecret(DEFAULT_STAFF_PASSWORD, salt);
		await ctx.db.insert('staff', {
			username: DEFAULT_STAFF_USERNAME,
			usernameNorm: normalizeUsername(DEFAULT_STAFF_USERNAME),
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			fullName: 'Administrator',
			role: 'admin' as const,
			active: true,
			createdAt: Date.now()
		});
		return { seeded: true, migrated };
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
		return {
			ok: true as const,
			token,
			fullName: staff.fullName,
			username: staff.username,
			role: staffRoleOf(staff),
			isAdmin: isAdminStaff(staff),
			mustChangePassword: staff.mustChangePassword === true
		};
	}
});

/** Who the current token belongs to, for either kind of identity. */
export const me = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await resolveActor(ctx, args.token);
		if (!actor) return null;
		if (actor.kind === 'staff') {
			const doc = await ctx.db.get('staff', actor.id);
			return {
				kind: 'staff' as const,
				id: String(actor.id),
				role: actor.staffRole,
				staffRole: actor.staffRole,
				isAdmin: actor.isAdmin,
				fullName: actor.name,
				username: actor.username,
				mustChangePassword: (doc as any)?.mustChangePassword === true
			};
		}
		const doc = await ctx.db.get('people', actor.id);
		if (!doc) return null;
		const memberships = await ctx.db
			.query('programMembers')
			.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
			.take(50);
		const programNames: string[] = [];
		for (const m of memberships) {
			const program = await ctx.db.get('programs', m.programId);
			if (program) programNames.push(program.name);
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
			programNames
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
		await ctx.db.patch(staff._id, {
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			// The owner just chose this themselves — the flag is spent.
			mustChangePassword: undefined
		});
		return { ok: true };
	}
});

/**
 * Legacy manual creation (username + chosen password). Kept for compatibility;
 * admin-only. New lecturers should use `createLecturer`, which generates the
 * initial password so the admin never invents a weak one.
 */
export const createStaff = mutation({
	args: { token: v.string(), username: v.string(), password: v.string(), fullName: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireAdmin(ctx, args.token);
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
		const id = await ctx.db.insert('staff', {
			username: args.username.trim(),
			usernameNorm,
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			fullName: name,
			role: 'lecturer' as const,
			// The password was someone else's choice — the owner must pick
			// their own before this flag clears.
			mustChangePassword: true,
			active: true,
			createdAt: Date.now()
		});
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: 'staff.create-manual',
			targetKind: 'staff',
			targetId: id,
			targetName: args.username.trim()
		});
		return id;
	}
});

/** Shared account creation: validates, hashes a generated password, inserts. */
async function createStaffAccount(
	ctx: any,
	username: string,
	fullName: string,
	role: 'admin' | 'lecturer'
): Promise<{ id: unknown; username: string; tempPassword: string }> {
	const usernameNorm = normalizeUsername(username);
	if (!usernameNorm) throw new Error('Enter a username.');
	if (!/^[a-z0-9._-]{3,32}$/.test(usernameNorm)) {
		throw new Error('Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.');
	}
	const name = fullName.trim();
	if (name.length < 2) throw new Error("Enter the person's name.");
	const clash = await ctx.db
		.query('staff')
		.withIndex('by_username', (q: any) => q.eq('usernameNorm', usernameNorm))
		.unique();
	if (clash) throw new Error('That username is already taken.');

	const tempPassword = generateTempPassword(10);
	const salt = randomSalt();
	const passwordHash = await hashSecret(tempPassword, salt);
	const id = await ctx.db.insert('staff', {
		username: username.trim(),
		usernameNorm,
		passwordHash,
		salt,
		scheme: SCHEME,
		iterations: ITERATIONS,
		fullName: name,
		role,
		mustChangePassword: true,
		active: true,
		createdAt: Date.now()
	});
	return { id, username: username.trim(), tempPassword };
}

/**
 * Admin creates a lecturer. The initial password is generated server-side and
 * returned once — the admin reads it out to the lecturer, who must change it
 * in Settings before doing anything else. Lecturers always sign in with
 * username + password.
 */
export const createLecturer = mutation({
	args: { token: v.string(), username: v.string(), fullName: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireAdmin(ctx, args.token);
		const created = await createStaffAccount(ctx, args.username, args.fullName, 'lecturer');
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: 'staff.create-lecturer',
			targetKind: 'staff',
			targetId: created.id,
			targetName: created.username
		});
		return created;
	}
});

/**
 * Admin creates another admin. Same generated-password flow as lecturers.
 * Keep at least two active admins so one lost password never locks everyone
 * out (see the break-glass procedure in SECURITY.md).
 */
export const createAdmin = mutation({
	args: { token: v.string(), username: v.string(), fullName: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireAdmin(ctx, args.token);
		const created = await createStaffAccount(ctx, args.username, args.fullName, 'admin');
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: 'staff.create-admin',
			targetKind: 'staff',
			targetId: created.id,
			targetName: created.username
		});
		return created;
	}
});

/**
 * Admin resets a lecturer's password. Generates a fresh temporary password,
 * signs the lecturer out everywhere, and returns the password once.
 */
export const resetLecturerPassword = mutation({
	args: { token: v.string(), staffId: v.id('staff') },
	handler: async (ctx, args) => {
		const actor = await requireAdmin(ctx, args.token);
		if (actor.id === args.staffId) {
			throw new Error('Use “Change your password” for your own account instead.');
		}
		const staff = await ctx.db.get('staff', args.staffId);
		if (!staff) throw new Error('Account not found.');
		if (isAdminStaff(staff)) {
			throw new Error('Admin passwords cannot be reset this way.');
		}
		const tempPassword = generateTempPassword(10);
		const salt = randomSalt();
		const passwordHash = await hashSecret(tempPassword, salt);
		const sessions = await ctx.db
			.query('staffSessions')
			.withIndex('by_staff', (q) => q.eq('staffId', args.staffId))
			.take(50);
		for (const s of sessions) await ctx.db.delete('staffSessions', s._id);
		await ctx.db.patch(args.staffId, {
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			mustChangePassword: true
		});
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: 'staff.reset-password',
			targetKind: 'staff',
			targetId: args.staffId,
			targetName: staff.username
		});
		return { ok: true as const, tempPassword };
	}
});

export const listStaff = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const rows = await ctx.db.query('staff').order('asc').take(200);
		const offerings = await ctx.db.query('offerings').take(500);
		const countByLecturer = new Map<string, number>();
		for (const o of offerings as any[]) {
			if (!o.lecturerId) continue;
			const key = String(o.lecturerId);
			countByLecturer.set(key, (countByLecturer.get(key) ?? 0) + 1);
		}
		return rows.map((s: any) => ({
			_id: s._id,
			username: s.username,
			fullName: s.fullName,
			role: staffRoleOf(s),
			isAdmin: isAdminStaff(s),
			active: s.active,
			lastLoginAt: s.lastLoginAt ?? null,
			assignmentCount: countByLecturer.get(String(s._id)) ?? 0,
			isDefault: s.usernameNorm === normalizeUsername(DEFAULT_STAFF_USERNAME)
		}));
	}
});

/**
 * Per-lecturer activity for the admin dashboard, counted from attendance
 * sessions. Each session is attributed to the staff account that opened it
 * (`startedByStaffId`), falling back to the offering's current lecturer for
 * old or rep-started rows — so reassigning a course or renaming an account
 * never rewrites history. Capped at the 2000 most recent sessions, matching
 * the reporting queries.
 */
export const lecturerStats = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const staffRows = await ctx.db.query('staff').take(200);
		const offerings = (await ctx.db.query('offerings').take(500)) as any[];
		const offeringLecturer = new Map<string, string>();
		const assignments = new Map<string, number>();
		for (const o of offerings) {
			const holders = offeringLecturers(o);
			if (holders.length === 0) continue;
			offeringLecturer.set(String(o._id), holders[0]);
			for (const lid of holders) {
				assignments.set(lid, (assignments.get(lid) ?? 0) + 1);
			}
		}
		const now = Date.now();
		const sessions = (await ctx.db.query('sessions').order('desc').take(2000)) as any[];
		const stats = new Map<string, { total: number; open: number; closed: number; lastAt: number | null }>();
		for (const s of sessions) {
			// Attribute to whoever opened the lecture; fall back to whoever
			// holds the offering today for old or rep-started rows. History no
			// longer moves when an offering is reassigned or a name changes.
			const lid = s.startedByStaffId
				? String(s.startedByStaffId)
				: offeringLecturer.get(String(s.offeringId));
			if (!lid) continue;
			const cur = stats.get(lid) ?? { total: 0, open: 0, closed: 0, lastAt: null };
			cur.total += 1;
			// Effective status: an "open" row past its close time is already
			// finished — the cron just has not written it yet.
			if (s.status === 'open' && now < s.closesAt) cur.open += 1;
			else cur.closed += 1;
			if (cur.lastAt === null || s.startedAt > cur.lastAt) cur.lastAt = s.startedAt;
			stats.set(lid, cur);
		}
		return staffRows.map((s: any) => {
			const key = String(s._id);
			const cur = stats.get(key) ?? { total: 0, open: 0, closed: 0, lastAt: null };
			return {
				_id: s._id,
				assignmentCount: assignments.get(key) ?? 0,
				lecturesTotal: cur.total,
				lecturesOpen: cur.open,
				lecturesClosed: cur.closed,
				lastLectureAt: cur.lastAt
			};
		});
	}
});

/**
 * Admin renames an account or changes its username. Past records keep their
 * stamped name snapshots, while id-stamped links (`startedByStaffId`,
 * `recordedByStaffId`, offering assignments) keep history connected.
 */
export const updateStaff = mutation({
	args: {
		token: v.string(),
		staffId: v.id('staff'),
		username: v.optional(v.string()),
		fullName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx, args.token);
		const staff = await ctx.db.get('staff', args.staffId);
		if (!staff) throw new Error('Account not found.');
		const patch: Record<string, unknown> = {};
		if (args.username !== undefined) {
			const usernameNorm = normalizeUsername(args.username);
			if (!/^[a-z0-9._-]{3,32}$/.test(usernameNorm)) {
				throw new Error('Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.');
			}
			const clash = await ctx.db
				.query('staff')
				.withIndex('by_username', (q) => q.eq('usernameNorm', usernameNorm))
				.unique();
			if (clash && String(clash._id) !== String(args.staffId)) {
				throw new Error('That username is already taken.');
			}
			patch.username = args.username.trim();
			patch.usernameNorm = usernameNorm;
		}
		if (args.fullName !== undefined) {
			const name = args.fullName.trim();
			if (name.length < 2) throw new Error("Enter the person's name.");
			patch.fullName = name;
		}
		if (Object.keys(patch).length === 0) return { ok: true };
		await ctx.db.patch(args.staffId, patch);
		await logAudit(ctx, {
			actorName: admin.name,
			actorId: admin.id,
			action: 'staff.update',
			targetKind: 'staff',
			targetId: args.staffId,
			targetName: staff.username,
			detail: Object.keys(patch).join(', ')
		});
		return { ok: true };
	}
});

export const setActive = mutation({
	args: { token: v.string(), staffId: v.id('staff'), active: v.boolean() },
	handler: async (ctx, args) => {
		const actor = await requireAdmin(ctx, args.token);
		if (actor.id === args.staffId) {
			throw new Error('You cannot switch off the account you are signed in with.');
		}
		const staff = await ctx.db.get('staff', args.staffId);
		if (!staff) throw new Error('Account not found.');
		if (!args.active && isAdminStaff(staff)) {
			const all = await ctx.db.query('staff').take(200);
			const otherAdmins = (all as any[]).filter(
				(s) => s.active && isAdminStaff(s) && String(s._id) !== String(args.staffId)
			);
			if (otherAdmins.length === 0) {
				throw new Error('You cannot switch off the last admin account.');
			}
		}
		let released = 0;
		if (!args.active) {
			const sessions = await ctx.db
				.query('staffSessions')
				.withIndex('by_staff', (q) => q.eq('staffId', args.staffId))
				.take(20);
			for (const s of sessions) await ctx.db.delete('staffSessions', s._id);
			// Release their offerings back to unassigned so courses do not
			// silently become unstartable — history stays attributed via
			// `startedByStaffId`, and the admin reassigns from the console.
			// A released lecturer is dropped from shared offerings but
			// co-lecturers keep them.
			const held = await lecturerOfferings(ctx, args.staffId);
			for (const o of held as any[]) {
				const remaining = offeringLecturers(o).filter((id) => id !== String(args.staffId));
				await ctx.db.patch(o._id, {
					lecturerIds: remaining.length > 0 ? (remaining as never[]) : undefined,
					lecturerId: (remaining[0] ?? undefined) as never
				});
				released += 1;
			}
		}
		await ctx.db.patch(args.staffId, { active: args.active });
		await logAudit(ctx, {
			actorName: actor.name,
			actorId: actor.id,
			action: args.active ? 'staff.set-active' : 'staff.set-inactive',
			targetKind: 'staff',
			targetId: args.staffId,
			targetName: staff.username,
			...(released > 0 ? { detail: `${released} offering(s) released` } : {})
		});
		return { ok: true, released };
	}
});

/** Recent audit trail rows, newest first. Admins only. */
export const listAudit = query({
	args: { token: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const rows = await ctx.db
			.query('auditLog')
			.withIndex('by_created')
			.order('desc')
			.take(Math.min(Math.max(args.limit ?? 100, 1), 200));
		return rows.map((r: any) => ({
			_id: r._id,
			actorName: r.actorName,
			action: r.action,
			targetName: r.targetName ?? null,
			detail: r.detail ?? null,
			createdAt: r.createdAt
		}));
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