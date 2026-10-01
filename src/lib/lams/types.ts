export type AttendanceStatus = 'Present' | 'Late' | 'Out_of_Range' | 'Absent' | 'Excused';

export interface PublicSession {
	_id: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	status: 'open' | 'closed';
	startedAt: number;
	closesAt: number;
	tokenExp: number;
	presentSec: number;
	totalSec: number;
	radiusM: number;
	now: number;
}

/** Raw session document (includes the secret token) — lecturer screens only. */
export interface SessionDoc {
	_id: string;
	courseId: string;
	termId?: string;
	lectureLat: number;
	lectureLng: number;
	radiusM: number;
	presentSec: number;
	totalSec: number;
	token: string;
	tokenExp: number;
	status: 'open' | 'closed';
	startedAt: number;
	closesAt: number;
	closedAt?: number;
	createdAt: number;
}

export interface TermDoc {
	_id: string;
	name: string;
	startDate: string;
	endDate: string;
	createdAt: number;
}

export interface CourseDoc {
	_id: string;
	code: string;
	title: string;
	termId?: string;
}

export interface StudentDoc {
	_id: string;
	fullName: string;
	regNumber: string;
	studentId: string;
	isClassRep: boolean;
}

export interface AttendanceDoc {
	_id: string;
	sessionId: string;
	courseId: string;
	fullName: string;
	regNumber: string;
	regNorm: string;
	studentId: string;
	method: 'self' | 'rep' | 'manual';
	repName?: string;
	repRegNumber?: string;
	studentLat?: number;
	studentLng?: number;
	accuracyM?: number;
	distanceM?: number;
	status: AttendanceStatus;
	submittedAt: number;
	overriddenBy?: string;
	overriddenAt?: number;
	prevStatus?: AttendanceStatus;
}
