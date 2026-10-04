export type AttendanceStatus = 'Present' | 'Late' | 'Out_of_Range' | 'Absent' | 'Excused';
export type Role = 'student' | 'rep' | 'lecturer';
export type PersonStatus = 'invited' | 'active' | 'blocked';

/** Who the current token belongs to — either a lecturer account or a person. */
export type Me =
	| {
			kind: 'staff';
			id: string;
			role: 'lecturer';
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
			/** Every class the person belongs to — a repeating student sits in several. */
			classNames: string[];
	  };

export interface StaffRow {
	_id: string;
	username: string;
	fullName: string;
	active: boolean;
	lastLoginAt: number | null;
	isDefault: boolean;
}

export interface PersonRow {
	_id: string;
	role: 'student' | 'rep';
	fullName: string;
	regNumber: string;
	studentId: string;
	status: PersonStatus;
	/** Every class the person belongs to (ids into `classes`). */
	classIds: string[];
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

export interface ClassRow {
	_id: string;
	name: string;
	yearOfStudy: number;
	semesterId?: string;
	/** Joined by listClasses. */
	studentCount?: number;
	semesterName?: string;
}

/** What reps.listForPerson returns — the classes a person represents. */
export interface RepClass {
	classId: string;
	className: string;
}

export interface Subject {
	_id: string;
	code: string;
	title: string;
	hoursPerWeek?: number;
	lecturerId?: string;
	openForEnrolment: boolean;
}

export interface Offering {
	_id: string;
	subjectId: string;
	subjectCode: string;
	subjectTitle: string;
	hoursPerWeek: number | null;
	classId: string;
	className: string;
	semesterId: string;
	semesterName: string;
	openForEnrolment: boolean;
	studentCount: number;
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
	subjectCode: string;
	subjectTitle: string;
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

export interface MyEnrolment {
	_id: string;
	offeringId: string;
	subjectId: string;
	subjectCode: string;
	subjectTitle: string;
	semesterName: string;
	className: string;
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

export interface AttendanceRecord {
	_id: string;
	personId: string | null;
	fullName: string;
	regNumber: string;
	method: 'scan' | 'rep' | 'manual' | 'absent';
	status: AttendanceStatus;
	recordedBy: string | null;
	recordedById: string | null;
	recordedByRole: Role | null;
	distanceM: number | null;
	accuracyM: number | null;
	submittedAt: number;
	overriddenBy: string | null;
	prevStatus: AttendanceStatus | null;
	disputed: boolean;
	disputeNote: string | null;
}

export interface LectureSession {
	_id: string;
	offeringId: string;
	subjectId: string;
	subjectCode: string;
	subjectTitle: string;
	className: string;
	openForEnrolment: boolean;
	status: 'open' | 'closed';
	startedAt: number;
	closesAt: number;
}

export interface ScanSession {
	_id: string;
	offeringId: string;
	subjectId: string;
	subjectCode: string;
	subjectTitle: string;
	className: string;
	status: 'open' | 'closed';
	startedAt: number;
	closesAt: number;
	now: number;
}

export interface MyAttendanceRow {
	_id: string;
	date: number;
	isoDate: string;
	subjectCode: string;
	subjectTitle: string;
	status: AttendanceStatus;
	method: 'scan' | 'rep' | 'manual' | 'absent';
	recordedBy: string | null;
	disputed: boolean;
	disputeNote: string | null;
}

export interface SubjectSummary {
	subjectId: string;
	subjectCode: string;
	subjectTitle: string;
}

export interface ReportRow {
	personId?: string;
	fullName: string;
	regNumber: string;
	present: number;
	late: number;
	outOfRange: number;
	absent: number;
	excused: number;
	attendPct: number;
}