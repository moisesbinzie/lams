export interface RosterRow {
	fullName: string;
	regNumber: string;
	studentId: string;
}

export function parseRosterCsv(text: string): RosterRow[] {
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) return [];
	const hasHeader = /name/i.test(lines[0]) && /reg/i.test(lines[0]);
	const body = hasHeader ? lines.slice(1) : lines;
	const rows: RosterRow[] = [];
	for (const line of body) {
		const parts = line.split(/[,;\t]/).map((p) => p.trim());
		if (parts.length < 3) continue;
		const [fullName, regNumber, studentId] = parts;
		if (!fullName || !regNumber || !studentId) continue;
		rows.push({ fullName, regNumber, studentId });
	}
	return rows.slice(0, 1000);
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
	const esc = (v: string | number) => {
		const s = String(v);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function downloadTextFile(filename: string, text: string, mime = 'text/csv'): void {
	const blob = new Blob([text], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
