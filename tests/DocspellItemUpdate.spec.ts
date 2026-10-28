import type { IDataObject } from 'n8n-workflow';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Docspell } from '../nodes/Docspell/Docspell.node';
import { docspell, getItem, itemIdByName, referenceId } from './docspellApi';
import { createExecuteContext, type RecordedRequest } from './fakeExecuteContext';
import { SEED_CUSTOM_FIELD, SEED_FOLDER, SEED_ORGANIZATION, SEED_PERSON, SEED_EQUIPMENT, UPDATE_TARGET } from './helpers';

const node = new Docspell();

async function update(
	itemId: string,
	updateFields: IDataObject,
	extra: IDataObject = {},
	failWhen?: (request: RecordedRequest) => boolean,
) {
	const { context, requests } = createExecuteContext({
		failWhen,
		parameters: { resource: 'item', operation: 'update', itemId, updateFields, ...extra },
	});
	const [items] = await node.execute!.call(context);
	return { items, requests };
}

// The item is found once, so a test that leaves it renamed cannot hide it from the cleanup.
let targetId: string;
beforeAll(async () => {
	targetId = await itemIdByName(UPDATE_TARGET);
});

// Whatever a test changed is put back, so the next one starts from the same item.
afterEach(async () => {
	const id = targetId;
	await docspell('PUT', `/sec/item/${id}/name`, { text: UPDATE_TARGET });
	await docspell('PUT', `/sec/item/${id}/notes`, { text: '' });
	await docspell('PUT', `/sec/item/${id}/direction`, { direction: 'incoming' });
	await docspell('PUT', `/sec/item/${id}/date`, {});
	await docspell('PUT', `/sec/item/${id}/duedate`, {});
	await docspell('PUT', `/sec/item/${id}/folder`, {});
	for (const field of ['corrOrg', 'corrPerson', 'concPerson', 'concEquipment']) {
		await docspell('PUT', `/sec/item/${id}/${field}`, {});
	}
	await docspell('PUT', `/sec/item/${id}/tags`, { items: [] });
	const item = await getItem(id);
	for (const custom of item.customfields) await docspell('DELETE', `/sec/item/${id}/customfield/${custom.id}`);
});

