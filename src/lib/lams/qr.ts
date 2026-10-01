import QRCode from 'qrcode';

export function buildAttendanceUrl(appUrl: string, sessionId: string, token: string): string {
	const base = appUrl.replace(/\/$/, '');
	return `${base}/a/${sessionId}?t=${token}`;
}

export async function qrDataUrl(text: string, size = 512): Promise<string> {
	return QRCode.toDataURL(text, { width: size, margin: 2, errorCorrectionLevel: 'M' });
}
