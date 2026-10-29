import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Docspell } from '../nodes/Docspell/Docspell.node';
import { attachmentIdOf, operationsOf } from './docspellApi';
import { createExecuteContext } from './fakeExecuteContext';
import { LATIN1_BYTES, LATIN1_DOCUMENT, SEED_DOCUMENTS } from './helpers';

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
