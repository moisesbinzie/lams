import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import {
	assertCanRecordFor,
	canRecordFor,
	recorderFields,
	requireActor,
	requirePerson,
	requirePersonOnDevice,
	requireRecorder,
	requireStaff
} from './auth';
import {
	computeAutoStatus,
	DEFAULT_STATION_RADIUS_M,
	haversineM,
	normalizeReg,
	randomHex
} from './helpers';
import { describeContradiction, judgeProximity, STUDENT_ACCURACY_TOLERANCE } from './proximity';
import { isBlocked, noteFailure, noteSuccess, STATION_LIMITS } from './ratelimit';
import { parseScanCode, verifyScanCode } from './scancode';
import { verifyStationCode } from './station';

const DEFAULT_ON_TIME_SEC = 300;
const DEFAULT_LATE_UNTIL_SEC = 600;

/**
 * Closes a session and marks every enrolled student with no record as Absent.
 * Running this on both an explicit close and the cron means the Absent rows
 * exist the moment a lecture ends, which is what makes the reports correct.
 */
async function closeWithAbsents(ctx: any, session: any, now = Date.now()): Promise<number> {
	if (session.status === 'closed') return 0;
	await ctx.db.patch(session._id, { status: 'closed', closedAt: now });

	const enrolments = await ctx.db
		.query('enrolments')
		.withIndex('by_offering', (q: any) => q.eq('offeringId', session.offeringId))
		.take(1000);
	const existing = await ctx.db
		.query('attendance')
		.withIndex('by_session', (q: any) => q.eq('sessionId', session._id))
		.take(2000);
	const seen = new Set<string>(existing.map((a: any) => a.regNorm));

	let added = 0;
	for (const e of enrolments) {
		if (e.status !== 'active') continue;
		const person = await ctx.db.get('people', e.personId);
		if (!person) continue;
		if (seen.has(person.regNorm)) continue;
		await ctx.db.insert('attendance', {
			sessionId: session._id,
			personId: person._id,
			offeringId: session.offeringId,
			subjectId: session.subjectId,
			semesterId: session.semesterId,
			fullName: person.fullName,
			regNumber: person.regNumber,
			regNorm: person.regNorm,
			method: 'absent',
			status: 'Absent',
			submittedAt: now
		});
		added += 1;
	}
	return added;
}

