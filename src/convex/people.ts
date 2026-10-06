import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { isBlocked, noteFailure, noteSuccess } from './ratelimit';
import { normalizeId, normalizeReg, randomHex } from './helpers';
import {
	ITERATIONS,
	SCHEME,
	SESSION_TTL_MS,
	hashPin,
	randomSalt,
	requirePerson,
	requireRecorder,
	requireStaff,
	verifySecret
} from './auth';

const roleValidator = v.union(v.literal('student'), v.literal('rep'), v.literal('lecturer'));

/** PINs are 4–8 digits; short enough to type in a lecture, long enough to matter. */
function validatePin(pin: string): string {
	const trimmed = pin.trim();
	if (!/^\d{4,8}$/.test(trimmed)) throw new Error('PIN must be 4 to 8 digits.');
	return trimmed;
}

// ---------------------------------------------------------- class membership
//
// A student can belong to several classes (the repeating-subject case), so
// membership lives in the `classMembers` join table rather than a single
// column on the person.

/** All class ids a person belongs to. */
async function memberClassIds(ctx: any, personId: unknown): Promise<string[]> {
	const rows = await ctx.db
		.query('classMembers')
		.withIndex('by_person', (q: any) => q.eq('personId', personId))
		.take(100);
	return rows.map((r: any) => String(r.classId));
}

async function hasMembership(ctx: any, personId: unknown, classId: unknown): Promise<boolean> {
	const rows = await ctx.db
		.query('classMembers')
		.withIndex('by_person', (q: any) => q.eq('personId', personId))
		.take(100);
	return rows.some((r: any) => String(r.classId) === String(classId));
}

async function addMembership(ctx: any, personId: unknown, classId: unknown): Promise<void> {
	if (await hasMembership(ctx, personId, classId)) return;
	await ctx.db.insert('classMembers', { personId, classId, createdAt: Date.now() });
}

/** Sets the person's memberships to exactly `classIds` (diff, not wipe-and-recreate). */
async function replaceMemberships(ctx: any, personId: unknown, classIds: string[]): Promise<void> {
	const current = await ctx.db
		.query('classMembers')
		.withIndex('by_person', (q: any) => q.eq('personId', personId))
		.take(100);
	const wanted = new Set(classIds.map(String));
	for (const row of current) {
		if (!wanted.has(String(row.classId))) await ctx.db.delete('classMembers', row._id);
	}
	for (const classId of wanted) {
		if (!current.some((r: any) => String(r.classId) === classId)) {
			await ctx.db.insert('classMembers', { personId, classId, createdAt: Date.now() });
		}
	}
}

/**
 * Staff-created registration. Produces an `invited` person: the record exists
 * but cannot sign in until its owner activates it with reg number + student ID.
 */
export const createPerson = mutation({
	args: {
		token: v.string(),
		fullName: v.string(),
		regNumber: v.string(),
		studentId: v.string(),
		role: v.optional(v.union(v.literal('student'), v.literal('rep'))),
		classId: v.optional(v.id('classes')),
		email: v.optional(v.string()),
		phone: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireRecorder(ctx, args.token);
		const fullName = args.fullName.trim();
		const regNorm = normalizeReg(args.regNumber);
		const idNorm = normalizeId(args.studentId);
		if (fullName.length < 2) throw new Error('Full name is required.');
		if (!regNorm) throw new Error('Registration number is required.');
		if (!idNorm) throw new Error('Student ID is required.');

		const clash = await ctx.db.query('people').withIndex('by_reg', (q) => q.eq('regNorm', regNorm)).unique();
		if (clash) throw new Error('That registration number already exists.');

		const personId = await ctx.db.insert('people', {
			role: args.role ?? 'student',
			fullName,
			regNumber: args.regNumber.trim(),
			regNorm,
			studentId: args.studentId.trim(),
			idNorm,
			...(args.email?.trim() ? { email: args.email.trim() } : {}),
			...(args.phone?.trim() ? { phone: args.phone.trim() } : {}),
			status: 'invited',
			createdAt: Date.now()
		});
		if (args.classId) await addMembership(ctx, personId, args.classId);
		return personId;
	}
});

