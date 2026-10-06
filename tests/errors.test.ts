// Tests for the error unpacking in `errors.ts`.
//
// The cases that matter are the ones where a student would otherwise read a
// backend internal: a CONVEX frame, a websocket drop, a server trace. Those are
// asserted to produce either a plain sentence or nothing at all — never the
// machinery itself.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errorMessage, explainError, isNotEnrolled } from '../src/lib/lams/errors.ts';

describe('explainError', () => {
	it('passes through a message already written for a person', () => {
		assert.equal(explainError(new Error('This lecture is closed.')), 'This lecture is closed.');
		assert.equal(
			explainError(new Error('You are not a class rep for this class.')),
			'You are not a class rep for this class.'
		);
	});

	it('strips a Convex frame and keeps the sentence behind it', () => {
		assert.equal(
			explainError(new Error('[CONVEX M(8f2c)] Server Error Uncaught Error: This lecture is closed.')),
			'This lecture is closed.'
		);
	});

	it('strips the Convex prefix from a query failure', () => {
		assert.equal(
			explainError(new Error('[CONVEX Q(a1b2)] Uncaught Error: That code has expired.')),
			'That code has expired.'
		);
	});

	it('returns nothing for a bare Convex frame with no message', () => {
		// Nothing a person can read, so the caller falls back rather than
		// rendering an empty toast.
		assert.equal(explainError(new Error('[CONVEX M(8f2c)] Server Error')), '');
	});

	it('turns a dropped websocket into a plain instruction', () => {
		const said = explainError(new Error("WebSocket connection to 'wss://x.convex.cloud' failed: Error in connection handshake: net::ERR_FAILED"));
		assert.match(said, /connection/i);
		assert.doesNotMatch(said, /wss:\/\//);
		assert.doesNotMatch(said, /ERR_FAILED/);
	});

	it('turns a fetch failure into a plain instruction', () => {
		const said = explainError(new TypeError('Failed to fetch'));
		assert.match(said, /connection/i);
	});

	it('softens a server transition rather than showing it verbatim', () => {
		const said = explainError(
			new Error('Called the server during a server transition')
		);
		assert.match(said, /busy/i);
		assert.doesNotMatch(said, /transition/i);
	});

	it('keeps only the first line of a multi-line server trace', () => {
		const said = explainError(
			new Error('Something went wrong.\n    at handler (index.js:1:1)\n    at run (index.js:2:2)')
		);
		assert.equal(said, 'Something went wrong.');
		assert.doesNotMatch(said, /at handler/);
	});

	it('maps a rate limit to a wait instruction', () => {
		assert.match(explainError(new Error('Too many requests')), /wait/i);
	});

	it('points an auth failure back at signing in', () => {
		assert.match(explainError(new Error('Unauthorized')), /sign in/i);
	});

	it('handles a thrown string', () => {
		assert.equal(explainError('Lecture not found.'), 'Lecture not found.');
	});

	it('returns nothing for a non-error throw', () => {
		assert.equal(explainError(undefined), '');
		assert.equal(explainError({ weird: true }), '');
		assert.equal(explainError(null), '');
	});

	it('returns nothing for an empty message', () => {
		assert.equal(explainError(new Error('')), '');
		assert.equal(explainError(new Error('   ')), '');
	});

	it('truncates a message too long to read as a sentence', () => {
		const said = explainError(new Error('x'.repeat(400)));
		assert.ok(said.length <= 240, `expected a short message, got ${said.length} chars`);
	});
});

describe('errorMessage', () => {
	it('falls back when there is nothing readable', () => {
		assert.equal(errorMessage(new Error('[CONVEX M(x)] Server Error'), 'Could not load.'), 'Could not load.');
		assert.equal(errorMessage(undefined, 'Could not load.'), 'Could not load.');
	});

	it('prefers the real message over the fallback', () => {
		assert.equal(errorMessage(new Error('This lecture is closed.'), 'Could not load.'), 'This lecture is closed.');
	});
});

describe('isNotEnrolled', () => {
	// The exact sentence the server throws, and the exact sentence the student
	// ends up reading once Convex has wrapped it. Both have to match.
	it('recognises the server refusal as thrown and as displayed', () => {
		assert.equal(isNotEnrolled('You are not enrolled in this subject.'), true);
		assert.equal(
			isNotEnrolled(explainError(new Error('[CONVEX M(attendance:submitStationScan)] Server Error You are not enrolled in this subject.'))),
			true
		);
	});

	it('recognises the hand-add refusal, which names the student', () => {
		assert.equal(isNotEnrolled('Jane Banda is not enrolled in this subject.'), true);
	});

	it('keeps working if the sentence around the phrase is reworded', () => {
		assert.equal(isNotEnrolled('NOT ENROLLED for this offering.'), true);
	});

	// Each of these is a different card on the scan page, so a false positive
	// here would send a student to /courses over a problem /courses cannot fix.
	it('does not claim the terminal failures are an enrolment problem', () => {
		const terminal = [
			'That station code has expired. Scan the screen again.',
			'The station has been moved out of its room, so it is not accepting attendance right now.',
			'This lecture is closed.',
			'The attendance window for this lecture has closed.',
			'You are already recorded as Present for this lecture.',
			'This scan came from a different phone from the one you signed in on, so it was refused.',
			'No connection to the server. Check your internet and try again.',
			''
		];
		for (const message of terminal) {
			assert.equal(isNotEnrolled(message), false, `misfired on ${JSON.stringify(message)}`);
		}
	});
});