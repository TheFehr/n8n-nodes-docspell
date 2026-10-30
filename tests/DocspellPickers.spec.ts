import type { IDataObject, ILoadOptionsFunctions, INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { tagTokens } from '../nodes/Common/GenericFunctions';
import { Docspell } from '../nodes/Docspell/Docspell.node';
import { docspell, itemIdByName, referenceId } from './docspellApi';
import { createExecuteContext } from './fakeExecuteContext';
import {
	SEED_CUSTOM_FIELD,
	SEED_EQUIPMENT,
	SEED_FOLDER,
	SEED_ORGANIZATION,
	SEED_PERSON,
	UPDATE_TARGET,
	UPLOAD_ACCOUNT,
	UPLOAD_FOLDER,
	UPLOAD_TAG,
} from './helpers';

const node = new Docspell();

// The loader runs on the same live server and the same credential as the node itself.
async function load(method: string, credentials?: IDataObject): Promise<INodePropertyOptions[]> {
	const { context } = createExecuteContext({ parameters: {}, credentials });
	const loader = node.methods?.loadOptions?.[method];
	if (!loader) throw new Error(`no loadOptions method ${method}`);
	return loader.call(context as unknown as ILoadOptionsFunctions);
}

const find = (properties: INodeProperties[], name: string): INodeProperties | undefined => {
	for (const property of properties) {
		if (property.name === name && property.displayOptions?.show?.operation) return property;
		const nested = (property.options ?? []).filter((option): option is INodeProperties => 'type' in option);
		const hit = find(nested, name);
		if (hit) return hit;
	}
	return undefined;
};

describe('Pickers load their choices from Docspell', () => {
	it('lists the tags by name, with the ID as the value', async () => {
		const options = await load('getTags');
		const invoice = options.find((option) => option.name === 'e2e-invoice');
		expect(invoice).toBeDefined();
		const real = (await docspell('GET', '/sec/tag')).items.find((tag: { name: string }) => tag.name === 'e2e-invoice');
		expect(invoice!.value).toBe(real.id);
		expect(invoice!.description).toContain('finance');
	});

	it('lists the tags of the account the credential belongs to, and no others', async () => {
		const options = await load('getTags', { account: UPLOAD_ACCOUNT });
		expect(options.map((option) => option.name)).toEqual([UPLOAD_TAG]);
	});

	it.each([
		['getFolders', SEED_FOLDER, 'folder', UPLOAD_FOLDER],
		['getOrganizations', SEED_ORGANIZATION, 'organization', undefined],
		['getPersons', SEED_PERSON, 'person', undefined],
		['getEquipment', SEED_EQUIPMENT, 'equipment', undefined],
	] as const)('%s offers "None" first, then the entries by name with their ID', async (method, name, kind, other) => {
		const options = await load(method);
		expect(options[0]).toMatchObject({ value: '' });
		expect(options[0].name).toMatch(/none/i);
		const entry = options.find((option) => option.name === name);
		expect(entry?.value).toBe(await referenceId(kind, name));
		if (other) expect(options.map((option) => option.name)).not.toContain(other);
	});

	it('lists the entries by name, whatever order they were created in', async () => {
		// Created in reverse order, in the upload account so the other tests' tags stay untouched.
		const created: string[] = [];
		try {
			for (const name of ['zzz-sort', 'aaa-sort']) {
				await docspell('POST', '/sec/tag', { id: '', created: 0, name, category: 'sort' }, UPLOAD_ACCOUNT);
			}
			const raw = (await docspell('GET', '/sec/tag', undefined, UPLOAD_ACCOUNT)).items;
			created.push(...raw.filter((tag: { name: string }) => tag.name.endsWith('-sort')).map((tag: { id: string }) => tag.id));
			const names = (await load('getTags', { account: UPLOAD_ACCOUNT })).map((option) => String(option.name));
			expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
			expect(names).toEqual(['aaa-sort', UPLOAD_TAG, 'zzz-sort']);
		} finally {
			for (const id of created) await docspell('DELETE', `/sec/tag/${id}`, undefined, UPLOAD_ACCOUNT);
		}
	});

	it('lists custom fields by label, with the field name as the value', async () => {
		const options = await load('getCustomFields');
		expect(options.find((option) => option.value === SEED_CUSTOM_FIELD)).toMatchObject({ name: 'E2E Ref' });
	});

	it('fails with the server error when Docspell cannot be reached', async () => {
		await expect(load('getTags', { url: 'http://127.0.0.1:1' })).rejects.toThrow();
	});
});

describe('The pickers are wired to the fields', () => {
	const properties = new Docspell().description.properties;
	const updateFields = properties.find((property) => property.name === 'updateFields')!;
	const nested = (updateFields.options ?? []) as INodeProperties[];

	it.each([
		['folder', 'getFolders'],
		['corrOrg', 'getOrganizations'],
		['corrPerson', 'getPersons'],
		['concPerson', 'getPersons'],
		['concEquipment', 'getEquipment'],
	])('Item > Update field %s is an options picker using %s', (name, method) => {
		const field = nested.find((option) => option.name === name)!;
		expect(field.type).toBe('options');
		expect(field.typeOptions?.loadOptionsMethod).toBe(method);
	});

	it('Item > Update tags is a multi picker', () => {
		const field = nested.find((option) => option.name === 'tags')!;
		expect(field.type).toBe('multiOptions');
		expect(field.typeOptions?.loadOptionsMethod).toBe('getTags');
	});

	it('Item > Update custom field names use the custom field picker', () => {
		const customFields = properties.find((property) => property.name === 'customFields')!;
		const values = ((customFields.options![0] as { values: INodeProperties[] }).values);
		const field = values.find((value) => value.name === 'field')!;
		expect(field.type).toBe('options');
		expect(field.typeOptions?.loadOptionsMethod).toBe('getCustomFields');
	});

	it('Item > Upload folder and tags use the pickers', () => {
		const upload = properties.find((property) => property.name === 'options' && property.displayOptions?.show?.operation?.includes('upload'))!;
		const opts = (upload.options ?? []) as INodeProperties[];
		expect(opts.find((o) => o.name === 'folder')?.typeOptions?.loadOptionsMethod).toBe('getFolders');
		expect(opts.find((o) => o.name === 'tags')?.typeOptions?.loadOptionsMethod).toBe('getTags');
		expect(find(properties, 'binaryPropertyName')).toBeDefined();
	});
});

describe('Values chosen from a picker are accepted by the operations', () => {
	it('Item > Update takes picker values: IDs, a tag ID list and a field name', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const tagId = (await load('getTags')).find((option) => option.name === 'e2e-invoice')!.value;
		const folderId = await referenceId('folder', SEED_FOLDER);
		const { context } = createExecuteContext({
			parameters: {
				resource: 'item',
				operation: 'update',
				itemId: id,
				updateFields: { folder: folderId, tags: [tagId], tagsMode: 'replace' },
				customFields: { values: [{ field: SEED_CUSTOM_FIELD, value: 'picked' }] },
			},
		});
		try {
			const [items] = await node.execute!.call(context);
			expect(items[0].json).toMatchObject({ folder: { name: SEED_FOLDER }, tags: [{ name: 'e2e-invoice' }] });
		} finally {
			await docspell('PUT', `/sec/item/${id}/folder`, {});
			await docspell('PUT', `/sec/item/${id}/tags`, { items: [] });
			const item = await docspell('GET', `/sec/item/${id}`);
			for (const custom of item.customfields) await docspell('DELETE', `/sec/item/${id}/customfield/${custom.id}`);
		}
	});

	it('an empty selection of a single picker removes the value', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const folderId = await referenceId('folder', SEED_FOLDER);
		await docspell('PUT', `/sec/item/${id}/folder`, { id: folderId });
		const { context } = createExecuteContext({
			parameters: { resource: 'item', operation: 'update', itemId: id, updateFields: { folder: '' } },
		});
		const [items] = await node.execute!.call(context);
		expect(items[0].json.folder).toBeFalsy();
	});
});

