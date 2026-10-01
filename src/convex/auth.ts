// Shared admin-password guard used by every privileged Convex function.
//
// Passwords are stored as iterated SHA-256 (`scheme: "sha2i"`) with a random
// salt so a leaked hash is much harder to brute-force than a single digest.
// Legacy single-round hashes (documents without a `scheme`) still verify and
// are re-hashed in place on the next successful check.

import { sha256Hex } from './helpers';

export const ADMIN_KEY = 'admin';
export const DEFAULT_PASSWORD = 'admin123';
export const SCHEME = 'sha2i';
export const ITERATIONS = 2048;

export interface AdminDoc {
	_id: unknown;
	key: string;
	adminHash: string;
	salt: string;
	scheme?: string;
	iterations?: number;
	updatedAt: number;
}

/** Iterated SHA-256 — `ITERATIONS` sequential rounds over `salt::password`. */
export async function hashPassword(
	password: string,
	salt: string,
	iterations = ITERATIONS
): Promise<string> {
	let acc = `${salt}::${password}`;
	for (let i = 0; i < iterations; i += 1) {
		acc = await sha256Hex(acc);
	}
	return acc;
}

export function randomSalt(): string {
	const buf = new Uint8Array(16);
	crypto.getRandomValues(buf);
	return Array.from(buf)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Verifies a password against a settings doc, upgrading legacy hashes. */
export async function verifyPassword(
	ctx: { db: { patch: (id: never, patch: Record<string, unknown>) => Promise<unknown> } },
	doc: AdminDoc,
	password: string
): Promise<boolean> {
	if (!doc.scheme) {
		// Legacy: single-round SHA-256 with the stored salt.
		const legacy = await sha256Hex(`${doc.salt}::${password}`);
		if (legacy !== doc.adminHash) return false;
		const salt = randomSalt();
		const adminHash = await hashPassword(password, salt);
		await ctx.db.patch(doc._id as never, {
			salt,
			adminHash,
			scheme: SCHEME,
			iterations: ITERATIONS,
			updatedAt: Date.now()
		});
		return true;
	}
	const hash = await hashPassword(password, doc.salt, doc.iterations ?? ITERATIONS);
	return hash === doc.adminHash;
}

/**
 * Mutation-side guard: throws when the password is wrong or setup is missing,
 * and silently upgrades legacy hashes on success.
 */
export async function requireAdmin(ctx: any, password: string): Promise<void> {
	const doc = (await ctx.db
		.query('settings')
		.withIndex('by_key', (q: any) => q.eq('key', ADMIN_KEY))
		.unique()) as AdminDoc | null;
	if (!doc) throw new Error('Admin not initialised.');
	const ok = await verifyPassword(ctx, doc, password);
	if (!ok) throw new Error('Invalid admin password.');
}

/**
 * Query-side check: queries cannot write, so this verifies without upgrading.
 */
export async function checkAdminPassword(ctx: any, password: string): Promise<boolean> {
	const doc = (await ctx.db
		.query('settings')
		.withIndex('by_key', (q: any) => q.eq('key', ADMIN_KEY))
		.unique()) as AdminDoc | null;
	if (!doc) throw new Error('Admin not initialised.');
	if (!doc.scheme) {
		const legacy = await sha256Hex(`${doc.salt}::${password}`);
		return legacy === doc.adminHash;
	}
	const hash = await hashPassword(password, doc.salt, doc.iterations ?? ITERATIONS);
	return hash === doc.adminHash;
}
