import { ConvexClient } from 'convex/browser';
import { env as publicEnv } from '$env/dynamic/public';

let client: ConvexClient | null = null;

export function getConvexUrl(): string | undefined {
	return publicEnv.PUBLIC_CONVEX_URL || (import.meta.env.VITE_CONVEX_URL as string | undefined);
}

export function getConvexClient(): ConvexClient | null {
	const url = getConvexUrl();
	if (!url) return null;
	if (!client) client = new ConvexClient(url);
	return client;
}

export function requireConvexClient(): ConvexClient {
	const c = getConvexClient();
	if (!c)
		throw new Error(
			'Convex URL is not set. Add PUBLIC_CONVEX_URL to .env.local (see .env.example) and restart the dev server.'
		);
	return c;
}
