import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Docspell } from '../nodes/Docspell/Docspell.node';
import { docspell, operationsOf, referenceId } from './docspellApi';
import { createExecuteContext } from './fakeExecuteContext';
import { SEED_ORGANIZATION, SEED_SHORT_NAME, SEED_SHORT_ORGANIZATION } from './helpers';

const node = new Docspell();

async function run(operation: string, parameters: IDataObject, extra: Partial<Parameters<typeof createExecuteContext>[0]> = {}) {
	const { context, requests } = createExecuteContext({
		parameters: { resource: 'organization', operation, ...parameters },
		...extra,
	});
	const [items] = await node.execute!.call(context);
	return { items, requests };
}

describe('Organization against a real Docspell', () => {
	it('is offered as a resource with Get and Get Many', () => {
		const resource = node.description.properties.find((property) => property.name === 'resource');
		expect(resource?.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'organization' })]));
		expect(operationsOf(node.description.properties, 'organization').map((option) => ('value' in option ? option.value : ''))).toEqual([
			'get',
			'getAll',
		]);
	});

	describe('Get', () => {
		it('returns the whole organization, including the short name', async () => {
			const id = await referenceId('organization', SEED_SHORT_ORGANIZATION);
			const { items } = await run('get', { organizationId: id });

			expect(items).toHaveLength(1);
			expect(items[0].json).toMatchObject({
				id,
				name: SEED_SHORT_ORGANIZATION,
				shortName: SEED_SHORT_NAME,
				use: 'correspondent',
				address: expect.any(Object),
				contacts: [],
			});
			expect(items[0].pairedItem).toEqual({ item: 0 });
		});

		it('ignores spaces around the ID', async () => {
			const id = await referenceId('organization', SEED_ORGANIZATION);
			const { items } = await run('get', { organizationId: `  ${id} ` });
			expect(items[0].json.id).toBe(id);
		});

		it('says so when the organization does not exist', async () => {
			await expect(run('get', { organizationId: 'no-such-organization' })).rejects.toThrow(
				'Organization "no-such-organization" was not found',
			);
		});

		it('rejects an empty ID before calling Docspell', async () => {
			const { context, requests } = createExecuteContext({
				parameters: { resource: 'organization', operation: 'get', organizationId: '   ' },
			});
			await expect(node.execute!.call(context)).rejects.toThrow('The Organization ID is empty');
			expect(requests).toHaveLength(0);
		});

		it('reports a failure per item with Continue On Fail', async () => {
			const id = await referenceId('organization', SEED_ORGANIZATION);
			const { items } = await run(
				'get',
				{},
				{
					continueOnFail: true,
					inputItems: [{ json: {} }, { json: {} }],
					parameters: (index) => ({
						resource: 'organization',
						operation: 'get',
						organizationId: index === 0 ? 'no-such-organization' : id,
					}),
				},
			);
			expect(items).toHaveLength(2);
			expect(items[0].json.error).toContain('was not found');
			expect(items[0].pairedItem).toEqual({ item: 0 });
			expect(items[1].json.id).toBe(id);
		});
	});

	describe('Get Many', () => {
		const names = (items: Array<{ json: IDataObject }>) => items.map((item) => item.json.name as string);

		it('returns every organization as its own item, with the short name', async () => {
			const { items } = await run('getAll', { returnAll: true, query: '' });
			const real = (await docspell('GET', '/sec/organization')).items.map((entry: { name: string }) => entry.name);

			expect(names(items).sort()).toEqual(real.sort());
			expect(items.find((item) => item.json.name === SEED_SHORT_ORGANIZATION)?.json).toMatchObject({ shortName: SEED_SHORT_NAME });
		});

		it('filters by name', async () => {
			const { items } = await run('getAll', { returnAll: true, query: SEED_ORGANIZATION });
			expect(names(items)).toEqual([SEED_ORGANIZATION]);
		});

		it('finds an organization by its short name too', async () => {
			const { items } = await run('getAll', { returnAll: true, query: SEED_SHORT_NAME });
			expect(names(items)).toEqual([SEED_SHORT_ORGANIZATION]);
		});

		it('returns nothing, not an error, when nothing matches', async () => {
			const { items } = await run('getAll', { returnAll: true, query: 'no-such-organization-anywhere' });
			expect(items).toEqual([]);
		});

		it('stops at the limit when Return All is off', async () => {
			const total = (await run('getAll', { returnAll: true, query: '' })).items.length;
			expect(total).toBeGreaterThan(1);
			const { items } = await run('getAll', { returnAll: false, limit: 1, query: '' });
			expect(items).toHaveLength(1);
		});

		it('pairs every result with its input item', async () => {
			const { items } = await run('getAll', { returnAll: true, query: '' });
			expect(items.every((item) => item.pairedItem !== undefined)).toBe(true);
		});

		it('sends the filter to Docspell and asks for the full records', async () => {
			const { requests } = await run('getAll', { returnAll: true, query: 'a b' });
			expect(requests).toHaveLength(1);
			expect(requests[0].url).toMatch(/\/sec\/organization\?/);
			expect(requests[0].url).toContain('full=true');
			expect(requests[0].url).toMatch(/q=a(\+|%20)b/);
		});
	});
});
