import type { IDataObject } from 'n8n-workflow';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Docspell } from '../nodes/Docspell/Docspell.node';
import { docspell, getItem, itemIdByName, operationsOf, referenceId } from './docspellApi';
import { createExecuteContext } from './fakeExecuteContext';
import { BULK_TARGET, SEED_CUSTOM_FIELD, SEED_FOLDER, SEED_ORGANIZATION, UPDATE_TARGET } from './helpers';

const node = new Docspell();

async function updateMany(itemIds: string | string[], bulkFields: IDataObject, extra: IDataObject = {}) {
	const { context, requests } = createExecuteContext({
		parameters: { resource: 'item', operation: 'updateMany', itemIds, bulkFields, ...extra },
	});
	const [items] = await node.execute!.call(context);
	return { items, requests };
}

let first: string;
let second: string;
beforeAll(async () => {
	first = await itemIdByName(UPDATE_TARGET);
	second = await itemIdByName(BULK_TARGET);
});

// Both scratch items are put back, so the next test starts from the same state.
afterEach(async () => {
	await docspell('PUT', '/sec/items/name', { items: [first], name: UPDATE_TARGET });
	await docspell('PUT', '/sec/items/name', { items: [second], name: BULK_TARGET });
	await docspell('PUT', '/sec/items/direction', { items: [first, second], direction: 'incoming' });
	await docspell('PUT', '/sec/items/date', { items: [first, second], date: null });
	await docspell('PUT', '/sec/items/duedate', { items: [first, second], date: null });
	await docspell('PUT', '/sec/items/folder', { items: [first, second], ref: null });
	await docspell('PUT', '/sec/items/corrOrg', { items: [first, second], ref: null });
	await docspell('PUT', '/sec/items/tags', { items: [first, second], refs: [] }).catch(() => undefined);
	for (const id of [first, second]) {
		for (const custom of (await getItem(id)).customfields) await docspell('DELETE', `/sec/item/${id}/customfield/${custom.id}`);
	}
});

