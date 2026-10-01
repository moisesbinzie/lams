const KEY = 'lams_admin_pw';

export function getAdminPassword(): string {
	if (typeof sessionStorage === 'undefined') return '';
	return sessionStorage.getItem(KEY) ?? '';
}

export function setAdminPassword(pw: string): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(KEY, pw);
}

export function clearAdminPassword(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(KEY);
}

export function isAdminUnlocked(): boolean {
	return getAdminPassword().length > 0;
}