// A workflow saved before the picker holds "a, b"; the picker holds a list, and an edit of a
// legacy value can leave a list whose entry is still the whole comma-separated string.
describe('Tag values are read the same way whatever shape the field holds', () => {
	it.each([
		['a plain string', 'e2e-invoice, e2e-contract', ['e2e-invoice', 'e2e-contract']],
		['a list', ['e2e-invoice', 'e2e-contract'], ['e2e-invoice', 'e2e-contract']],
		['a list holding a legacy string', ['e2e-invoice, e2e-contract'], ['e2e-invoice', 'e2e-contract']],
		['a mixed list', ['e2e-invoice', 'e2e-contract,upload-tag'], ['e2e-invoice', 'e2e-contract', 'upload-tag']],
		['an empty list', [], []],
		['an empty string', '', []],
		['nothing', undefined, []],
		['blank entries', [' ', 'e2e-invoice,, '], ['e2e-invoice']],
	])('%s', (_label, value, expected) => {
		expect(tagTokens(value)).toEqual(expected);
	});

	it('Item > Update applies a legacy string kept inside the picker list', async () => {
		const id = await itemIdByName(UPDATE_TARGET);
		const { context } = createExecuteContext({
			parameters: {
				resource: 'item',
				operation: 'update',
				itemId: id,
				updateFields: { tags: ['e2e-invoice, e2e-contract'], tagsMode: 'replace' },
			},
		});
		try {
			const [items] = await node.execute!.call(context);
			expect((items[0].json.tags as Array<{ name: string }>).map((tag) => tag.name).sort()).toEqual(['e2e-contract', 'e2e-invoice']);
		} finally {
			await docspell('PUT', `/sec/item/${id}/tags`, { items: [] });
		}
	});
});
