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
 * A student's own location is judged more strictly than the rep's: they are the
 * one whose attendance is in question, so a coarse fix is treated as suspicious
 * rather than accepted.
 */
export const STUDENT_ACCURACY_TOLERANCE = 2;

/**
 * Explains a contradiction between the two devices so the lecturer sees a
 * reason, not just a red row.
 */
export function describeContradiction(
	scannerDistanceM: number | null,
	studentDistanceM: number | null,
	radiusM: number,
	studentWeak: boolean
): string | null {
	if (studentWeak) {
		return 'The student’s phone location was too imprecise to check — treat this record with care.';
	}
	if (studentDistanceM !== null && studentDistanceM > radiusM * 2) {
		return `The student’s own phone was ${studentDistanceM} m from the lecture hall (allowed: ${radiusM} m).`;
	}
	if (scannerDistanceM === null) {
		return 'The rep’s phone location could not be confirmed.';
	}
	return null;
}

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