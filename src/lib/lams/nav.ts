// The signed-in student's own navigation.
//
// Kept here rather than inline in the layout because two places need the same
// list: the top bar decides which links to *drop* for a student, and the
// in-page strip renders what is left. Two hand-maintained copies would drift
// the first time a page is added.

import { BarChart3, BookOpen, CalendarDays, ScanLine, UserRound } from '@lucide/svelte';

export interface StudentNavItem {
	href: string;
	label: string;
	icon: typeof UserRound;
}

/**
 * Where a student can go. Order is deliberate: the account itself first, then
 * what they open in a lecture (scan, timetable), then the records they come
 * back to check.
 *
 * Labels are kept short on purpose — this renders as a single row inside the
 * page, and the narrowest student page (`/scanner`) is `max-w-md`.
 */
export const STUDENT_NAV: StudentNavItem[] = [
	{ href: '/home', label: 'My account', icon: UserRound },
	{ href: '/scanner', label: 'Scan', icon: ScanLine },
	{ href: '/timetable', label: 'Timetable', icon: CalendarDays },
	{ href: '/attendance', label: 'Attendance', icon: BarChart3 },
	{ href: '/courses', label: 'Subjects', icon: BookOpen }
];
