import { ACCOUNT, COLLECTIVE, DOCSPELL_URL, PASSWORD, USER } from './helpers';

const STARTUP_TIMEOUT_MS = 120_000;

async function waitForServer(): Promise<void> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	let lastError = 'no response';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${DOCSPELL_URL}/api/info/version`);
			if (response.ok) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = (error as Error).message;
		}
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error(
		`Docspell did not answer at ${DOCSPELL_URL} (${lastError}). ` +
			'Start it with: docker compose -f docker-compose.test.yml up -d',
	);
}

export default async function setup(): Promise<void> {
	await waitForServer();

	const response = await fetch(`${DOCSPELL_URL}/api/v1/open/signup/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ collectiveName: COLLECTIVE, login: USER, password: PASSWORD }),
	});
	const result = (await response.json()) as { success: boolean; message: string };
	// A second run finds the account already there, which is fine.
	if (!result.success && !/already exists/i.test(result.message)) {
		throw new Error(`Could not register ${ACCOUNT}: ${result.message}`);
	}
}
