// Backend helpers tested outside src/convex on purpose: Convex bundles every
// file inside the functions directory, and `node:test` imports would break
// `convex dev`. Same module, same code — only the location differs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	computeAutoStatus,
	haversineM,
	normalizeId,
	normalizeReg,
	randomHex,
	sha256Hex
} from '../src/convex/helpers.ts';

describe('normalizeReg / normalizeId', () => {
	it('upper-cases, trims and collapses inner spaces', () => {
		assert.equal(normalizeReg('  bit/2024/0123 '), 'BIT/2024/0123');
		assert.equal(normalizeReg('bit/2024  /  0123'), 'BIT/2024 / 0123');
	});

	it('strips every space from student IDs', () => {
		assert.equal(normalizeId(' 2024 - 0123 '), '2024-0123');
	});
});

describe('haversineM', () => {
	it('is zero for identical points', () => {
		assert.equal(haversineM(-13.96, 33.77, -13.96, 33.77), 0);
	});

	it('matches the known 1-degree latitude distance (~111.19 km)', () => {
		const d = haversineM(0, 0, 1, 0);
		assert.ok(Math.abs(d - 111194.9) < 1, `got ${d}`);
	});
});

describe('randomHex / sha256Hex', () => {
	it('produces the requested number of hex characters', () => {
		assert.equal(randomHex(16).length, 32);
		assert.match(randomHex(8), /^[0-9a-f]+$/);
	});

	it('hashes deterministically (SHA-256 of "abc")', async () => {
		const out = await sha256Hex('abc');
		assert.equal(out, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
});

describe('computeAutoStatus', () => {
	const RADIUS = 50;
	// Lecturer defaults: on time for 5 minutes, late until 10 minutes.
	const ON_TIME = 300;
	const LATE_UNTIL = 600;

	it('marks in-range and on-time submissions Present', () => {
		assert.equal(computeAutoStatus(0, ON_TIME, LATE_UNTIL, 10, RADIUS), 'Present');
		assert.equal(computeAutoStatus(ON_TIME, ON_TIME, LATE_UNTIL, 10, RADIUS), 'Present');
	});

	it('marks anything beyond the radius Out of Range, even when early', () => {
		assert.equal(computeAutoStatus(1, ON_TIME, LATE_UNTIL, RADIUS + 1, RADIUS), 'Out_of_Range');
	});

	it('keeps Out of Range when the student is also late', () => {
		assert.equal(computeAutoStatus(ON_TIME + 60, ON_TIME, LATE_UNTIL, 500, RADIUS), 'Out_of_Range');
	});

	it('keeps Out of Range even after the late window closes', () => {
		assert.equal(computeAutoStatus(LATE_UNTIL + 120, ON_TIME, LATE_UNTIL, 500, RADIUS), 'Out_of_Range');
	});

	it('treats a missing GPS fix as in range', () => {
		assert.equal(computeAutoStatus(60, ON_TIME, LATE_UNTIL, null, RADIUS), 'Present');
	});

	it('marks a student Late between the two thresholds', () => {
		assert.equal(computeAutoStatus(ON_TIME + 1, ON_TIME, LATE_UNTIL, 10, RADIUS), 'Late');
		assert.equal(computeAutoStatus(400, ON_TIME, LATE_UNTIL, 10, RADIUS), 'Late');
	});

	it('marks a student Late right up to the late threshold', () => {
		assert.equal(computeAutoStatus(LATE_UNTIL, ON_TIME, LATE_UNTIL, 10, RADIUS), 'Late');
	});

	it('marks a student Absent after the late threshold', () => {
		assert.equal(computeAutoStatus(LATE_UNTIL + 1, ON_TIME, LATE_UNTIL, 10, RADIUS), 'Absent');
		assert.equal(computeAutoStatus(3600, ON_TIME, LATE_UNTIL, 10, RADIUS), 'Absent');
	});

	it('honours adjusted thresholds', () => {
		// A lecturer widening the windows to 15 / 30 minutes.
		assert.equal(computeAutoStatus(700, 900, 1800, 10, RADIUS), 'Present');
		assert.equal(computeAutoStatus(1000, 900, 1800, 10, RADIUS), 'Late');
		assert.equal(computeAutoStatus(1900, 900, 1800, 10, RADIUS), 'Absent');
	});

	it('honours tightened thresholds', () => {
		// A lecturer narrowing to 2 / 4 minutes.
		assert.equal(computeAutoStatus(100, 120, 240, 10, RADIUS), 'Present');
		assert.equal(computeAutoStatus(200, 120, 240, 10, RADIUS), 'Late');
		assert.equal(computeAutoStatus(300, 120, 240, 10, RADIUS), 'Absent');
	});
});
