// Where the station screen actually is.
//
// Until now a session's pinned coordinates were only ever used to judge
// *students* — the distance between a phone and the screen. Nothing checked
// where the screen itself was, so a station that had been picked up and carried
// out of the hall kept issuing perfectly valid codes to whoever stood in front
// of it, and the "you must be in the room" promise was really "you must be near
// wherever the rep typed a number".
//
// The fix is the same distance check applied one level up. The screen reports
// where it is, the server compares that against the room it was pinned to, and
// while it is demonstrably elsewhere every scan is refused outright. The gate is
// server-side on purpose: hiding the QR in the browser would still leave the
// rolling code readable to anyone photographing the screen.
//
// What this cannot do is survive a spoofed fix on the station's own device. A
// rep with a mock-location app can hold the flag down. That is the same limit as
// every other browser-delivered location in this project — a deterrent plus a
// legible audit trail, never a proof.

import { mutation, query } from './_generated/server';
import { canRecordFor, recorderFields, requireRecorder } from './auth';
import { toleranceFor } from './helpers';
import { judgeStationPlacement } from './proximity';
import { v } from 'convex/values';

/**
 * The station screen reports where it currently is.
 *
 * Called on a timer by `/scan` while a lecture is open. Failing to report — no
 * permission, no signal, a browser without geolocation — is deliberately not an
 * error: the screen keeps working and simply reports nothing, because a rep who
 * cannot share location is a rep whose students must still be marked present.
 */
export const reportStationPosition = mutation({
	args: {
		token: v.string(),
		sessionId: v.id('sessions'),
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		accuracyM: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) throw new Error('This lecture could not be found.');
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		if (session.status !== 'open') return { ok: false as const, reason: 'closed' as const };

		const toleranceM = toleranceFor(session);
		const now = Date.now();
		const placement = judgeStationPlacement(
			session.stationLat,
			session.stationLng,
			args.latitude,
			args.longitude,
			args.accuracyM,
			toleranceM
		);

		// `inside === false` is the only reading that blocks. A `weak` reading is
		// recorded as "could not check" without stopping anyone, and a missing fix
		// is recorded as no idea at all rather than as a pass.
		const moved = placement.inside === false;
		const unverified = placement.distanceM === null || placement.weak;

		await ctx.db.patch(session._id, {
			...(args.latitude !== undefined ? { stationSeenLat: args.latitude } : {}),
			...(args.longitude !== undefined ? { stationSeenLng: args.longitude } : {}),
			...(args.accuracyM !== undefined ? { stationSeenAccuracyM: args.accuracyM } : {}),
			stationSeenAt: now,
			...(placement.distanceM !== null ? { stationSeenDistanceM: placement.distanceM } : {}),
			stationUnverified: unverified,
			// The flag is only ever cleared by a reading that positively places the
			// station back inside its room. A weak reading clears nothing.
			...(moved
				? { stationMoved: true, stationMovedAt: now }
				: placement.inside === true
					? { stationMoved: undefined, stationMovedAt: undefined }
					: {})
		});

		return { ok: true as const, moved, unverified, distanceM: placement.distanceM, toleranceM };
	}
});
/**
 * Move the station's pinned room, with a reason.
 *
 * The escape hatch for the legitimate case: the lecture genuinely moved rooms,
 * or the rep pinned the wrong coordinates when they opened it. Without this a
 * mistaken pin would be unrecoverable until the session closed, and reps would
 * learn to switch the check off rather than work with it.
 *
 * Any recorder may do this to their own class's lecture, which is exactly why
 * the reason is mandatory and the re-pin is stored against the session instead
 * of quietly overwriting where the station had been.
 */
export const pinStation = mutation({
	args: {
		token: v.string(),
		sessionId: v.id('sessions'),
		latitude: v.number(),
		longitude: v.number(),
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) throw new Error('This lecture could not be found.');
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		if (args.latitude < -90 || args.latitude > 90) throw new Error('Invalid latitude.');
		if (args.longitude < -180 || args.longitude > 180) throw new Error('Invalid longitude.');
		const reason = args.reason.trim();
		if (reason.length < 3) {
			throw new Error('Say why the station is being moved — it is kept on the record.');
		}

		const now = Date.now();
		await ctx.db.patch(session._id, {
			stationLat: args.latitude,
			stationLng: args.longitude,
			// Clear the moved flag: the point of the re-pin is that the station is
			// now legitimately somewhere else.
			stationMoved: undefined,
			stationMovedAt: undefined,
			stationUnverified: false,
			stationSeenLat: args.latitude,
			stationSeenLng: args.longitude,
			stationSeenDistanceM: 0,
			stationSeenAt: now,
			stationRepinnedBy: recorderFields(actor).recordedBy,
			stationRepinnedAt: now,
			stationRepinReason: reason
		});
		return { ok: true as const, pinnedAt: now };
	}
});

/**
 * What the station screen needs to draw its own placement banner, and — when it
 * has genuinely moved — to offer the re-pin.
 *
 * Guarded like the rest of the station tooling: a student must not be able to
 * read the room's coordinates or nudge the pin.
 */
export const stationPlacement = query({
	args: { token: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) return null;
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		return {
			stationLat: session.stationLat,
			stationLng: session.stationLng,
			toleranceM: toleranceFor(session),
			seenDistanceM: session.stationSeenDistanceM ?? null,
			seenAt: session.stationSeenAt ?? null,
			accuracyM: session.stationSeenAccuracyM ?? null,
			moved: session.stationMoved === true,
			movedAt: session.stationMovedAt ?? null,
			unverified: session.stationUnverified === true,
			repinnedBy: session.stationRepinnedBy ?? null,
			repinnedAt: session.stationRepinnedAt ?? null,
			repInReason: session.stationRepinReason ?? null
		};
	}
});