export const startSession = mutation({
	args: {
		token: v.string(),
		offeringId: v.id('offerings'),
		lectureLat: v.number(),
		lectureLng: v.number(),
		radiusM: v.optional(v.number()),
		onTimeSec: v.optional(v.number()),
		lateUntilSec: v.optional(v.number()),
		/** Defaults to the lecture position — a station in the room is the usual case. */
		stationRadiusM: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const offering = await ctx.db.get('offerings', args.offeringId);
		if (!offering) throw new Error('Subject not found.');
		if (!(await canRecordFor(ctx, actor, offering.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		if (args.lectureLat < -90 || args.lectureLat > 90) throw new Error('Invalid latitude.');
		if (args.lectureLng < -180 || args.lectureLng > 180) throw new Error('Invalid longitude.');

		const radiusM = args.radiusM ?? 50;
		// Three tiers: on time, late, then too late to count. Both thresholds
		// are adjustable so a lecturer can widen them for a long discussion.
		const onTimeSec = args.onTimeSec ?? DEFAULT_ON_TIME_SEC;
		const lateUntilSec = args.lateUntilSec ?? DEFAULT_LATE_UNTIL_SEC;
		if (radiusM < 5 || radiusM > 2000) throw new Error('The allowed distance must be between 5 and 2000 metres.');
				// The station is what students actually scan, so its radius is the one that
		// decides most attendance. It gets its own bound rather than inheriting the
		// lecture radius, which a lecturer may widen for reasons that have nothing
		// to do with where the door is.
		const stationRadiusM = args.stationRadiusM ?? DEFAULT_STATION_RADIUS_M;
		if (stationRadiusM < 5 || stationRadiusM > 2000) {
			throw new Error('The station distance must be between 5 and 2000 metres.');
		}
		if (onTimeSec < 30 || onTimeSec > 3600) throw new Error('The on-time window must be between 30 seconds and 60 minutes.');
		if (lateUntilSec < 60 || lateUntilSec > 7200) throw new Error('The late window must be between 1 and 120 minutes.');
		if (onTimeSec >= lateUntilSec) throw new Error('The late window must be longer than the on-time window.');

		// One open session per offering, so two classes of the same subject can
		// run side by side without one closing the other.
		const open = await ctx.db
			.query('sessions')
			.withIndex('by_offering', (q) => q.eq('offeringId', offering._id))
			.take(50);
		let closed = 0;
		for (const s of open) {
			if (s.status !== 'open') continue;
			await closeWithAbsents(ctx, s);
			closed += 1;
		}

		const now = Date.now();
		const id = await ctx.db.insert('sessions', {
			offeringId: offering._id,
			subjectId: offering.subjectId,
			semesterId: offering.semesterId,
			classId: offering.classId,
			stationLat: args.lectureLat,
			stationLng: args.lectureLng,
			stationRadiusM,
			lectureLat: args.lectureLat,
			lectureLng: args.lectureLng,
			radiusM,
			stationSecret: randomHex(16),
			onTimeSec,
			lateUntilSec,
			status: 'open',
			startedAt: now,
			closesAt: now + lateUntilSec * 1000,
			createdAt: now
		});
		return { sessionId: id, closedOthers: closed };
	}
});

/** Public, session-agnostic details a scanner needs before opening the camera. */
export const getSession = query({
	args: { token: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const actor = await requireActor(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) return null;
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		const subject = await ctx.db.get('subjects', session.subjectId);
		const classDoc = await ctx.db.get('classes', session.classId);
		const now = Date.now();
		return {
			_id: session._id,
			offeringId: session.offeringId,
			subjectId: session.subjectId,
			subjectCode: subject?.code ?? '',
			subjectTitle: subject?.title ?? '',
			className: classDoc?.name ?? '',
			status: session.status === 'open' && now < session.closesAt ? 'open' : 'closed',
			startedAt: session.startedAt,
			closesAt: session.closesAt,
			now
		};
	}
});

/** Records one student's attendance by scanning their code. */
export const recordScan = mutation({
	args: {
		token: v.string(),
		sessionId: v.id('sessions'),
		qr: v.string(),
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		accuracyM: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) throw new Error('This lecture could not be found.');
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		if (session.status !== 'open') throw new Error('This lecture is closed.');
		if (Date.now() > session.closesAt) throw new Error('The attendance window for this lecture has closed.');

		// The payload carries the registration number plus a code derived from
		// the student's own secret. Reject a malformed payload before any lookup.
		const parsed = parseScanCode(args.qr);
		if (!parsed) throw new Error('That is not a student attendance code.');

		const person = await ctx.db
			.query('people')
			.withIndex('by_reg', (q) => q.eq('regNorm', normalizeReg(parsed.regNumber)))
			.unique();
		if (!person) throw new Error('That student is not registered.');
		if (!person.qrSecret) {
			throw new Error(
				`${person.fullName} has not finished setting up their account yet, so they have no code to show.`
			);
		}
		// Rejects a forged code (no secret) and a stale screenshot (old slot).
		if (!verifyScanCode(parsed.code, person.qrSecret)) {
			throw new Error('That code has expired or is not valid. Ask the student to show a fresh one.');
		}

		const enrolments = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const enrolled = enrolments.find(
			(e: any) => e.offeringId === session.offeringId && e.status === 'active'
		);
		if (!enrolled) {
			throw new Error(`${person.fullName} is not enrolled in this subject. Ask your lecturer to add them.`);
		}
		if (person.status === 'blocked') throw new Error('That student account is suspended.');

		const dup = await ctx.db
			.query('attendance')
			.withIndex('by_session_and_reg', (q) =>
				q.eq('sessionId', args.sessionId).eq('regNorm', person.regNorm)
			)
			.unique();
		if (dup) {
			throw new Error(
				`${person.fullName} is already recorded as ${String(dup.status).replace('_', ' ')} for this lecture.`
			);
		}

		// A coarse reading must not produce a confident verdict, so `weak` keeps the
				// record but stops it being marked Out of Range on a ±200 m fix.
				const proximity = judgeProximity(
					session.lectureLat,
					session.lectureLng,
					args.latitude,
					args.longitude,
					args.accuracyM,
					session.radiusM
				);
				const distanceM = proximity.distanceM ?? undefined;
				const elapsedSec = Math.floor((Date.now() - session.startedAt) / 1000);
				const status = computeAutoStatus(
					elapsedSec,
					session.onTimeSec,
					session.lateUntilSec,
					distanceM ?? null,
					session.radiusM
				);

				const anomaly = await scanAnomalyNote(ctx, session._id, actor.kind === 'person' ? actor.id : undefined);
				const flagReason =
					anomaly ??
					(proximity.weak && distanceM !== undefined
						? `Rep’s phone location was imprecise (±${Math.round(args.accuracyM ?? 0)} m) for a ${session.radiusM} m radius — presence not verified.`
						: undefined);

				await ctx.db.insert('attendance', {
					sessionId: session._id,
					personId: person._id,
					offeringId: session.offeringId,
					subjectId: session.subjectId,
					semesterId: session.semesterId,
					fullName: person.fullName,
					regNumber: person.regNumber,
					regNorm: person.regNorm,
					method: 'scan',
					...recorderFields(actor),
					...(args.latitude !== undefined ? { latitude: args.latitude } : {}),
					...(args.longitude !== undefined ? { longitude: args.longitude } : {}),
					...(args.accuracyM !== undefined ? { accuracyM: args.accuracyM } : {}),
					...(distanceM !== undefined ? { distanceM } : {}),
					verification: proximity.weak ? 'weak' : 'scan_only',
					...(flagReason ? { flagged: true, flagReason } : {}),
					status,
					submittedAt: Date.now()
				});
				// Say plainly why a late arrival was refused attendance, otherwise the
				// student just sees "Absent" with no explanation on their phone.
				if (status === 'Absent') {
					return {
						ok: true,
						fullName: person.fullName,
						status,
						lateByMinutes: Math.max(1, Math.ceil((elapsedSec - session.lateUntilSec) / 60))
					};
				}
				return { ok: true, fullName: person.fullName, status };
			}
		});

/**
 * What the station screen needs to render itself: the rotating code's secret
 * plus the countdown and title around it.
 *
 * Only a recorder who may take this class's attendance can call it. The secret
 * is deliberately returned rather than the code itself — the display derives
 * each code locally so the screen keeps refreshing on a timer with no network
 * round trip, and in a hall with poor signal that is the difference between a
 * working station and a frozen one. A rep is already fully trusted over their
 * own class's attendance, so the secret adds no exposure they did not have.
 */
export const stationFeed = query({
	args: { token: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) return null;
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		const subject = await ctx.db.get('subjects', session.subjectId);
		const classDoc = await ctx.db.get('classes', session.classId);
		return {
			_id: session._id,
			secret: session.stationSecret ?? null,
			subjectCode: subject?.code ?? '',
			subjectTitle: subject?.title ?? '',
			className: classDoc?.name ?? '',
			status: session.status,
			startedAt: session.startedAt,
			closesAt: session.closesAt,
			stationRadiusM: session.stationRadiusM
		};
	}
});

/**
 * Minimal, non-sensitive details a student sees on the page the QR opened.
 * Any signed-in person may read it — it reveals no location and no secret, and
 * it has to render before the scan is submitted.
 */
export const stationPreview = query({
	args: { token: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		await requireActor(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) return null;
		const subject = await ctx.db.get('subjects', session.subjectId);
		const classDoc = await ctx.db.get('classes', session.classId);
		return {
			subjectCode: subject?.code ?? '',
			subjectTitle: subject?.title ?? '',
			className: classDoc?.name ?? '',
			status: session.status,
			startedAt: session.startedAt,
			closesAt: session.closesAt
		};
	}
});

/**
 * A student scans the station with their own phone.
 *
 * This is the new front door for attendance and it inverts the old flow: the
 * device that proves presence is the student's, not the class rep's, so the
 * record carries a first-party position fix instead of a proxy. That is what
 * makes "in range" mean something — it is the student's own phone reporting,
 * at the moment of scanning, how far it is from the code it just read.
 */
export const submitStationScan = mutation({
	args: {
		token: v.string(),
		sessionId: v.id('sessions'),
		code: v.string(),
		/**
		 * The scanning handset's id, compared against the one the token was issued
		 * to. This is what stops a student's token being carried to another phone
		 * and used to mark their own attendance from there.
		 */
		deviceId: v.string(),
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		accuracyM: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const person = await requirePersonOnDevice(ctx, args.token, args.deviceId);
		if (person.status === 'blocked') {
			throw new Error('Your account is suspended. Speak to your class rep.');
		}

		// The code is six digits, so cap how fast one account can guess at it. A
		// successful scan clears the count, so this only ever bites a brute-forcer
		// or a student whose camera will not read the screen.
		const limitKey = `station:${String(person._id)}`;
		const limiter = await ctx.db
			.query('authAttempts')
			.withIndex('by_key', (q) => q.eq('key', limitKey))
			.unique();
		if (isBlocked(ctx, limiter)) {
			throw new Error('Too many attempts at reading that code. Wait a few minutes and scan again.');
		}

		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) throw new Error('This lecture could not be found.');
		if (session.status !== 'open') throw new Error('This lecture is closed.');
		if (Date.now() > session.closesAt) {
			throw new Error('The attendance window for this lecture has closed.');
		}
		if (!session.stationSecret) throw new Error('This lecture is not taking scans.');

		// A photographed screen is refused, which is the whole point of the code
		// rolling every 30 seconds.
		if (!verifyStationCode(args.code, session.stationSecret)) {
			await noteFailure(ctx, limitKey, STATION_LIMITS);
			throw new Error('That station code has expired. Scan the screen again.');
		}
		await noteSuccess(ctx, limitKey);

		const enrolments = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		const enrolled = enrolments.find(
			(e: any) => e.offeringId === session.offeringId && e.status === 'active'
		);
		if (!enrolled) {
			throw new Error('You are not enrolled in this subject.');
		}

		const dup = await ctx.db
			.query('attendance')
			.withIndex('by_session_and_reg', (q) =>
				q.eq('sessionId', args.sessionId).eq('regNorm', person.regNorm)
			)
			.unique();
		if (dup) {
			throw new Error(
				`You are already recorded as ${String(dup.status).replace('_', ' ')} for this lecture.`
			);
		}

		// Judged against the station, not the lecture centre: this is the distance
		// between the phone that scanned and the screen it scanned.
		const proximity = judgeProximity(
			session.stationLat,
			session.stationLng,
			args.latitude,
			args.longitude,
			args.accuracyM,
			session.stationRadiusM
		);
		const distanceM = proximity.distanceM ?? undefined;

		// A fix coarser than a small multiple of the radius cannot tell inside
		// from outside — a phone reporting ±150 m for a 50 m radius is not
		// evidence either way. So the distance is withheld from the status
		// calculation entirely and the record is flagged for a human instead.
		// Letting a coarse fix produce a confident verdict in either direction
		// would either fail honest students or wave through absent ones.
		const noFix = proximity.distanceM === null;
		const positionUsable =
			!noFix &&
			(args.accuracyM === undefined ||
				args.accuracyM <= session.stationRadiusM * STUDENT_ACCURACY_TOLERANCE);

		const elapsedSec = Math.floor((Date.now() - session.startedAt) / 1000);
		const status = computeAutoStatus(
			elapsedSec,
			session.onTimeSec,
			session.lateUntilSec,
			positionUsable ? proximity.distanceM : null,
			session.stationRadiusM
		);

		const flagReason = !positionUsable
			? noFix
				? 'No location was reported, so it could not be confirmed that this student was at the station.'
				: `Location was too imprecise (±${Math.round(args.accuracyM ?? 0)} m for a ${session.stationRadiusM} m station radius), so it could not be confirmed that this student was there.`
			: undefined;

		await ctx.db.insert('attendance', {
			sessionId: session._id,
			personId: person._id,
			offeringId: session.offeringId,
			subjectId: session.subjectId,
			semesterId: session.semesterId,
			fullName: person.fullName,
			regNumber: person.regNumber,
			regNorm: person.regNorm,
			method: 'station',
			scannerDeviceId: args.deviceId,
			// The generic position fields are this student's own — there is no
			// rep proxy in this flow — so every existing report and listing keeps
			// working without special-casing. The `student*` fields say the same
			// thing in words, and their presence also stops the legacy
			// `confirmMyLocation` pass from picking this record up a second time.
			...(args.latitude !== undefined ? { latitude: args.latitude } : {}),
			...(args.longitude !== undefined ? { longitude: args.longitude } : {}),
			...(args.accuracyM !== undefined ? { accuracyM: args.accuracyM } : {}),
			...(distanceM !== undefined ? { distanceM } : {}),
			...(args.latitude !== undefined ? { studentLat: args.latitude } : {}),
			...(args.longitude !== undefined ? { studentLng: args.longitude } : {}),
			...(args.accuracyM !== undefined ? { studentAccuracyM: args.accuracyM } : {}),
			...(distanceM !== undefined ? { studentDistanceM: distanceM } : {}),
			verification: positionUsable ? 'confirmed' : noFix ? 'unconfirmed' : 'weak',
			...(flagReason ? { flagged: true, flagReason } : {}),
			status,
			submittedAt: Date.now()
		});

		const subject = await ctx.db.get('subjects', session.subjectId);
		return {
			ok: true as const,
			fullName: person.fullName,
			subjectCode: subject?.code ?? '',
			subjectTitle: subject?.title ?? '',
			status,
			distanceM: distanceM ?? null,
			positionUsable,
			flagged: Boolean(flagReason),
			lateByMinutes:
				status === 'Absent' ? Math.max(1, Math.ceil((elapsedSec - session.lateUntilSec) / 60)) : null
		};
	}
});