/** Adds several people at once from pasted class-list lines. */
export const importPeople = mutation({
	args: {
		token: v.string(),
		classId: v.id('classes'),
		rows: v.array(v.object({ fullName: v.string(), regNumber: v.string(), studentId: v.string() }))
	},
	handler: async (ctx, args) => {
		await requireRecorder(ctx, args.token);
		let added = 0;
		let skipped = 0;
		for (const row of args.rows.slice(0, 500)) {
			const fullName = row.fullName.trim();
			const regNorm = normalizeReg(row.regNumber);
			const idNorm = normalizeId(row.studentId);
			if (fullName.length < 2 || !regNorm || !idNorm) {
				skipped += 1;
				continue;
			}
			const clash = await ctx.db
				.query('people')
				.withIndex('by_reg', (q) => q.eq('regNorm', regNorm))
				.unique();
			if (clash) {
				skipped += 1;
				continue;
			}
			const personId = await ctx.db.insert('people', {
				role: 'student',
				fullName,
				regNumber: row.regNumber.trim(),
				regNorm,
				studentId: row.studentId.trim(),
				idNorm,
				status: 'invited',
				createdAt: Date.now()
			});
			await addMembership(ctx, personId, args.classId);
			added += 1;
		}
		return { added, skipped };
	}
});

/**
 * First sign-in. Claims an `invited` record by proving both identities, then
 * sets the PIN. The two-factor requirement is what stops someone else claiming
 * an account from a guessable registration number alone.
 */
export const activate = mutation({
	args: { regNumber: v.string(), studentId: v.string(), pin: v.string() },
	handler: async (ctx, args) => {
		const regNorm = normalizeReg(args.regNumber);
		const idNorm = normalizeId(args.studentId);
		// Rate-limited on the reg number so one account cannot be probed
		// repeatedly with different student IDs.
		const limiter = await ctx.db
			.query('authAttempts')
			.withIndex('by_key', (q) => q.eq('key', `act:${regNorm}`))
			.unique();
		if (isBlocked(ctx, limiter)) {
			throw new Error('Too many attempts. Please wait 15 minutes and try again.');
		}

		const person = await ctx.db.query('people').withIndex('by_reg', (q) => q.eq('regNorm', regNorm)).unique();
		// One message for every failure: do not confirm which half was wrong,
		// or whether the registration number exists at all.
		const reject = async (message: string): Promise<never> => {
			await noteFailure(ctx, `act:${regNorm}`);
			throw new Error(message);
		};
		if (!person) return await reject('Those details do not match our records. Check them with your lecturer.');
		if (person.status === 'blocked') {
			throw new Error('Your access has been suspended. Please see your lecturer.');
		}
		if (person.status === 'active') return await reject('Those details do not match our records. Check them with your lecturer.');
		if (person.idNorm !== idNorm) {
			return await reject('Those details do not match our records. Check them with your lecturer.');
		}
		const pin = validatePin(args.pin);
		if (/^(\d)\1+$/.test(pin)) throw new Error('Choose a PIN that is not all the same digit.');
		const salt = randomSalt();
		const pinHash = await hashPin(pin, salt);
		await ctx.db.patch(person._id, {
			pinHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			// Legacy field from the retired "student shows a code" flow. Nothing
			// derives a code from it any more, but the column stays until the
			// deployment's documents are migrated away — see SECURITY.md.
			qrSecret: person.qrSecret ?? randomHex(20),
			status: 'active',
			activatedAt: Date.now()
		});
		await noteSuccess(ctx, `act:${regNorm}`);
		return { ok: true, fullName: person.fullName, regNumber: person.regNumber };
	}
});

/**
 * Sign-in for an already-activated person.
 *
 * The refusals a person can bring on themselves — details that do not match, an
 * account not set up yet, a suspended account, one already bound to another
 * phone — come back as `{ ok: false, message }` instead of being thrown. They
 * are ordinary events: somebody mistyped a PIN. Throwing recorded every one of
 * them as an uncaught server error, which buries the failures that are actually
 * faults (2026-10-06 logs: one mistyped PIN, logged as an error).
 *
 * Counting is deliberately unchanged: `refuse` still calls `noteFailure`, so the
 * lockout below — and the `authAttempts` trail behind it — behave exactly as
 * before. Only the way the answer travels back changed.
 */
