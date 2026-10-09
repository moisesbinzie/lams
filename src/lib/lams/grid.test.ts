import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	clashingMeetingIds,
	columnLayout,
	DEFAULT_WINDOW,
	overlaps,
	rowCount,
	rowLabel,
	rowStarts,
	slotBox,
	snapToSlot,
	toClock,
	toMinutes
} from './grid.ts';

test('toMinutes accepts 24-hour times and rejects anything else', () => {
	assert.equal(toMinutes('00:00'), 0);
	assert.equal(toMinutes('09:05'), 545);
	assert.equal(toMinutes('23:59'), 1439);
	assert.equal(toMinutes('7:30'), null, 'a bare hour is not HH:MM');
	assert.equal(toMinutes('24:00'), null);
	assert.equal(toMinutes('12:60'), null);
	assert.equal(toMinutes(''), null);
	assert.equal(toMinutes('noon'), null);
});

test('toClock round-trips and wraps a wrapped day', () => {
	assert.equal(toClock(0), '00:00');
	assert.equal(toClock(545), '09:05');
	assert.equal(toClock(1440), '00:00');
	assert.equal(toClock(-60), '23:00');
});

test('snapToSlot floors to the quarter hour', () => {
	assert.equal(snapToSlot(0), 0);
	assert.equal(snapToSlot(7 * 60 + 14), 7 * 60);
	assert.equal(snapToSlot(7 * 60 + 15), 7 * 60 + 15);
	assert.equal(snapToSlot(7 * 60 + 59), 7 * 60 + 45);
	// A zero step would divide by zero; the guard returns the input untouched.
	assert.equal(snapToSlot(613, 0), 613);
});

test('the default window covers a teaching day in quarter-hour rows', () => {
	assert.equal(DEFAULT_WINDOW.startMin, 420);
	assert.equal(DEFAULT_WINDOW.endMin, 1260);
	assert.equal(rowCount(), 56);
	const starts = rowStarts();
	assert.equal(starts.length, 56);
	assert.equal(starts[0], 420);
	assert.equal(starts[starts.length - 1], 420 + 55 * 15);
});

test('rowLabel only names the hours, so the gutter stays quiet', () => {
	assert.equal(rowLabel(420), '07:00');
	assert.equal(rowLabel(435), '');
	assert.equal(rowLabel(1260), '21:00');
});

test('slotBox places a slot on the row it starts in', () => {
	assert.deepEqual(slotBox('09:00', '10:00'), { startRow: 9, spanRows: 4, clipped: false });
	assert.deepEqual(slotBox('09:15', '09:45'), { startRow: 10, spanRows: 2, clipped: false });
});

test('slotBox rounds a partial row up rather than losing it', () => {
	// 50 minutes is 3⅓ rows: the block must still be four rows tall.
	assert.deepEqual(slotBox('09:00', '09:50'), { startRow: 9, spanRows: 4, clipped: false });
	// 10 minutes is under a row, and a row is the smallest thing that renders.
	assert.deepEqual(slotBox('09:00', '09:10'), { startRow: 9, spanRows: 1, clipped: false });
});

test('slotBox clamps a slot that runs past the window and says so', () => {
	assert.deepEqual(slotBox('06:30', '08:00'), { startRow: 1, spanRows: 4, clipped: true });
	assert.deepEqual(slotBox('20:30', '22:00'), { startRow: 55, spanRows: 2, clipped: true });
});

test('slotBox refuses a slot with no height or unusable times', () => {
	assert.equal(slotBox('10:00', '10:00'), null);
	assert.equal(slotBox('10:00', '09:00'), null);
	assert.equal(slotBox('', '10:00'), null);
	assert.equal(slotBox('09:00', 'later'), null);
	// Entirely outside the window: nothing to draw.
	assert.equal(slotBox('04:00', '05:00'), null);
	assert.equal(slotBox('22:00', '23:00'), null);
});