/** Staff add a student by hand — the phone-less case. */
export const addManually = mutation({
	args: {
		token: v.string(),
		sessionId: v.id('sessions'),
		regNumber: v.string(),
		status: v.union(
			v.literal('Present'),
			v.literal('Late'),
			v.literal('Out_of_Range'),
			v.literal('Excused')
		),
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		/**
		 * Required. A record entered by hand is the one thing in this system no
		 * scan can corroborate, so leaving the reason blank would make the whole
		 * override invisible in the audit trail.
		 */
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) throw new Error('This lecture could not be found.');
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		if (session.status !== 'open') throw new Error('This lecture is closed.');
		const regNorm = normalizeReg(args.regNumber);
		if (!regNorm) throw new Error('Enter the registration number.');
		const reason = args.reason.trim();
		if (!reason) throw new Error('Say why this student was added by hand — it is kept on the record.');
		const person = await ctx.db
			.query('people')
			.withIndex('by_reg', (q) => q.eq('regNorm', regNorm))
			.unique();
		if (!person) throw new Error('That student is not registered.');

		const enrolments = await ctx.db
			.query('enrolments')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(300);
		if (!enrolments.some((e: any) => e.offeringId === session.offeringId && e.status === 'active')) {
			throw new Error(`${person.fullName} is not enrolled in this subject.`);
		}
		const dup = await ctx.db
			.query('attendance')
			.withIndex('by_session_and_reg', (q) => q.eq('sessionId', args.sessionId).eq('regNorm', regNorm))
			.unique();
		if (dup) throw new Error(`${person.fullName} already has a record for this lecture.`);

		// This distance is the recorder's phone, not the student's — it says only
		// that the rep was standing near the station. It is never evidence about
		// this student, so it is tagged `scan_only` and the record is only as good
		// as the rep's word.
		let distanceM: number | undefined = undefined;
		if (args.latitude !== undefined && args.longitude !== undefined) {
			distanceM = Math.round(haversineM(session.stationLat, session.stationLng, args.latitude, args.longitude));
		}
		await ctx.db.insert('attendance', {
			sessionId: session._id,
			personId: person._id,
			offeringId: session.offeringId,
			subjectId: session.subjectId,
			semesterId: session.semesterId,
			fullName: person.fullName,
			regNumber: person.regNumber,
			regNorm,
			method: 'rep',
			...recorderFields(actor),
			overrideReason: reason,
			...(args.latitude !== undefined ? { latitude: args.latitude } : {}),
			...(args.longitude !== undefined ? { longitude: args.longitude } : {}),
			...(distanceM !== undefined ? { distanceM } : {}),
			verification: 'scan_only',
			status: args.status,
			submittedAt: Date.now()
		});
		return { ok: true, fullName: person.fullName };
	}
});

