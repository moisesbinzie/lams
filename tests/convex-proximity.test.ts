// Backend proximity logic tested outside src/convex on purpose: Convex bundles
// every file inside the functions directory, and a `node:test` import there
// would break `convex dev`. Same module, same code — only the location differs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	judgeProximity,
	judgeStationPlacement,
	describeContradiction,
	haversineM,
	STUDENT_ACCURACY_TOLERANCE
} from '../src/convex/proximity.ts';

// A lecture somewhere recognisable.
const LAT = -13.9626;
const LNG = 33.7741;
const RADIUS = 50;

describe('haversineM', () => {
	it('is zero for the same point', () => {
		assert.equal(Math.round(haversineM(LAT, LNG, LAT, LNG)), 0);
	});

	it('matches the known 1-degree distance', () => {
		const km = haversineM(0, 0, 1, 0) / 1000;
		assert.ok(Math.abs(km - 111.19) < 0.1, `expected ~111.19 km, got ${km}`);
	});
});

describe('judgeProximity', () => {
	it('reports no distance when the device gave no fix', () => {
		const result = judgeProximity(LAT, LNG, undefined, undefined, undefined, RADIUS);
		assert.equal(result.distanceM, null);
		assert.equal(result.inside, null);
		assert.equal(result.weak, false);
	});

	it('puts a point at the lecture inside the radius', () => {
		const result = judgeProximity(LAT, LNG, LAT, LNG, 5, RADIUS);
		assert.equal(result.distanceM, 0);
		assert.equal(result.inside, true);
		assert.equal(result.weak, false);
	});

	it('puts a nearby point inside and a distant point outside', () => {
		// ~11 m north.
		assert.equal(judgeProximity(LAT, LNG, LAT + 0.0001, LNG, 5, RADIUS).inside, true);
		// ~1.1 km north.
		assert.equal(judgeProximity(LAT, LNG, LAT + 0.01, LNG, 5, RADIUS).inside, false);
	});

	it('respects a widened radius', () => {
		// ~111 m away: out at 50 m, in at 500 m.
		assert.equal(judgeProximity(LAT, LNG, LAT + 0.001, LNG, 5, 50).inside, false);
		assert.equal(judgeProximity(LAT, LNG, LAT + 0.001, LNG, 5, 500).inside, true);
	});

	it('refuses to judge a fix coarser than the radius', () => {
		const result = judgeProximity(LAT, LNG, LAT, LNG, 400, RADIUS);
		assert.equal(result.weak, true);
		assert.equal(result.inside, null, 'a ±400 m fix cannot separate inside from outside at 50 m');
		// The distance is still recorded, for the lecturer to judge.
		assert.equal(result.distanceM, 0);
	});

	it('still judges a fix at exactly the radius, since it is not coarser', () => {
		const result = judgeProximity(LAT, LNG, LAT, LNG, RADIUS, RADIUS);
		assert.equal(result.weak, false);
		assert.equal(result.inside, true);
	});
});

describe('describeContradiction', () => {
	it('says nothing when the student is plausibly present', () => {
		assert.equal(describeContradiction(10, 12, RADIUS, false), null);
	});

	it('flags a student phone far from the hall', () => {
		const note = describeContradiction(10, 900, RADIUS, false);
		assert.ok(note && note.includes('900'));
	});

	it('flags a student fix too coarse to check', () => {
		const note = describeContradiction(10, 20, RADIUS, true);
		assert.ok(note && note.includes('imprecise'));
	});

	it('flags a missing rep location', () => {
		const note = describeContradiction(null, 10, RADIUS, false);
		assert.ok(note && note.includes('could not be confirmed'));
	});

	it('tolerates a modest overshoot before complaining', () => {
		// Just over the radius but under twice it — walking to the back row.
		assert.equal(describeContradiction(10, RADIUS * 1.5, RADIUS, false), null);
	});
});

describe('student accuracy tolerance', () => {
	it('is a deliberate multiple of the radius', () => {
		assert.equal(STUDENT_ACCURACY_TOLERANCE, 2);
	});
});

// The station's own room check. Tolerance is far tighter than the student
// radius on purpose, so TOL below is the station's own and RADIUS stays the
// students'.
const TOL = 15;

describe('judgeStationPlacement', () => {
	it('reports no idea when the station reported nothing', () => {
		const result = judgeStationPlacement(LAT, LNG, undefined, undefined, undefined, TOL);
		assert.equal(result.distanceM, null);
		assert.equal(result.inside, null);
		// Never `false`: silence must not be able to block a lecture hall.
		assert.notEqual(result.inside, false);
	});

	it('keeps a station standing on its pinned spot', () => {
		const result = judgeStationPlacement(LAT, LNG, LAT, LNG, 5, TOL);
		assert.equal(result.distanceM, 0);
		assert.equal(result.inside, true);
		assert.equal(result.weak, false);
	});

	it('blocks a station carried a street away', () => {
		// ~1.1 km north, precise fix: unambiguously not this room.
		const result = judgeStationPlacement(LAT, LNG, LAT + 0.01, LNG, 5, TOL);
		assert.equal(result.inside, false);
		assert.equal(result.weak, false);
		assert.ok(result.distanceM! > 1000);
	});

	it('blocks even a coarse fix when the whole error circle is outside', () => {
		// ~1.1 km away with a ±400 m error circle: still far outside a 15 m room.
		const result = judgeStationPlacement(LAT, LNG, LAT + 0.01, LNG, 400, TOL);
		assert.equal(result.inside, false);
		assert.equal(result.weak, false);
	});

	it('does not block on a fix whose error circle still reaches the room', () => {
		// ~55 m north but ±200 m: the two circles overlap, so this is not
		// evidence of anything and must not stop a real lecture. The distance is
		// still recorded, so a lecturer can see what was reported.
		const result = judgeStationPlacement(LAT, LNG, LAT + 0.0005, LNG, 200, TOL);
		assert.ok(result.distanceM! > 50 && result.distanceM! < 60, `got ${result.distanceM}`);
		assert.equal(result.inside, null);
		assert.equal(result.weak, true);
	});

	it('treats a missing accuracy as a precise fix rather than an excuse to pass', () => {
		const far = judgeStationPlacement(LAT, LNG, LAT + 0.01, LNG, undefined, TOL);
		assert.equal(far.inside, false);
		const near = judgeStationPlacement(LAT, LNG, LAT + 0.0005, LNG, undefined, TOL);
		assert.equal(near.inside, false, 'no accuracy reported is still a reading, so judge it as given');
	});

	it('allows a station at exactly the tolerance and refuses one past it', () => {
		const dLat = TOL / 111194.9; // ~TOL metres north, converted to degrees.
		assert.equal(judgeStationPlacement(LAT, LNG, LAT + dLat, LNG, 1, TOL).inside, true);
		assert.equal(judgeStationPlacement(LAT, LNG, LAT + dLat * 2, LNG, 1, TOL).inside, false);
	});

	it('is much tighter than the student radius for the same session', () => {
		// ~110 m from the pinned spot. A student that far out is already outside
		// the 50 m student radius, but the point here is that the *station* is
		// out of a 15 m room by seven times over — the two tolerances are
		// independent, which is what stops one widening the other.
		const result = judgeStationPlacement(LAT, LNG, LAT + 0.001, LNG, 5, TOL);
		assert.equal(result.inside, false);
		assert.ok(judgeProximity(LAT, LNG, LAT + 0.001, LNG, 5, RADIUS).inside === false);
	});
});