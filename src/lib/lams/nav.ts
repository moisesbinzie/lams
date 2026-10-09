// The signed-in student's own navigation.
//
// Kept here rather than inline in the layout because two places need the same
// list: the top bar decides which links to *drop* for a student, and the
// in-page strip renders what is left. Two hand-maintained copies would drift
// the first time a page is added.

import {
	BarChart3,
	BookOpen,
	CalendarDays,
	ScanLine,
	Settings,
	Settings2,
	ShieldCheck,
	UserRound
} from '@lucide/svelte';

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
	{ href: '/courses', label: 'Courses', icon: BookOpen }
];

/**
 * Where a lecturer can go. Same shape as {@link STUDENT_NAV} on purpose: the
 * lecturer strip (`lecturer-nav.svelte`) is the desktop header's twin for
 * narrow screens, so the two lists must offer the same destinations in the
 * same order. `How it works` stays in the chrome (header on desktop, footer
 * everywhere), exactly like the student strip.
 */
export const LECTURER_NAV: StudentNavItem[] = [
	{ href: '/manage', label: 'Set up', icon: Settings2 },
	{ href: '/scan', label: 'Take attendance', icon: ScanLine },
	{ href: '/records', label: 'Records', icon: BarChart3 },
	{ href: '/settings', label: 'Settings', icon: Settings }
];

/**
 * Where an admin can go. The admin console plus the setup and records tools —
 * deliberately no "Take attendance": admins manage accounts and assignments,
 * lecturers and reps run lectures.
 */
export const ADMIN_NAV: StudentNavItem[] = [
	{ href: '/admin', label: 'Admin', icon: ShieldCheck },
	{ href: '/manage', label: 'Set up', icon: Settings2 },
	{ href: '/records', label: 'Records', icon: BarChart3 },
	{ href: '/settings', label: 'Settings', icon: Settings }
];