describe('Item > Update Many against a real Docspell', () => {
	it('is offered as an operation, without a notes field', () => {
		expect(operationsOf(node.description.properties, 'item')).toEqual(
			expect.arrayContaining([expect.objectContaining({ value: 'updateMany' })]),
		);
		const fields = node.description.properties.find((property) => property.name === 'bulkFields');
		const names = (fields?.options ?? []).map((option) => option.name);
		expect(names).toContain('folder');
		expect(names).not.toContain('notes');
	});

	it('renames every item and returns them all', async () => {
		const { items } = await updateMany([first, second], { name: 'bulk-renamed.txt' });

		expect(items.map((item) => item.json.id).sort()).toEqual([first, second].sort());
		expect(items.every((item) => item.json.name === 'bulk-renamed.txt')).toBe(true);
		expect(items.every((item) => (item.pairedItem as { item: number }).item === 0)).toBe(true);
		expect((await getItem(second)).name).toBe('bulk-renamed.txt');
	});

	it('takes the IDs as comma or space separated text, each once', async () => {
		const { items } = await updateMany(` ${first},\n${second} ${first}`, { name: 'text-list.txt' });
		expect(items).toHaveLength(2);
		expect((await getItem(first)).name).toBe('text-list.txt');
	});

	it('sets and clears the folder, a reference and the dates on all items', async () => {
		const folder = await referenceId('folder', SEED_FOLDER);
		const organization = await referenceId('organization', SEED_ORGANIZATION);

		await updateMany([first, second], {
			folder,
			corrOrg: organization,
			direction: 'outgoing',
			itemDate: '2026-03-04T00:00:00.000Z',
			dueDate: '2026-04-05T00:00:00.000Z',
		});
		for (const id of [first, second]) {
			const item = await getItem(id);
			expect(item.folder?.id).toBe(folder);
			expect(item.corrOrg?.id).toBe(organization);
			expect(item.direction).toBe('outgoing');
			expect(item.itemDate).toBe(Date.parse('2026-03-04T00:00:00.000Z'));
			expect(item.dueDate).toBe(Date.parse('2026-04-05T00:00:00.000Z'));
		}

		await updateMany([first, second], { folder: '', corrOrg: '', itemDate: '', dueDate: '' });
		for (const id of [first, second]) {
			const item = await getItem(id);
			expect(item.folder ?? null).toBeNull();
			expect(item.corrOrg ?? null).toBeNull();
			expect(item.itemDate ?? null).toBeNull();
			expect(item.dueDate ?? null).toBeNull();
		}
	});

	it('replaces, adds and removes tags', async () => {
		const tags = (await docspell('GET', '/sec/tag')).items as Array<{ id: string; name: string }>;
		const invoice = tags.find((tag) => tag.name === 'e2e-invoice')!.id;
		const contract = tags.find((tag) => tag.name === 'e2e-contract')!.id;
		const tagIds = async (id: string) => ((await getItem(id)).tags as Array<{ id: string }>).map((tag) => tag.id).sort();

		await updateMany([first, second], { tags: ['e2e-invoice'] });
		expect(await tagIds(first)).toEqual([invoice]);
		expect(await tagIds(second)).toEqual([invoice]);

		await updateMany([first, second], { tags: [contract], tagsMode: 'add' });
		expect(await tagIds(first)).toEqual([invoice, contract].sort());

		await updateMany([first, second], { tags: ['e2e-invoice'], tagsMode: 'remove' });
		expect(await tagIds(second)).toEqual([contract]);

		await updateMany([first, second], { tags: [] });
		expect(await tagIds(first)).toEqual([]);
	});

	it('removing all tags works when none of the items has a tag', async () => {
		const { items } = await updateMany([first, second], { tags: [] });
		expect(items).toHaveLength(2);
	});

	it('removing all tags only touches the items that have some', async () => {
		await docspell('PUT', '/sec/items/tags', { items: [first], refs: ['e2e-invoice'] });
		const { items } = await updateMany([first, second], { tags: [] });
		expect(items).toHaveLength(2);
		expect((await getItem(first)).tags).toEqual([]);
	});

	it('sets and removes a custom field on all items', async () => {
		await updateMany([first, second], {}, { bulkCustomFields: { values: [{ field: SEED_CUSTOM_FIELD, value: 'bulk value' }] } });
		for (const id of [first, second]) {
			expect((await getItem(id)).customfields).toEqual([expect.objectContaining({ name: SEED_CUSTOM_FIELD, value: 'bulk value' })]);
		}

		await updateMany([first, second], {}, { removeCustomFields: [SEED_CUSTOM_FIELD] });
		for (const id of [first, second]) expect((await getItem(id)).customfields).toEqual([]);
	});

	describe('refuses before changing anything', () => {
		const untouched = async () => {
			expect((await getItem(first)).name).toBe(UPDATE_TARGET);
			expect((await getItem(second)).name).toBe(BULK_TARGET);
		};

		it('when an item does not exist, which Docspell would silently skip', async () => {
			await expect(updateMany([first, 'no-such-item', second], { name: 'never.txt' })).rejects.toThrow(
				'Item not found in Docspell: "no-such-item". Nothing was changed.',
			);
			await untouched();
		});

		it('names every missing item', async () => {
			await expect(updateMany(['gone-1', first, 'gone-2'], { name: 'never.txt' })).rejects.toThrow('"gone-1", "gone-2"');
		});

		it('when no IDs are given, without calling Docspell', async () => {
			const { context, requests } = createExecuteContext({
				parameters: { resource: 'item', operation: 'updateMany', itemIds: ' , ', bulkFields: { name: 'x' } },
			});
			await expect(node.execute!.call(context)).rejects.toThrow('No item IDs were given');
			expect(requests).toHaveLength(0);
		});

		it('when no field is chosen', async () => {
			await expect(updateMany([first], {})).rejects.toThrow('Choose at least one field to update');
		});

		it('when a tag does not exist', async () => {
			await expect(updateMany([first, second], { name: 'never.txt', tags: ['no-such-tag'] })).rejects.toThrow(
				'Tag not found in Docspell: "no-such-tag"',
			);
			await untouched();
		});

		it('when the tags value is null', async () => {
			await expect(updateMany([first, second], { tags: null })).rejects.toThrow('The tags value is empty');
		});

		it('when the name is empty or the date is not one', async () => {
			await expect(updateMany([first], { name: '  ' })).rejects.toThrow('The name cannot be empty');
			await expect(updateMany([first], { itemDate: '2026-02-30' })).rejects.toThrow('is not a valid date');
			await untouched();
		});
	});

	it('says what was already applied when a later step fails', async () => {
		await expect(
			updateMany([first, second], { name: 'half-done.txt' }, { bulkCustomFields: { values: [{ field: 'no-such-field', value: 'x' }] } }),
		).rejects.toThrow('already applied: name');
		expect((await getItem(first)).name).toBe('half-done.txt');
	});

	it('says what was already applied when Docspell cannot be reached afterwards', async () => {
		let lookups = 0;
		const { context } = createExecuteContext({
			// The look-ups before the change succeed; reading the items back at the end does not.
			failWhen: (request) => request.method === 'GET' && request.url.endsWith(`/sec/item/${second}`) && request.body === undefined && lookups++ >= 1,
			parameters: { resource: 'item', operation: 'updateMany', itemIds: [first, second], bulkFields: { name: 'unreachable.txt' } },
		});
		await expect(node.execute!.call(context)).rejects.toThrow('already applied: name');
		expect((await getItem(second)).name).toBe('unreachable.txt');
	});

	it('works per input item with Continue On Fail', async () => {
		const { context } = createExecuteContext({
			continueOnFail: true,
			inputItems: [{ json: {} }, { json: {} }],
			parameters: { resource: 'item', operation: 'updateMany', itemIds: [first, 'missing'], bulkFields: { name: 'x.txt' } },
		});
		const [items] = await node.execute!.call(context);
		expect(items).toHaveLength(2);
		expect(String(items[0].json.error)).toContain('"missing"');
	});
});
