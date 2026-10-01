import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatTime, isPast, elapsedPct } from './time.ts';

describe('formatTime / formatDateTime / formatDate', () => {
	const ts = Date.UTC(2026, 0, 5, 14, 7, 0);

	it('produces a locale time for a timestamp', () => {
		const out = formatTime(ts);
		assert.ok(/[:.]/.test(out), `expected a time, got "${out}"`);
	});

	it('produces a date-time and a date-only string', () => {
		assert.ok(formatDateTime(ts).length > formatTime(ts).length);
		assert.equal(formatDate(ts).length > 0, true);
	});

	it('throws away sub-second precision differences between identical seconds', () => {
		assert.equal(formatTime(ts), formatTime(ts + 400));
	});
});

describe('elapsedPct', () => {
	it('is 0 at open, 50 at half and 100 once the window is gone', () => {
		assert.equal(elapsedPct(0, 100, 0), 0);
		assert.equal(elapsedPct(0, 100, 50), 50);
		assert.equal(elapsedPct(0, 100, 150), 100);
	});

	it('never returns a negative percentage for a clock that jumped back', () => {
		assert.equal(elapsedPct(50, 100, -10), 0);
	});

	it('treats a zero-length window as fully elapsed', () => {
		assert.equal(elapsedPct(50, 50, 50), 100);
	});
});

describe('isPast', () => {
	it('flips exactly at the deadline', () => {
		assert.equal(isPast(100, 99), false);
		assert.equal(isPast(100, 100), true);
		assert.equal(isPast(100, 101), true);
	});
});