export const login = mutation({
	args: { regNumber: v.string(), pin: v.string(), deviceId: v.string() },
	handler: async (ctx, args) => {
		const regNorm = normalizeReg(args.regNumber);
		if (!regNorm) return { ok: false as const, message: 'Enter your registration number.' };
		const limiter = await ctx.db
			.query('authAttempts')
			.withIndex('by_key', (q) => q.eq('key', `pin:${regNorm}`))
			.unique();
		if (isBlocked(ctx, limiter)) {
			return {
				ok: false as const,
				message:
					'Too many wrong attempts. Please wait 15 minutes or ask your class rep to reset your PIN.'
			};
		}

		/** A failed attempt: counted for the lockout, then answered rather than thrown. */
		const refuse = async (message: string) => {
			await noteFailure(ctx, `pin:${regNorm}`);
			return { ok: false as const, message };
		};

		const person = await ctx.db.query('people').withIndex('by_reg', (q) => q.eq('regNorm', regNorm)).unique();
		if (!person) return await refuse('That PIN is not right.');
		if (person.status === 'invited') {
			return { ok: false as const, message: 'Set up your PIN first — use “Set up your account”.' };
		}
		if (person.status === 'blocked') {
			return { ok: false as const, message: 'Your access has been suspended. Please see your lecturer.' };
		}

		const ok = await verifySecret(person as never, args.pin);
		if (!ok) return await refuse('That PIN is not right.');

		if (person.boundDeviceId && person.boundDeviceId !== args.deviceId) {
			return {
				ok: false as const,
				message:
					'This account is already set up on another phone. Ask your class rep or lecturer to move it to this one.'
			};
		}

		const existing = await ctx.db
			.query('authSessions')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.first();
		if (existing && existing.deviceId === args.deviceId && existing.expiresAt > Date.now()) {
			await ctx.db.patch(existing._id, { expiresAt: Date.now() + SESSION_TTL_MS });
			await ctx.db.patch(person._id, { lastLoginAt: Date.now() });
			await noteSuccess(ctx, `pin:${regNorm}`);
			return { ok: true as const, token: existing.token, fullName: person.fullName, role: person.role };
		}

		const token = randomHex(24);
		await ctx.db.insert('authSessions', {
			personId: person._id,
			token,
			deviceId: args.deviceId,
			createdAt: Date.now(),
			expiresAt: Date.now() + SESSION_TTL_MS
		});
		await ctx.db.patch(person._id, {
			boundDeviceId: args.deviceId,
			lastLoginAt: Date.now()
		});
		await noteSuccess(ctx, `pin:${regNorm}`);
		return { ok: true as const, token, fullName: person.fullName, role: person.role };
	}
});

/**
 * Students edit their own contact details. Identity fields (registration number
 * and student ID) are deliberately not accepted here — only staff may change those.
 */
export const updateMyDetails = mutation({
	args: { token: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()) },
	handler: async (ctx, args) => {
			const person = await requirePerson(ctx, args.token);
			const doc = await ctx.db.get('people', person._id);
			if (!doc) throw new Error('Account not found.');
			await ctx.db.patch(doc._id, {
				email: args.email?.trim() ?? '',
				phone: args.phone?.trim() ?? ''
			});
			return { ok: true };
		}
	});

/**
 * A student may correct a typo in their own name, but not their identifiers.
 * Keeping this narrow avoids the edit screen becoming an identity bypass.
 */
export const updateMyName = mutation({
	args: { token: v.string(), fullName: v.string() },
	handler: async (ctx, args) => {
			const person = await requirePerson(ctx, args.token);
			const fullName = args.fullName.trim();
			if (fullName.length < 2) throw new Error('Please enter your full name.');
			const doc = await ctx.db.get('people', person._id);
			if (!doc) throw new Error('Account not found.');
			await ctx.db.patch(doc._id, { fullName });
			return { ok: true };
		}
	});

/**
 * Staff reset a forgotten PIN. Clears the PIN and returns the person to
 * `invited` so they set a new one themselves — staff never see or choose it.
 */