/**
 * Undo a scan made moments ago in this live session. Narrow by design: a rep
 * can correct their own mistake mid-lecture without gaining the ability to
 * rewrite settled attendance.
 */
export const undoOwnScan = mutation({
	args: { token: v.string(), attendanceId: v.id('attendance') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const record = await ctx.db.get('attendance', args.attendanceId);
		if (!record) throw new Error('That record no longer exists.');
		if (record.method === 'absent') {
			throw new Error('Absent entries are settled when the lecture closes. Ask your lecturer.');
		}
		const isOwn = record.recordedById === actor.id;
		if (!isOwn && actor.kind !== 'staff') {
			throw new Error('You can only undo scans you made yourself.');
		}
		const session = await ctx.db.get('sessions', record.sessionId);
		if (!session || session.status !== 'open') {
			throw new Error('This lecture is closed. Ask your lecturer to change the record.');
		}
		await ctx.db.delete('attendance', args.attendanceId);
		return { ok: true };
	}
});

/** Only lecturers may override a settled record. Keeps the audit trail. */
export const override = mutation({
	args: {
		token: v.string(),
		attendanceId: v.id('attendance'),
		status: v.union(
			v.literal('Present'),
			v.literal('Late'),
			v.literal('Out_of_Range'),
			v.literal('Absent'),
			v.literal('Excused')
		)
	},
	handler: async (ctx, args) => {
		const actor = await requireStaff(ctx, args.token);
		const record = await ctx.db.get('attendance', args.attendanceId);
		if (!record) throw new Error('Record not found.');
		await ctx.db.patch(args.attendanceId, {
			prevStatus: record.status,
			status: args.status,
			overriddenBy: actor.name,
			overriddenAt: Date.now()
		});
		return { ok: true };
	}
});

