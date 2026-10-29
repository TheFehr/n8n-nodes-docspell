import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { beforeAll, describe, expect, it } from 'vitest';

import { Docspell } from '../nodes/Docspell/Docspell.node';
import { docspell, operationsOf } from './docspellApi';
import { createExecuteContext } from './fakeExecuteContext';
import { UPLOAD_ACCOUNT, UPLOAD_FOLDER, UPLOAD_TAG } from './helpers';

const node = new Docspell();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Names are unique per run, so a rerun against the same instance never finds old items.
const run = Date.now();
let counter = 0;
const uniqueName = (label: string) => `upload-${run}-${counter++}-${label}.txt`;

function binary(fileName: string, text: string) {
	return { data: Buffer.from(text).toString('base64'), fileName, mimeType: 'text/plain' };
}

// An input item that carries one file under "data" and optionally more under other names.
function fileItem(fileName: string, text = `content of ${fileName}`, extra: Record<string, ReturnType<typeof binary>> = {}) {
	return { json: {}, binary: { data: binary(fileName, text), ...extra } } as INodeExecutionData;
}

async function upload(inputItems: INodeExecutionData[], options: IDataObject = {}, extra: IDataObject = {}) {
	const { context, requests } = createExecuteContext({
		credentials: { account: UPLOAD_ACCOUNT },
		inputItems,
		parameters: { resource: 'item', operation: 'upload', binaryPropertyName: 'data', options, ...extra },
	});
	const [items] = await node.execute!.call(context);
	return { items, requests };
}

interface FoundItem {
	id: string;
	name: string;
	direction: string;
	folder?: { name: string };
	tags: Array<{ name: string }>;
	attachments: unknown[];
}

async function itemsNamed(name: string): Promise<FoundItem[]> {
	const result = await docspell('POST', '/sec/item/search', { query: `name:"${name}"`, limit: 20, offset: 0, withDetails: true }, UPLOAD_ACCOUNT);
	return result.groups.flatMap((group: { items: FoundItem[] }) => group.items);
}

// Docspell answers an upload before the job runner has made an item of it.
async function waitForItem(name: string, timeoutMs = 90_000): Promise<FoundItem> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = await itemsNamed(name);
		if (found.length > 0) return found[0];
		if (Date.now() > deadline) throw new Error(`"${name}" did not become an item in time`);
		await sleep(2_000);
	}
}

