// LAMS schema.
//
// Vocabulary:
//   Person     — one human: student, program rep or lecturer.
//   Semester   — one half of a university year (Semester 1 or 2).
//   Course     — an entry in the catalogue, e.g. BIT 221. May be taught in
//                several programs and semesters.
//   Program    — a course of study, e.g. "BSc Computer Science", running
//                `durationYears` years. Its courses change every semester
//                until the final year.
//   Year       — one year of a program (1..durationYears). Not a table: an
//                offering names the program year it is taught in.
//   Offering   — a course taught to one program year in one semester.
//   Meeting    — when a course actually meets: a weekly slot or a one-off makeup.
//   Session    — the live attendance window opened during a meeting.
//   ProgramRep — grants a person attendance rights over everything their
//                program takes.

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const statusValidator = v.union(
	v.literal('Present'),
	v.literal('Late'),
	v.literal('Out_of_Range'),
	v.literal('Absent'),
	v.literal('Excused')
);

/** What a person may do. Lecturers sign in separately — see `staff`. */
const roleValidator = v.union(v.literal('student'), v.literal('rep'));

export default defineSchema({
	/**
	 * Append-only trail of privileged actions: staff account lifecycle,
	 * lecturer assignments, rep grants, blocks and PIN/device resets.
	 * Per-record attendance changes already carry their own stamps; this is
	 * the who-did-what for everything else. Admins read it in the console.
	 */
	auditLog: defineTable({
		actorName: v.string(),
		actorId: v.optional(v.string()),
		action: v.string(),
		targetKind: v.optional(v.string()),
		targetId: v.optional(v.string()),
		targetName: v.optional(v.string()),
		detail: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_created', ['createdAt']),

	/** Failed sign-in and activation attempts, used for rate limiting. */
		authAttempts: defineTable({
			/** Normalised identifier being probed, e.g. a reg number or username. */
			key: v.string(),
			count: v.number(),
			windowStart: v.number(),
			blockedUntil: v.optional(v.number())
		})
			.index('by_key', ['key']),

		people: defineTable({
		role: roleValidator,
		fullName: v.string(),
		regNumber: v.string(),
		regNorm: v.string(),
		/** Secondary identity. Locked after creation; used to prove first login. */
		studentId: v.string(),
		idNorm: v.string(),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		/**
		 * 'invited' — created by a rep/lecturer, no PIN chosen yet. This is the
		 * only state that can be claimed; activation needs reg number + student ID.
		 * 'active'   — PIN set, can sign in.
		 * 'blocked'  — sign-in refused by a rep or lecturer.
		 */
		status: v.union(v.literal('invited'), v.literal('active'), v.literal('blocked')),
		/** Argon-style iterated SHA-256 of the PIN; absent until first activation. */
		pinHash: v.optional(v.string()),
		/**
		 * Per-person secret behind the rotating attendance code. Minted at
		 * activation, never returned by any query except the owner's own code.
		 */
		qrSecret: v.optional(v.string()),
		salt: v.optional(v.string()),
		scheme: v.optional(v.string()),
		iterations: v.optional(v.number()),
		/** First device that signed in; other devices are refused. */
		boundDeviceId: v.optional(v.string()),
		lastLoginAt: v.optional(v.number()),
		createdAt: v.number(),
		activatedAt: v.optional(v.number())
	})
		.index('by_reg', ['regNorm'])
		.index('by_status', ['status'])
		.index('by_role', ['role']),

	/**
		 * Lecturer accounts. Lecturers do not use registration numbers or PINs —
		 * they sign in with a username and a shared password, so a lecturer can be
		 * created before their registration details are known and cannot be
		 * impersonated by a student who guesses a reg number.
		 */
		staff: defineTable({
			username: v.string(),
			usernameNorm: v.string(),
			passwordHash: v.string(),
			salt: v.string(),
			scheme: v.optional(v.string()),
			iterations: v.optional(v.number()),
			fullName: v.string(),
			/**
			 * 'admin' sees everything and manages lecturer accounts.
			 * 'lecturer' only sees the offerings assigned to them.
			 * Optional until existing deployments are backfilled (see
			 * `staff.ensureSeed`); missing reads as admin for the default
			 * account and lecturer for everyone else.
			 */
			role: v.optional(v.union(v.literal('admin'), v.literal('lecturer'))),
			/**
			 * Set when the password was generated or chosen by someone else.
			 * Cleared when the owner picks their own. Missing reads as false.
			 */
			mustChangePassword: v.optional(v.boolean()),
			/** Revoked accounts cannot sign in but keep their past records. */
			active: v.boolean(),
			lastLoginAt: v.optional(v.number()),
			createdAt: v.number()
		})
			.index('by_username', ['usernameNorm'])
			.index('by_active', ['active']),

		staffSessions: defineTable({
			staffId: v.id('staff'),
			token: v.string(),
			createdAt: v.number(),
			expiresAt: v.number()
		})
			.index('by_token', ['token'])
			.index('by_staff', ['staffId']),

		authSessions: defineTable({
		personId: v.id('people'),
		token: v.string(),
		deviceId: v.string(),
		createdAt: v.number(),
		expiresAt: v.number()
	})
		.index('by_token', ['token'])
		.index('by_person', ['personId']),

	semesters: defineTable({
		name: v.string(),
		/** Academic year this semester belongs to, e.g. 2026. */
		year: v.number(),
		/** 1 or 2 within the year; 3 for a summer session. */
		number: v.number(),
		startDate: v.string(),
		endDate: v.string(),
		createdAt: v.number()
	})
		.index('by_year', ['year']),

	/**
	 * A program of study, e.g. "BSc Computer Science". Courses change every
	 * semester across `durationYears` years until the final year.
	 */
	programs: defineTable({
		name: v.string(),
		/** How many years the program runs, e.g. 4. */
		durationYears: v.number(),
		createdAt: v.number()
	}).index('by_name', ['name']),

	/** The course catalogue. Independent of any semester or program. */
	courses: defineTable({
		code: v.string(),
		title: v.string(),
		/** Optional: opening this to self-enrolment is a lecturer decision. */
		openForEnrolment: v.boolean(),
		/** Lecture hours per week, shown to students when choosing. */
		hoursPerWeek: v.optional(v.number()),
		createdAt: v.number()
	}).index('by_code', ['code']),

	/**
	 * Program membership. A student can belong to several programs — e.g. a
	 * repeating student retakes a first-year course while in third year.
	 * Attendance never reads this directly; it follows enrolments.
	 */
	programMembers: defineTable({
		personId: v.id('people'),
		programId: v.id('programs'),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_program', ['programId']),

	/**
	 * Program-rep rights. A rep of a program can take attendance for anything
	 * that program is taking. Several people may represent one program.
	 */
	programReps: defineTable({
		personId: v.id('people'),
		programId: v.id('programs'),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_program', ['programId']),

	/** Deprecated: migrated to `programs` (see `migrations.migrateToProgramsAndCourses`). */
	classes: defineTable({
		name: v.string(),
		/** Year of study within the programme, e.g. 1–4. */
		yearOfStudy: v.number(),
		semesterId: v.optional(v.id('semesters')),
		createdAt: v.number()
	}).index('by_semester', ['semesterId']),

	/** Deprecated: migrated to `courses` (see `migrations.migrateToProgramsAndCourses`). */
	subjects: defineTable({
		code: v.string(),
		title: v.string(),
		lecturerId: v.optional(v.id('staff')),
		openForEnrolment: v.boolean(),
		hoursPerWeek: v.optional(v.number()),
		createdAt: v.number()
	}).index('by_code', ['code']),

	/** A course offered to one program year in one semester. */
	offerings: defineTable({
		subjectId: v.optional(v.id('subjects')),
		classId: v.optional(v.id('classes')),
		courseId: v.optional(v.id('courses')),
		programId: v.optional(v.id('programs')),
		semesterId: v.id('semesters'),
		/** Which year of the program this offering is taught in (1..durationYears). */
		yearOfStudy: v.optional(v.number()),
		/** The lecturer teaching this offering. One offering has one lecturer; a lecturer may teach many. */
		lecturerId: v.optional(v.id('staff')),
		openForEnrolment: v.boolean(),
		createdAt: v.number()
	})
		.index('by_subject', ['subjectId'])
		.index('by_class', ['classId'])
		.index('by_course', ['courseId'])
		.index('by_program', ['programId'])
		.index('by_semester', ['semesterId'])
		.index('by_lecturer', ['lecturerId'])
		.index('by_class_and_semester', ['classId', 'semesterId'])
		.index('by_program_and_semester', ['programId', 'semesterId']),

	/** A person's place in one offering. The many-to-many heart of the system. */
	enrolments: defineTable({
		personId: v.id('people'),
		subjectId: v.optional(v.id('subjects')),
		offeringId: v.id('offerings'),
		semesterId: v.id('semesters'),
		classId: v.optional(v.id('classes')),
		courseId: v.optional(v.id('courses')),
		programId: v.optional(v.id('programs')),
		status: v.union(v.literal('active'), v.literal('dropped')),
		/** 'self' chose it themselves; 'rep' or 'lecturer' assigned it. */
		addedBy: v.union(v.literal('self'), v.literal('rep'), v.literal('lecturer')),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_person_and_status', ['personId', 'status'])
		.index('by_offering', ['offeringId'])
		.index('by_subject', ['subjectId'])
		.index('by_class', ['classId'])
		.index('by_course', ['courseId'])
		.index('by_program', ['programId']),

	/** Deprecated: migrated to `programMembers` (see `migrations.migrateToProgramsAndCourses`). */
	classMembers: defineTable({
		personId: v.id('people'),
		classId: v.id('classes'),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_class', ['classId']),

	/** Deprecated: migrated to `programReps` (see `migrations.migrateToProgramsAndCourses`). */
	classReps: defineTable({
		personId: v.id('people'),
		classId: v.id('classes'),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_class', ['classId']),

	/**
	 * When a course meets. `kind: 'weekly'` repeats on `dayOfWeek` at
	 * `startTime`; `kind: 'makeup'` happens once on `date` (a make-up lecture).
	 */
	meetings: defineTable({
		offeringId: v.id('offerings'),
		subjectId: v.optional(v.id('subjects')),
		courseId: v.optional(v.id('courses')),
		kind: v.union(v.literal('weekly'), v.literal('makeup')),
		/** 0 = Sunday … 6 = Saturday, for weekly meetings. */
		dayOfWeek: v.optional(v.number()),
		startTime: v.string(),
		endTime: v.string(),
		/** YYYY-MM-DD, for makeups only. */
		date: v.optional(v.string()),
		room: v.optional(v.string()),
		note: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_offering', ['offeringId'])
		.index('by_subject', ['subjectId'])
		.index('by_kind', ['kind']),

	/** A live attendance window opened during one meeting. */
	sessions: defineTable({
		meetingId: v.optional(v.id('meetings')),
		offeringId: v.id('offerings'),
		subjectId: v.optional(v.id('subjects')),
		semesterId: v.id('semesters'),
		classId: v.optional(v.id('classes')),
		courseId: v.optional(v.id('courses')),
		programId: v.optional(v.id('programs')),
		/**
		 * Where the QR station physically stands. Kept separate from the lecture
		 * position so the two radii can differ — the screen may sit at a doorway
		 * while the lecture is at the back of the hall. Sessions opened before the
		 * station existed are backfilled from the lecture coordinates by
		 * `migrations.ts`.
		 */
		stationLat: v.number(),
		stationLng: v.number(),
		/** Distance from the station at which a student's phone still counts as present. */
		stationRadiusM: v.number(),
		/**
		 * How far the *station itself* may drift from its pinned spot before
		 * scans are refused. Optional because sessions opened before this existed
		 * have no value; the gate falls back to `stationRadiusM` when it is absent.
		 *
		 * Separate from `stationRadiusM` on purpose: that radius is generous
		 * because a whole hall of students has to fit inside it, while the screen
		 * is a fixed object expected to stay put. Defaulting one to the other
		 * would let the station be carried to the next building and still count.
		 */
		stationToleranceM: v.optional(v.number()),
		/**
		 * The station's last reported position, and when it reported it. The
		 * screen re-reports on a timer; `null` simply means it never has, which
		 * is not by itself a reason to refuse anyone.
		 */
		stationSeenLat: v.optional(v.number()),
		stationSeenLng: v.optional(v.number()),
		stationSeenAccuracyM: v.optional(v.number()),
		stationSeenAt: v.optional(v.number()),
		/** How far that reading put the station from its pinned spot. */
		stationSeenDistanceM: v.optional(v.number()),
		/**
		 * Set when a reading placed the station clear of its room. While this is
		 * present every scan is refused — that is the whole point of pinning a
		 * room to the screen. Cleared automatically by the next in-room reading,
		 * or by an audited `pinStation` when the rep really did change rooms.
		 */
		stationMoved: v.optional(v.boolean()),
		stationMovedAt: v.optional(v.number()),
		/**
		 * The last reading could not place the station either way. Surfaced in
		 * the UI so a rep knows the check is not currently proving anything, but
		 * it never blocks: a weak fix is an absence of evidence, not evidence of
		 * absence.
		 */
		stationUnverified: v.optional(v.boolean()),
		/**
		 * Re-pin trail. Who moved the station's room, when, and why. A station
		 * that is quietly re-pinned mid-lecture would otherwise be indistinguishable
		 * from one that was never moved, so this is kept the same way attendance
		 * corrections are.
		 */
		stationRepinnedBy: v.optional(v.string()),
		stationRepinnedAt: v.optional(v.number()),
		stationRepinReason: v.optional(v.string()),
		lectureLat: v.number(),
		lectureLng: v.number(),
		radiusM: v.number(),
		/**
		 * Per-session secret behind the rotating station code. Minted when the
		 * lecture opens, never reused, never returned to a student.
		 */
		stationSecret: v.optional(v.string()),
		/**
		 * Who opened the lecture. Stamped so history survives renames and
		 * reassignments — counts and trails follow the starter, not whoever
		 * happens to hold the offering today. Absent on old rows and on
		 * rep-started lectures (reps are people, not staff).
		 */
		startedByStaffId: v.optional(v.id('staff')),
		startedByName: v.optional(v.string()),
		/** Within this many seconds of the start -> Present. Default 300 (5 min). */
		onTimeSec: v.number(),
		/** By this many seconds -> Late; after it, scans record Absent. Default 600 (10 min). */
		lateUntilSec: v.number(),
		status: v.union(v.literal('open'), v.literal('closed')),
		startedAt: v.number(),
		closesAt: v.number(),
		closedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_offering', ['offeringId'])
		.index('by_status', ['status'])
		.index('by_subject', ['subjectId'])
		.index('by_course', ['courseId'])
		.index('by_semester', ['semesterId']),

	attendance: defineTable({
		sessionId: v.id('sessions'),
		personId: v.optional(v.id('people')),
		offeringId: v.id('offerings'),
		subjectId: v.optional(v.id('subjects')),
		semesterId: v.id('semesters'),
		courseId: v.optional(v.id('courses')),
		fullName: v.string(),
		regNumber: v.string(),
		regNorm: v.string(),
		method: v.union(
			v.literal('scan'),
			/** Student scanned the station with their own phone. */
			v.literal('station'),
			/** A rep added them by hand because they have no usable phone. */
			v.literal('rep'),
			v.literal('manual'),
			v.literal('absent')
		),
		/** Why a record was entered by hand — kept for the audit trail. */
		overrideReason: v.optional(v.string()),
		/** Who recorded it, for every non-absent method. */
		recordedBy: v.optional(v.string()),
		recordedByRole: v.optional(v.union(v.literal('rep'), v.literal('lecturer'))),
		recordedById: v.optional(v.id('people')),
		/** Staff author, id-stamped so renames keep history linked. */
		recordedByStaffId: v.optional(v.id('staff')),
		/**
		 * The handset a scan came from. For station scans this is the student's
		 * own device, already checked against their bound device server-side.
		 */
		scannerDeviceId: v.optional(v.string()),
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		accuracyM: v.optional(v.number()),
		distanceM: v.optional(v.number()),
		/**
		 * How this record was verified:
		 *   scan_only  — only the rep's device was located (the fast path)
		 *   confirmed  — the student's own phone also reported its location
		 *   weak       — location was captured but too imprecise to trust
		 */
		verification: v.optional(
			v.union(
				v.literal('scan_only'),
				v.literal('confirmed'),
				v.literal('weak'),
				/** No usable position fix at all, so presence could not be judged. */
				v.literal('unconfirmed')
			)
		),
		/** Student's own location, reported by their phone after being scanned. */
		studentLat: v.optional(v.number()),
		studentLng: v.optional(v.number()),
		studentAccuracyM: v.optional(v.number()),
		studentDistanceM: v.optional(v.number()),
		/** Raised for lecturer review — never silently corrected. */
		flagged: v.optional(v.boolean()),
		flagReason: v.optional(v.string()),
		status: statusValidator,
		submittedAt: v.number(),
		/** Set when a lecturer overrides; `prevStatus` keeps the audit trail. */
		overriddenBy: v.optional(v.string()),
		overriddenAt: v.optional(v.number()),
		prevStatus: v.optional(statusValidator),
		disputed: v.optional(v.boolean()),
		disputeNote: v.optional(v.string()),
		/** Set when someone reviews a dispute and stands by the record. */
		disputeResolvedBy: v.optional(v.string()),
		disputeResolvedAt: v.optional(v.number()),
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_reg', ['sessionId', 'regNorm'])
		.index('by_person', ['personId'])
		.index('by_subject', ['subjectId'])
});