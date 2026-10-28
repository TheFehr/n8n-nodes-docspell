import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Docspell } from '../nodes/Docspell/Docspell.node';
import { createExecuteContext } from './fakeExecuteContext';

const node = new Docspell();

async function run(operation: string, parameters: IDataObject, extra: Partial<Parameters<typeof createExecuteContext>[0]> = {}) {
	const { context, requests } = createExecuteContext({
		parameters: { resource: 'item', operation, ...parameters },
		...extra,
	});
	const [items] = await node.execute!.call(context);
	return { items, requests };
}

async function idOf(name: string): Promise<string> {
	const { items } = await run('search', { query: `name:${name}`, returnAll: false, limit: 5 });
	return items[0].json.id as string;
}

describe('Item > Get against a real Docspell', () => {
	it('is offered as an operation', () => {
		const operation = node.description.properties.find((property) => property.name === 'operation');
		expect(operation?.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'get' })]));
	});

	it('returns the full detail of one item', async () => {
		const id = await idOf('invoice-alpha.txt');
		const { items } = await run('get', { itemId: id });

		expect(items).toHaveLength(1);
		expect(items[0].json).toMatchObject({
			id,
			name: 'invoice-alpha.txt',
			tags: [expect.objectContaining({ name: 'e2e-invoice' })],
			attachments: [expect.objectContaining({ id: expect.any(String) })],
		});
	});

	it('accepts an id with surrounding whitespace', async () => {
		const id = await idOf('contract-gamma.txt');
		const { items } = await run('get', { itemId: `  ${id}\n` });

		expect(items[0].json.name).toBe('contract-gamma.txt');
	});

	it('explains that an unknown item does not exist', async () => {
		await expect(run('get', { itemId: 'does-not-exist' })).rejects.toMatchObject({
			message: expect.stringMatching(/item .*not found/i),
			httpCode: '404',
		});
	});

	it('refuses an empty id before calling Docspell', async () => {
		const { context, requests } = createExecuteContext({
			parameters: { resource: 'item', operation: 'get', itemId: '  ' },
		});
		await expect(node.execute!.call(context)).rejects.toThrow(/item id/i);
		expect(requests).toEqual([]);
	});

	it('reads one item per input item and pairs them', async () => {
		const first = await idOf('invoice-alpha.txt');
		const second = await idOf('contract-gamma.txt');
		const { items } = await run('get', {}, {
			inputItems: [{ json: {} }, { json: {} }],
			parameters: (index: number) => ({ resource: 'item', operation: 'get', itemId: index === 0 ? first : second }),
		});

		expect(items.map((item) => item.json.name)).toEqual(['invoice-alpha.txt', 'contract-gamma.txt']);
		expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
	});

	it('keeps going after a failure when Continue On Fail is set', async () => {
		const good = await idOf('invoice-beta.txt');
		const { items } = await run('get', {}, {
			continueOnFail: true,
			inputItems: [{ json: {} }, { json: {} }],
			parameters: (index: number) => ({ resource: 'item', operation: 'get', itemId: index === 0 ? 'nope' : good }),
		});

		expect(items[0].json.error).toMatch(/not found/i);
		expect(items[1].json.name).toBe('invoice-beta.txt');
	});

	it('says which input item failed when it stops the run', async () => {
		const good = await idOf('invoice-beta.txt');

		await expect(
			run('get', {}, {
				inputItems: [{ json: {} }, { json: {} }],
				parameters: (index: number) => ({ resource: 'item', operation: 'get', itemId: index === 0 ? good : 'nope' }),
			}),
		).rejects.toMatchObject({ context: { itemIndex: 1 } });
	});
});
