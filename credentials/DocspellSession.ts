import { createHash } from 'node:crypto';

export interface DocspellLoginCredentials {
	url: string;
	account: string;
	password: string;
}

interface LoginResponse {
	success: boolean;
	message?: string;
	token?: string | null;
	validMs?: number;
	requireSecondFactor?: boolean;
}

interface CachedSession {
	token: string;
	expiresAt: number;
}

// Docspell sessions last validMs (5 minutes by default). Stop reusing one slightly
// early so a request never goes out with a token that expires in flight.
const EXPIRY_MARGIN_MS = 30_000;

// Why a per-process cache instead of n8n's `preAuthentication` + expirable token:
// n8n only re-authenticates after a 401, but Docspell answers an expired or invalid
// token with 403, so a stored token would stay stale until it was cleared by hand.
const sessions = new Map<string, CachedSession>();
const logins = new Map<string, Promise<string>>();

function baseUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

// The password is part of the key so changing it can never reuse the old session,
// and it is hashed so it is not kept around as a plain map key.
function cacheKey({ url, account, password }: DocspellLoginCredentials): string {
	return createHash('sha256')
		.update([baseUrl(url), account, password].join('\0'))
		.digest('hex');
}

async function login(credentials: DocspellLoginCredentials): Promise<CachedSession> {
	const url = baseUrl(credentials.url);

	let response: Response;
	try {
		response = await fetch(`${url}/api/v1/open/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ account: credentials.account, password: credentials.password }),
		});
	} catch (error) {
		const cause = (error as { cause?: { code?: string; message?: string } }).cause;
		const reason = cause?.code ?? cause?.message ?? (error as Error).message;
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- credential code has no node to attach; n8n wraps what authenticate throws
		throw new Error(`Could not reach Docspell at ${url}: ${reason}`);
	}

	if (!response.ok) {
		throw new Error(`Docspell login at ${url} failed with HTTP ${response.status}`);
	}

	let body: LoginResponse;
	try {
		body = (await response.json()) as LoginResponse;
	} catch {
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- credential code has no node to attach; n8n wraps what authenticate throws
		throw new Error(`Docspell login at ${url} returned a response that is not JSON`);
	}

	// A wrong password is an HTTP 200 with success: false.
	if (!body.success) {
		throw new Error(
			`Docspell login failed for account "${credentials.account}": ${body.message ?? 'no reason given'}`,
		);
	}
	if (body.requireSecondFactor) {
		throw new Error(
			`Docspell account "${credentials.account}" requires two-factor authentication, which this node does not support`,
		);
	}
	if (!body.token) {
		throw new Error(`Docspell login for account "${credentials.account}" returned no token`);
	}

	return {
		token: body.token,
		expiresAt: Date.now() + Math.max(0, (body.validMs ?? 0) - EXPIRY_MARGIN_MS),
	};
}

export async function getSessionToken(credentials: DocspellLoginCredentials): Promise<string> {
	const key = cacheKey(credentials);

	const cached = sessions.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.token;

	// Requests that start while a login is running wait for it instead of starting more.
	const running = logins.get(key);
	if (running) return running;

	const attempt = login(credentials)
		.then((session) => {
			sessions.set(key, session);
			return session.token;
		})
		.finally(() => logins.delete(key));
	logins.set(key, attempt);
	return attempt;
}

export function resetSessionCache(): void {
	sessions.clear();
	logins.clear();
}
