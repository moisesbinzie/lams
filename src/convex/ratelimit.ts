// Throttling for credential-checking endpoints.
//
// Registration numbers and usernames are guessable, so without this an attacker
// can walk the space of real accounts and find the ones whose PIN or password
// happens to be weak. The limiter is keyed on the identifier being probed, which
// slows a single-target sweep without punishing a whole lecture hall signing in
// at once from behind one NAT address.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
/** Once tripped, this long before the next attempt is even hashed. */
const BLOCK_MS = 15 * 60 * 1000;

/**
 * Records a failed attempt and reports whether the caller should be refused
 * outright. Call before doing the expensive hash comparison.
 */
export async function noteFailure(ctx: any, key: string): Promise<{ blocked: boolean; remaining: number }> {
	const now = Date.now();
	const existing = await ctx.db.query('authAttempts').withIndex('by_key', (q: any) => q.eq('key', key)).unique();

	if (!existing) {
		await ctx.db.insert('authAttempts', { key, count: 1, windowStart: now });
		return { blocked: false, remaining: MAX_ATTEMPTS - 1 };
	}

	if (existing.blockedUntil && existing.blockedUntil > now) {
		return { blocked: true, remaining: 0 };
	}

	// The window has lapsed — start a fresh count rather than accumulating forever.
	if (now - existing.windowStart > WINDOW_MS) {
		await ctx.db.patch(existing._id, { count: 1, windowStart: now, blockedUntil: undefined });
		return { blocked: false, remaining: MAX_ATTEMPTS - 1 };
	}

	const count = existing.count + 1;
	const blockedUntil = count >= MAX_ATTEMPTS ? now + BLOCK_MS : undefined;
	await ctx.db.patch(existing._id, { count, blockedUntil });
	return { blocked: false, remaining: Math.max(0, MAX_ATTEMPTS - count) };
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