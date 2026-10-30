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

// Uploads create new items, which would change what the search tests count, so the
// upload tests use an account (and with it a collective) of their own.
export const UPLOAD_COLLECTIVE = 'e2e-upload';
export const UPLOAD_USER = 'uploader';
export const UPLOAD_ACCOUNT = `${UPLOAD_COLLECTIVE}/${UPLOAD_USER}`;
export const UPLOAD_TAG = 'upload-tag';
export const UPLOAD_FOLDER = 'upload-folder';

// Upload only attaches tags that already exist, so they are created first.
export const SEED_TAGS = [
	{ name: 'e2e-invoice', category: 'finance' },
	{ name: 'e2e-contract', category: 'legal' },
];

// Reference data the update tests assign to items.
export const SEED_FOLDER = 'e2e-folder';
export const SEED_ORGANIZATION = 'e2e-org';
// The only organization with a short name, which Item Get and Search do not show.
export const SEED_SHORT_ORGANIZATION = 'e2e-short-org';
export const SEED_SHORT_NAME = 'e2eshort';
export const SEED_PERSON = 'e2e-person';
export const SEED_EQUIPMENT = 'e2e-device';
export const SEED_CUSTOM_FIELD = 'e2e-ref';

// The update tests change this item and put it back; it carries no tag.
export const UPDATE_TARGET = 'update-target.txt';

// Bytes that are not valid UTF-8, to prove that a download is not decoded as text on the way.
export const LATIN1_DOCUMENT = 'latin1-sample.txt';
export const LATIN1_BYTES = Uint8Array.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0xe4, 0xf6, 0xff, 0x0a]);

export const SEED_DOCUMENTS = [
	{ name: 'invoice-alpha.txt', tag: 'e2e-invoice', text: 'Invoice alpha from zebrafruit GmbH. Total 100 CHF.' },
	{ name: 'invoice-beta.txt', tag: 'e2e-invoice', text: 'Invoice beta from zebrafruit GmbH. Total 250 CHF.' },
	{ name: 'contract-gamma.txt', tag: 'e2e-contract', text: 'Contract gamma between the parties, signed in Bern.' },
	{ name: UPDATE_TARGET, tag: null, text: 'A scratch document that the update tests edit.' },
	{ name: LATIN1_DOCUMENT, tag: null, bytes: LATIN1_BYTES },
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

async function registerAndLogin(url, collective = COLLECTIVE, user = USER) {
	const account = `${collective}/${user}`;
	const registered = await api(url, null, '/open/signup/register', json({ collectiveName: collective, login: user, password: PASSWORD }));
	if (!registered.success && !/already exists/i.test(registered.message)) {
		throw new Error(`Could not register ${account}: ${registered.message}`);
	}
	const session = await api(url, null, '/open/auth/login', json({ account, password: PASSWORD }));
	if (!session.success) throw new Error(`Could not log in as ${account}: ${session.message}`);
	return session.token;
}

async function search(url, token, query) {
	const result = await api(url, token, '/sec/item/search', json({ query, limit: 100, offset: 0, withDetails: true }));
	return result.groups.flatMap((group) => group.items);
}

const noAddress = { street: '', zip: '', city: '', country: '' };

// Folders, organizations, people, equipment and a custom field, created once.
async function seedReferenceData(url, token) {
	const missing = async (path, name) => !(await api(url, token, path)).items.some((entry) => entry.name === name);
	const create = async (path, body) => {
		const result = await api(url, token, path, json(body));
		if (!result.success) throw new Error(`POST ${path} failed: ${result.message}`);
	};

	if (await missing('/sec/folder', SEED_FOLDER)) await create('/sec/folder', { name: SEED_FOLDER });
	if (await missing('/sec/organization', SEED_ORGANIZATION)) {
		await create('/sec/organization', { id: '', created: 0, name: SEED_ORGANIZATION, address: noAddress, contacts: [], use: 'correspondent' });
	}
	if (await missing('/sec/organization', SEED_SHORT_ORGANIZATION)) {
		await create('/sec/organization', {
			id: '',
			created: 0,
			name: SEED_SHORT_ORGANIZATION,
			shortName: SEED_SHORT_NAME,
			address: noAddress,
			contacts: [],
			use: 'correspondent',
		});
	}
	if (await missing('/sec/person', SEED_PERSON)) {
		await create('/sec/person', { id: '', created: 0, name: SEED_PERSON, address: noAddress, contacts: [], use: 'both' });
	}
	if (await missing('/sec/equipment', SEED_EQUIPMENT)) {
		await create('/sec/equipment', { id: '', created: 0, name: SEED_EQUIPMENT, use: 'concerning' });
	}
	if (await missing('/sec/customfield', SEED_CUSTOM_FIELD)) {
		await create('/sec/customfield', { name: SEED_CUSTOM_FIELD, label: 'E2E Ref', ftype: 'text' });
	}
}

// The upload account only needs a tag and a folder to upload into; its items come from the tests.
async function seedUploadAccount(url) {
	const token = await registerAndLogin(url, UPLOAD_COLLECTIVE, UPLOAD_USER);
	if (!(await api(url, token, '/sec/tag')).items.some((tag) => tag.name === UPLOAD_TAG)) {
		await api(url, token, '/sec/tag', json({ id: '', created: 0, name: UPLOAD_TAG, category: 'upload' }));
	}
	if (!(await api(url, token, '/sec/folder')).items.some((folder) => folder.name === UPLOAD_FOLDER)) {
		const created = await api(url, token, '/sec/folder', json({ name: UPLOAD_FOLDER }));
		if (!created.success) throw new Error(`Could not create folder ${UPLOAD_FOLDER}: ${created.message}`);
	}
}

export async function seed(url = DOCSPELL_URL) {
	await waitForServer(url);
	await seedUploadAccount(url);
	const token = await registerAndLogin(url);

	const existingTags = (await api(url, token, '/sec/tag')).items.map((tag) => tag.name);
	for (const tag of SEED_TAGS.filter((tag) => !existingTags.includes(tag.name))) {
		// The request body is a full Tag; the server assigns the real id and date.
		await api(url, token, '/sec/tag', json({ id: '', created: 0, ...tag }));
	}

	await seedReferenceData(url, token);

	for (const doc of SEED_DOCUMENTS) {
		if ((await search(url, token, `name:${doc.name}`)).length > 0) continue;
		const form = new FormData();
		form.append('meta', new Blob([JSON.stringify({ multiple: false, tags: { items: doc.tag ? [doc.tag] : [] } })], { type: 'application/json' }));
		form.append('file', new Blob([doc.bytes ?? doc.text], { type: 'text/plain' }), doc.name);
		const uploaded = await api(url, token, '/sec/upload/item', { method: 'POST', body: form });
		if (!uploaded.success) throw new Error(`Upload of ${doc.name} failed: ${uploaded.message}`);
	}

	// Items show up once the job runner has processed them, tags last.
	const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
	for (;;) {
		const items = await search(url, token, 'name:*');
		const ready = SEED_DOCUMENTS.every((doc) =>
			items.some((item) => item.name === doc.name && (!doc.tag || item.tags.some((tag) => tag.name === doc.tag))),
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
