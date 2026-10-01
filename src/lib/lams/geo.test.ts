import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatDistance, getCurrentPosition } from './geo.ts';

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
