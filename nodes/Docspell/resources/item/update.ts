import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { dateBody, docspellApiRequest, hasMissingTag, resolveTags, rethrowWithApplied, tagTokens } from '../../../Common/GenericFunctions';

const show = { resource: ['item'], operation: ['update'] };

// Shared with Update Many, which has no notes endpoint and leaves that one out.
export const updateFieldOptions: INodeProperties[] = [
	{
		displayName: 'Concerning Equipment Name or ID',
		name: 'concEquipment',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getEquipment' },
		default: '',
		description: 'None removes the current one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Concerning Person Name or ID',
		name: 'concPerson',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPersons' },
		default: '',
		description: 'None removes the current one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Correspondent Organization Name or ID',
		name: 'corrOrg',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getOrganizations' },
		default: '',
		description: 'None removes the current one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Correspondent Person Name or ID',
		name: 'corrPerson',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPersons' },
		default: '',
		description: 'None removes the current one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Direction',
		name: 'direction',
		type: 'options',
		default: 'incoming',
		options: [
			{ name: 'Incoming', value: 'incoming' },
			{ name: 'Outgoing', value: 'outgoing' },
		],
	},
	{ displayName: 'Due Date', name: 'dueDate', type: 'dateTime', default: '', description: 'Leave empty to remove' },
	{
		displayName: 'Folder Name or ID',
		name: 'folder',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFolders' },
		default: '',
		description: 'None removes the current one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{ displayName: 'Item Date', name: 'itemDate', type: 'dateTime', default: '', description: 'Leave empty to remove' },
	{ displayName: 'Name', name: 'name', type: 'string', default: '', description: 'The new name of the item. It cannot be empty.' },
	{ displayName: 'Notes', name: 'notes', type: 'string', typeOptions: { rows: 4 }, default: '', description: 'Leave empty to remove the notes' },
	{
		displayName: 'Tag Names or IDs',
		name: 'tags',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getTags' },
		default: [],
		description: 'A tag that does not exist is an error. With Replace, choosing none removes all tags. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Tags Mode',
		name: 'tagsMode',
		type: 'options',
		default: 'replace',
		description: 'What to do with the tags listed under Tags',
		options: [
			{ name: 'Replace', value: 'replace', description: 'The item gets exactly these tags' },
			{ name: 'Add', value: 'add', description: 'Keep the current tags and add these' },
			{ name: 'Remove', value: 'remove', description: 'Remove only these tags' },
		],
	},
];

// Built by a function so Update and Update Many share it without repeating the picker.
export const customFieldsProperty = (name: string, show: Record<string, string[]>): INodeProperties => ({
	displayName: 'Custom Fields',
	name,
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Custom Field',
	default: {},
	description: 'Custom fields to set. The field must already exist in Docspell.',
	displayOptions: { show },
	options: [
		{
			displayName: 'Field',
			name: 'values',
			values: [
				{
					displayName: 'Field Name or ID',
					name: 'field',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCustomFields' },
					default: '',
					description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{ displayName: 'Value', name: 'value', type: 'string', default: '' },
			],
		},
	],
});

export const removeCustomFieldsProperty = (show: Record<string, string[]>): INodeProperties => ({
	displayName: 'Remove Custom Field Names or IDs',
	name: 'removeCustomFields',
	type: 'multiOptions',
	typeOptions: { loadOptionsMethod: 'getCustomFields' },
	default: [],
	description:
		'Custom fields whose value is removed. An item that does not have the field is left as it is. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	displayOptions: { show },
});

export const itemUpdateDescription: INodeProperties[] = [
	{
		displayName: 'Item ID',
		name: 'itemId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID of the item, as returned by Search',
		displayOptions: { show },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		description: 'Only the fields added here are changed. Where noted, an empty value removes the current one.',
		displayOptions: { show },
		options: updateFieldOptions,
	},
	customFieldsProperty('customFields', show),
	removeCustomFieldsProperty(show),
];

// An empty object would be sent as no body at all, which Docspell answers with a 500,
// so "remove" is spelled out as null.
interface Step {
	label: string;
	run: () => Promise<void>;
}

interface Named {
	id: string;
	name: string;
}

interface DocspellTag {
	id: string;
	name: string;
}

export const ENDPOINT_OF = {
	concEquipment: 'concEquipment',
	concPerson: 'concPerson',
	corrOrg: 'corrOrg',
	corrPerson: 'corrPerson',
} as const;

export const LABEL_OF: Record<string, string> = {
	concEquipment: 'concerning equipment',
	concPerson: 'concerning person',
	corrOrg: 'correspondent organization',
	corrPerson: 'correspondent person',
};

export async function executeItemUpdate(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const fail = (message: string) => new NodeOperationError(context.getNode(), message, { itemIndex });

	const itemId = (context.getNodeParameter('itemId', itemIndex, '') as string).trim();
	if (!itemId) throw fail('The Item ID is empty');
	const itemPath = `/sec/item/${encodeURIComponent(itemId)}`;

	const fields = context.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	const customFields = (
		(context.getNodeParameter('customFields', itemIndex, {}) as { values?: Array<{ field: string; value: string }> })
			.values ?? []
	).filter((entry) => entry.field.trim() !== '');
	const removeCustomFields = tagTokens(context.getNodeParameter('removeCustomFields', itemIndex, []));
	if (Object.keys(fields).length === 0 && customFields.length === 0 && removeCustomFields.length === 0) {
		throw fail('Choose at least one field to update');
	}

	// Everything that can be checked without Docspell is checked before the first change.
	if ('name' in fields && String(fields.name).trim() === '') throw fail('The name cannot be empty');
	if ('tags' in fields && hasMissingTag(fields.tags)) {
		throw fail('The tags value is empty (null or undefined). Leave the field empty to remove all tags.');
	}
	const alsoSet = removeCustomFields.filter((name) => customFields.some((entry) => entry.field.trim() === name));
	if (alsoSet.length > 0) {
		throw fail(`Custom field ${alsoSet.map((name) => `"${name}"`).join(', ')} is both set and removed`);
	}
	const fieldsToRemove: Named[] = [];
	if (removeCustomFields.length > 0) {
		const known = ((await docspellApiRequest(context, { method: 'GET', endpoint: '/sec/customfield' })) as { items: Named[] }).items;
		const unknown: string[] = [];
		for (const token of removeCustomFields) {
			const field = known.find((candidate) => candidate.name === token || candidate.id === token);
			if (field) fieldsToRemove.push(field);
			else unknown.push(token);
		}
		if (unknown.length > 0) {
			throw fail(`Custom field${unknown.length > 1 ? 's' : ''} not found in Docspell: ${unknown.map((name) => `"${name}"`).join(', ')}`);
		}
	}
	const itemDate = 'itemDate' in fields ? dateBody('Item Date', fields.itemDate, fail) : undefined;
	const dueDate = 'dueDate' in fields ? dateBody('Due Date', fields.dueDate, fail) : undefined;

	const applied: string[] = [];
	const put = async (label: string, method: 'PUT' | 'POST' | 'DELETE', endpoint: string, body: IDataObject) => {
		const result = await docspellApiRequest(context, { method, endpoint: `${itemPath}${endpoint}`, body });
		if (result.success === false) {
			const reason = result.message === 'Not found' ? `item "${itemId}" was not found` : String(result.message);
			const done = applied.length > 0 ? ` (already applied: ${applied.join(', ')})` : '';
			throw fail(`Could not update the ${label}: ${reason}${done}`);
		}
		applied.push(label);
	};

	const steps: Step[] = [];
	if ('name' in fields) steps.push({ label: 'name', run: () => put('name', 'PUT', '/name', { text: fields.name as string }) });
	if ('notes' in fields) {
		steps.push({ label: 'notes', run: () => put('notes', 'PUT', '/notes', fields.notes === '' ? { text: null } : { text: fields.notes as string }) });
	}
	if ('direction' in fields) {
		steps.push({ label: 'direction', run: () => put('direction', 'PUT', '/direction', { direction: fields.direction as string }) });
	}
	if (itemDate) steps.push({ label: 'item date', run: () => put('item date', 'PUT', '/date', itemDate) });
	if (dueDate) steps.push({ label: 'due date', run: () => put('due date', 'PUT', '/duedate', dueDate) });
	if ('folder' in fields) {
		steps.push({ label: 'folder', run: () => put('folder', 'PUT', '/folder', fields.folder === '' ? { id: null } : { id: fields.folder as string }) });
	}
	for (const key of Object.keys(ENDPOINT_OF) as Array<keyof typeof ENDPOINT_OF>) {
		if (key in fields) {
			steps.push({
				label: LABEL_OF[key],
				run: () => put(LABEL_OF[key], 'PUT', `/${ENDPOINT_OF[key]}`, fields[key] === '' ? { id: null } : { id: fields[key] as string }),
			});
		}
	}

	if ('tags' in fields) {
		const wanted = tagTokens(fields.tags);
		const mode = (fields.tagsMode as string | undefined) ?? 'replace';

		const { ids, unknown } = await resolveTags(context, wanted);
		if (unknown.length > 0) {
			throw fail(`Tag${unknown.length > 1 ? 's' : ''} not found in Docspell: ${unknown.map((tag) => `"${tag}"`).join(', ')}`);
		}

		if (mode === 'remove') {
			if (ids.length > 0) steps.push({ label: 'tags', run: () => put('tags', 'POST', '/tagsremove', { items: ids }) });
		} else if (mode === 'add') {
			if (ids.length > 0) {
				steps.push({
					label: 'tags',
					run: async () => {
						const item = (await docspellApiRequest(context, { method: 'GET', endpoint: itemPath })) as { tags?: DocspellTag[] };
						const current = (item.tags ?? []).map((tag) => tag.id);
						await put('tags', 'PUT', '/tags', { items: [...new Set([...current, ...ids])] });
					},
				});
			}
		} else {
			steps.push({ label: 'tags', run: () => put('tags', 'PUT', '/tags', { items: ids }) });
		}
	}

	for (const { field, value } of customFields) {
		const label = `custom field "${field.trim()}"`;
		steps.push({ label, run: () => put(label, 'PUT', '/customfield', { field: field.trim(), value }) });
	}

	for (const field of fieldsToRemove) {
		const label = `removal of custom field "${field.name}"`;
		steps.push({
			label,
			run: async () => {
				// Only a field the item carries can be removed; Docspell answers any other with "Not found".
				const current = (await docspellApiRequest(context, { method: 'GET', endpoint: itemPath })) as { customfields?: Named[] };
				if ((current.customfields ?? []).some((entry) => entry.id === field.id)) {
					await put(label, 'DELETE', `/customfield/${encodeURIComponent(field.id)}`, {});
				}
			},
		});
	}

	let item: IDataObject;
	try {
		for (const step of steps) await step.run();
		item = await docspellApiRequest(context, { method: 'GET', endpoint: itemPath }, { 404: `Item "${itemId}" was not found` });
	} catch (error) {
		return rethrowWithApplied(applied, error, fail);
	}
	return context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(item), {
		itemData: { item: itemIndex },
	});
}
