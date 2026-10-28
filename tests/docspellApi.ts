import { getSessionToken } from '../credentials/DocspellSession';
import { ACCOUNT, DOCSPELL_URL, PASSWORD } from './helpers';

// Direct calls to Docspell, for setting up and checking state independently of the node.
// The responses are checked field by field in the tests, so they stay loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function docspell<T = any>(method: string, path: string, body?: unknown): Promise<T> {
	const token = await getSessionToken({ url: DOCSPELL_URL, account: ACCOUNT, password: PASSWORD });
	const response = await fetch(`${DOCSPELL_URL}/api/v1${path}`, {
		method,
		headers: { 'X-Docspell-Auth': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!response.ok) throw new Error(`${method} ${path} -> HTTP ${response.status}`);
	return (await response.json()) as T;
}

export async function itemIdByName(name: string): Promise<string> {
	const result = await docspell('POST', '/sec/item/search', { query: `name:"${name}"`, limit: 5, offset: 0 });
	const items = result.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items);
	if (items.length !== 1) throw new Error(`expected exactly one item named ${name}, found ${items.length}`);
	return items[0].id;
}

export async function referenceId(kind: 'folder' | 'organization' | 'person' | 'equipment', name: string): Promise<string> {
	const list = await docspell('GET', `/sec/${kind}`);
	const entry = list.items.find((candidate: { name: string }) => candidate.name === name);
	if (!entry) throw new Error(`no ${kind} named ${name}`);
	return entry.id;
}

export const getItem = (id: string) => docspell('GET', `/sec/item/${id}`);
