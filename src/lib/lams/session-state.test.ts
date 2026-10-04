import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideSession } from './session-state.ts';

describe('decideSession', () => {
	it('no stored token means anonymous without touching storage', () => {
		assert.deepEqual(decideSession({ kind: 'no-token' }), {
			status: 'anonymous',
			forget: false
		});
	});

	it('a resolved session is authed and keeps the token', () => {
		assert.deepEqual(
			decideSession({ kind: 'query-ok', me: { kind: 'person', role: 'student' } }),
			{ status: 'authed', forget: false }
		);
	});

	it('a definite null answer is an expired session: anonymous AND forget', () => {
		assert.deepEqual(decideSession({ kind: 'query-ok', me: null }), {
			status: 'anonymous',
			forget: true
		});
	});

	it('a failed query must NOT forget the token — the session may still be valid', () => {
		// Regression: clearing here used to sign people out on every network
		// blip and made the navbar flip between states.
		assert.deepEqual(decideSession({ kind: 'query-failed' }), {
			status: 'unavailable',
			forget: false
		});
	});
});
