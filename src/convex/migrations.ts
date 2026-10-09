// One-shot data migrations.
//
// `npx convex dev` refuses to push a schema that existing documents fail to
// validate against, so making a field required is a three-step dance: widen the
// field to `v.optional(...)`, run the backfill here, then narrow it back. Every
// migration is internal-only and idempotent, so it can be left in place and
// re-run against any deployment that has not been backfilled yet.

import { internalMutation, mutation, query } from './_generated/server';
import { DEFAULT_STATION_RADIUS_M, DEFAULT_STATION_TOLERANCE_M } from './helpers';
import {
	DEFAULT_STAFF_USERNAME,
	ITERATIONS,
	SCHEME,
	hashSecret,
	normalizeUsername,
	randomSalt,
	requireAdmin
} from './auth';
import { v } from 'convex/values';

/**
 * Sessions opened before the QR station existed carry no `stationLat`,
 * `stationLng` or `stationRadiusM`. Backfill them from the lecture position,
 * which is exactly what `startSession` does when the rep pins no separate
 * station.
 *
 * The radius is the station default rather than the session's `radiusM`: the
 * lecture radius is a teaching convenience a rep may widen, and inheriting it
 * would leave a migrated station far more permissive than any real one.
 *
 * Drive it page by page — call with `cursor: null`, then feed the returned
 * `cursor` back in until `isDone` comes back true. Skipping a page loses those
 * documents until the next run, so keep going until it is done.
 */
export const backfillSessionStations = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query('sessions')
			.paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const session of page.page) {
			const missing =
				session.stationLat === undefined ||
				session.stationLng === undefined ||
				session.stationRadiusM === undefined;
			if (!missing) continue;
			await ctx.db.patch(session._id, {
				stationLat: session.lectureLat,
				stationLng: session.lectureLng,
				stationRadiusM: DEFAULT_STATION_RADIUS_M
			});
			patched += 1;
		}
		return {
			scanned: page.page.length,
			patched,
			cursor: page.continueCursor,
			isDone: page.isDone
		};
	}
});

// ---------------------------------------------------------------------------
// Class/Subject → Program/Course rename.
//
// Old tables (`classes`, `subjects`, `classMembers`, `classReps`) are retained
// as a backup and never read by app code; everything new lives in `programs`,
// `courses`, `programMembers`, `programReps`, plus the backfilled `programId`/
// `courseId`/`yearOfStudy` fields on offerings, meetings, sessions, attendance
// and enrolments. Runbook: back up the deployment, deploy this code, run
// `migrateToProgramsAndCourses` (admin console button or CLI) until
// `overallDone`, then compare `renameStatus` counts. Dropping the old tables
// is a follow-up schema edit once counts check out.
//
// Every phase is idempotent: entities match by natural key (name/code,
// person+program, offering tuple), field backfills overwrite identical
// values. Calls process one page per phase; repeat with the returned cursor
// until `overallDone` is true.

const RENAME_PHASES = [
	'programs',
	'courses',
	'offerings',
	'members',
	'reps',
	'meetings',
	'sessions',
	'attendance',
	'enrolments',
	'done'
] as const;

async function programCourseMaps(ctx: any): Promise<{
	courseByCode: Map<string, any>;
	programByName: Map<string, any>;
	classToProgram: Map<string, any>;
	offeringInfo: Map<string, { courseId: unknown; programId: unknown }>;
}> {
	const courseByCode = new Map<string, any>();
	for (const c of await ctx.db.query('courses').take(2000)) courseByCode.set(c.code, c);
	const programByName = new Map<string, any>();
	for (const p of await ctx.db.query('programs').take(500)) programByName.set(p.name, p);
	const classToProgram = new Map<string, any>();
	for (const c of await ctx.db.query('classes').take(500)) {
		const p = programByName.get(c.name);
		if (p) classToProgram.set(String(c._id), p);
	}
	const offeringInfo = new Map<string, { courseId: unknown; programId: unknown }>();
	for (const o of (await ctx.db.query('offerings').take(2000)) as any[]) {
		if (o.courseId && o.programId) {
			offeringInfo.set(String(o._id), { courseId: o.courseId, programId: o.programId });
		}
	}
	return { courseByCode, programByName, classToProgram, offeringInfo };
}