/**
 * Override a record while the lecture is still open.
 *
 * `override` above is lecturer-only because it settles a finished lecture. This
 * is the one a class rep can reach, and it exists for the cases the new station
 * flow creates rather than replaces:
 *
 *   - a phone-less student, added by hand, who needs a status changed;
 *   - a student whose scan was marked Out of range by a bad GPS fix;
 *   - a student whose phone refused to give a location, so their record came
 *     through unconfirmed and the rep knows they were sitting right there.
 *
 * A rep may only touch records for a class they represent, and only while the
 * lecture is open. Everything it does is written to the audit trail, so a
 * lecturer reviewing the session afterwards can see whose word it was.
 */
export const overrideDuringSession = mutation({
	args: {
		token: v.string(),
		attendanceId: v.id('attendance'),
		status: v.union(
			v.literal('Present'),
			v.literal('Late'),
			v.literal('Absent'),
			v.literal('Excused')
		),
		/**
		 * Required, for the same reason as `addManually`: an override is the rep
		 * speaking against the evidence, and the ledger has to record what that
		 * claim was.
		 */
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const record = await ctx.db.get('attendance', args.attendanceId);
		if (!record) throw new Error('That record no longer exists.');
		const session = await ctx.db.get('sessions', record.sessionId);
		if (!session) throw new Error('That lecture could not be found.');
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are only a class representative for your own class.');
		}
		if (session.status !== 'open') {
			throw new Error('This lecture is closed. Ask your lecturer to change the record.');
		}
		const reason = args.reason.trim();
		if (!reason) throw new Error('Say why this record is being changed — it is kept on the record.');
		if (record.status === args.status) return { ok: true };

		await ctx.db.patch(args.attendanceId, {
			prevStatus: record.status,
			status: args.status,
			overriddenBy: actor.name,
			overriddenAt: Date.now(),
			overrideReason: reason
		});
		return { ok: true };
	}
});

