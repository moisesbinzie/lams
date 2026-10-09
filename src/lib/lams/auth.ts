// Client sign-in state. Students and class reps use registration-number +
// PIN; lecturers and admins use username + password (separate doors).
//
// A student's token is device-bound server-side: the first sign-in fixes the
// account to that phone, and any other device is refused until staff move it.
// That stops a borrowed phone being signed in as somebody else — but not
// someone copying both the token and the device id to another phone, since
// both live side by side in `localStorage` (see SECURITY.md).

const TOKEN_KEY = 'lams_token';
const DEVICE_KEY = 'lams_device_id';

/**
 * Stable per-browser device id. Random rather than hardware-fingerprinted: it
 * only needs to be stable and unique so the server can tell "the same phone"
 * from "a different phone".
 */
export function getDeviceId(): string {
	if (typeof localStorage === 'undefined') return 'server-render';
	let id = localStorage.getItem(DEVICE_KEY);
	if (!id) {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		id = Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		localStorage.setItem(DEVICE_KEY, id);
	}
	return id;
}

export function getToken(): string {
	if (typeof localStorage === 'undefined') return '';
	return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(TOKEN_KEY);
}