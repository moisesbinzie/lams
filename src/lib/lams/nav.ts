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
	/** One line under the label, used by the strip on wide screens. */
	hint: string;
}

/**
 * Where a student can go. Order is deliberate: the account itself first, then
 * the two things they open in a lecture (scan, timetable), then the records
 * they come back to check.
 */
export const STUDENT_NAV: StudentNavItem[] = [
	{ href: '/home', label: 'My account', icon: UserRound, hint: 'Your details' },
	{ href: '/scanner', label: 'Scan attendance', icon: ScanLine, hint: 'Point at the screen' },
	{ href: '/timetable', label: 'Timetable', icon: CalendarDays, hint: 'When classes meet' },
	{ href: '/attendance', label: 'My attendance', icon: BarChart3, hint: 'See and report errors' },
	{ href: '/courses', label: 'My subjects', icon: BookOpen, hint: 'Join or leave a subject' }
];
