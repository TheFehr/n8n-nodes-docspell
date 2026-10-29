import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Docspell } from '../nodes/Docspell/Docspell.node';
import { fileNameOf } from '../nodes/Docspell/resources/attachment/download';
import { attachmentIdOf, docspell, operationsOf } from './docspellApi';
import { createExecuteContext } from './fakeExecuteContext';
import { DOCSPELL_URL, LATIN1_BYTES, LATIN1_DOCUMENT, PASSWORD, SEED_DOCUMENTS, UPLOAD_ACCOUNT } from './helpers';

const node = new Docspell();
const ALPHA = SEED_DOCUMENTS[0];

async function download(attachmentId: string, extra: IDataObject = {}) {
	const { context, requests } = createExecuteContext({
		parameters: { resource: 'attachment', operation: 'download', attachmentId, ...extra },
	});
	const [items] = await node.execute!.call(context);
	return { items, requests };
}

const bytesOf = (item: INodeExecutionData, property = 'data') => Buffer.from(item.binary![property].data, 'base64');

describe('File names in Content-Disposition', () => {
	it.each([
		['inline; filename="invoice.pdf"', 'invoice.pdf'],
		['attachment; filename=invoice.pdf; size=10', 'invoice.pdf'],
		['inline; filename="invoice; April.pdf"', 'invoice; April.pdf'],
		['inline; filename="say \\"hi\\".txt"', 'say "hi".txt'],
		['inline; filename="a;b.pdf"; size=3', 'a;b.pdf'],
		["inline; filename*=UTF-8''gr%C3%BCn%20%26%20blau.pdf", 'grün & blau.pdf'],
		['inline; filename="fallback.pdf"; filename*=UTF-8\'\'real%20name.pdf', 'real name.pdf'],
	])('reads %s', (header, expected) => {
		expect(fileNameOf(header)).toBe(expected);
	});

	it.each([undefined, '', 'inline', 'attachment; size=3'])('finds no name in %j', (header) => {
		expect(fileNameOf(header)).toBeUndefined();
	});
});

describe('Attachment > Download of a name with a semicolon', () => {
	it('keeps the whole name', async () => {
		const name = `semi; colon ${Date.now()}.txt`;
		const form = new FormData();
		form.append('meta', new Blob([JSON.stringify({ multiple: false })], { type: 'application/json' }));
		form.append('file', new Blob(['semicolon'], { type: 'text/plain' }), name);
		const token = (await (await fetch(`${DOCSPELL_URL}/api/v1/open/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ account: UPLOAD_ACCOUNT, password: PASSWORD }),
		})).json()).token;
		await fetch(`${DOCSPELL_URL}/api/v1/sec/upload/item`, { method: 'POST', headers: { 'X-Docspell-Auth': token }, body: form });

		let attachmentId: string | undefined;
		for (let attempt = 0; attempt < 45 && !attachmentId; attempt++) {
			const found = await docspell('POST', '/sec/item/search', { query: 'name:"semi*"', limit: 20, offset: 0, withDetails: true }, UPLOAD_ACCOUNT);
			const match = found.groups
				.flatMap((group: { items: Array<{ name: string; attachments: Array<{ id: string }> }> }) => group.items)
				.find((item: { name: string }) => item.name === name);
			attachmentId = match?.attachments[0].id;
			if (!attachmentId) await new Promise((resolve) => setTimeout(resolve, 2_000));
		}
		expect(attachmentId, 'the uploaded item never appeared').toBeDefined();

		const { context } = createExecuteContext({
			credentials: { account: UPLOAD_ACCOUNT },
			parameters: { resource: 'attachment', operation: 'download', attachmentId },
		});
		const [items] = await node.execute!.call(context);
		expect(items[0].json.fileName).toBe(name);
		expect(items[0].binary!.data.fileName).toBe(name);
	}, 120_000);
});

describe('Attachment > Download against a real Docspell', () => {
	it('is offered as a resource with a download operation', () => {
		const resource = node.description.properties.find((property) => property.name === 'resource');
		expect(resource?.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'attachment' })]));
		expect(operationsOf(node.description.properties, 'attachment')).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'download' })]));
	});

	it('returns the file as binary data with its name and type', async () => {
		const id = await attachmentIdOf(ALPHA.name);
		const { items } = await download(id);

		expect(items).toHaveLength(1);
		expect(items[0].json).toMatchObject({ id, fileName: ALPHA.name, mimeType: 'text/plain', size: ALPHA.text!.length, version: 'file' });
		expect(items[0].binary!.data).toMatchObject({ fileName: ALPHA.name, mimeType: 'text/plain' });
		expect(bytesOf(items[0]).toString()).toBe(ALPHA.text);
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});

	it('keeps bytes that are not valid UTF-8 exactly as they are', async () => {
		const { items } = await download(await attachmentIdOf(LATIN1_DOCUMENT));
		expect([...bytesOf(items[0])]).toEqual([...LATIN1_BYTES]);
	});

	it('puts the file under the binary field that was asked for', async () => {
		const { items } = await download(await attachmentIdOf(ALPHA.name), { binaryPropertyName: 'invoice' });

		expect(Object.keys(items[0].binary!)).toEqual(['invoice']);
		expect(bytesOf(items[0], 'invoice').toString()).toBe(ALPHA.text);
	});

	it('downloads the original file', async () => {
		const id = await attachmentIdOf(ALPHA.name);
		const { items, requests } = await download(id, { version: 'original' });

		// A text file has the same bytes in every version, so the path is what tells them apart.
		expect(requests[0].url).toMatch(new RegExp(`/sec/attachment/${id}/original$`));
		expect(items[0].json.version).toBe('original');
		expect(bytesOf(items[0]).toString()).toBe(ALPHA.text);
	});

	describe('failures', () => {
		it('names the attachment that was not found', async () => {
			await expect(download('no-such-attachment')).rejects.toThrow(/Attachment "no-such-attachment" was not found/);
		});

		it('says that a missing archive version may simply not exist', async () => {
			const id = await attachmentIdOf(ALPHA.name);
			await expect(download(id, { version: 'archive' })).rejects.toThrow(/archive/i);
		});

		it('refuses an empty attachment ID without calling Docspell', async () => {
			const { context, requests } = createExecuteContext({
				parameters: { resource: 'attachment', operation: 'download', attachmentId: '  ' },
			});

			await expect(node.execute!.call(context)).rejects.toThrow(/attachment id/i);
			expect(requests).toEqual([]);
		});

		it('keeps going after a failure when Continue On Fail is set', async () => {
			const id = await attachmentIdOf(ALPHA.name);
			const { context } = createExecuteContext({
				continueOnFail: true,
				inputItems: [{ json: {} }, { json: {} }],
				parameters: (index: number) => ({
					resource: 'attachment',
					operation: 'download',
					attachmentId: index === 0 ? 'no-such-attachment' : id,
				}),
			});
			const [items] = await node.execute!.call(context);

			expect(items[0].json.error).toMatch(/not found/i);
			expect(items[1].json.fileName).toBe(ALPHA.name);
			expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
		});
	});
});