export const migrateToProgramsAndCourses = mutation({
	args: {
		token: v.string(),
		phase: v.optional(v.string()),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const phase = args.phase && (RENAME_PHASES as readonly string[]).includes(args.phase) ? args.phase : 'programs';
		const cursor = args.cursor ?? null;
		const PAGE = 200;

		if (phase === 'programs') {
			const page = await ctx.db.query('classes').paginate({ cursor, numItems: PAGE });
			let created = 0;
			for (const c of page.page as any[]) {
				const existing = await ctx.db
					.query('programs')
					.withIndex('by_name', (q: any) => q.eq('name', c.name))
					.unique();
				const duration = Math.min(10, Math.max(1, c.yearOfStudy ?? 1));
				if (existing) {
					if ((existing.durationYears ?? 0) < duration) {
						await ctx.db.patch(existing._id, { durationYears: duration });
					}
				} else {
					await ctx.db.insert('programs', { name: c.name, durationYears: duration, createdAt: Date.now() });
					created += 1;
				}
			}
			if (page.isDone) return { phase, phaseDone: true, created, next: { phase: 'courses', cursor: null } };
			return { phase, phaseDone: false, created, next: { phase, cursor: page.continueCursor } };
		}

		if (phase === 'courses') {
			const page = await ctx.db.query('subjects').paginate({ cursor, numItems: PAGE });
			const { courseByCode } = await programCourseMaps(ctx);
			let created = 0;
			for (const s of page.page as any[]) {
				if (courseByCode.has(s.code)) continue;
				await ctx.db.insert('courses', {
					code: s.code,
					title: s.title,
					openForEnrolment: s.openForEnrolment ?? false,
					...(s.hoursPerWeek !== undefined ? { hoursPerWeek: s.hoursPerWeek } : {}),
					createdAt: Date.now()
				});
				courseByCode.set(s.code, true);
				created += 1;
			}
			if (page.isDone) return { phase, phaseDone: true, created, next: { phase: 'offerings', cursor: null } };
			return { phase, phaseDone: false, created, next: { phase, cursor: page.continueCursor } };
		}

		if (phase === 'offerings') {
			const page = await ctx.db.query('offerings').paginate({ cursor, numItems: PAGE });
			const { courseByCode, classToProgram } = await programCourseMaps(ctx);
			const subjects = new Map<string, any>();
			for (const s of await ctx.db.query('subjects').take(2000)) subjects.set(String(s._id), s);
			const classes = new Map<string, any>();
			for (const c of await ctx.db.query('classes').take(500)) classes.set(String(c._id), c);
			let patched = 0;
			let skipped = 0;
			for (const o of page.page as any[]) {
				if (o.courseId && o.programId && o.yearOfStudy !== undefined) continue;
				const subject = o.subjectId ? subjects.get(String(o.subjectId)) : null;
				const cls = o.classId ? classes.get(String(o.classId)) : null;
				const course = subject ? courseByCode.get(subject.code) : null;
				const program = cls ? classToProgram.get(String(cls._id)) : null;
				if (!course || !program) {
					skipped += 1;
					continue;
				}
				await ctx.db.patch(o._id, {
					courseId: course._id ?? course,
					programId: program._id ?? program,
					yearOfStudy: Math.min(10, Math.max(1, cls?.yearOfStudy ?? 1))
				});
				patched += 1;
			}
			if (page.isDone)
				return { phase, phaseDone: true, patched, skipped, next: { phase: 'members', cursor: null } };
			return { phase, phaseDone: false, patched, skipped, next: { phase, cursor: page.continueCursor } };
		}

		if (phase === 'members' || phase === 'reps') {
			const oldTable = phase === 'members' ? 'classMembers' : 'classReps';
			const newTable = phase === 'members' ? 'programMembers' : 'programReps';
			const page = await ctx.db.query(oldTable as never).paginate({ cursor, numItems: PAGE });
			const { classToProgram } = await programCourseMaps(ctx);
			let created = 0;
			let skipped = 0;
			for (const m of page.page as any[]) {
				const program = classToProgram.get(String(m.classId));
				if (!program) {
					skipped += 1;
					continue;
				}
				const programId = program._id ?? program;
				const existing = await ctx.db
					.query(newTable as never)
					.withIndex('by_person', (q: any) => q.eq('personId', m.personId))
					.take(100);
				if ((existing as any[]).some((r: any) => String(r.programId) === String(programId))) continue;
				await ctx.db.insert(newTable as never, {
					personId: m.personId,
					programId,
					createdAt: Date.now()
				} as never);
				created += 1;
			}
			if (page.isDone)
				return {
					phase,
					phaseDone: true,
					created,
					skipped,
					next: { phase: phase === 'members' ? 'reps' : 'meetings', cursor: null }
				};
			return { phase, phaseDone: false, created, skipped, next: { phase, cursor: page.continueCursor } };
		}

		if (phase === 'meetings' || phase === 'sessions' || phase === 'attendance' || phase === 'enrolments') {
		 const table = phase as 'meetings' | 'sessions' | 'attendance' | 'enrolments';
			const page = await ctx.db.query(table).paginate({ cursor, numItems: PAGE });
			const { offeringInfo } = await programCourseMaps(ctx);
			const subjects = new Map<string, any>();
			for (const s of await ctx.db.query('subjects').take(2000)) subjects.set(String(s._id), s);
			const { courseByCode } = await programCourseMaps(ctx);
			let patched = 0;
			for (const d of page.page as any[]) {
				const patch: Record<string, unknown> = {};
				const info = d.offeringId ? offeringInfo.get(String(d.offeringId)) : null;
				const courseFromSubject = d.subjectId
					? (() => {
							const s = subjects.get(String(d.subjectId));
							return s ? courseByCode.get(s.code) : null;
						})()
					: null;
				if (phase !== 'attendance' && phase !== 'meetings') {
					// sessions + enrolments carry programId too.
					const programId = info?.programId;
					if (programId && d.programId === undefined) patch.programId = programId;
				}
				const courseId = info?.courseId ?? (courseFromSubject ? (courseFromSubject._id ?? courseFromSubject) : null);
				if (courseId && d.courseId === undefined) patch.courseId = courseId;
				if (Object.keys(patch).length > 0) {
					await ctx.db.patch(d._id, patch);
					patched += 1;
				}
			}
			const order = ['meetings', 'sessions', 'attendance', 'enrolments', 'done'] as const;
			const nextPhase = order[order.indexOf(phase as (typeof order)[number]) + 1];
			if (page.isDone) return { phase, phaseDone: true, patched, next: { phase: nextPhase, cursor: null } };
			return { phase, phaseDone: false, patched, next: { phase, cursor: page.continueCursor } };
		}

		return { phase: 'done', phaseDone: true, next: null, overallDone: true };
	}
});