describe('Item > Update against a real Docspell', () => {
	it('is offered as an operation', () => {
		const operation = node.description.properties.find((property) => property.name === 'operation');
		expect(operation?.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'update' })]));
	});

	it('changes the name and returns the updated item', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const { items } = await update(id, { name: 'renamed-by-test.txt' });

		expect(items).toHaveLength(1);
		expect(items[0].json).toMatchObject({ id, name: 'renamed-by-test.txt' });
		expect((await getItem(id)).name).toBe('renamed-by-test.txt');
	});

	it('sets and clears the notes', async () => {
		const id = await itemIdByName(UPDATE_TARGET);

		await update(id, { notes: 'first notes' });
		expect((await getItem(id)).notes).toBe('first notes');

		const { items } = await update(id, { notes: '' });
		expect(items[0].json.notes ?? '').toBe('');
	});

	it('sets the direction', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const { items } = await update(id, { direction: 'outgoing' });

		expect(items[0].json.direction).toBe('outgoing');
	});

	it('sets and clears the item date and the due date', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const { items } = await update(id, { itemDate: '2026-01-01T00:00:00.000Z', dueDate: '2026-02-01T00:00:00.000Z' });

		expect(items[0].json.itemDate).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
		expect(items[0].json.dueDate).toBe(Date.parse('2026-02-01T00:00:00.000Z'));

		const cleared = await update(id, { itemDate: '', dueDate: '' });
		expect(cleared.items[0].json.itemDate ?? null).toBeNull();
		expect(cleared.items[0].json.dueDate ?? null).toBeNull();
	});

	it('refuses a date it cannot read before changing anything', async () => {
		const id = await itemIdByName(UPDATE_TARGET);

		await expect(update(id, { name: 'renamed-by-test.txt', itemDate: 'next tuesday-ish' })).rejects.toThrow(/item date/i);
		expect((await getItem(id)).name).toBe(UPDATE_TARGET);
	});

	it('sets the folder by name or by id, and removes it with an empty value', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const folderId = await referenceId('folder', SEED_FOLDER);

		expect((await update(id, { folder: SEED_FOLDER })).items[0].json.folder).toMatchObject({ id: folderId });
		await update(id, { folder: '' });
		expect((await update(id, { folder: folderId })).items[0].json.folder).toMatchObject({ name: SEED_FOLDER });
		expect((await update(id, { folder: '' })).items[0].json.folder ?? null).toBeNull();
	});

	it('sets the correspondents and the concerning person and equipment by id', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const org = await referenceId('organization', SEED_ORGANIZATION);
		const person = await referenceId('person', SEED_PERSON);
		const equipment = await referenceId('equipment', SEED_EQUIPMENT);

		const { items } = await update(id, {
			corrOrg: org,
			corrPerson: person,
			concPerson: person,
			concEquipment: equipment,
		});
		expect(items[0].json).toMatchObject({
			corrOrg: { id: org },
			corrPerson: { id: person },
			concPerson: { id: person },
			concEquipment: { id: equipment },
		});

		const cleared = await update(id, { corrOrg: '', concEquipment: '' });
		expect(cleared.items[0].json.corrOrg ?? null).toBeNull();
		expect(cleared.items[0].json.concEquipment ?? null).toBeNull();
		expect(cleared.items[0].json.corrPerson).toMatchObject({ id: person });
	});

	describe('tags', () => {
		const names = async (id: string) => (await getItem(id)).tags.map((tag: { name: string }) => tag.name).sort();

		it('replaces the tags by default', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			await update(id, { tags: 'e2e-invoice' });
			await update(id, { tags: 'e2e-contract' });

			expect(await names(id)).toEqual(['e2e-contract']);
		});

		it('adds to the existing tags, without duplicating', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			await update(id, { tags: 'e2e-invoice' });
			await update(id, { tags: 'e2e-contract', tagsMode: 'add' });
			expect(await names(id)).toEqual(['e2e-contract', 'e2e-invoice']);

			// Adding what is already there changes nothing.
			await update(id, { tags: 'e2e-invoice, e2e-contract', tagsMode: 'add' });
			expect(await names(id)).toEqual(['e2e-contract', 'e2e-invoice']);
		});

		it('removes only the named tags', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			await update(id, { tags: 'e2e-invoice,e2e-contract' });
			await update(id, { tags: 'e2e-invoice', tagsMode: 'remove' });

			expect(await names(id)).toEqual(['e2e-contract']);
		});

		it('accepts tag ids as well as names', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const tags = await docspell('GET', '/sec/tag');
			const invoice = tags.items.find((tag: { name: string }) => tag.name === 'e2e-invoice');

			await update(id, { tags: invoice.id });
			expect(await names(id)).toEqual(['e2e-invoice']);
		});

		it('refuses a tag that does not exist instead of silently dropping it', async () => {
			const id = await itemIdByName(UPDATE_TARGET);

			await expect(update(id, { name: 'renamed-by-test.txt', tags: 'e2e-invoice, no-such-tag' })).rejects.toThrow(/no-such-tag/);
			expect((await getItem(id)).name).toBe(UPDATE_TARGET);
			expect(await names(id)).toEqual([]);
		});
	});

	describe('custom fields', () => {
		it('sets a custom field by name', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const { items } = await update(id, {}, { customFields: { values: [{ field: SEED_CUSTOM_FIELD, value: 'ABC-1' }] } });

			expect(items[0].json.customfields).toEqual([expect.objectContaining({ name: SEED_CUSTOM_FIELD, value: 'ABC-1' })]);
		});

		it('names the field when Docspell does not know it', async () => {
			const id = await itemIdByName(UPDATE_TARGET);

			await expect(update(id, {}, { customFields: { values: [{ field: 'no-such-field', value: 'x' }] } })).rejects.toThrow(
				/no-such-field/,
			);
		});
	});

	describe('failures', () => {
		it('refuses an empty name before calling Docspell', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const { context, requests } = createExecuteContext({
				parameters: { resource: 'item', operation: 'update', itemId: id, updateFields: { name: '  ' } },
			});

			await expect(node.execute!.call(context)).rejects.toThrow(/name/i);
			expect(requests).toEqual([]);
		});

		it('asks for at least one field', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const { context, requests } = createExecuteContext({
				parameters: { resource: 'item', operation: 'update', itemId: id, updateFields: {} },
			});

			await expect(node.execute!.call(context)).rejects.toThrow(/at least one/i);
			expect(requests).toEqual([]);
		});

		it('reports an item that does not exist, although Docspell answers 200', async () => {
			await expect(update('does-not-exist', { notes: 'x' })).rejects.toThrow(/not found/i);
		});

		it('says what was already applied when a later change fails', async () => {
			const id = await itemIdByName(UPDATE_TARGET);

			await expect(update(id, { name: 'renamed-by-test.txt', folder: 'no-such-folder' })).rejects.toThrow(
				/folder.*already applied.*name/is,
			);
			expect((await getItem(id)).name).toBe('renamed-by-test.txt');
		});

		it.each(['2026-02-30', '2026-04-31', '2026-02-30T10:00:00Z', '2026-13-01'])(
			'rejects the impossible date %s before changing anything',
			async (date) => {
				const id = await itemIdByName(UPDATE_TARGET);
				const { context, requests } = createExecuteContext({
					parameters: { resource: 'item', operation: 'update', itemId: id, updateFields: { name: 'x.txt', itemDate: date } },
				});

				await expect(node.execute!.call(context)).rejects.toThrow(/not a valid date/i);
				expect(requests).toEqual([]);
			},
		);

		it('accepts the last day of a leap-year February', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const { items } = await update(id, { dueDate: '2028-02-29' });
			expect(new Date(items[0].json.dueDate as number).toISOString()).toMatch(/^2028-02-29/);
		});

		it('lists the applied changes when a later request fails with an HTTP error', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			// The Add mode reads the current tags first; that read fails after the name was changed.
			const error = await update(id, { name: 'renamed-by-test.txt', tags: 'e2e-invoice', tagsMode: 'add' }, {}, (request) =>
				request.method === 'GET' && request.url.endsWith(`/sec/item/${id}`),
			).catch((caught) => caught);

			expect(error.httpCode).toBe('503');
			expect(`${error.message} ${error.description}`).toMatch(/already applied: name/);
			expect((await getItem(id)).name).toBe('renamed-by-test.txt');
		});

		it('lists the applied changes when the final read of the item fails', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const error = await update(id, { notes: 'applied before the read' }, {}, (request) =>
				request.method === 'GET' && request.url.endsWith(`/sec/item/${id}`),
			).catch((caught) => caught);

			expect(error.httpCode).toBe('503');
			expect(`${error.message} ${error.description}`).toMatch(/already applied: notes/);
		});

		it('does not repeat the applied list on an error that already carries it', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const error = await update(id, { name: 'renamed-by-test.txt', folder: 'no-such-folder' }).catch((caught) => caught);

			expect(`${error.message} ${error.description ?? ''}`.match(/already applied/g)).toHaveLength(1);
		});

		it('keeps going after a failure when Continue On Fail is set', async () => {
			const id = await itemIdByName(UPDATE_TARGET);
			const { context } = createExecuteContext({
				continueOnFail: true,
				inputItems: [{ json: {} }, { json: {} }],
				parameters: (index: number) => ({
					resource: 'item',
					operation: 'update',
					itemId: index === 0 ? 'does-not-exist' : id,
					updateFields: { notes: 'second item worked' },
				}),
			});
			const [items] = await node.execute!.call(context);

			expect(items[0].json.error).toMatch(/not found/i);
			expect(items[1].json.notes).toBe('second item worked');
			expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
		});
	});
});
