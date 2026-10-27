import type { ICredentialDataDecryptedObject, IHttpRequestOptions } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocspellApi } from '../credentials/DocspellApi.credentials';
import { resetSessionCache } from '../credentials/DocspellSession';
import { ACCOUNT, DOCSPELL_URL, PASSWORD } from './helpers';

const AUTH_HEADER = 'X-Docspell-Auth';

function credentials(overrides: Partial<ICredentialDataDecryptedObject> = {}) {
	return { url: DOCSPELL_URL, account: ACCOUNT, password: PASSWORD, ...overrides };
}

// What n8n does with a credential's `authenticate` function: hand it the stored
// credentials and the outgoing request, and send whatever comes back.
async function authenticate(
	creds: ICredentialDataDecryptedObject,
	request: IHttpRequestOptions = { url: `${DOCSPELL_URL}/api/v1/sec/tag` },
): Promise<IHttpRequestOptions> {
	const { authenticate: fn } = new DocspellApi();
	if (typeof fn !== 'function') throw new Error('expected authenticate to be a function');
	return fn(creds, request);
}

// A protected route: it answers 403 unless the token is a currently valid one.
async function callProtectedRoute(token: unknown) {
	return fetch(`${DOCSPELL_URL}/api/v1/sec/tag`, {
		headers: { [AUTH_HEADER]: String(token) },
	});
}

function loginCalls(spy: ReturnType<typeof vi.spyOn>) {
	return spy.mock.calls.filter(([input]) => String(input).endsWith('/open/auth/login'));
}

// Tokens are cached per process; every test starts with an empty cache.
beforeEach(() => {
	resetSessionCache();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('DocspellApi.authenticate against a real Docspell', () => {
	it('adds a token the server accepts and keeps the rest of the request', async () => {
		const request = {
			url: `${DOCSPELL_URL}/api/v1/sec/tag`,
			method: 'GET' as const,
			headers: { Accept: 'application/json' },
		};

		const result = await authenticate(credentials(), request);

		expect(result.headers).toMatchObject({ Accept: 'application/json' });
		const token = (result.headers as Record<string, string>)[AUTH_HEADER];
		expect(token).toBeTruthy();
		expect(token).not.toBe('undefined');
		expect((await callProtectedRoute(token)).status).toBe(200);
		expect(result.url).toBe(request.url);
	});

	it('accepts a URL with a trailing slash', async () => {
		const result = await authenticate(credentials({ url: `${DOCSPELL_URL}/` }));
		const token = (result.headers as Record<string, string>)[AUTH_HEADER];

		expect((await callProtectedRoute(token)).status).toBe(200);
	});

	it('rejects a wrong password with the server message instead of sending a bad token', async () => {
		await expect(authenticate(credentials({ password: 'not-the-password' }))).rejects.toThrow(
			/login failed/i,
		);
	});

	it('names the account in the error so a typo is easy to spot', async () => {
		await expect(authenticate(credentials({ account: 'e2e/nobody' }))).rejects.toThrow(
			/e2e\/nobody/,
		);
	});

	it('fails clearly when the server cannot be reached', async () => {
		await expect(authenticate(credentials({ url: 'http://127.0.0.1:9' }))).rejects.toThrow(
			/127\.0\.0\.1:9/,
		);
	});
});

describe('DocspellApi.authenticate token caching', () => {
	it('logs in once for several requests', async () => {
		const spy = vi.spyOn(globalThis, 'fetch');
		const creds = credentials();

		await authenticate(creds);
		await authenticate(creds);
		await authenticate(creds);

		expect(loginCalls(spy)).toHaveLength(1);
	});

	it('logs in once even when the requests start at the same time', async () => {
		const spy = vi.spyOn(globalThis, 'fetch');
		const creds = credentials();

		await Promise.all([authenticate(creds), authenticate(creds), authenticate(creds)]);

		expect(loginCalls(spy)).toHaveLength(1);
	});

	it('logs in again once the token has expired', async () => {
		const spy = vi.spyOn(globalThis, 'fetch');
		vi.useFakeTimers({ toFake: ['Date'] });
		const creds = credentials();

		await authenticate(creds);
		// The server issues tokens that live for 5 minutes (validMs: 300000).
		vi.advanceTimersByTime(5 * 60 * 1000);
		await authenticate(creds);

		expect(loginCalls(spy)).toHaveLength(2);
	});

	it('does not reuse a token for different credentials', async () => {
		const spy = vi.spyOn(globalThis, 'fetch');

		await authenticate(credentials());
		await expect(authenticate(credentials({ password: 'changed' }))).rejects.toThrow(
			/login failed/i,
		);

		expect(loginCalls(spy)).toHaveLength(2);
	});

	it('does not cache a failed login', async () => {
		const spy = vi.spyOn(globalThis, 'fetch');
		const bad = credentials({ password: 'still-wrong' });

		await expect(authenticate(bad)).rejects.toThrow();
		await expect(authenticate(bad)).rejects.toThrow();

		expect(loginCalls(spy)).toHaveLength(2);
	});
});

describe('DocspellApi.authenticate with unusual server answers', () => {
	function stubLogin(body: unknown, init: ResponseInit = { status: 200 }) {
		return vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(JSON.stringify(body), init));
	}

	it('explains that two-factor accounts are not supported', async () => {
		stubLogin({
			success: true,
			message: 'Login successful',
			token: 'second-factor-token',
			requireSecondFactor: true,
			validMs: 300000,
		});

		await expect(authenticate(credentials({ url: 'http://2fa.test' }))).rejects.toThrow(
			/two-factor/i,
		);
	});

	it('reports an HTTP error status from the login endpoint', async () => {
		stubLogin({ message: 'boom' }, { status: 500 });

		await expect(authenticate(credentials({ url: 'http://broken.test' }))).rejects.toThrow(/500/);
	});

	it('rejects a successful login that carries no token', async () => {
		stubLogin({ success: true, message: 'ok', token: null, requireSecondFactor: false });

		await expect(authenticate(credentials({ url: 'http://notoken.test' }))).rejects.toThrow(
			/token/i,
		);
	});
});
