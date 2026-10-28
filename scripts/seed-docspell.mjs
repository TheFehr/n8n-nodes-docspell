// Registers the test account and seeds a few documents into a throwaway Docspell
// instance. Shared by the vitest global setup and the full pipeline script.
//
//   node scripts/seed-docspell.mjs        (DOCSPELL_URL defaults to http://localhost:7880)
//
// Idempotent: a second run finds the account, tags and documents already there.

export const DOCSPELL_URL = process.env.DOCSPELL_URL ?? 'http://localhost:7880';
export const COLLECTIVE = 'e2e';
export const USER = 'tester';
export const ACCOUNT = `${COLLECTIVE}/${USER}`;
export const PASSWORD = 'test-password-1';

// Upload only attaches tags that already exist, so they are created first.
export const SEED_TAGS = [
	{ name: 'e2e-invoice', category: 'finance' },
	{ name: 'e2e-contract', category: 'legal' },
];

export const SEED_DOCUMENTS = [
	{ name: 'invoice-alpha.txt', tag: 'e2e-invoice', text: 'Invoice alpha from zebrafruit GmbH. Total 100 CHF.' },
	{ name: 'invoice-beta.txt', tag: 'e2e-invoice', text: 'Invoice beta from zebrafruit GmbH. Total 250 CHF.' },
	{ name: 'contract-gamma.txt', tag: 'e2e-contract', text: 'Contract gamma between the parties, signed in Bern.' },
];

const STARTUP_TIMEOUT_MS = 120_000;
const PROCESSING_TIMEOUT_MS = 180_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForServer(url = DOCSPELL_URL) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	let lastError = 'no response';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${url}/api/info/version`);
			if (response.ok) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error.message;
		}
		await sleep(2_000);
	}
	throw new Error(
		`Docspell did not answer at ${url} (${lastError}). ` +
			'Start it with: docker compose -f docker-compose.test.yml up -d',
	);
}

async function api(url, token, path, init = {}) {
	const response = await fetch(`${url}/api/v1${path}`, {
		...init,
		headers: { ...(token ? { 'X-Docspell-Auth': token } : {}), ...init.headers },
	});
	if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${response.status}`);
	return response.json();
}

const json = (body) => ({
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
});

async function registerAndLogin(url) {
	const registered = await api(url, null, '/open/signup/register', json({ collectiveName: COLLECTIVE, login: USER, password: PASSWORD }));
	if (!registered.success && !/already exists/i.test(registered.message)) {
		throw new Error(`Could not register ${ACCOUNT}: ${registered.message}`);
	}
	const session = await api(url, null, '/open/auth/login', json({ account: ACCOUNT, password: PASSWORD }));
	if (!session.success) throw new Error(`Could not log in as ${ACCOUNT}: ${session.message}`);
	return session.token;
}

async function search(url, token, query) {
	const result = await api(url, token, '/sec/item/search', json({ query, limit: 100, offset: 0, withDetails: true }));
	return result.groups.flatMap((group) => group.items);
}

export async function seed(url = DOCSPELL_URL) {
	await waitForServer(url);
	const token = await registerAndLogin(url);

	const existingTags = (await api(url, token, '/sec/tag')).items.map((tag) => tag.name);
	for (const tag of SEED_TAGS.filter((tag) => !existingTags.includes(tag.name))) {
		// The request body is a full Tag; the server assigns the real id and date.
		await api(url, token, '/sec/tag', json({ id: '', created: 0, ...tag }));
	}

	for (const doc of SEED_DOCUMENTS) {
		if ((await search(url, token, `name:${doc.name}`)).length > 0) continue;
		const form = new FormData();
		form.append('meta', new Blob([JSON.stringify({ multiple: false, tags: { items: [doc.tag] } })], { type: 'application/json' }));
		form.append('file', new Blob([doc.text], { type: 'text/plain' }), doc.name);
		const uploaded = await api(url, token, '/sec/upload/item', { method: 'POST', body: form });
		if (!uploaded.success) throw new Error(`Upload of ${doc.name} failed: ${uploaded.message}`);
	}

	// Items show up once the job runner has processed them, tags last.
	const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
	for (;;) {
		const items = await search(url, token, 'name:*');
		const ready = SEED_DOCUMENTS.every((doc) =>
			items.some((item) => item.name === doc.name && item.tags.some((tag) => tag.name === doc.tag)),
		);
		if (ready) return;
		if (Date.now() > deadline) {
			throw new Error(`Seeded documents were not processed in time (saw: ${items.map((i) => i.name).join(', ') || 'nothing'})`);
		}
		await sleep(2_000);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	seed().then(
		() => console.log(`Seeded ${SEED_DOCUMENTS.length} documents for ${ACCOUNT} at ${DOCSPELL_URL}`),
		(error) => {
			console.error(`Seeding failed: ${error.message}`);
			process.exit(1);
		},
	);
}