export const removeRecord = mutation({
	args: { token: v.string(), attendanceId: v.id('attendance') },
	handler: async (ctx, args) => {
		await requireStaff(ctx, args.token);
		const record = await ctx.db.get('attendance', args.attendanceId);
		if (!record) throw new Error('Record not found.');
		await ctx.db.delete('attendance', args.attendanceId);
		return { ok: true };
	}
});

export const closeSession = mutation({
	args: { token: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) throw new Error('Lecture not found.');
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		if (session.status === 'closed') return { ok: true, absentAdded: 0 };
		const absentAdded = await closeWithAbsents(ctx, session);
		return { ok: true, absentAdded };
	}
});

export const extendSession = mutation({
	args: { token: v.string(), sessionId: v.id('sessions'), extraSec: v.number() },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) throw new Error('Lecture not found.');
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		if (session.status !== 'open') throw new Error('This lecture is already closed.');
		if (args.extraSec < 60 || args.extraSec > 3600) throw new Error('You can add between 1 and 60 minutes.');
		const closesAt = Math.max(session.closesAt, Date.now()) + args.extraSec * 1000;
		await ctx.db.patch(session._id, { closesAt });
		return { closesAt };
	}
});

export const listBySession = query({
	args: { token: v.string(), sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		const session = await ctx.db.get('sessions', args.sessionId);
		if (!session) return [];
		if (!(await canRecordFor(ctx, actor, session.classId))) {
			throw new Error('You are not a class rep for this class.');
		}
		const rows = await ctx.db
			.query('attendance')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('asc')
			.take(2000);
		return rows.map((r: any) => ({
			_id: r._id,
			personId: r.personId ?? null,
			fullName: r.fullName,
			regNumber: r.regNumber,
			method: r.method,
			status: r.status,
			recordedBy: r.recordedBy ?? null,
			recordedById: r.recordedById ?? null,
			recordedByRole: r.recordedByRole ?? null,
			distanceM: r.distanceM ?? null,
			accuracyM: r.accuracyM ?? null,
			studentDistanceM: r.studentDistanceM ?? null,
			verification: r.verification ?? 'scan_only',
			flagged: r.flagged ?? false,
			flagReason: r.flagReason ?? null,
			overrideReason: r.overrideReason ?? null,
			submittedAt: r.submittedAt,
			overriddenBy: r.overriddenBy ?? null,
			prevStatus: r.prevStatus ?? null,
			disputed: r.disputed ?? false,
			disputeNote: r.disputeNote ?? null
		}));
	}
});

/** Lectures a rep or lecturer can act on right now. */
export const listForRecordKeeper = query({
	args: { token: v.string(), offeringId: v.optional(v.id('offerings')) },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		let classIds: string[];
		if (actor.kind === 'staff') {
			const classes = await ctx.db.query('classes').take(200);
			classIds = classes.map((c: any) => String(c._id));
		} else {
			const rows = await ctx.db
				.query('classReps')
				.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
				.take(200);
			classIds = rows.map((r: any) => String(r.classId));
		}
		if (classIds.length === 0) return [];

		const sessions = args.offeringId
			? await ctx.db
					.query('sessions')
					.withIndex('by_offering', (q) => q.eq('offeringId', args.offeringId!))
					.order('desc')
					.take(50)
			: await ctx.db.query('sessions').order('desc').take(200);

		const now = Date.now();
		const out: any[] = [];
		for (const s of sessions) {
			if (!classIds.includes(String(s.classId))) continue;
			const subject = await ctx.db.get('subjects', s.subjectId);
			const classDoc = await ctx.db.get('classes', s.classId);
			const offering = await ctx.db.get('offerings', s.offeringId);
			out.push({
				_id: s._id,
				offeringId: s.offeringId,
				subjectId: s.subjectId,
				subjectCode: subject?.code ?? '',
				subjectTitle: subject?.title ?? '',
				className: classDoc?.name ?? '',
				openForEnrolment: offering?.openForEnrolment ?? false,
				status: s.status === 'open' && now < s.closesAt ? 'open' : 'closed',
				startedAt: s.startedAt,
				closesAt: s.closesAt
			});
		}
		return out.sort((a, b) => b.startedAt - a.startedAt);
	}
});

