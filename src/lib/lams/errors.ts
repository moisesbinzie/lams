// Turning a thrown value into something a person can act on.
//
// The problem this solves: Convex reaches the browser with its internals still
// attached. A user whose session was closed sees
//
//   [CONVEX M(8f2c)] Server Error Called the server during a server transition
//
// or a mis-pinned station surfaces as a raw server string. None of that means
// anything to a first-year holding a phone, and all of it leaks the backend's
// shape into the student-facing UI. So the message is unpacked here and the
// parts nobody can act on are thrown away.
//
// Deliberately pure and framework-free: this file is unit-tested under
// `node --test`, which cannot import a Svelte store or a DOM. The toast
// wrapper lives in `errors.svelte.ts` alongside it, mirroring how
// `session-state.ts` and `session.svelte.ts` split one concern in two.
//
// The rule: an *actionable* sentence from the server is already written for a
// human ("This lecture is closed.", "You are not a class rep for this class.")
// and is passed through untouched. Only the machine wrapper is stripped. That
// keeps the specific, helpful messages the server already produces instead of
// flattening everything into one vague toast.

/** Words that mean this string is machinery, not a sentence for a person. */
const NOISE = [
	/^\s*\[?HTTP\s+error/i,
	/^\s*NetworkError\b/i
];

// Convex prefixes a thrown message with these; they are never the useful part.
//
// Order is irrelevant because stripping runs to a fixed point: the wrappers
// arrive in an unpredictable order (`[CONVEX M(x)] Server Error Uncaught
// Error: …`), so removing the front one exposes the next. A single pass leaves
// `Server Error Uncaught Error: …` sitting in front of the real sentence.
const WRAPPERS = [
	/^Uncaught\s+Error:\s*/i,
	/^Server\s+Error\s*/i,
	/^Server\s+Error:\s*/i,
	/^Error:\s*/i,
	/^\[CONVEX\s+[A-Za-z]+\([^\]]*\)\]\s*/i,
	/^\[CONVEX[^\]]*\]\s*/i
];

/**
 * Technical failures mapped to the plain sentence a user can act on.
 *
 * Order matters: the first match wins, so the specific `includes` cases come
 * before the broad network fallback. Each entry is deliberately worded as
 * "what happened, what to do" rather than naming a protocol.
 */
const PHRASES: { match: RegExp; say: string }[] = [
	{
		match: /WebSocket connection to .* failed/i,
		say: 'Lost connection to the server. Check your internet and try again.'
	},
	{
		match: /Failed to fetch|NetworkError|Fetch failed|Load failed/i,
		say: 'No connection to the server. Check your internet and try again.'
	},
	{
		match: /during a server transition|Server Error/i,
		say: 'The server is busy updating. Please try again in a moment.'
	},
	{
		match: /timeout|timed? ?out/i,
		say: 'That took too long. Please try again.'
	},
	{
		match: /Too many requests|rate limit/i,
		say: 'Too many attempts in a row. Wait a moment before trying again.'
	},
	{
		match: /Unauthorized|unauthenticated|Not authenticated|sign in/i,
		say: 'Please sign in again to continue.'
	},
	{
		match: /Argument validation failed|ValidationError/i,
		say: 'Something in that request was not valid. Please try again.'
	}
];

/**
 * Reduces a raw thrown message to a plain sentence.
 *
 * Returns an empty string when there is nothing a person could read — the
 * caller supplies its own fallback in that case rather than showing `undefined`.
 */
export function explainError(err: unknown): string {
	if (typeof err === 'string') return tidy(err);
	if (!(err instanceof Error)) return '';
	return tidy(err.message);
}

function tidy(raw: string): string {
	let message = raw.trim();
	// A message that is nothing but internals is worse than no message at all:
	// the caller then uses its own fallback.
	if (!message) return '';

	// Fixed point: each wrapper can expose another one in front of it. Bounded
	// so a pathological message cannot spin here.
	for (let pass = 0; pass < WRAPPERS.length + 1; pass += 1) {
		const stripped = WRAPPERS.reduce((acc, w) => acc.replace(w, '').trim(), message);
		if (stripped === message) break;
		message = stripped;
	}
	if (!message) return '';

	// A leading `[CONVEX ...]` prefix survives the wrapper pass when the server
	// message itself was empty; strip any residue so it is never shown.
	message = message.replace(/^\[CONVEX[^\]]*\]\s*/, '').trim();

	// Map before discarding. A dropped connection and a server transition are
	// machinery, but they are machinery the app knows how to explain — so they
	// become an instruction rather than an empty string. Anything still
	// unrecognised afterwards is treated as noise and dropped, which keeps an
	// unhandled backend frame from reaching a student.
	for (const { match, say } of PHRASES) {
		if (match.test(message)) return say;
	}

	for (const noise of NOISE) {
		if (noise.test(message)) return '';
	}
	// Anything left that still reads as a raw frame is not worth showing.
	if (/^\s*\[?CONVEX\b|^\s*WebSocket\b|^\s*Fetch failed|^\s*Load failed/i.test(message)) {
		return '';
	}

	// Multi-line server traces read as a crash report. Keep the first sentence:
	// it is the part written for a human.
	const firstSentence = message.split('\n')[0]?.trim() ?? '';
	if (!firstSentence) return '';
	return firstSentence.length > 240 ? `${firstSentence.slice(0, 237)}…` : firstSentence;
}

/**
 * The sentence to show for a failure, never empty.
 *
 * `fallback` covers the two cases `explainError` deliberately returns nothing
 * for: a non-Error was thrown, or the message was pure machinery.
 */
export function errorMessage(err: unknown, fallback: string): string {
	return explainError(err) || fallback;
}

/**
 * Whether a failure was the server refusing a scan because the caller is not
 * taking that subject.
 *
 * A scan is already gated by enrolment on the server — `submitStationScan`
 * checks the enrolment itself and is the authority, not this. What the check
 * buys is the *response*: "not enrolled" is the one refusal a student can fix
 * on their own, so it is told apart from the terminal ones (a stale code, a
 * station out of its room) and answered with a route to `/courses` instead of a
 * dead end.
 *
 * Matched on the server's own wording rather than a code, because Convex
 * carries thrown messages as prose. The regex is deliberately loose: it must
 * keep working if the sentence around the phrase is reworded, and a false
 * positive would only ever offer a helpful link to a student who was refused.
 */
export function isNotEnrolled(message: string): boolean {
	return /not enrolled/i.test(message);
}