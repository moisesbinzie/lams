// Backend proximity logic tested outside src/convex on purpose: Convex bundles
// every file inside the functions directory, and a `node:test` import there
// would break `convex dev`. Same module, same code — only the location differs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	judgeProximity,
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