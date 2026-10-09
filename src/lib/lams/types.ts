export type AttendanceStatus = 'Present' | 'Late' | 'Out_of_Range' | 'Absent' | 'Excused';
export type Role = 'student' | 'rep' | 'lecturer' | 'admin';
export type StaffRole = 'admin' | 'lecturer';
export type PersonStatus = 'invited' | 'active' | 'blocked';

/** Who the current token belongs to — either a staff account or a person. */
export type Me =
	| {
			kind: 'staff';
			id: string;
			role: 'lecturer' | 'admin';
			staffRole?: 'lecturer' | 'admin';
			isAdmin?: boolean;
			mustChangePassword?: boolean;
			fullName: string;
			username: string;
	  }
	| {
			kind: 'person';
			id: string;
			role: 'student' | 'rep';
			fullName: string;
			regNumber: string;
			studentId: string;
			email: string;
			phone: string;
	/** Every program the person belongs to — a repeating student sits in several. */
		programNames: string[];
	  };

export interface StaffRow {
	_id: string;
	username: string;
	fullName: string;
	role: 'admin' | 'lecturer';
	isAdmin: boolean;
	active: boolean;
	lastLoginAt: number | null;
	assignmentCount: number;
	isDefault: boolean;
}

export interface PersonRow {
	_id: string;
	role: 'student' | 'rep';
	fullName: string;
	regNumber: string;
	studentId: string;
	status: PersonStatus;
	/** Every program the person belongs to (ids into `programs`). */
	programIds: string[];
	/** Joined by listPeople: active enrolments. */
	courseCount?: number;
	email: string;
	phone: string;
	hasDevice: boolean;
	activatedAt: number | null;
}

export interface Semester {
	_id: string;
	name: string;
	year: number;
	number: number;
	startDate: string;
	endDate: string;
}

export interface ProgramRow {
	_id: string;
	name: string;
	durationYears: number;
	/** Joined by listPrograms: students who belong, blocked ones excluded. */
	studentCount?: number;
	/** Joined by listPrograms: offerings placed in this program. */
	courseCount?: number;
}

/** What reps.listForPerson returns — the programs a person represents. */
export interface ProgramRep {
	programId: string;
	programName: string;
}

export interface Course {
	_id: string;
	code: string;
	title: string;
	hoursPerWeek?: number;
	openForEnrolment: boolean;
	/** Joined by listCourses: how many programs take this course. */
	placementCount?: number;
	/** Joined by listCourses: up to 5 program names taking this course. */
	programNames?: string[];
}

/**
 * A course placed in a program: the one row that ties course ↔ program ↔
 * semester ↔ year of study together, resolved with every display name.
 *
 * `_id` is the offering's id — the "placement", not the course. The same
 * course code appears in as many placements as it is taught in, which is what
 * makes one course belong to several programs (and lets a repeating student
 * meet it again in a later year).
 */
export interface ProgramCoursePlacement {
	_id: string;
	courseId: string | null;
	courseCode: string;
	courseTitle: string;
	hoursPerWeek: number | null;
	courseOpenForEnrolment: boolean;
	programId: string | null;
	programName: string;
	yearOfStudy: number | null;
	semesterId: string;
	semesterName: string;
	semesterYear: number | null;
	semesterNumber: number | null;
	openForEnrolment: boolean;
	lecturerIds: string[];
	lecturerNames: string[];
	lecturerUsernames: string[];
	lecturerId: string | null;
	lecturerName: string | null;
	lecturerUsername: string | null;
	studentCount: number;
	/** Weekly + make-up slots set on the Timetable tab. */
	meetingCount: number;
	createdAt: number;
}

/** A course one student is enrolled in — the Students tab's read side. */
export interface StudentCourse {
	enrolmentId: string;
	offeringId: string;
	courseId: string | null;
	courseCode: string;
	courseTitle: string;
	programId: string | null;
	programName: string;
	yearOfStudy: number | null;
	semesterId: string;
	semesterName: string;
	semesterYear: number | null;
	addedBy: 'self' | 'rep' | 'lecturer';
	meetingCount: number;
	enrolledAt: number;
}

/** A course one student could be given, from every program they belong to. */
export interface StudentCourseOption {
	offeringId: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	hoursPerWeek: number | null;
	programId: string;
	programName: string;
	yearOfStudy: number | null;
	semesterId: string;
	semesterName: string;
	semesterYear: number | null;
	openForEnrolment: boolean;
	enrolled: boolean;
	addedBy: 'self' | 'rep' | 'lecturer' | null;
}

/** One weekly meeting as the timetable grid draws it. */
export interface TimetableSlot {
	meetingId: string;
	offeringId: string;
	courseCode: string;
	courseTitle: string;
	yearOfStudy: number | null;
	dayOfWeek: number;
	startTime: string;
	endTime: string;
	room: string;
}

/** A course placed in the selected semester, for the grid's legend/picker. */
export interface TimetableGridCourse {
	offeringId: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	hoursPerWeek: number | null;
	yearOfStudy: number | null;
	lecturerNames: string[];
}

export interface TimetableGrid {
	programName: string;
	semesterName: string;
	semesterYear: number;
	slots: TimetableSlot[];
	courses: TimetableGridCourse[];
}

export interface Offering {
	_id: string;
	courseId: string | null;
	courseCode: string;
	courseTitle: string;
	hoursPerWeek: number | null;
	/** Whether the catalogue course itself is open — a lecturer's setting. */
	courseOpenForEnrolment?: boolean;
	programId: string | null;
	programName: string;
	yearOfStudy: number | null;
	semesterId: string;
	semesterName: string;
	/** Joined so a semester can be named unambiguously across years. */
	semesterYear?: number | null;
	semesterNumber?: number | null;
	openForEnrolment: boolean;
	lecturerIds?: string[];
	lecturerNames?: string[];
	lecturerUsernames?: string[];
	lecturerId?: string | null;
	lecturerName?: string | null;
	lecturerUsername?: string | null;
	studentCount: number;
	/** Weekly + make-up slots set on this offering. */
	meetingCount?: number;
	createdAt?: number;
}

