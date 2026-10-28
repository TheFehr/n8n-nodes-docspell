import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { searchAllPages } from '../nodes/Docspell/resources/item/search';
import { Docspell } from '../nodes/Docspell/Docspell.node';
import { createExecuteContext } from './fakeExecuteContext';
import { SEED_DOCUMENTS } from './helpers';

const node = new Docspell();

async function search(parameters: IDataObject, extra: Parameters<typeof createExecuteContext>[0] extends infer O ? Partial<O> : never = {}) {
	const { context, requests } = createExecuteContext({
		parameters: { resource: 'item', operation: 'search', returnAll: false, limit: 50, ...parameters },
		...extra,
	});
	const [items] = await node.execute!.call(context);
	return { items, requests, names: items.map((item) => item.json.name as string) };
}

const ALL_NAMES = SEED_DOCUMENTS.map((doc) => doc.name).sort();

describe('Docspell node description', () => {
	it('offers Item > Search', () => {
		const properties = node.description.properties;
		const resource = properties.find((property) => property.name === 'resource');
		const operation = properties.find((property) => property.name === 'operation');

		expect(resource?.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'item' })]));
		expect(operation?.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'search' })]));
		expect(node.description.credentials).toEqual([{ name: 'docspellApi', required: true }]);
	});
});

describe('Item > Search against a real Docspell', () => {
	it('returns one n8n item per Docspell item', async () => {
		const { items, names } = await search({ query: 'tag:e2e-invoice' });

		expect(names.sort()).toEqual(['invoice-alpha.txt', 'invoice-beta.txt']);
		expect(items[0].json).toMatchObject({ id: expect.any(String), state: expect.any(String) });
	});

	it('applies the Docspell query', async () => {
		const { names } = await search({ query: 'name:contract*' });

		expect(names).toEqual(['contract-gamma.txt']);
	});

	it('returns everything for an empty query', async () => {
		const { names } = await search({ query: '' });

		expect(names.sort()).toEqual(ALL_NAMES);
	});

	it('returns no items, not an error, when nothing matches', async () => {
		const { items } = await search({ query: 'name:does-not-exist*' });

		expect(items).toEqual([]);
	});

	it('respects the limit', async () => {
		const { items } = await search({ query: '', limit: 1 });

		expect(items).toHaveLength(1);
	});

	it('respects the offset option', async () => {
		const { names: all } = await search({ query: '', limit: 3 });
		const { names: second } = await search({ query: '', limit: 1, options: { offset: 1 } });

		expect(second).toEqual([all[1]]);
	});

	it('leaves tags unresolved unless Include Details is set', async () => {
		const plain = await search({ query: 'name:invoice-alpha.txt' });
		const detailed = await search({ query: 'name:invoice-alpha.txt', options: { withDetails: true } });

		expect(plain.items[0].json.tags).toEqual([]);
		expect((detailed.items[0].json.tags as IDataObject[]).map((tag) => tag.name)).toEqual(['e2e-invoice']);
	});

	it('finds nothing in the trash when nothing was deleted', async () => {
		const { items } = await search({ query: '', options: { searchMode: 'trashed' } });

		expect(items).toEqual([]);
	});

	it('sends the search as a POST so long queries are not limited by the URL', async () => {
		const { requests } = await search({ query: 'tag:e2e-invoice' });

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/api\/v1\/sec\/item\/search$/) });
		expect(requests[0].body).toMatchObject({ query: 'tag:e2e-invoice', limit: 50, offset: 0 });
	});
});

describe('Item > Search with Return All', () => {
	it('pages until every item is fetched', async () => {
		const { context, requests } = createExecuteContext({ parameters: {} });

		const pageSize = ALL_NAMES.length - 1;

		const items = await searchAllPages(context, { query: '' }, pageSize);

		expect(items.map((item) => item.name).sort()).toEqual(ALL_NAMES);
		// One item short of everything per page: a full page, then a short one that ends the loop.
		expect(requests).toHaveLength(2);
		expect(requests.map((request) => (request.body as IDataObject).offset)).toEqual([0, pageSize]);
	});

	it('is what the node uses when Return All is on', async () => {
		const { names } = await search({ query: '', returnAll: true });

		expect(names.sort()).toEqual(ALL_NAMES);
	});

	it('stops when the last page is exactly full', async () => {
		const { context, requests } = createExecuteContext({ parameters: {} });

		const items = await searchAllPages(context, { query: '' }, ALL_NAMES.length);

		expect(items).toHaveLength(ALL_NAMES.length);
		// The next page is empty, which is what proves there is nothing left.
		expect(requests).toHaveLength(2);
	});
});

describe('Item > Search errors and multiple items', () => {
	it('explains a query Docspell cannot parse', async () => {
		await expect(search({ query: '((' })).rejects.toMatchObject({
			message: expect.stringMatching(/search query/i),
			httpCode: '400',
		});
	});

	it('explains wrong credentials', async () => {
		await expect(search({ query: '' }, { credentials: { password: 'wrong' } })).rejects.toThrow(/login failed/i);
	});

	it('runs once per input item with that item\'s own query and pairs the results', async () => {
		const { items } = await search(
			{ query: '' },
			{
				inputItems: [{ json: {} }, { json: {} }],
				parameters: (index: number) => ({
					resource: 'item',
					operation: 'search',
					returnAll: false,
					limit: 50,
					query: index === 0 ? 'tag:e2e-invoice' : 'tag:e2e-contract',
				}),
			},
		);

		expect(items.map((item) => [item.json.name, item.pairedItem])).toEqual(
			expect.arrayContaining([
				['invoice-alpha.txt', { item: 0 }],
				['invoice-beta.txt', { item: 0 }],
				['contract-gamma.txt', { item: 1 }],
			]),
		);
		expect(items).toHaveLength(3);
	});

	it('with Continue On Fail, reports the error for that item and carries on', async () => {
		const { items } = await search(
			{ query: '' },
			{
				continueOnFail: true,
				inputItems: [{ json: {} }, { json: {} }],
				parameters: (index: number) => ({
					resource: 'item',
					operation: 'search',
					returnAll: false,
					limit: 50,
					query: index === 0 ? '((' : 'name:contract*',
				}),
			},
		);

		expect(items).toHaveLength(2);
		expect(items[0].json.error).toMatch(/search query/i);
		expect(items[0].pairedItem).toEqual({ item: 0 });
		expect(items[1].json.name).toBe('contract-gamma.txt');
	});
});