export const resetPin = mutation({
	args: { token: v.string(), personId: v.id('people') },
	handler: async (ctx, args) => {
		await requireRecorder(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		const sessions = await ctx.db
			.query('authSessions')
			.withIndex('by_person', (q) => q.eq('personId', args.personId))
			.take(20);
		for (const s of sessions) await ctx.db.delete('authSessions', s._id);
		await ctx.db.patch(args.personId, {
					status: 'invited',
					pinHash: undefined,
					salt: undefined,
					scheme: undefined,
					iterations: undefined,
					boundDeviceId: undefined,
					lastLoginAt: undefined,
					// Dropping the QR secret stops the old phone showing valid codes even
					// if it is still open on someone's screen; activation mints a new one.
					qrSecret: undefined
				});
				return { ok: true };
			}
		});

		/**
		 * Moves an account to a new phone without wiping the PIN, for a student who
		 * lost their handset and still remembers their PIN.
		 *
		 * The QR secret is rotated. Deleting the sign-in token is not enough on its own:
		 * a page left open on the old phone keeps deriving codes in memory, and those
		 * codes would still verify. A fresh secret makes every code from the old handset
		 * fail immediately.
		 */
		export const clearDevice = mutation({
			args: { token: v.string(), personId: v.id('people') },
			handler: async (ctx, args) => {
				await requireRecorder(ctx, args.token);
				const person = await ctx.db.get('people', args.personId);
				if (!person) throw new Error('Person not found.');
				const sessions = await ctx.db
					.query('authSessions')
					.withIndex('by_person', (q) => q.eq('personId', args.personId))
					.take(20);
				for (const s of sessions) await ctx.db.delete('authSessions', s._id);
				await ctx.db.patch(args.personId, {
					boundDeviceId: undefined,
					lastLoginAt: undefined,
					qrSecret: randomHex(20)
				});
				return { ok: true };
			}
		});

/** Staff change a person's identifiers, role or classes. */
export const updatePerson = mutation({
	args: {
		token: v.string(),
		personId: v.id('people'),
		fullName: v.optional(v.string()),
		regNumber: v.optional(v.string()),
		studentId: v.optional(v.string()),
		/** The person's full class membership list; replaces whatever it was. */
		classIds: v.optional(v.array(v.id('classes'))),
		role: v.optional(v.union(v.literal('student'), v.literal('rep'))),
	},
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		const patch: Record<string, unknown> = {};
		if (args.fullName?.trim()) patch.fullName = args.fullName.trim();
		if (args.regNumber?.trim()) {
			const regNorm = normalizeReg(args.regNumber);
			if (!regNorm) throw new Error('Registration number is required.');
			const clash = await ctx.db
				.query('people')
				.withIndex('by_reg', (q) => q.eq('regNorm', regNorm))
				.unique();
			if (clash && clash._id !== args.personId) throw new Error('That registration number already exists.');
			patch.regNumber = args.regNumber.trim();
			patch.regNorm = regNorm;
		}
		if (args.studentId?.trim()) {
			patch.studentId = args.studentId.trim();
			patch.idNorm = normalizeId(args.studentId);
		}
		if (args.role) patch.role = args.role;
		if (Object.keys(patch).length > 0) await ctx.db.patch(args.personId, patch);
		if (args.classIds !== undefined) {
			await replaceMemberships(ctx, args.personId, args.classIds.map(String));
		}
		return { ok: true };
	}
});

export const setBlocked = mutation({
	args: { token: v.string(), personId: v.id('people'), blocked: v.boolean() },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const person = await ctx.db.get('people', args.personId);
		if (!person) throw new Error('Person not found.');
		if (args.blocked) {
			const sessions = await ctx.db
				.query('authSessions')
				.withIndex('by_person', (q) => q.eq('personId', args.personId))
				.take(20);
			for (const s of sessions) await ctx.db.delete('authSessions', s._id);
		}
		await ctx.db.patch(args.personId, { status: args.blocked ? 'blocked' : 'active' });
		return { ok: true };
	}
});

/** People list for staff screens, scoped to a class when given. */
export const listPeople = query({
	args: { token: v.string(), classId: v.optional(v.id('classes')), status: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireRecorder(ctx, args.token);
		let rows: any[];
		if (args.classId) {
			const memberships = await ctx.db
				.query('classMembers')
				.withIndex('by_class', (q: any) => q.eq('classId', args.classId!))
				.take(1000);
			rows = (await Promise.all(memberships.map((m: any) => ctx.db.get('people', m.personId)))).filter(
				Boolean
			);
		} else {
			rows = await ctx.db.query('people').take(1000);
		}
		const idsByPerson = new Map<string, string[]>();
		const memberships = await ctx.db.query('classMembers').take(2000);
		for (const m of memberships) {
			const key = String(m.personId);
			idsByPerson.set(key, [...(idsByPerson.get(key) ?? []), String(m.classId)]);
		}
		return rows
			.filter((p: any) => (args.status ? p.status === args.status : true))
			.map((p: any) => ({
				_id: p._id,
				role: p.role,
				fullName: p.fullName,
				regNumber: p.regNumber,
				studentId: p.studentId,
				status: p.status,
				classIds: idsByPerson.get(String(p._id)) ?? [],
				email: p.email ?? '',
				phone: p.phone ?? '',
				hasDevice: !!p.boundDeviceId,
			activatedAt: p.activatedAt ?? null
			}));
	}
});
