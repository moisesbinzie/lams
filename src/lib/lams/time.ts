// Small time/formatting helpers shared by the student, rep and lecturer screens.

export function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(ts: number): string {
	return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(ts: number): string {
	return new Date(ts).toLocaleDateString([], { dateStyle: 'medium' });
}

/** 0–100 percentage of the session window that has elapsed. */
export function elapsedPct(startedAt: number, closesAt: number, now: number): number {
	const total = closesAt - startedAt;
	if (total <= 0) return 100;
	return Math.min(100, Math.max(0, ((now - startedAt) / total) * 100));
}

export function isPast(closesAt: number, now: number): boolean {
	return now >= closesAt;
}