export interface Meeting {
	_id: string;
	kind: 'weekly' | 'makeup';
	dayName: string;
	dayOfWeek: number | null;
	date: string | null;
	startTime: string;
	endTime: string;
	room: string;
	note: string;
}

export interface TimetableEntry {
	meetingId: string;
	offeringId: string;
	courseCode: string;
	courseTitle: string;
	room: string;
	startTime: string;
	endTime: string;
}

export interface TimetableWeekly extends TimetableEntry {
	dayOfWeek: number;
	dayName: string;
}

export interface TimetableMakeup extends TimetableEntry {
	date: string;
	note: string;
}

/** What the station screen needs to render its rotating code and say where it is. */
export interface StationFeed {
	_id: string;
	secret: string | null;
	courseCode: string;
	courseTitle: string;
	programName: string;
	status: 'open' | 'closed';
	startedAt: number;
	closesAt: number;
	stationRadiusM: number;
	/** The room this screen is pinned to. */
	stationLat: number;
	stationLng: number;
	/** How far the screen itself may sit from that spot before scans stop. */
	stationToleranceM: number;
	/** The server currently believes the screen is outside its room. */
	stationMoved: boolean;
	/** How far the screen's last reported position was from its pinned spot. */
	stationSeenDistanceM: number | null;
	stationSeenAt: number | null;
	/** The last check could not place the screen either way. Never blocks. */
	stationUnverified: boolean;
	stationRepinnedBy: string | null;
	stationRepinReason: string | null;
}

/** What a student sees on the page the QR opened, before and after scanning. */
export interface StationPreview {
	courseCode: string;
	courseTitle: string;
	programName: string;
	status: 'open' | 'closed';
	startedAt: number;
	closesAt: number;
	/** The screen is out of its room, so scanning is being refused. */
	stationMoved: boolean;
	/**
	 * Whether the person asking holds an active enrolment in this course. The
	 * scan is refused regardless; this only lets the page say so before asking
	 * for a location fix.
	 */
	viewerEnrolled: boolean;
}

export interface StationScanResult {
	ok: true;
	fullName: string;
	courseCode: string;
	courseTitle: string;
	status: AttendanceStatus;
	distanceM: number | null;
	/** False when the fix was missing or too coarse to judge. */
	positionUsable: boolean;
	flagged: boolean;
	lateByMinutes: number | null;
}

/** A course offering open to a student, from `enrolments.listOpenForStudent`. */
export interface OpenCourse {
	_id: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	hoursPerWeek: number | null;
	semesterName: string;
	programName: string;
	alreadyEnrolled: boolean;
}

export interface MyEnrolment {
	_id: string;
	offeringId: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	semesterName: string;
	programName: string;
	addedBy: 'self' | 'rep' | 'lecturer';
	meetings: {
		_id: string;
		kind: 'weekly' | 'makeup';
		dayOfWeek: number | null;
		date: string | null;
		startTime: string;
		endTime: string;
		room: string;
	}[];
}

export type AttendanceMethod = 'scan' | 'station' | 'rep' | 'manual' | 'absent';

/**
 * How far the record's position evidence actually goes.
 *   confirmed   — the student's own phone reported a precise fix inside the radius
 *   weak        — a fix was reported but too coarse to decide inside from outside
 *   unconfirmed — no usable fix, so presence could not be judged either way
 *   scan_only   — only the recorder's phone was located; no claim about the student
 */
export type Verification = 'scan_only' | 'confirmed' | 'weak' | 'unconfirmed';

export interface AttendanceRecord {
	_id: string;
	personId: string | null;
	fullName: string;
	regNumber: string;
	method: AttendanceMethod;
	status: AttendanceStatus;
	recordedBy: string | null;
	recordedById: string | null;
	recordedByRole: Role | null;
	distanceM: number | null;
	accuracyM: number | null;
	/** The student's own distance from the station, when their phone reported one. */
	studentDistanceM: number | null;
	verification: Verification;
	flagged: boolean;
	flagReason: string | null;
	/** Why a record was entered by hand instead of scanned. */
	overrideReason: string | null;
	submittedAt: number;
	overriddenBy: string | null;
	prevStatus: AttendanceStatus | null;
	disputed: boolean;
	disputeNote: string | null;
}

export interface LectureSession {
	_id: string;
	offeringId: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	programName: string;
	openForEnrolment: boolean;
	status: 'open' | 'closed';
	flaggedCount?: number;
	disputedCount?: number;
	startedAt: number;
	closesAt: number;
}

export interface ScanSession {
	_id: string;
	offeringId: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	programName: string;
	status: 'open' | 'closed';
	startedAt: number;
	closesAt: number;
	now: number;
}

export interface MyAttendanceRow {
	_id: string;
	date: number;
	isoDate: string;
	courseCode: string;
	courseTitle: string;
	status: AttendanceStatus;
		method: AttendanceMethod;
		recordedBy: string | null;
		disputed: boolean;
		disputeNote: string | null;
	}

export interface CourseSummary {
	courseId: string;
	courseCode: string;
	courseTitle: string;
}

export interface ReportRow {
	personId?: string;
	fullName: string;
	regNumber: string;
	studentId: string;
	present: number;
	late: number;
	outOfRange: number;
	absent: number;
	excused: number;
	attendPct: number;
}