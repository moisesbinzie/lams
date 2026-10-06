// Throttling for endpoints where guessing is the threat.
//
// Two very different jobs share this table:
//
//   - **Credentials** (`pin:`, `act:`, `staff:`) — registration numbers and
//     usernames are guessable, so without this an attacker can walk the space of
//     real accounts and find the ones whose PIN or password happens to be weak.
//     Tight limits, because there is no legitimate reason to try a PIN forty
//     times.
//   - **Station codes** (`station:`) — six digits, server-verified, so the same
//     brute-force shape applies but the caller is an already-authenticated
//     student fumbling with a camera. Much looser limits; see `STATION_LIMITS`.
//
// Keying on the thing being probed rather than the caller keeps a single-target
// sweep slow without punishing a whole lecture hall signing in at once from
// behind one NAT address.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
/** Once tripped, this long before the next attempt is even hashed. */
const BLOCK_MS = 15 * 60 * 1000;

/**
 * Limits for a non-credential endpoint. The station code is six digits, so a
 * determined client could brute-force it; this caps the rate. The numbers are far
 * more generous than the credential defaults on purpose — a student fumbling with
 * a camera in bad light should be able to try again, and a blocked student cannot
 * attend at all. The station call site passes these.
 */
export const STATION_LIMITS = { windowMs: 5 * 60 * 1000, maxAttempts: 40, blockMs: 5 * 60 * 1000 };

/**
 * Limits for *asking* for the current code rather than guessing at it.
 *
 * A separate budget on purpose, and keyed separately: the point of this endpoint
 * is that a student whose scan went stale can recover silently, and a recovery
 * that spends the same budget as a wrong guess would let a couple of fumbled
 * camera attempts lock a student out of their own lecture. Generous enough for a
 * retry or two per scan, far too tight to be a useful way to harvest codes.
 */
export const CODE_FETCH_LIMITS = { windowMs: 5 * 60 * 1000, maxAttempts: 60, blockMs: 5 * 60 * 1000 };

export interface RateLimits {
	windowMs?: number;
	maxAttempts?: number;
	blockMs?: number;
}

/**
 * Records a failed attempt and reports whether the caller should be refused
 * outright. Call before doing the expensive hash comparison.
 */
export async function noteFailure(
	ctx: any,
	key: string,
	limits: RateLimits = {}
): Promise<{ blocked: boolean; remaining: number }> {
	const windowMs = limits.windowMs ?? WINDOW_MS;
	const maxAttempts = limits.maxAttempts ?? MAX_ATTEMPTS;
	const blockMs = limits.blockMs ?? BLOCK_MS;
	const now = Date.now();
	const existing = await ctx.db.query('authAttempts').withIndex('by_key', (q: any) => q.eq('key', key)).unique();

	if (!existing) {
		await ctx.db.insert('authAttempts', { key, count: 1, windowStart: now });
		return { blocked: false, remaining: maxAttempts - 1 };
	}

	if (existing.blockedUntil && existing.blockedUntil > now) {
		return { blocked: true, remaining: 0 };
	}

	// The window has lapsed — start a fresh count rather than accumulating forever.
	if (now - existing.windowStart > windowMs) {
		await ctx.db.patch(existing._id, { count: 1, windowStart: now, blockedUntil: undefined });
		return { blocked: false, remaining: maxAttempts - 1 };
	}

	const count = existing.count + 1;
	const blockedUntil = count >= maxAttempts ? now + blockMs : undefined;
	await ctx.db.patch(existing._id, { count, blockedUntil });
	return { blocked: false, remaining: Math.max(0, maxAttempts - count) };
}

/** Called after a success so a legitimate user is never locked out mid-lecture. */
export async function noteSuccess(ctx: any, key: string): Promise<void> {
	const existing = await ctx.db.query('authAttempts').withIndex('by_key', (q: any) => q.eq('key', key)).unique();
	if (!existing) return;
	await ctx.db.patch(existing._id, { count: 0, windowStart: Date.now(), blockedUntil: undefined });
}

export function isBlocked(ctx: any, doc: { blockedUntil?: number } | null): boolean {
	return !!doc?.blockedUntil && doc.blockedUntil > Date.now();
}