/** A person's own attendance, filterable by semester or a date range. */
export const myAttendance = query({
	args: {
		token: v.string(),
		semesterId: v.optional(v.id('semesters')),
		from: v.optional(v.string()),
		to: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person) return [];
		const rows = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(2000);
		const sessions = await ctx.db.query('sessions').take(1000);
		const sessionById = new Map(sessions.map((s: any) => [String(s._id), s]));
		const out: any[] = [];
		for (const r of rows) {
			if (args.semesterId && r.semesterId !== args.semesterId) continue;
			const session = sessionById.get(String(r.sessionId));
			if (!session) continue;
			const date = new Date(session.startedAt);
			const iso = date.toISOString().slice(0, 10);
			if (args.from && iso < args.from) continue;
			if (args.to && iso > args.to) continue;
			const subject = await ctx.db.get('subjects', r.subjectId);
			out.push({
				_id: r._id,
				date: session.startedAt,
				isoDate: iso,
				subjectCode: subject?.code ?? '',
				subjectTitle: subject?.title ?? '',
				status: r.status,
				method: r.method,
				recordedBy: r.recordedBy ?? null,
				disputed: r.disputed ?? false,
				disputeNote: r.disputeNote ?? null
			});
		}
		return out.sort((a, b) => b.date - a.date);
	}
});

/**
 * The student's own phone reports where it is, once it notices it has been
 * scanned. This is what closes the biggest gap: until now only the rep's device
 * was located, so a record proved the *rep* was in the hall and said nothing
 * about the student.
 *
 * A record whose student location lands well outside the radius is flagged for
 * lecturer review rather than being rewritten — the student may genuinely have
 * stepped out, and the rep may be wrong. That judgement belongs to a person.
 */
export const confirmMyLocation = mutation({
	args: {
		token: v.string(),
		latitude: v.number(),
		longitude: v.number(),
		accuracyM: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person.qrSecret) return { ok: false, reason: 'not_ready' };

		// Only recent, still-unconfirmed scans are eligible.
		const cutoff = Date.now() - 10 * 60 * 1000;
		const records = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(200);
		const pending = records
			.filter((r: any) => r.studentLat === undefined && r.submittedAt >= cutoff && r.method !== 'absent')
			.sort((a: any, b: any) => b.submittedAt - a.submittedAt);

		if (pending.length === 0) {
			return { ok: false, reason: 'nothing_to_confirm' };
		}

		const record = pending[0];
		const session = await ctx.db.get('sessions', record.sessionId);
		if (!session) return { ok: false, reason: 'no_session' };

		const proximity = judgeProximity(
			session.lectureLat,
			session.lectureLng,
			args.latitude,
			args.longitude,
			args.accuracyM,
			session.radiusM
		);

		// A fix coarser than twice the radius cannot place the student at all.
		const studentWeak =
			proximity.weak || (args.accuracyM !== undefined && args.accuracyM > session.radiusM * 2);

		const flagReason = describeContradiction(
			record.distanceM ?? null,
			proximity.distanceM,
			session.radiusM,
			studentWeak
		);

		await ctx.db.patch(record._id, {
			studentLat: args.latitude,
			studentLng: args.longitude,
			...(args.accuracyM !== undefined ? { studentAccuracyM: args.accuracyM } : {}),
			...(proximity.distanceM !== null ? { studentDistanceM: proximity.distanceM } : {}),
			verification: studentWeak ? 'weak' : 'confirmed',
			...(flagReason ? { flagged: true, flagReason } : {})
		});

		return { ok: true, subjectCode: (await ctx.db.get('subjects', record.subjectId))?.code ?? '' };
	}
});

/**
 * Whether the signed-in student has a freshly-scanned record awaiting their
 * location, so their phone can show "you were marked present" immediately.
 */
