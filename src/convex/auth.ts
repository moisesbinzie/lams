// Sign-in, hashing, and permission guards.
//
// Two kinds of identity exist, deliberately kept separate:
//
//   Staff     — lecturers. A username and a shared password, seeded as
//               admin/admin. Not tied to a student record, so a lecturer cannot
//               be impersonated by guessing a registration number.
//   Person    — students and class reps. A registration number plus a PIN the
//               person chose themselves, bound to their own phone.
//
// Every guarded function takes a single `token` and resolves it to an Actor.
// Callers use `requireActor` / `requireRecorder` rather than caring which kind
// of identity arrived, which keeps the permission rules in one place.

import type { GenericId } from 'convex/values';
import { judgeScanDevice, sha256Hex } from './helpers';

export const SCHEME = 'sha2i';
export const ITERATIONS = 2048;

/** Seeded lecturer credentials. Change the password after first sign-in. */
export const DEFAULT_STAFF_USERNAME = 'admin';
export const DEFAULT_STAFF_PASSWORD = 'admin';
export const DEFAULT_STAFF_NAME = 'Lecturer';

/** Sessions last a working week of lectures. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

// ------------------------------------------------------------------ hashing

export interface HashDoc {
	_id: unknown;
	passwordHash?: string;
	pinHash?: string;
	salt?: string;
	scheme?: string;
	iterations?: number;
}

/**
 * Iterated SHA-256 over `salt::secret`. Weaker than argon2/scrypt, which Convex
 * cannot call synchronously, but it stops a leaked database from yielding
 * plaintext and makes offline cracking far more expensive.
 */
export async function hashSecret(secret: string, salt: string, iterations = ITERATIONS): Promise<string> {
	let acc = `${salt}::${secret}`;
	for (let i = 0; i < iterations; i += 1) {
		acc = await sha256Hex(acc);
	}
	return acc;
}

/** Kept for readability at the PIN call sites. */
export const hashPin = hashSecret;