test('overlaps is true only for the same day and genuinely shared time', () => {
	const a = { dayOfWeek: 1, startTime: '09:00', endTime: '10:00' };
	assert.equal(overlaps(a, { dayOfWeek: 1, startTime: '09:30', endTime: '10:30' }), true);
	assert.equal(overlaps(a, { dayOfWeek: 1, startTime: '08:30', endTime: '09:30' }), true);
	assert.equal(overlaps(a, { dayOfWeek: 2, startTime: '09:30', endTime: '10:30' }), false);
	// Touching edges are back-to-back lectures, not a clash.
	assert.equal(overlaps(a, { dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }), false);
	assert.equal(overlaps(a, { dayOfWeek: 1, startTime: '08:00', endTime: '09:00' }), false);
	// Swallowing the whole slot still counts.
	assert.equal(overlaps(a, { dayOfWeek: 1, startTime: '08:00', endTime: '11:00' }), true);
});

test('overlaps ignores slots whose times do not parse', () => {
	const a = { dayOfWeek: 1, startTime: '09:00', endTime: '10:00' };
	assert.equal(overlaps(a, { dayOfWeek: 1, startTime: 'oops', endTime: '10:00' }), false);
});

test('clashingMeetingIds marks both sides of a clash and nothing else', () => {
	const slots = [
		{ meetingId: 'a', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
		{ meetingId: 'b', dayOfWeek: 1, startTime: '09:30', endTime: '10:30' },
		{ meetingId: 'c', dayOfWeek: 1, startTime: '10:30', endTime: '11:30' },
		{ meetingId: 'd', dayOfWeek: 2, startTime: '09:30', endTime: '10:30' }
	];
	assert.deepEqual([...clashingMeetingIds(slots)].sort(), ['a', 'b']);
});

test('clashingMeetingIds is empty for an impossible week that is merely busy', () => {
	const slots = [
		{ meetingId: 'a', dayOfWeek: 1, startTime: '08:00', endTime: '10:00' },
		{ meetingId: 'b', dayOfWeek: 1, startTime: '10:00', endTime: '12:00' },
		{ meetingId: 'c', dayOfWeek: 1, startTime: '12:00', endTime: '14:00' }
	];
	assert.equal(clashingMeetingIds(slots).size, 0);
});

test('columnLayout leaves a normal week one column wide', () => {
	const layout = columnLayout([
		{ meetingId: 'a', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
		{ meetingId: 'b', dayOfWeek: 1, startTime: '11:00', endTime: '12:00' },
		{ meetingId: 'c', dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }
	]);
	for (const id of ['a', 'b', 'c']) {
		assert.deepEqual(layout.get(id), { column: 0, width: 1 });
	}
});

test('columnLayout makes room for two overlapping slots', () => {
	const layout = columnLayout([
		{ meetingId: 'a', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
		{ meetingId: 'b', dayOfWeek: 1, startTime: '09:30', endTime: '10:30' }
	]);
	assert.deepEqual(layout.get('a'), { column: 0, width: 2 });
	assert.deepEqual(layout.get('b'), { column: 1, width: 2 });
});

test('columnLayout reuses a freed column instead of widening for ever', () => {
	// Three lectures in a row, each overlapping only the next: the middle one
	// overlaps both, so it takes a second column, but the third can go back to
	// the first.
	const layout = columnLayout([
		{ meetingId: 'a', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
		{ meetingId: 'b', dayOfWeek: 1, startTime: '09:30', endTime: '10:30' },
		{ meetingId: 'c', dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }
	]);
	assert.equal(layout.get('a')?.column, 0);
	assert.equal(layout.get('b')?.column, 1);
	assert.equal(layout.get('c')?.column, 0, 'c starts as a ends, so column 0 is free again');
	assert.equal(layout.get('c')?.width, 2);
});

test('columnLayout separates runs on different days', () => {
	const layout = columnLayout([
		{ meetingId: 'a', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
		{ meetingId: 'b', dayOfWeek: 2, startTime: '09:30', endTime: '10:30' }
	]);
	assert.deepEqual(layout.get('a'), { column: 0, width: 1 });
	assert.deepEqual(layout.get('b'), { column: 0, width: 1 });
});

test('columnLayout ignores slots with no meeting id', () => {
	const layout = columnLayout([{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]);
	assert.equal(layout.size, 0);
});