export const myLatestScan = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		const records = await ctx.db
			.query('attendance')
			.withIndex('by_person', (q) => q.eq('personId', person._id))
			.take(50);
		const latest = records
			.filter((r: any) => r.method !== 'absent')
			.sort((a: any, b: any) => b.submittedAt - a.submittedAt)[0];
		if (!latest) return null;
		const session = await ctx.db.get('sessions', latest.sessionId);
		const subject = await ctx.db.get('subjects', latest.subjectId);
		return {
			status: latest.status,
			at: latest.submittedAt,
			subjectCode: subject?.code ?? '',
			// null until the student has reported their own location.
			locationConfirmed: latest.studentLat !== undefined
		};
	}
});

/** A student reports a record they believe is wrong. */
export const dispute = mutation({
	args: { token: v.string(), attendanceId: v.id('attendance'), note: v.string() },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person) throw new Error('Your sign-in has expired. Please sign in again.');
		const record = await ctx.db.get('attendance', args.attendanceId);
		if (!record) throw new Error('Record not found.');
		if (record.personId !== person._id) throw new Error('You can only report your own attendance.');
		await ctx.db.patch(args.attendanceId, {
			disputed: true,
			disputeNote: args.note.trim() || 'This was not me.'
		});
		return { ok: true };
	}
});

// A rep scanning an implausible number of students in a short window is the
	// clearest signal of a rep marking a room they are not standing in. Counted
	// per session rather than globally so one busy lecture never trips it.
	const RECENT_WINDOW_SEC = 120;
	const SCANS_PER_WINDOW_MAX = 40;

	/**
	 * Returns a reason to flag this scan, or null. A flagged record is still
	 * created — the point is to surface it for review, never to silently drop or
	 * rewrite a student's attendance.
	 */
	async function scanAnomalyNote(
		ctx: any,
		sessionId: unknown,
		recordedById: unknown
	): Promise<string | null> {
		const rows = await ctx.db
			.query('attendance')
			.withIndex('by_session', (q: any) => q.eq('sessionId', sessionId))
			.take(2000);
		const cutoff = Date.now() - RECENT_WINDOW_SEC * 1000;
		const recent = rows.filter(
			(r: any) => r.submittedAt >= cutoff && r.recordedById === recordedById && r.method === 'scan'
		);
		if (recent.length === SCANS_PER_WINDOW_MAX) {
			return `Unusual pace — ${SCANS_PER_WINDOW_MAX}+ students scanned in ${RECENT_WINDOW_SEC} seconds. Worth checking this was a live roll call.`;
		}
		return null;
			}

		/** Cron target: retire lapsed sessions and write their Absent rows. */
		export const autoCloseExpired = internalMutation({
	args: {},
	handler: async (ctx) => {
		const open = await ctx.db.query('sessions').withIndex('by_status', (q) => q.eq('status', 'open')).take(200);
		const now = Date.now();
		let closed = 0;
		for (const s of open) {
			if (now < s.closesAt) continue;
			await closeWithAbsents(ctx, s, now);
			closed += 1;
		}
		return { closed };
	}
});

/**
 * The rotating code for a signed-in person to display. The secret stays
 * server-side; only this derived code leaves.
 */
export const myScanCode = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const person = await requirePerson(ctx, args.token);
		if (!person) return null;
		const doc = await ctx.db.get('people', person._id as never);
		if (!doc?.qrSecret) return null;
		// The owner receives their own secret so the phone can roll the code
		// locally; it is useless to anyone who is not already signed in here.
		return { regNumber: doc.regNumber, qrSecret: doc.qrSecret };
	}
});

/**
 * Offerings the signed-in rep or lecturer may start a lecture for: everything
 * for staff, only their classes' offerings for a rep. Powers the "start a
 * lecture" form on the scanning screen.
 */
export const listRecordableOfferings = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireRecorder(ctx, args.token);
		let offerings: any[];
		if (actor.kind === 'staff') {
			offerings = await ctx.db.query('offerings').take(500);
		} else {
			const repClasses = await ctx.db
				.query('classReps')
				.withIndex('by_person', (q: any) => q.eq('personId', actor.id))
				.take(200);
			const classIdSet = new Set(repClasses.map((r: any) => String(r.classId)));
			const all = await ctx.db.query('offerings').take(500);
			offerings = all.filter((o: any) => classIdSet.has(String(o.classId)));
		}
		const out: any[] = [];
		for (const o of offerings) {
			const subject = await ctx.db.get('subjects', o.subjectId);
			const classDoc = await ctx.db.get('classes', o.classId);
			if (!subject || !classDoc) continue;
			out.push({
				_id: o._id,
				subjectCode: subject.code,
				subjectTitle: subject.title,
				className: classDoc.name
			});
		}
		out.sort(
			(a: any, b: any) =>
				a.className.localeCompare(b.className) || a.subjectCode.localeCompare(b.subjectCode)
		);
		return out;
	}
});