export interface GeoPoint {
	lat: number;
	lng: number;
	accuracyM?: number;
}

export function getCurrentPosition(timeoutMs = 15000): Promise<GeoPoint> {
	return new Promise((resolve, reject) => {
		if (!('geolocation' in navigator)) {
			reject(new Error('Geolocation not supported on this device.'));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
			(err) => reject(new Error(err.message || 'Location permission denied.')),
			{ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 }
		);
	});
}

export function formatDistance(m: number | null | undefined): string {
	if (m === null || m === undefined) return '—';
	if (m < 1000) return `${Math.round(m)} m`;
	return `${(m / 1000).toFixed(2)} km`;
}

export function formatCountdown(msLeft: number): string {
	if (msLeft <= 0) return 'Expired';
	const s = Math.floor(msLeft / 1000);
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${r.toString().padStart(2, '0')}`;
}
