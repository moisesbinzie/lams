// Policy for turning the outcome of the session check (the staff.me query)
// into a navbar state, kept pure so it can be unit-tested without a browser
// or a Convex connection.
//
// The rule that removes the navbar flicker: only a definite "no such session"
// answer may clear the stored token. A query that THROWS (offline, Convex
// unreachable, bad configuration) must keep the token — clearing it used to
// sign people out on flaky mobile connections and flip the navbar between
// signed-in and signed-out mid-use.

export type SessionStatus = 'checking' | 'anonymous' | 'authed' | 'unavailable';

export type SessionCheck =
	| { kind: 'no-token' }
	| { kind: 'query-ok'; me: unknown }
	| { kind: 'query-failed' };

export interface SessionDecision {
	status: SessionStatus;
	/** The stored token must be removed because the server said it is gone. */
	forget: boolean;
}

export function decideSession(check: SessionCheck): SessionDecision {
	if (check.kind === 'no-token') return { status: 'anonymous', forget: false };
	if (check.kind === 'query-failed') return { status: 'unavailable', forget: false };
	return check.me
		? { status: 'authed', forget: false }
		: { status: 'anonymous', forget: true };
}
