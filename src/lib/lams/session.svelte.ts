// Shared sign-in state for the whole app — the single source of truth the
// navbar, the sign-in page and every page that boots an invalid session all
// read and update. Before this module the root layout, the sign-in page and
// each page fetched the session independently, so the navbar could show a
// different state from the page underneath it (most visibly right after
// signing in, when the layout never learned about the new token until a full
// reload).
//
// Runes in a `.svelte.ts` module: importers cannot reassign module bindings,
// so state is mutated inside this module and read through the exported
// getter functions.
import { api } from '../../convex/_generated/api.js';
import { requireConvexClient } from '$lib/convexClient';
import { clearToken, getToken, setToken } from './auth';
import { decideSession, type SessionDecision } from './session-state';
import type { Me } from './types';

let status = $state<'checking' | 'anonymous' | 'authed' | 'unavailable'>('checking');
let me = $state<Me | null>(null);
let loaded = false;

export function sessionStatus(): 'checking' | 'anonymous' | 'authed' | 'unavailable' {
	return status;
}

export function sessionMe(): Me | null {
	return me;
}

function apply(decision: SessionDecision, found: Me | null) {
	if (decision.forget) clearToken();
	status = decision.status;
	me = decision.status === 'authed' ? found : null;
}

async function check(): Promise<void> {
	const token = getToken();
	if (!token) {
		apply(decideSession({ kind: 'no-token' }), null);
		return;
	}
	status = 'checking';
	me = null;
	try {
		const client = requireConvexClient();
		const found = (await client.query(api.staff.me, { token })) as unknown as Me | null;
		// The session may have been signed out (or a new one signed in) while
		// this query was in flight — that answer belongs to a stale token.
		if (getToken() !== token) return;
		apply(decideSession({ kind: 'query-ok', me: found }), found);
	} catch {
		// Network or configuration trouble: the token may still be valid, so
		// keep it and let the UI offer a retry instead of signing out.
		apply(decideSession({ kind: 'query-failed' }), null);
	}
}

/**
 * Load the session once per page load. Every caller sees the same result;
 * later calls are no-ops.
 */
export async function ensureSession(): Promise<void> {
	if (loaded) return;
	loaded = true;
	await check();
}

/** Re-run the session check (retry button after a failed check). */
export async function refreshSession(): Promise<void> {
	loaded = true;
	await check();
}

/**
 * Record a freshly issued token (right after a successful sign-in) and check
 * it, so the navbar switches to the signed-in state in the same navigation.
 */
export async function beginSession(token: string): Promise<void> {
	setToken(token);
	loaded = true;
	await check();
}

/**
 * End the session for real: the user signed out, or the server rejected the
 * token. Callers that only hit a network error must NOT call this.
 */
export function endSession(): void {
	clearToken();
	loaded = true;
	status = 'anonymous';
	me = null;
}
