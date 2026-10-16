import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatDistance, getBestPosition, getCurrentPosition, haversineM } from './geo.ts';

describe('formatDistance', () => {
	it('renders metres below a kilometre and kilometres above', () => {
		assert.equal(formatDistance(12), '12 m');
		assert.equal(formatDistance(999.4), '999 m');
		assert.equal(formatDistance(1500), '1.50 km');
	});

	it('renders an em dash when there is no fix', () => {
		assert.equal(formatDistance(null), '—');
		assert.equal(formatDistance(undefined), '—');
	});
});

describe('formatCountdown', () => {
	it('counts down in m:ss', () => {
		assert.equal(formatCountdown(90_000), '1:30');
		assert.equal(formatCountdown(600_000), '10:00');
		assert.equal(formatCountdown(1_000), '0:01');
	});

	it('reports Expired at or below zero', () => {
		assert.equal(formatCountdown(0), 'Expired');
		assert.equal(formatCountdown(-5_000), 'Expired');
	});
});

describe('getCurrentPosition', () => {
	it('rejects when the browser exposes no geolocation API', async () => {
		await assert.rejects(() => getCurrentPosition(50));
	});
});

describe('getBestPosition', () => {
	it('rejects when the browser exposes no geolocation API', async () => {
		await assert.rejects(() => getBestPosition({ budgetMs: 50 }));
	});
});

describe('haversineM', () => {
	it('is zero for identical points', () => {
		assert.equal(haversineM(-13.9626, 33.7741, -13.9626, 33.7741), 0);
	});

	it('matches the known 1-degree latitude distance (~111.19 km)', () => {
		const d = haversineM(0, 0, 1, 0);
		assert.ok(Math.abs(d - 111194.9) < 1, `got ${d}`);
	});

	it('measures a few metres within a hall', () => {
		const d = haversineM(-13.9626, 33.7741, -13.96265, 33.77415);
		assert.ok(d > 1 && d < 20, `got ${d}`);
	});
});
