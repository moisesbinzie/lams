import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScanCode, parseScanCode, codeForSlot, slotAt, secondsRemaining } from './totp.ts';
import {
	buildScanCode as serverBuild,
	parseScanCode as serverParse,
	codeForSlot as serverCode,
	verifyScanCode,
	slotAt as serverSlot
} from '../../convex/scancode.ts';

const SECRET = 'a1b2c3d4e5f6a7b8c9d0';
const NOW = 1_700_000_000_000;

describe('client and server agree', () => {
	it('derive the same slot', () => {
		assert.equal(slotAt(NOW), serverSlot(NOW));
		assert.equal(slotAt(0), serverSlot(0));
		assert.equal(slotAt(-1000), serverSlot(-1000));
	});

	it('derive the same code for a slot', () => {
		for (const slot of [0, 1, 42, 12345]) {
			assert.equal(codeForSlot(SECRET, slot), serverCode(SECRET, slot));
		}
	});

	it('build the same payload', () => {
		assert.equal(buildScanCode('BIT/2024/0123', SECRET, NOW), serverBuild('BIT/2024/0123', SECRET, NOW));
	});

	it('parse the same payloads', () => {
		const text = buildScanCode('BIT/2024/0123', SECRET, NOW);
		assert.deepEqual(parseScanCode(text), serverParse(text));
	});
});

describe('rotating attendance code', () => {
	it('produces the expected wire format', () => {
		assert.match(buildScanCode('BIT/2024/0123', SECRET, NOW), /^LAMS\|BIT\/2024\/0123\|\d{6}$/);
	});

	it('strips spaces in the registration number', () => {
		assert.equal(
			buildScanCode('  BIT / 2024 / 0123 ', SECRET, NOW),
			buildScanCode('BIT/2024/0123', SECRET, NOW)
		);
	});

	it('changes every 30 seconds', () => {
		const first = buildScanCode('BIT/2024/0123', SECRET, NOW);
		const next = buildScanCode('BIT/2024/0123', SECRET, NOW + 30_000);
		assert.notEqual(first, next);
	});

	it('is unchanged within the same slot', () => {
		// Anchor to the start of a slot so +29s cannot cross a boundary.
		const start = slotAt(NOW) * 30_000;
		assert.equal(
			buildScanCode('BIT/2024/0123', SECRET, start),
			buildScanCode('BIT/2024/0123', SECRET, start + 29_000)
		);
	});

	it('depends on the secret, so it cannot be forged from the reg number alone', () => {
		const mine = buildScanCode('BIT/2024/0123', SECRET, NOW);
		const forged = buildScanCode('BIT/2024/0123', 'someone-elses-secret', NOW);
		assert.notEqual(mine, forged);
		assert.equal(verifyScanCode(mine.split('|')[2], SECRET, NOW), true);
		assert.equal(verifyScanCode(forged.split('|')[2], SECRET, NOW), false);
	});

	it('always emits six digits', () => {
		for (let slot = 0; slot < 500; slot += 1) {
			assert.match(codeForSlot(SECRET, slot), /^\d{6}$/);
		}
	});

	it('reports seconds until the next refresh', () => {
		assert.equal(secondsRemaining(0), 30);
		assert.equal(secondsRemaining(29_000), 1);
		const start = slotAt(NOW) * 30_000;
		assert.equal(secondsRemaining(start), 30);
		assert.equal(secondsRemaining(start + 29_000), 1);
	});
});

describe('code freshness', () => {
	it('accepts the current slot', () => {
		assert.equal(verifyScanCode(codeForSlot(SECRET, slotAt(NOW)), SECRET, NOW), true);
	});

	it('tolerates one slot of clock drift either way', () => {
		const slot = slotAt(NOW);
		assert.equal(verifyScanCode(codeForSlot(SECRET, slot - 1), SECRET, NOW), true);
		assert.equal(verifyScanCode(codeForSlot(SECRET, slot + 1), SECRET, NOW), true);
	});

	it('rejects a screenshot taken two minutes ago', () => {
		const stale = codeForSlot(SECRET, slotAt(NOW - 120_000));
		assert.equal(verifyScanCode(stale, SECRET, NOW), false);
	});

	it('rejects malformed codes without throwing', () => {
		assert.equal(verifyScanCode('', SECRET, NOW), false);
		assert.equal(verifyScanCode('abc', SECRET, NOW), false);
		assert.equal(verifyScanCode('12345', SECRET, NOW), false);
	});
});

describe('parsing rejects foreign payloads', () => {
	it('rejects a session URL', () => {
		assert.equal(parseScanCode('https://example.com/a/xyz?t=tokentokentoken'), null);
	});
	it('rejects a session QR body', () => {
		assert.equal(parseScanCode('LAMS-S:abc:def:123456'), null);
	});
	it('rejects wrong field counts', () => {
		assert.equal(parseScanCode('LAMS|only|two'), null);
		assert.equal(parseScanCode('LAMS|a|b|c|d'), null);
	});
	it('rejects a non-numeric code', () => {
		assert.equal(parseScanCode('LAMS|BIT/2024/0123|abcdef'), null);
	});
});