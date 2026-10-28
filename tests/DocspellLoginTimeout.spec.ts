import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSessionToken, resetSessionCache } from '../credentials/DocspellSession';

// A Docspell that takes the connection and never sends a response.
let server: Server;
let requestsReceived: number;
let url: string;
// What the stalled server does with a request: nothing, or headers and then silence.
let sendHeaders = false;

beforeEach(async () => {
	resetSessionCache();
	requestsReceived = 0;
	sendHeaders = false;
	server = createServer((_request, response) => {
		requestsReceived++;
		if (sendHeaders) {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.write('{"success":');
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

const credentials = () => ({ url, account: 'e2e/tester', password: 'x' });

describe('login against a server that never answers', () => {
	it('gives up after the timeout and says Docspell could not be reached', async () => {
		const started = Date.now();

		await expect(getSessionToken(credentials(), 300)).rejects.toThrow(/could not reach docspell/i);
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it('lets every caller waiting on the stalled login fail, and the next call tries again', async () => {
		const waiting = [getSessionToken(credentials(), 300), getSessionToken(credentials(), 300)];
		const results = await Promise.allSettled(waiting);

		expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
		expect(requestsReceived).toBe(1);

		await expect(getSessionToken(credentials(), 300)).rejects.toThrow(/could not reach docspell/i);
		expect(requestsReceived).toBe(2);
	});

	it('reports a body that stalls after the headers as a timeout, not as invalid JSON', async () => {
		sendHeaders = true;

		await expect(getSessionToken(credentials(), 300)).rejects.toThrow(/could not reach docspell.*time/i);
	});
});