/** Migration progress: old vs new counts so the admin can verify the move. */
export const renameStatus = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx, args.token);
		const classes = await ctx.db.query('classes').take(500);
		const subjects = await ctx.db.query('subjects').take(2000);
		const programs = await ctx.db.query('programs').take(500);
		const courses = await ctx.db.query('courses').take(2000);
		const offerings = (await ctx.db.query('offerings').take(2000)) as any[];
		const members = await ctx.db.query('classMembers').take(2000);
		const programMembers = await ctx.db.query('programMembers').take(2000);
		const reps = await ctx.db.query('classReps').take(500);
		const programReps = await ctx.db.query('programReps').take(500);
		const migratedOfferings = offerings.filter((o) => o.courseId && o.programId).length;
		return {
			classes: classes.length,
			subjects: subjects.length,
			programs: programs.length,
			courses: courses.length,
			offeringsTotal: offerings.length,
			offeringsMigrated: migratedOfferings,
			offeringsTruncated: offerings.length >= 2000,
			membersOld: members.length,
			membersNew: programMembers.length,
			membersTruncated: members.length >= 2000 || programMembers.length >= 2000,
			repsOld: reps.length,
			repsNew: programReps.length,
			needsMigration:
				(classes.length > 0 || subjects.length > 0) && (programs.length === 0 || courses.length === 0)
		};
	}
});

