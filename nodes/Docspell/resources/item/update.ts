import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { docspellApiRequest } from '../../../Common/GenericFunctions';

const show = { resource: ['item'], operation: ['update'] };

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
		options: [
			{ displayName: 'Concerning Equipment ID', name: 'concEquipment', type: 'string', default: '', description: 'ID of the equipment. Leave empty to remove.' },
			{ displayName: 'Concerning Person ID', name: 'concPerson', type: 'string', default: '', description: 'ID of the person. Leave empty to remove.' },
			{ displayName: 'Correspondent Organization ID', name: 'corrOrg', type: 'string', default: '', description: 'ID of the organization. Leave empty to remove.' },
			{ displayName: 'Correspondent Person ID', name: 'corrPerson', type: 'string', default: '', description: 'ID of the person. Leave empty to remove.' },
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
			{ displayName: 'Folder', name: 'folder', type: 'string', default: '', description: 'Name or ID of the folder. Leave empty to remove.' },
			{ displayName: 'Item Date', name: 'itemDate', type: 'dateTime', default: '', description: 'Leave empty to remove' },
			{ displayName: 'Name', name: 'name', type: 'string', default: '', description: 'The new name of the item. It cannot be empty.' },
			{ displayName: 'Notes', name: 'notes', type: 'string', typeOptions: { rows: 4 }, default: '', description: 'Leave empty to remove the notes' },
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'invoice, 2026',
				description:
					'Comma-separated tag names or IDs. A tag that does not exist is an error. With Replace, leave empty to remove all tags.',
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
		],
	},
	{
		displayName: 'Custom Fields',
		name: 'customFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Custom Field',
		default: {},
		description: 'Custom fields to set on the item. The field must already exist in Docspell.',
		displayOptions: { show },
		options: [
			{
				displayName: 'Field',
				name: 'values',
				values: [
					{ displayName: 'Field Name or ID', name: 'field', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
];

// An empty object would be sent as no body at all, which Docspell answers with a 500,
// so "remove" is spelled out as null.
interface Step {
	label: string;
	run: () => Promise<void>;
}

interface DocspellTag {
	id: string;
	name: string;
}

const ENDPOINT_OF = {
	concEquipment: 'concEquipment',
	concPerson: 'concPerson',
	corrOrg: 'corrOrg',
	corrPerson: 'corrPerson',
} as const;

const LABEL_OF: Record<string, string> = {
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
	if (Object.keys(fields).length === 0 && customFields.length === 0) {
		throw fail('Choose at least one field to update');
	}

	// Everything that can be checked without Docspell is checked before the first change.
	if ('name' in fields && String(fields.name).trim() === '') throw fail('The name cannot be empty');
	const dateBody = (label: string, value: unknown): IDataObject => {
		if (value === '' || value === undefined || value === null) return { date: null };
		const text = String(value);
		const time = new Date(text).getTime();
		if (Number.isNaN(time)) throw fail(`${label} "${text}" is not a valid date`);
		// Date rolls a day that does not exist (February 30) over into the next month.
		const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
		if (day) {
			const [year, month, date] = day.slice(1).map(Number);
			const check = new Date(Date.UTC(year, month - 1, date));
			if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
				throw fail(`${label} "${text}" is not a valid date`);
			}
		}
		return { date: time };
	};
	const itemDate = 'itemDate' in fields ? dateBody('Item Date', fields.itemDate) : undefined;
	const dueDate = 'dueDate' in fields ? dateBody('Due Date', fields.dueDate) : undefined;

	const applied: string[] = [];
	const put = async (label: string, method: 'PUT' | 'POST', endpoint: string, body: IDataObject) => {
		const result = await docspellApiRequest(context, { method, endpoint: `${itemPath}${endpoint}`, body });
		if (result.success === false) {
			const reason = result.message === 'Not found' ? `item "${itemId}" was not found` : String(result.message);
			const done = applied.length > 0 ? ` (already applied: ${applied.join(', ')})` : '';
			throw fail(`Could not update the ${label}: ${reason}${done}`);
		}
		applied.push(label);
	};

	// An error after the first change still has to say what was already changed.
	const withApplied = (error: unknown): never => {
		if (applied.length === 0) throw error;
		const note = `already applied: ${applied.join(', ')}`;
		if (error instanceof NodeApiError || error instanceof NodeOperationError) {
			if (!`${error.message} ${error.description ?? ''}`.includes('already applied')) {
				error.description = error.description ? `${error.description} (${note})` : note;
			}
			throw error;
		}
		throw fail(`${error instanceof Error ? error.message : String(error)} (${note})`);
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
		const wanted = String(fields.tags)
			.split(',')
			.map((tag) => tag.trim())
			.filter((tag) => tag !== '');
		const mode = (fields.tagsMode as string | undefined) ?? 'replace';

		// Docspell silently ignores tags it does not know, so they are resolved here.
		const known = ((await docspellApiRequest(context, { method: 'GET', endpoint: '/sec/tag' })) as { items: DocspellTag[] }).items;
		const resolve = (token: string) => known.find((tag) => tag.id === token) ?? known.find((tag) => tag.name === token);
		const unknown = wanted.filter((token) => !resolve(token));
		if (unknown.length > 0) {
			throw fail(`Tag${unknown.length > 1 ? 's' : ''} not found in Docspell: ${unknown.map((tag) => `"${tag}"`).join(', ')}`);
		}
		const ids = wanted.map((token) => resolve(token)!.id);

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

	let item: IDataObject;
	try {
		for (const step of steps) await step.run();
		item = await docspellApiRequest(context, { method: 'GET', endpoint: itemPath }, { 404: `Item "${itemId}" was not found` });
	} catch (error) {
		return withApplied(error);
	}
	return context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(item), {
		itemData: { item: itemIndex },
	});
}
