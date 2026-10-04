// One-shot data migrations.
//
// `npx convex dev` refuses to push a schema that existing documents fail to
// validate against, so making a field required is a three-step dance: widen the
// field to `v.optional(...)`, run the backfill here, then narrow it back. Every
// migration is internal-only and idempotent, so it can be left in place and
// re-run against any deployment that has not been backfilled yet.

import { internalMutation } from './_generated/server';
import { DEFAULT_STATION_RADIUS_M } from './helpers';
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