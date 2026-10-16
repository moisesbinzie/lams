export interface GeoPoint {
	lat: number;
	lng: number;
	accuracyM?: number;
}

export function getCurrentPosition(timeoutMs = 20000): Promise<GeoPoint> {
	return new Promise((resolve, reject) => {
		if (!('geolocation' in navigator)) {
			reject(new Error('Geolocation not supported on this device.'));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
			(err) => reject(new Error(err.message || 'Location permission denied.')),
			// A cached fix is what pins a room hundreds of metres off: the last
			// reading may be from outside the building or another street entirely.
			// Always take a fresh one here, even if it takes longer indoors.
			{ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
		);
	});
}

/**
 * Best-of sampling for the student scan.
 *
 * A single snapshot indoors is often the first, coarsest fix — network
 * location before GPS settles — which is exactly what used to turn honest
 * scans into Out_of_Range rows or flagged reviews. Watching for a few seconds
 * and keeping the most accurate fix costs a short spinner and buys a verdict
 * the server can actually trust.
 *
 * Resolves early once a fix beats `goodEnoughM`, otherwise with the best fix
 * seen within `budgetMs`. Falls back to one single shot when the watch errors
 * or yields nothing, so this is never worse than `getCurrentPosition` alone.
 * `onFix` reports each improvement so the UI can show "best so far ±X m".
 */
export function getBestPosition(
	opts: { budgetMs?: number; goodEnoughM?: number; onFix?: (fix: GeoPoint) => void } = {}
): Promise<GeoPoint> {
	const { budgetMs = 8000, goodEnoughM = 25, onFix } = opts;
	return new Promise((resolve, reject) => {
		if (!('geolocation' in navigator)) {
			reject(new Error('Geolocation not supported on this device.'));
			return;
		}
		let best: GeoPoint | null = null;
		let done = false;
		let watchId = -1;
		const stop = () => {
			if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
			watchId = -1;
		};
		const settleBest = () => {
			if (done || !best) return;
			done = true;
			const fix = best;
			stop();
			resolve(fix);
		};
		const settleFallback = () => {
			if (done) return;
			done = true;
			stop();
			void getCurrentPosition(10000).then(resolve, reject);
		};
		const score = (p: GeoPoint) => p.accuracyM ?? Number.MAX_SAFE_INTEGER;
		watchId = navigator.geolocation.watchPosition(
			(pos) => {
				const fix: GeoPoint = {
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
					accuracyM: pos.coords.accuracy
				};
				if (!best || score(fix) < score(best)) {
					best = fix;
					onFix?.(fix);
				}
				if ((fix.accuracyM ?? Number.MAX_SAFE_INTEGER) <= goodEnoughM) settleBest();
			},
			() => {
				if (best) settleBest();
				else settleFallback();
			},
			{ enableHighAccuracy: true, timeout: budgetMs, maximumAge: 0 }
		);
		setTimeout(() => {
			if (best) settleBest();
			else settleFallback();
		}, budgetMs);
	});
}

export function formatDistance(m: number | null | undefined): string {	if (m === null || m === undefined) return '—';
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

/**
 * Metres between two coordinates. Client-side copy of the server's haversine,
 * used to warn before pinning far from where a course usually meets — the
 * server re-checks on start and remains the authority.
 */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	return 2 * R * Math.asin(Math.sqrt(a));
}