/**
 * Staff rows created before roles existed have no `role`. The default account
 * becomes the admin, everyone else becomes a lecturer. Idempotent.
 */
export const backfillStaffRoles = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db.query('staff').paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const s of page.page as any[]) {
			if (s.role === 'admin' || s.role === 'lecturer') continue;
			const role =
				s.usernameNorm === normalizeUsername(DEFAULT_STAFF_USERNAME) ? ('admin' as const) : ('lecturer' as const);
			await ctx.db.patch(s._id, { role });
			patched += 1;
		}
		return { scanned: page.page.length, patched, cursor: page.continueCursor, isDone: page.isDone };
	}
});

/**
 * Break-glass admin recovery. If every admin password is lost, run from a
 * shell with deployment credentials (never from app code — internal-only):
 *
 *   npx convex run migrations:resetStaffPassword '{"username":"admin","newPassword":"..."}'
 *
 * Signs the account out everywhere and forces a password change at next
 * sign-in. Prefer keeping two active admins so this is never needed.
 */
export const resetStaffPassword = internalMutation({
	args: { username: v.string(), newPassword: v.string() },
	handler: async (ctx, args) => {
		const usernameNorm = normalizeUsername(args.username);
		if (args.newPassword.length < 8) throw new Error('Choose a password of at least 8 characters.');
		const staff = await ctx.db
			.query('staff')
			.withIndex('by_username', (q) => q.eq('usernameNorm', usernameNorm))
			.unique();
		if (!staff) throw new Error('Account not found.');
		const sessions = await ctx.db
			.query('staffSessions')
			.withIndex('by_staff', (q) => q.eq('staffId', staff._id))
			.take(50);
		for (const s of sessions) await ctx.db.delete('staffSessions', s._id);
		const salt = randomSalt();
		const passwordHash = await hashSecret(args.newPassword, salt);
		await ctx.db.patch(staff._id, {
			passwordHash,
			salt,
			scheme: SCHEME,
			iterations: ITERATIONS,
			mustChangePassword: true,
			active: true
		});
		return { ok: true, username: staff.username };
	}
});

/**
 * Drops the retired `subjects.lecturerId` column. Superseded by
 * `migrateToProgramsAndCourses`, which leaves `subjects` behind entirely;
 * kept for deployments that only need this column gone. Idempotent.
 */
export const backfillSubjectsDropLecturer = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db.query('subjects').paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const s of page.page as any[]) {
			if (s.lecturerId === undefined) continue;
			await ctx.db.patch(s._id, { lecturerId: undefined });
			patched += 1;
		}
		return { scanned: page.page.length, patched, cursor: page.continueCursor, isDone: page.isDone };
	}
});

/**
 * Sessions opened before the station-placement check carry no
 * `stationToleranceM`, no last-seen position and no moved flag.
 *
 * All of those are optional and all of them degrade safely on their own — a
 * missing tolerance falls back to the student radius, and a missing moved flag
 * reads as "not moved" — so this backfill exists to make those sessions behave
 * like fresh ones rather than to fix anything broken.
 *
 * The tolerance comes from the station default and not from the session's
 * `radiusM`: as with the station fields above, inheriting a teaching radius
 * would leave a migrated session far more permissive than any new one.
 */
export const backfillStationPlacement = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query('sessions')
			.paginate({ cursor: args.cursor ?? null, numItems: 100 });
		let patched = 0;
		for (const session of page.page) {
			if (session.stationToleranceM !== undefined) continue;
			await ctx.db.patch(session._id, {
				stationToleranceM: DEFAULT_STATION_TOLERANCE_M,
				// Never block a session on a reading taken before this feature
				// existed: there is no evidence it ever moved.
				stationMoved: false,
				stationUnverified: false
			});
			patched += 1;
		}
		return {
			scanned: page.page.length,
			patched,
			cursor: page.continueCursor,
			isDone: page.isDone
		};
	}
});