// Items appear only once the job runner has processed them, which takes seconds each.
describe('Item > Upload against a real Docspell', { timeout: 120_000 }, () => {
	beforeAll(async () => {
		// The upload account is seeded with a tag and a folder.
		const tags = await docspell('GET', '/sec/tag', undefined, UPLOAD_ACCOUNT);
		expect(tags.items.map((tag: { name: string }) => tag.name)).toContain(UPLOAD_TAG);
	});

	it('is offered as an operation', () => {
		expect(operationsOf(node.description.properties, 'item')).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'upload' })]));
	});

	it('uploads a file that becomes an item with that file as its attachment', async () => {
		const name = uniqueName('plain');
		const { items, requests } = await upload([fileItem(name)]);

		expect(items).toHaveLength(1);
		expect(items[0].json).toMatchObject({ success: true, files: [name] });
		expect(items[0].pairedItem).toEqual({ item: 0 });
		expect(requests.some((request) => request.method === 'POST' && request.url.endsWith('/sec/upload/item'))).toBe(true);

		const item = await waitForItem(name);
		expect(item.attachments).toHaveLength(1);
	});

	it('uploads one file per input item', async () => {
		const [first, second] = [uniqueName('many-a'), uniqueName('many-b')];
		const { items } = await upload([fileItem(first), fileItem(second)]);

		expect(items.map((item) => item.json.files)).toEqual([[first], [second]]);
		expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
		await waitForItem(first);
		await waitForItem(second);
	});

	it('applies direction, folder and tags, given by name', async () => {
		const name = uniqueName('meta');
		const { requests } = await upload([fileItem(name)], {
			direction: 'outgoing',
			folder: UPLOAD_FOLDER,
			tags: UPLOAD_TAG,
		});

		const item = await waitForItem(name);
		expect(item.direction).toBe('outgoing');
		expect(item.folder?.name).toBe(UPLOAD_FOLDER);
		// Tags are attached last by the job runner.
		const deadline = Date.now() + 60_000;
		let tagged = item;
		while (tagged.tags.length === 0 && Date.now() < deadline) {
			await sleep(2_000);
			tagged = (await itemsNamed(name))[0];
		}
		expect(tagged.tags.map((tag) => tag.name)).toEqual([UPLOAD_TAG]);
		expect(requests.find((request) => request.url.endsWith('/sec/upload/item'))?.body).toMatchObject({
			meta: { direction: 'outgoing', multiple: true },
		});
	});

	it('makes one item of several files when asked to', async () => {
		const [first, second] = [uniqueName('one-a'), uniqueName('one-b')];
		const { items } = await upload(
			[fileItem(first, 'a', { second: binary(second, 'b') })],
			{ oneItem: true },
			{ binaryPropertyName: 'data,second' },
		);

		expect(items[0].json.files).toEqual([first, second]);
		// Docspell names the combined item after all its files.
		const item = await waitForItem(`${first}*`);
		expect(item.attachments).toHaveLength(2);
	});

	it('makes an item per file by default', async () => {
		const [first, second] = [uniqueName('sep-a'), uniqueName('sep-b')];
		await upload([fileItem(first, 'a', { second: binary(second, 'b') })], {}, { binaryPropertyName: 'data,second' });

		expect((await waitForItem(first)).attachments).toHaveLength(1);
		expect((await waitForItem(second)).attachments).toHaveLength(1);
	});

	it('skips a file that Docspell already has when asked to', async () => {
		const name = uniqueName('dup');
		const text = `the same bytes ${run}`;
		await upload([fileItem(name, text)]);
		await waitForItem(name);

		const duplicate = uniqueName('dup-again');
		await upload([fileItem(duplicate, text)], { skipDuplicates: true });
		// A negative result cannot be waited for, so give the job runner time to have acted.
		await sleep(15_000);
		expect(await itemsNamed(duplicate)).toHaveLength(0);

		const kept = uniqueName('dup-kept');
		await upload([fileItem(kept, text)]);
		expect((await waitForItem(kept)).attachments).toHaveLength(1);
	});

	describe('failures', () => {
		it('refuses an unknown tag, which Docspell would silently ignore', async () => {
			const name = uniqueName('bad-tag');
			const { context, requests } = createExecuteContext({
				credentials: { account: UPLOAD_ACCOUNT },
				inputItems: [fileItem(name)],
				parameters: { resource: 'item', operation: 'upload', binaryPropertyName: 'data', options: { tags: 'no-such-tag' } },
			});

			await expect(node.execute!.call(context)).rejects.toThrow(/tag.*no-such-tag/i);
			expect(requests.filter((request) => request.method === 'POST')).toEqual([]);
		});

		it('refuses an unknown folder, which Docspell would silently ignore', async () => {
			const { context, requests } = createExecuteContext({
				credentials: { account: UPLOAD_ACCOUNT },
				inputItems: [fileItem(uniqueName('bad-folder'))],
				parameters: { resource: 'item', operation: 'upload', binaryPropertyName: 'data', options: { folder: 'no-such-folder' } },
			});

			await expect(node.execute!.call(context)).rejects.toThrow(/folder.*no-such-folder/i);
			expect(requests.filter((request) => request.method === 'POST')).toEqual([]);
		});

		it('names the binary property when the item has none', async () => {
			const { context, requests } = createExecuteContext({
				credentials: { account: UPLOAD_ACCOUNT },
				inputItems: [{ json: {} }],
				parameters: { resource: 'item', operation: 'upload', binaryPropertyName: 'attachment' },
			});

			await expect(node.execute!.call(context)).rejects.toThrow(/attachment/);
			expect(requests).toEqual([]);
		});

		it('refuses a language that is not a three-letter code, which Docspell answers with a 500', async () => {
			const { context, requests } = createExecuteContext({
				credentials: { account: UPLOAD_ACCOUNT },
				inputItems: [fileItem(uniqueName('bad-language'))],
				parameters: { resource: 'item', operation: 'upload', binaryPropertyName: 'data', options: { language: 'english' } },
			});

			await expect(node.execute!.call(context)).rejects.toThrow(/language/i);
			expect(requests.filter((request) => request.method === 'POST')).toEqual([]);
		});

		it('keeps going after a failure when Continue On Fail is set', async () => {
			const good = uniqueName('after-failure');
			const { context } = createExecuteContext({
				credentials: { account: UPLOAD_ACCOUNT },
				continueOnFail: true,
				inputItems: [{ json: {} }, fileItem(good)],
				parameters: { resource: 'item', operation: 'upload', binaryPropertyName: 'data' },
			});
			const [items] = await node.execute!.call(context);

			expect(items[0].json.error).toMatch(/data/);
			expect(items[1].json).toMatchObject({ success: true, files: [good] });
			expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
			await waitForItem(good);
		});
	});
});