export function randomSalt(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Reads whichever hash column this document uses. */
function storedHash(doc: HashDoc): string | undefined {
	return doc.passwordHash ?? doc.pinHash;
}

export async function verifySecret(doc: HashDoc, secret: string): Promise<boolean> {
	const hash = storedHash(doc);
	if (!hash || !doc.salt) return false;
	const candidate = await hashSecret(secret, doc.salt, doc.iterations ?? ITERATIONS);
	return candidate === hash;
}

export function normalizeUsername(value: string): string {
	return value.trim().toLowerCase();
}

// ------------------------------------------------------------------- actors

export type Role = 'student' | 'rep' | 'lecturer';

export interface PersonDoc {
	_id: GenericId<'people'>;
	role: 'student' | 'rep';
	fullName: string;
	regNumber: string;
	regNorm: string;
	status: 'invited' | 'active' | 'blocked';
	boundDeviceId?: string;
	qrSecret?: string;
}

/** Whatever a token turned out to be. */
export type Actor =
	| {
			kind: 'staff';
			id: GenericId<'staff'>;
			name: string;
			username: string;
			/** Lecturer accounts are not device-bound; they use a shared password. */
			role: 'lecturer';
	  }
	| {
			kind: 'person';
			id: GenericId<'people'>;
			name: string;
			person: PersonDoc;
			role: 'student' | 'rep';
	  };

export async function resolveActor(ctx: any, token: string): Promise<Actor | null> {
	if (!token) return null;

	// Staff tokens live in their own table so a student token can never be
	// reinterpreted as a lecturer one.
	const staffSess = await ctx.db
		.query('staffSessions')
		.withIndex('by_token', (q: any) => q.eq('token', token))
		.unique();
	if (staffSess && staffSess.expiresAt >= Date.now()) {
		const staff = await ctx.db.get('staff', staffSess.staffId);
		if (staff && staff.active) {
			return {
				kind: 'staff',
				id: staff._id,
				name: staff.fullName,
				username: staff.username,
				role: 'lecturer'
			};
		}
	}

	const sess = await ctx.db
		.query('authSessions')
		.withIndex('by_token', (q: any) => q.eq('token', token))
		.unique();
	if (!sess || sess.expiresAt < Date.now()) return null;
	const person = await ctx.db.get('people', sess.personId);
	if (!person || person.status !== 'active') return null;
	const doc = person as unknown as PersonDoc;
	return {
		kind: 'person',
		id: doc._id,
		name: doc.fullName,
		person: doc,
		role: doc.role
	};
}

// ------------------------------------------------------------------- guards

/** Any signed-in identity. */
export async function requireActor(ctx: any, token: string): Promise<Actor> {
	const actor = await resolveActor(ctx, token);
	if (!actor) throw new Error('Your sign-in has expired. Please sign in again.');
	return actor;
}

/** Lecturers only. */
export async function requireStaff(ctx: any, token: string): Promise<Extract<Actor, { kind: 'staff' }>> {
	const actor = await requireActor(ctx, token);
	if (actor.kind !== 'staff') {
		throw new Error('This is a lecturer-only action. Please sign in with a lecturer account.');
	}
	return actor;
}

/**
 * Anyone who may record attendance: a lecturer, or a class rep. Reps are
 * additionally checked against the subject with `canRecordFor`.
 */
export async function requireRecorder(ctx: any, token: string): Promise<Actor> {
	const actor = await requireActor(ctx, token);
	if (actor.kind === 'staff') return actor;
	if (actor.role !== 'rep') {
		throw new Error('Only class representatives and lecturers can do this.');
	}
	return actor;
}

/** Reps and lecturers — for viewing subject lists and similar. */
export async function requireRepOrStaff(ctx: any, token: string): Promise<Actor> {
	const actor = await requireActor(ctx, token);
	if (actor.kind === 'staff') return actor;
	if (actor.role !== 'rep') {
		throw new Error('Only class representatives and lecturers can do this.');
	}
	return actor;
}

/** Any signed-in person, student included. */
export async function requirePerson(ctx: any, token: string): Promise<PersonDoc> {
	const actor = await requireActor(ctx, token);
	if (actor.kind !== 'person') {
		throw new Error('This action is for students and class representatives.');
	}
	return actor.person;
}

/**
 * The device a token was issued to, read from the session row itself rather than
 * from anything the caller sent. Null when the token is unknown or expired.
 */
export async function sessionDeviceId(ctx: any, token: string): Promise<string | null> {
	if (!token) return null;
	const sess = await ctx.db
		.query('authSessions')
		.withIndex('by_token', (q: any) => q.eq('token', token))
		.unique();
	if (!sess || sess.expiresAt < Date.now()) return null;
	return sess.deviceId;
}

/**
 * A person, *and* proof that this request is coming from the one phone their
 * account is bound to.
 *
 * Sign-in already refuses a second device, but that check happens once, at login.
 * A token is still a bearer credential afterwards: it sits in `localStorage`, so
 * it can be copied to another phone by hand, restored from a backup, or carried
 * across by a browser profile sync. Without this guard, a student could hand their
 * token to an absentee and have the scan land on their own record.
 *
 * Two comparisons are needed, and they fail differently:
 *
 *   - the presented device must equal the session's device — otherwise someone
 *     moved a valid token onto a different handset;
 *   - the session's device must equal the account's bound device — otherwise the
 *     account was moved to a new phone while an old session was still alive.
 */
export async function requirePersonOnDevice(
	ctx: any,
	token: string,
	deviceId: string
): Promise<PersonDoc> {
	const person = await requirePerson(ctx, token);
	const issuedTo = await sessionDeviceId(ctx, token);
	const verdict = judgeScanDevice(issuedTo, deviceId, person.boundDeviceId);

	switch (verdict.ok ? true : verdict.reason) {
		case true:
			return person;
		case 'unknown-session':
			throw new Error('This device could not be identified. Please sign in again.');
		case 'mismatch':
			throw new Error(
				'This scan came from a different phone from the one you signed in on, so it was refused. Sign in again on this phone.'
			);
		case 'moved':
			throw new Error(
				'Your account has been moved to another phone. Sign in again on the phone that now holds it.'
			);
	}
}

// ------------------------------------------------------- class-level rights

/** True when this person is a class rep for the class. */
export async function isRepFor(ctx: any, personId: unknown, classId: unknown): Promise<boolean> {
	const rows = await ctx.db
		.query('classReps')
		.withIndex('by_person', (q: any) => q.eq('personId', personId))
		.take(200);
	return rows.some((r: any) => r.classId === classId);
}

/**
 * True when the actor may record attendance for this class. Lecturers may do
 * so for anything; reps only for classes they represent.
 */
export async function canRecordFor(ctx: any, actor: Actor, classId: unknown): Promise<boolean> {
	if (actor.kind === 'staff') return true;
	if (actor.role !== 'rep') return false;
	return await isRepFor(ctx, actor.id, classId);
}

/** Throws unless the actor may record for the class. */
export async function assertCanRecordFor(ctx: any, actor: Actor, classId: unknown): Promise<void> {
	if (await canRecordFor(ctx, actor, classId)) return;
	throw new Error(
		actor.kind === 'staff'
			? 'Not allowed for this class.'
			: 'You are only a class representative for your own class.'
	);
}

/** The name and role to stamp on an attendance record. */
export function recorderFields(actor: Actor): {
	recordedBy: string;
	recordedByRole: 'rep' | 'lecturer';
	recordedById?: GenericId<'people'>;
} {
	if (actor.kind === 'staff') {
		return { recordedBy: actor.name, recordedByRole: 'lecturer' };
	}
	return {
		recordedBy: actor.name,
		recordedByRole: 'rep',
		recordedById: actor.id
	};
}