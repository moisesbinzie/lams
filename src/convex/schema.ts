// LAMS schema.
//
// Vocabulary:
//   Person   — one human: student, class rep or lecturer.
//   Semester — the period a cohort studies in (was "term").
//   Subject  — a course in the catalogue, e.g. BIT 221.
//   Class    — a cohort, e.g. "BSc Computer Science, Year 2".
//   Meeting  — when a subject actually meets: a weekly slot or a one-off makeup.
//   Session  — the live 5-minute attendance window opened during a meeting.
//   SubjectRep — REMOVED: rep rights are per class now (see ClassRep).
//   ClassRep — grants a person attendance rights over everything their class takes.

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

	classes: defineTable({
		name: v.string(),
		/** Year of study within the programme, e.g. 1–4. */
		yearOfStudy: v.number(),
		semesterId: v.optional(v.id('semesters')),
		createdAt: v.number()
	}).index('by_semester', ['semesterId']),

	/** The course catalogue. Independent of any semester or cohort. */
	subjects: defineTable({
		code: v.string(),
		title: v.string(),
		/** Lecturer of record; may be set later. */
		lecturerId: v.optional(v.id('staff')),
		/** Optional: opening this to self-enrolment is a lecturer decision. */
		openForEnrolment: v.boolean(),
		/** Lecture hours per week, shown to students when choosing. */
		hoursPerWeek: v.optional(v.number()),
		createdAt: v.number()
	}).index('by_code', ['code']),

	/** A subject offered to a specific cohort in a specific semester. */
	offerings: defineTable({
		subjectId: v.id('subjects'),
		classId: v.id('classes'),
		semesterId: v.id('semesters'),
		lecturerId: v.optional(v.id('staff')),
		openForEnrolment: v.boolean(),
		createdAt: v.number()
	})
		.index('by_subject', ['subjectId'])
		.index('by_class', ['classId'])
		.index('by_semester', ['semesterId'])
		.index('by_class_and_semester', ['classId', 'semesterId']),

	/** A person's place in one offering. The many-to-many heart of the system. */
	enrolments: defineTable({
		personId: v.id('people'),
		subjectId: v.id('subjects'),
		offeringId: v.id('offerings'),
		semesterId: v.id('semesters'),
		classId: v.id('classes'),
		status: v.union(v.literal('active'), v.literal('dropped')),
		/** 'self' chose it themselves; 'rep' or 'lecturer' assigned it. */
		addedBy: v.union(v.literal('self'), v.literal('rep'), v.literal('lecturer')),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_person_and_status', ['personId', 'status'])
		.index('by_offering', ['offeringId'])
		.index('by_subject', ['subjectId'])
		.index('by_class', ['classId']),

	/**
	 * Class membership. A student can belong to several classes — e.g. a
	 * repeating student sits in a junior class for one subject while their
	 * cohort moves on. Attendance never reads this directly; it follows
	 * enrolments, which may come from any of the person's classes.
	 */
	classMembers: defineTable({
		personId: v.id('people'),
		classId: v.id('classes'),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_class', ['classId']),

	/**
	 * Class-rep rights. A rep of a class can take attendance for any subject
	 * that class is taking. Several reps may share one class.
	 */
	classReps: defineTable({
		personId: v.id('people'),
		classId: v.id('classes'),
		createdAt: v.number()
	})
		.index('by_person', ['personId'])
		.index('by_class', ['classId']),

	/**
	 * When a subject meets. `kind: 'weekly'` repeats on `dayOfWeek` at
	 * `startTime`; `kind: 'makeup'` happens once on `date` (a make-up lecture).
	 */
	meetings: defineTable({
		offeringId: v.id('offerings'),
		subjectId: v.id('subjects'),
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
		subjectId: v.id('subjects'),
		semesterId: v.id('semesters'),
		classId: v.id('classes'),
		lectureLat: v.number(),
		lectureLng: v.number(),
		radiusM: v.number(),
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
		.index('by_semester', ['semesterId']),

	attendance: defineTable({
		sessionId: v.id('sessions'),
		personId: v.optional(v.id('people')),
		offeringId: v.id('offerings'),
		subjectId: v.id('subjects'),
		semesterId: v.id('semesters'),
		fullName: v.string(),
		regNumber: v.string(),
		regNorm: v.string(),
		method: v.union(
			v.literal('scan'),
			v.literal('rep'),
			v.literal('manual'),
			v.literal('absent')
		),
		/** Who recorded it, for every non-absent method. */
		recordedBy: v.optional(v.string()),
		recordedByRole: v.optional(v.union(v.literal('rep'), v.literal('lecturer'))),
		recordedById: v.optional(v.id('people')),
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
			v.union(v.literal('scan_only'), v.literal('confirmed'), v.literal('weak'))
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
		disputeNote: v.optional(v.string())
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_reg', ['sessionId', 'regNorm'])
		.index('by_person', ['personId'])
		.index('by_subject', ['subjectId'])
});