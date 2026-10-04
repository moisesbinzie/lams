// Client mirror of `src/convex/scancode.ts`.
//
// The student's phone derives its rotating attendance code from a secret the
// server issued at activation. Both sides must compute the same value, so the
// two files are kept deliberately identical and both are covered by tests.
//
// Keeping the derivation on the phone means the code refreshes every 30 seconds
// with no network round trip — important when the lecture hall signal is poor.

export const CODE_PERIOD_SEC = 30;
export const SCAN_PREFIX = 'LAMS';

/** FNV-1a, then a second mixing round to break slot-to-slot structure. */
function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

export function codeForSlot(secret: string, slot: number): string {
	const a = fnv1a(`${secret}:${slot}`);
	const b = fnv1a(`${a}:${slot}:${secret.length}`);
	const mixed = (a ^ b) >>> 0;
	return (mixed % 1000000).toString().padStart(6, '0');
}

export function slotAt(nowMs: number): number {
	return Math.floor(Math.max(0, nowMs) / 1000 / CODE_PERIOD_SEC);
}

export function buildScanCode(regNumber: string, secret: string, nowMs = Date.now()): string {
	return `${SCAN_PREFIX}|${regNumber.trim().replace(/\s+/g, '')}|${codeForSlot(secret, slotAt(nowMs))}`;
}

export function parseScanCode(text: string): { regNumber: string; code: string } | null {
	const parts = text.trim().split('|');
	if (parts.length !== 3 || parts[0] !== SCAN_PREFIX) return null;
	const [, regNumber, code] = parts;
	if (!regNumber || !/^\d{6}$/.test(code)) return null;
	return { regNumber, code };
}

/** Seconds until the displayed code rolls over — drives the countdown ring. */
export function secondsRemaining(nowMs: number): number {
	const elapsed = Math.floor(Math.max(0, nowMs) / 1000) % CODE_PERIOD_SEC;
	return CODE_PERIOD_SEC - elapsed;
}