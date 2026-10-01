import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const statusValidator = v.union(
	v.literal('Present'),
	v.literal('Late'),
	v.literal('Out_of_Range'),
	v.literal('Absent'),
	v.literal('Excused')
);

export default defineSchema({
	settings: defineTable({
		key: v.string(),
		adminHash: v.string(),
		salt: v.string(),
		scheme: v.optional(v.string()),
		iterations: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	terms: defineTable({
		name: v.string(),
		startDate: v.string(),
		endDate: v.string(),
		createdAt: v.number()
	}),

	courses: defineTable({
		termId: v.optional(v.id('terms')),
		code: v.string(),
		title: v.string(),
		createdAt: v.number()
	}).index('by_term', ['termId']),

	students: defineTable({
		courseId: v.id('courses'),
		fullName: v.string(),
		regNumber: v.string(),
		regNorm: v.string(),
		studentId: v.string(),
		idNorm: v.string(),
		isClassRep: v.boolean(),
		createdAt: v.number()
	})
		.index('by_course', ['courseId'])
		.index('by_course_and_reg', ['courseId', 'regNorm']),

	sessions: defineTable({
		courseId: v.id('courses'),
		termId: v.optional(v.id('terms')),
		lectureLat: v.number(),
		lectureLng: v.number(),
		radiusM: v.number(),
		presentSec: v.number(),
		totalSec: v.number(),
		token: v.string(),
		tokenExp: v.number(),
		status: v.union(v.literal('open'), v.literal('closed')),
		startedAt: v.number(),
		closesAt: v.number(),
		closedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_course', ['courseId'])
		.index('by_status', ['status']),

	attendance: defineTable({
		sessionId: v.id('sessions'),
		courseId: v.id('courses'),
		fullName: v.string(),
		regNumber: v.string(),
		regNorm: v.string(),
		studentId: v.string(),
		method: v.union(v.literal('self'), v.literal('rep'), v.literal('manual')),
		repName: v.optional(v.string()),
		repRegNumber: v.optional(v.string()),
		studentLat: v.optional(v.number()),
		studentLng: v.optional(v.number()),
		accuracyM: v.optional(v.number()),
		distanceM: v.optional(v.number()),
		status: statusValidator,
		submittedAt: v.number(),
		overriddenBy: v.optional(v.string()),
		overriddenAt: v.optional(v.number()),
		prevStatus: v.optional(statusValidator)
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_reg', ['sessionId', 'regNorm'])
});
