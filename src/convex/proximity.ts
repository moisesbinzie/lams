// Location judgement.
//
// Two things are measured at a scan: where the **rep's** phone is, and — once
// the student's own phone responds — where the **student's** phone is. Neither
// is a guarantee of presence, and this module is explicit about that.
//
// The important rule here: a GPS reading that is less precise than the radius
// cannot distinguish inside from outside, so it must not produce a confident
// verdict. It is recorded and flagged instead.

export type Proximity = {
	distanceM: number | null;
	/** True when the reading was too coarse to support a verdict. */
	weak: boolean;
	inside: boolean | null;
};

/**
 * Judges a single coordinate pair against the lecture location.
 *
 * `accuracyM` is the device's own reported uncertainty. When that is larger than
 * the radius, a point 40 m outside and one 40 m inside are indistinguishable,
 * so `inside` stays null rather than guessing.
 */
export function judgeProximity(
	lectureLat: number,
	lectureLng: number,
	lat: number | undefined,
	lng: number | undefined,
	accuracyM: number | undefined,
	radiusM: number
): Proximity {
	if (lat === undefined || lng === undefined) {
		return { distanceM: null, weak: false, inside: null };
	}
	const distanceM = Math.round(haversineM(lectureLat, lectureLng, lat, lng));
	if (accuracyM !== undefined && accuracyM > radiusM) {
		return { distanceM, weak: true, inside: null };
	}
	return { distanceM, weak: false, inside: distanceM <= radiusM };
}

/**
 * Judges the **station** against its own pinned room, as opposed to a student
 * against the station.
 *
 * This is a different question from `judgeProximity`, and it is answered
 * differently on purpose:
 *
 *   - A student's reading that cannot be decided is recorded and flagged. That
 *     is the safe direction — it never silently loses a present student.
 *   - Here the reading *gates* the whole session. Refusing every scan because a
 *     phone could not get a fix would empty a real lecture hall, so the burden
 *     of proof is on the accusation: only a reading whose entire error circle
 *     lies beyond the room counts as "the station moved".
 *
 * Silence is never evidence. A station that reports nothing, or reports a fix
 * too coarse to decide, keeps working and is surfaced as unverified instead.
 */
export function judgeStationPlacement(
	stationLat: number,
	stationLng: number,
	lat: number | undefined,
	lng: number | undefined,
	accuracyM: number | undefined,
	toleranceM: number
): Proximity {
	if (lat === undefined || lng === undefined) {
		return { distanceM: null, weak: false, inside: null };
	}
	const distanceM = Math.round(haversineM(stationLat, stationLng, lat, lng));
	// Wholly inside the room, including its whole error circle: in, and no doubt
	// about it. This is what clears a previous "moved" flag.
	if (distanceM <= toleranceM) {
		return { distanceM, weak: false, inside: true };
	}
	// Beyond the radius. If the reported accuracy still reaches back inside it,
	// the two circles overlap and the reading cannot place the station at all.
	const slack = accuracyM ?? 0;
	if (distanceM - slack > toleranceM) {
		return { distanceM, weak: false, inside: false };
	}
	// Overlapping circles: recorded and warned about, but not a verdict.
	return { distanceM, weak: true, inside: null };
}

/**
 * A student's own location is judged more strictly than the rep's: they are the
 * one whose attendance is in question, so a coarse fix is treated as suspicious
 * rather than accepted.
 */
export const STUDENT_ACCURACY_TOLERANCE = 2;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	return 2 * R * Math.asin(Math.sqrt(a));
}