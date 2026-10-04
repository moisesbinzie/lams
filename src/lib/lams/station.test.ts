import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	STATION_PERIOD_SEC,
	STATION_WINDOW,
	currentStationCode,
	pendingScanTarget,
	secondsRemaining,
	stationCodeForSlot,
	stationSlotAt,
	takePendingScan
} from './station.ts';
import {
	currentStationCode as serverCurrentStationCode,
	stationCodeForSlot as serverStationCodeForSlot,
	verifyStationCode
} from '../../convex/station.ts';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const T0 = 1_760_000_000_000;

describe('station code derivation', () => {
	it('is deterministic for a secret and slot', () => {
		assert.equal(stationCodeForSlot(SECRET, 100), stationCodeForSlot(SECRET, 100));
	});

	it('changes every slot', () => {
		const seen = new Set<string>();
		for (let slot = 0; slot < 200; slot += 1) seen.add(stationCodeForSlot(SECRET, slot));
		assert.equal(seen.size, 200, 'every slot in 200 produced a repeated code');
	});

	it('is six digits so it always fits the same QR payload', () => {
		for (let slot = 0; slot < 50; slot += 1) {
			assert.match(stationCodeForSlot(SECRET, slot), /^\d{6}$/);
		}
	});

	it('separates secrets', () => {
		assert.notEqual(stationCodeForSlot(SECRET, 7), stationCodeForSlot(`${SECRET}x`, 7));
	});

	it('does not leak slot-to-slot structure', () => {
		// A plain counter would make consecutive codes differ by exactly one. The
		// second mixing round exists to stop that being guessable from one code.
		const deltas = new Set<number>();
		for (let slot = 0; slot < 100; slot += 1) {
			const a = Number(stationCodeForSlot(SECRET, slot));
			const b = Number(stationCodeForSlot(SECRET, slot + 1));
			deltas.add(Math.abs(b - a));
		}
		assert.ok(deltas.size > 50, 'consecutive codes look like a simple counter');
	});
});

describe('display and server agree', () => {
	it('compute the same value for every slot', () => {
		for (let slot = 0; slot < 500; slot += 1) {
			assert.equal(
				stationCodeForSlot(SECRET, slot),
				serverStationCodeForSlot(SECRET, slot),
				`display and server disagree at slot ${slot}`
			);
		}
	});

	it('compute the same current code', () => {
		assert.equal(currentStationCode(SECRET, T0), serverCurrentStationCode(SECRET, T0));
	});

	it('read the same slot from the same clock', () => {
		assert.equal(stationSlotAt(T0), Math.floor(T0 / 1000 / STATION_PERIOD_SEC));
	});
});

describe('verification window', () => {
	it('accepts the code currently on screen', () => {
		assert.equal(verifyStationCode(currentStationCode(SECRET, T0), SECRET, T0), true);
	});

	it('accepts the neighbouring slots so a drifting display clock still works', () => {
		const slot = stationSlotAt(T0);
		assert.equal(verifyStationCode(stationCodeForSlot(SECRET, slot - STATION_WINDOW), SECRET, T0), true);
		assert.equal(verifyStationCode(stationCodeForSlot(SECRET, slot + STATION_WINDOW), SECRET, T0), true);
	});

	it('refuses a code from outside the window', () => {
		const slot = stationSlotAt(T0);
		assert.equal(verifyStationCode(stationCodeForSlot(SECRET, slot + 2), SECRET, T0), false);
		assert.equal(verifyStationCode(stationCodeForSlot(SECRET, slot - 2), SECRET, T0), false);
	});

	it('refuses a photographed code once it has rolled on', () => {
		// This is the property the whole scheme rests on: a photo of the screen
		// stops working, so it cannot be sent to an absentee and used later.
		const photographed = currentStationCode(SECRET, T0);
		const muchLater = T0 + STATION_PERIOD_SEC * 1000 * 10;
		assert.equal(verifyStationCode(photographed, SECRET, muchLater), false);
	});

	it('refuses another lecture’s code', () => {
		assert.equal(verifyStationCode(currentStationCode('deadbeef', T0), SECRET, T0), false);
	});

	it('refuses anything that is not six digits', () => {
		for (const bad of ['', '12345', '1234567', 'abcdef', '12345a', ' 12345 ']) {
			assert.equal(verifyStationCode(bad, SECRET, T0), false, `accepted ${JSON.stringify(bad)}`);
		}
	});

	it('holds a photographed code for a bounded time, not forever', () => {
		const photographed = currentStationCode(SECRET, T0);
		const lastValid = T0 + STATION_PERIOD_SEC * 1000 * (STATION_WINDOW + 1);
		assert.equal(verifyStationCode(photographed, SECRET, lastValid), false);
	});
});

describe('countdown', () => {
	it('counts down inside a slot and wraps at the boundary', () => {
			const start = stationSlotAt(T0) * STATION_PERIOD_SEC * 1000;
			assert.equal(secondsRemaining(start), STATION_PERIOD_SEC);
			assert.equal(secondsRemaining(start + 1_000), STATION_PERIOD_SEC - 1);
			assert.equal(secondsRemaining(start + (STATION_PERIOD_SEC - 1) * 1000), 1);
		});
	});

	describe('pending scan across sign-in', () => {
		// No sessionStorage in the test runner, which is also the server-render case:
		// these have to degrade to "nothing waiting" rather than throwing.
		it('reports nothing to return to when storage is unavailable', () => {
			assert.equal(pendingScanTarget(), null);
		});

		it('refuses a stash that belongs to a different lecture', () => {
			// A scan stashed for session A must never be spent on session B.
			assert.equal(takePendingScan('some-other-session'), null);
		});
	});