import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterCsv, toCsv } from './csv.ts';

describe('parseRosterCsv', () => {
	it('parses comma separated rows into roster entries', () => {
		const rows = parseRosterCsv('Amina Banda, BIT/2024/0123, 2024-0123');
		assert.deepEqual(rows, [{ fullName: 'Amina Banda', regNumber: 'BIT/2024/0123', studentId: '2024-0123' }]);
	});

	it('skips a header line and trims whitespace', () => {
		const rows = parseRosterCsv(
			'Full Name, Reg Number, Student ID\n  John Phiri , BIT/2024/0124 , 2024-0124 \n'
		);
		assert.equal(rows.length, 1);
		assert.deepEqual(rows[0], { fullName: 'John Phiri', regNumber: 'BIT/2024/0124', studentId: '2024-0124' });
	});

	it('accepts semicolon and tab separators', () => {
		const rows = parseRosterCsv('A B; r1; s1\nC D\tr2\ts2');
		assert.equal(rows.length, 2);
		assert.equal(rows[1].regNumber, 'r2');
	});

	it('drops malformed rows instead of failing the whole import', () => {
		const rows = parseRosterCsv('Only One Field\nValid Name, REG9, SID9\nMissing id, REG8');
		assert.equal(rows.length, 1);
		assert.equal(rows[0].regNumber, 'REG9');
	});

	it('returns an empty list for empty or blank input', () => {
		assert.deepEqual(parseRosterCsv(''), []);
		assert.deepEqual(parseRosterCsv('\n   \n\t\n'), []);
	});

	it('caps an import at 1000 rows', () => {
		const line = 'Name{i}, REG{i}, SID{i}';
		const big = Array.from({ length: 1200 }, (_, i) => line.replace(/\{i\}/g, String(i))).join('\n');
		assert.equal(parseRosterCsv(big).length, 1000);
	});
});

describe('toCsv', () => {
	it('joins headers and rows with plain values', () => {
		assert.equal(toCsv(['A', 'B'], [[1, 'two']]), 'A,B\n1,two');
	});

	it('quotes values containing commas, quotes or newlines', () => {
		const out = toCsv(['name'], [['Banda, Amina "M"']]);
		assert.equal(out, 'name\n"Banda, Amina ""M"""');
	});
});
