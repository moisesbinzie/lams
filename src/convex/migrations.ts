// One-shot data migrations.
//
// `npx convex dev` refuses to push a schema that existing documents fail to
// validate against, so making a field required is a three-step dance: widen the
// field to `v.optional(...)`, run the backfill here, then narrow it back. Every
// migration is internal-only and idempotent, so it can be left in place and
// re-run against any deployment that has not been backfilled yet.

import { internalMutation } from './_generated/server';
import { DEFAULT_STATION_RADIUS_M, DEFAULT_STATION_TOLERANCE_M } from './helpers';
import {
	DEFAULT_STAFF_USERNAME,
	ITERATIONS,
	SCHEME,
	hashSecret,
	normalizeUsername,
	randomSalt
} from './auth';
import { v } from 'convex/values';

/**
 * Sessions opened before the QR station existed carry no `stationLat`,
 * `stationLng` or `stationRadiusM`. Backfill them from the lecture position,
 * which is exactly what `startSession` does when the rep pins no separate
 * station.
 *
 * The radius is the station default rather than the session's `radiusM`: the
 * lecture radius is a teaching convenience a rep may widen, and inheriting it
 * would leave a migrated station far more permissive than any real one.
 *
 * Drive it page by page — call with `cursor: null`, then feed the returned
 * `cursor` back in until `isDone` comes back true. Skipping a page loses those
 * documents until the next run, so keep going until it is done.
 */
export const backfillSessionStations = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query('sessions')
			.paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const session of page.page) {
			const missing =
				session.stationLat === undefined ||
				session.stationLng === undefined ||
				session.stationRadiusM === undefined;
			if (!missing) continue;
			await ctx.db.patch(session._id, {
				stationLat: session.lectureLat,
				stationLng: session.lectureLng,
				stationRadiusM: DEFAULT_STATION_RADIUS_M
			});
			patched += 1;
		}
		return {
			scanned: page.page.length,
			patched,
			cursor: page.continueCursor,
			isDone: page.isDone
		};
	}
});

/**
 * Staff rows created before roles existed have no `role`. The default account
 * becomes the admin, everyone else becomes a lecturer. Idempotent.
 */
export const backfillStaffRoles = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db.query('staff').paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const s of page.page as any[]) {
			if (s.role === 'admin' || s.role === 'lecturer') continue;
			const role =
				s.usernameNorm === normalizeUsername(DEFAULT_STAFF_USERNAME) ? ('admin' as const) : ('lecturer' as const);
			await ctx.db.patch(s._id, { role });
			patched += 1;
		}
		return { scanned: page.page.length, patched, cursor: page.continueCursor, isDone: page.isDone };
	}
});

/**
 * Break-glass admin recovery. If every admin password is lost, run from a
 * shell with deployment credentials (never from app code — internal-only):
 *
 *   npx convex run migrations:resetStaffPassword '{"username":"admin","newPassword":"..."}'
 *
 * Signs the account out everywhere and forces a password change at next
 * sign-in. Prefer keeping two active admins so this is never needed.
 */
export const resetStaffPassword = internalMutation({
	args: { username: v.string(), newPassword: v.string() },
	handler: async (ctx, args) => {
		const usernameNorm = normalizeUsername(args.username);
		if (args.newPassword.length < 8) throw new Error('Choose a password of at least 8 characters.');
		const staff = await ctx.db
			.query('staff')
			.withIndex('by_username', (q) => q.eq('usernameNorm', usernameNorm))
			.unique();
		if (!staff) throw new Error('Account not found.');
		const sessions = await ctx.db
			.query('staffSessions')
			.withIndex('by_staff', (q) => q.eq('staffId', staff._id))
			.take(50);
		for (const s of sessions) await ctx.db.delete('staffSessions', s._id);
		const salt = randomSalt();
		const passwordHash = await hashSecret(args.newPassword, salt);
		await ctx.db.patch(staff._id, {
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			mustChangePassword: true,
			active: true
		});
		return { ok: true, username: staff.username };
	}
});

/**
 * Drops the retired `subjects.lecturerId` column. Nothing reads or writes it
 * any more (teaching is decided per offering); run to completion, then the
 * field can leave the schema. Idempotent.
 */
export const backfillSubjectsDropLecturer = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db.query('subjects').paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const s of page.page as any[]) {
			if (s.lecturerId === undefined) continue;
			await ctx.db.patch(s._id, { lecturerId: undefined });
			patched += 1;
		}
		return { scanned: page.page.length, patched, cursor: page.continueCursor, isDone: page.isDone };
	}
});

/**
 * Sessions opened before the station-placement check carry no
 * `stationToleranceM`, no last-seen position and no moved flag.
 *
 * All of those are optional and all of them degrade safely on their own — a
 * missing tolerance falls back to the student radius, and a missing moved flag
 * reads as "not moved" — so this backfill exists to make those sessions behave
 * like fresh ones rather than to fix anything broken.
 *
 * The tolerance comes from the station default and not from the session's
 * `radiusM`: as with the station fields above, inheriting a teaching radius
 * would leave a migrated session far more permissive than any new one.
 */
export const backfillStationPlacement = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query('sessions')
			.paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const session of page.page) {
			if (session.stationToleranceM !== undefined) continue;
			await ctx.db.patch(session._id, {
				stationToleranceM: DEFAULT_STATION_TOLERANCE_M,
				// Never block a session on a reading taken before this feature
				// existed: there is no evidence it ever moved.
				stationMoved: false,
				stationUnverified: false
			});
			patched += 1;
		}
		return {
			scanned: page.page.length,
			patched,
			cursor: page.continueCursor,
			isDone: page.isDone
		};
	}
});