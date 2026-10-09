/**
 * Pure layout maths for the timetable spreadsheet.
 *
 * Kept out of the component on purpose: everything here is arithmetic on times
 * and minutes, it is the part most likely to be wrong at a boundary (a slot
 * ending exactly at the last row, a slot starting before the grid opens), and
 * it can be tested without rendering anything.
 */

/** Grid rows are whole quarter hours — fine enough to place any real slot. */
export const SLOT_MINUTES = 15;

export interface GridWindow {
	/** Minutes since midnight of the first row. */
	startMin: number;
	/** Minutes since midnight of the last row's end. */
	endMin: number;
}

/** 07:00 to 21:00 — a full teaching day with room either side. */
export const DEFAULT_WINDOW: GridWindow = { startMin: 7 * 60, endMin: 21 * 60 };

/** 'HH:MM' → minutes since midnight, or null when it is not a valid time. */
export function toMinutes(time: string): number | null {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
	if (!m) return null;
	return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight → 'HH:MM'. Wraps within the day so a clamped time stays valid. */
export function toClock(minutes: number): string {
	const day = 24 * 60;
	const wrapped = ((Math.round(minutes) % day) + day) % day;
	const h = Math.floor(wrapped / 60);
	const m = wrapped % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Snap minutes down to the nearest quarter hour. */
export function snapToSlot(minutes: number, step = SLOT_MINUTES): number {
	if (step <= 0) return minutes;
	return Math.floor(minutes / step) * step;
}

/** How many rows the window covers. Always at least one. */
export function rowCount(window: GridWindow = DEFAULT_WINDOW, step = SLOT_MINUTES): number {
	return Math.max(1, Math.ceil((window.endMin - window.startMin) / step));
}

/** Every row's start time, top to bottom. */
export function rowStarts(window: GridWindow = DEFAULT_WINDOW, step = SLOT_MINUTES): number[] {
	const count = rowCount(window, step);
	return Array.from({ length: count }, (_, i) => window.startMin + i * step);
}

/** The time label for a row — blank on the quarters, so the gutter stays readable. */
export function rowLabel(minutes: number): string {
	return minutes % 60 === 0 ? toClock(minutes) : '';
}

export interface SlotBox {
	/** 1-based grid row the block starts on, relative to the window. */
	startRow: number;
	/** How many rows the block spans. Never less than one. */
	spanRows: number;
	/** True when the slot was cut off by the window's top or bottom edge. */
	clipped: boolean;
}

/**
 * Where a slot sits in the grid, and how tall it is.
 *
 * A slot that starts before the window opens or ends after it closes is clamped
 * rather than dropped: a 06:30 lecture still has to be visible, or the grid
 * would quietly lie about the week. `clipped` lets the cell say so.
 */
export function slotBox(
	startTime: string,
	endTime: string,
	window: GridWindow = DEFAULT_WINDOW,
	step = SLOT_MINUTES
): SlotBox | null {
	const start = toMinutes(startTime);
	const end = toMinutes(endTime);
	if (start === null || end === null || end <= start) return null;
	const safeStep = step > 0 ? step : SLOT_MINUTES;
	const top = Math.max(start, window.startMin);
	const bottom = Math.min(end, window.endMin);
	if (bottom <= top) return null;
	const startRow = Math.floor((top - window.startMin) / safeStep) + 1;
	// Round the height up to a whole row so a 50-minute lecture does not lose
	// its last five minutes to the floor.
	const spanRows = Math.max(1, Math.ceil((bottom - top) / safeStep));
	return {
		startRow,
		spanRows,
		clipped: start < window.startMin || end > window.endMin
	};
}

export interface SlotLike {
	meetingId?: string;
	dayOfWeek: number;
	startTime: string;
	endTime: string;
	courseCode?: string;
}

/** Do two slots on the same day overlap in time? Touching edges do not count. */
export function overlaps(a: SlotLike, b: SlotLike): boolean {
	if (a.dayOfWeek !== b.dayOfWeek) return false;
	const aStart = toMinutes(a.startTime);
	const aEnd = toMinutes(a.endTime);
	const bStart = toMinutes(b.startTime);
	const bEnd = toMinutes(b.endTime);
	if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;
	return aStart < bEnd && bStart < aEnd;
}

/**
 * Meeting ids that collide with at least one other slot in the same week.
 *
 * Room and lecturer are ignored on purpose: a student is only ever in one of
 * the two courses, so the pair that matters is "same day, overlapping time,
 * same program and semester". Anything else is the admin's own business.
 */
export function clashingMeetingIds(slots: SlotLike[]): Set<string> {
	const out = new Set<string>();
	for (let i = 0; i < slots.length; i += 1) {
		for (let j = i + 1; j < slots.length; j += 1) {
			if (!overlaps(slots[i], slots[j])) continue;
			const a = slots[i].meetingId;
			const b = slots[j].meetingId;
			if (a) out.add(a);
			if (b) out.add(b);
		}
	}
	return out;
}

/**
 * Side-by-side placement for slots that share a cell, so two clashing lectures
 * are both readable instead of one hiding the other.
 *
 * Runs of overlapping slots are packed in order of start time — a later slot
 * takes the first column no earlier slot still occupying that time is using.
 * Comparing within a run rather than against every other slot is deliberate:
 * two lectures that never meet in time share a column, which is what keeps a
 * normal week one column wide. A slot with no overlap gets `{ column: 0, width: 1 }`.
 */
export function columnLayout(slots: SlotLike[]): Map<string, { column: number; width: number }> {
	const out = new Map<string, { column: number; width: number }>();
	for (const slot of slots) {
		if (slot.meetingId) out.set(slot.meetingId, { column: 0, width: 1 });
	}

	// Group by day, then sweep left to right.
	const days = new Map<number, SlotLike[]>();
	for (const slot of slots) {
		if (!slot.meetingId) continue;
		if (!days.has(slot.dayOfWeek)) days.set(slot.dayOfWeek, []);
		days.get(slot.dayOfWeek)!.push(slot);
	}

	for (const daySlots of days.values()) {
		const ordered = [...daySlots].sort(
			(a, b) => (toMinutes(a.startTime) ?? 0) - (toMinutes(b.startTime) ?? 0)
		);
		const current: { end: number; column: number }[] = [];
		const placed: { id: string; column: number }[] = [];
		let widest = 1;
		for (const slot of ordered) {
			const start = toMinutes(slot.startTime) ?? 0;
			const end = toMinutes(slot.endTime) ?? start;
			for (let i = current.length - 1; i >= 0; i -= 1) {
				if (current[i].end <= start) current.splice(i, 1);
			}
			const taken = new Set(current.map((c) => c.column));
			let column = 0;
			while (taken.has(column)) column += 1;
			current.push({ end, column });
			placed.push({ id: String(slot.meetingId), column });
			widest = Math.max(widest, current.length, column + 1);
		}
		for (const item of placed) out.set(item.id, { column: item.column, width: widest });
	}
	return out;
}
