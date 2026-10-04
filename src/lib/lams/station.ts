// Client mirror of `src/convex/station.ts`.
//
// The station screen derives its rotating code from a secret the server minted
// when the lecture opened. Both sides compute the same value, so the two files
// are kept deliberately identical and both are covered by tests.
//
// Deriving on the display rather than fetching a new code every 30 seconds
// means the screen refreshes on a timer with no network round trip — it keeps
// working in exactly the lecture halls where the signal is worst.

export const STATION_PERIOD_SEC = 30;

/** Kept in step with the server's window so both sides agree on what is stale. */
export const STATION_WINDOW = 1;

/** FNV-1a, then a second mixing round to break slot-to-slot structure. */
function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

export function stationCodeForSlot(secret: string, slot: number): string {
	const a = fnv1a(`${secret}:${slot}`);
	const b = fnv1a(`${a}:${slot}:${secret.length}`);
	const mixed = (a ^ b) >>> 0;
	return (mixed % 1000000).toString().padStart(6, '0');
}

export function stationSlotAt(nowMs: number): number {
	return Math.floor(Math.max(0, nowMs) / 1000 / STATION_PERIOD_SEC);
}

export function currentStationCode(secret: string, nowMs = Date.now()): string {
	return stationCodeForSlot(secret, stationSlotAt(nowMs));
}

/** Seconds until the displayed code rolls over — drives the countdown ring. */
export function secondsRemaining(nowMs: number): number {
	const elapsed = Math.floor(Math.max(0, nowMs) / 1000) % STATION_PERIOD_SEC;
	return STATION_PERIOD_SEC - elapsed;
}

/**
 * The URL the station QR encodes.
 *
 * It has to be a URL rather than a bare code: the student scans it with the
 * phone's own camera app, which opens links but cannot post anything to a
 * server itself. Everything that makes the scan an attendance record — the
 * session, the signed-in student, the position fix — happens once that link
 * opens in the browser.
 */
export function buildStationUrl(appUrl: string, sessionId: string, code: string): string {
	const base = appUrl.replace(/\/$/, '');
	return `${base}/a/${sessionId}?c=${code}`;
}

const PENDING_KEY = 'lams_pending_scan';

/** How long a stashed scan stays worth returning to. Matches the station window. */
const PENDING_TTL_MS = 15 * 60 * 1000;

type Pending = { sessionId: string; code: string; at: number };

function readPending(): Pending | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(PENDING_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Pending>;
		if (typeof parsed.sessionId !== 'string' || typeof parsed.code !== 'string') return null;
		return { sessionId: parsed.sessionId, code: parsed.code, at: parsed.at ?? 0 };
	} catch {
		return null;
	}
}

/**
 * A student who scans while signed out has to be sent through sign-in first, and
 * the browser is free to drop the query string across that round trip. Stashing
 * the scan here means their place is held instead of making them find the code
 * on the screen all over again.
 *
 * sessionStorage rather than localStorage: the code is worthless in about a
 * minute, so there is no reason to let it outlive the tab.
 */
export function stashPendingScan(sessionId: string, code: string): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		const payload: Pending = { sessionId, code, at: Date.now() };
		sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
	} catch {
		// Private browsing can refuse storage. The scan still works from the URL.
	}
}

/**
 * Where to send a student who was interrupted by a sign-in prompt.
 *
 * Sign-in is the one thing that can still stand between a scan and a record, so
 * the sign-in page asks this and returns them to the lecture instead of their
 * home page. Without it a student who scanned while signed out simply lost the
 * scan, which is exactly the "just works" promise the station is making.
 *
 * The code is *not* returned or consumed — the landing page picks it up from the
 * stash — so this is safe to call more than once.
 */
export function pendingScanTarget(): string | null {
	const pending = readPending();
	if (!pending) return null;
	// A code is worthless well before this, but an old entry would send the
	// student to a lecture that closed and produce a confusing error.
	if (Date.now() - pending.at > PENDING_TTL_MS) {
		clearPendingScan();
		return null;
	}
	return `/a/${pending.sessionId}`;
}

export function takePendingScan(sessionId: string): string | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const parsed = readPending();
		// Only consumed on the lecture it was taken from, so a scan stashed for
		// one session cannot be spent on another.
		if (!parsed || parsed.sessionId !== sessionId) return null;
		if (Date.now() - parsed.at > PENDING_TTL_MS) return null;
		return parsed.code;
	} finally {
		clearPendingScan();
	}
}

export function clearPendingScan(): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.removeItem(PENDING_KEY);
	} catch {
		// Nothing to do; the entry expires with the tab.
	}
}