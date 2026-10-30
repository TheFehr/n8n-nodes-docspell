import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { dateBody, docspellApiRequest, hasMissingTag, resolveTags, rethrowWithApplied, tagTokens } from '../../../Common/GenericFunctions';
import { customFieldsProperty, ENDPOINT_OF, LABEL_OF, updateFieldOptions } from './update';

const show = { resource: ['item'], operation: ['updateMany'] };

export const itemUpdateManyDescription: INodeProperties[] = [
	{
		displayName: 'Item IDs',
		name: 'itemIds',
		type: 'string',
		required: true,
		default: '',
		description:
			'The IDs of the items to change, separated by commas, spaces or new lines. Use an expression to take them from earlier items, for example the results of a Search.',
		displayOptions: { show },
	},
	{
		displayName: 'Update Fields',
		name: 'bulkFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		description: 'Only the fields added here are changed, on every item. Where noted, an empty value removes the current one.',
		displayOptions: { show },
		// Docspell has no bulk endpoint for the notes.
		options: updateFieldOptions.filter((option) => option.name !== 'notes'),
	},
	customFieldsProperty('bulkCustomFields', show),
	{
		displayName: 'Remove Custom Field Names or IDs',
		name: 'removeCustomFields',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getCustomFields' },
		default: [],
		description:
			'Custom fields whose value is removed from every item. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show },
	},
];

// "a, b\nc" -> a, b, c, each once.
function idList(value: unknown): string[] {
	const entries = Array.isArray(value) ? value : [value];
	const ids = entries.flatMap((entry) => String(entry ?? '').split(/[\s,]+/)).filter((id) => id !== '');
	return [...new Set(ids)];
}

interface Step {
	label: string;
	run: () => Promise<void>;
}

export async function executeItemUpdateMany(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const fail = (message: string) => new NodeOperationError(context.getNode(), message, { itemIndex });

	const ids = idList(context.getNodeParameter('itemIds', itemIndex, ''));
	if (ids.length === 0) throw fail('No item IDs were given');

	const fields = context.getNodeParameter('bulkFields', itemIndex, {}) as IDataObject;
	const customFields = (
		(context.getNodeParameter('bulkCustomFields', itemIndex, {}) as { values?: Array<{ field: string; value: string }> }).values ?? []
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
	const itemDate = 'itemDate' in fields ? dateBody('Item Date', fields.itemDate, fail) : undefined;
	const dueDate = 'dueDate' in fields ? dateBody('Due Date', fields.dueDate, fail) : undefined;

	// Docspell answers an ID it does not know with success and changes nothing, so a typo would
	// go unnoticed. Looking every item up first also gives the tags each one has now.
	const current: IDataObject[] = [];
	const missing: string[] = [];
	for (const id of ids) {
		try {
			current.push(await docspellApiRequest(context, { method: 'GET', endpoint: `/sec/item/${encodeURIComponent(id)}` }, { 404: `Item "${id}" was not found` }));
		} catch (error) {
			// Already a node error: only a missing item is collected, anything else stops here.
			// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
			if ((error as { httpCode?: string }).httpCode !== '404') throw error;
			missing.push(id);
		}
	}
	if (missing.length > 0) {
		throw fail(`Item${missing.length > 1 ? 's' : ''} not found in Docspell: ${missing.map((id) => `"${id}"`).join(', ')}. Nothing was changed.`);
	}

	const applied: string[] = [];
	const put = async (label: string, method: 'PUT' | 'POST', endpoint: string, body: IDataObject, items = ids) => {
		const result = await docspellApiRequest(context, { method, endpoint: `/sec/items${endpoint}`, body: { items, ...body } });
		if (result.success === false) {
			const done = applied.length > 0 ? ` (already applied: ${applied.join(', ')})` : '';
			throw fail(`Could not update the ${label}: ${String(result.message)}${done}`);
		}
		applied.push(label);
	};

	const steps: Step[] = [];
	if ('name' in fields) steps.push({ label: 'name', run: () => put('name', 'PUT', '/name', { name: fields.name as string }) });
	if ('direction' in fields) {
		steps.push({ label: 'direction', run: () => put('direction', 'PUT', '/direction', { direction: fields.direction as string }) });
	}
	if (itemDate) steps.push({ label: 'item date', run: () => put('item date', 'PUT', '/date', itemDate) });
	if (dueDate) steps.push({ label: 'due date', run: () => put('due date', 'PUT', '/duedate', dueDate) });
	if ('folder' in fields) {
		steps.push({ label: 'folder', run: () => put('folder', 'PUT', '/folder', { ref: fields.folder === '' ? null : (fields.folder as string) }) });
	}
	for (const key of Object.keys(ENDPOINT_OF) as Array<keyof typeof ENDPOINT_OF>) {
		if (key in fields) {
			steps.push({
				label: LABEL_OF[key],
				run: () => put(LABEL_OF[key], 'PUT', `/${ENDPOINT_OF[key]}`, { ref: fields[key] === '' ? null : (fields[key] as string) }),
			});
		}
	}

	if ('tags' in fields) {
		const mode = (fields.tagsMode as string | undefined) ?? 'replace';
		const { ids: tagIds, unknown } = await resolveTags(context, tagTokens(fields.tags));
		if (unknown.length > 0) {
			throw fail(`Tag${unknown.length > 1 ? 's' : ''} not found in Docspell: ${unknown.map((tag) => `"${tag}"`).join(', ')}`);
		}
		if (mode === 'remove') {
			if (tagIds.length > 0) steps.push({ label: 'tags', run: () => put('tags', 'POST', '/tagsremove', { refs: tagIds }) });
		} else if (mode === 'add') {
			if (tagIds.length > 0) steps.push({ label: 'tags', run: () => put('tags', 'POST', '/tags', { refs: tagIds }) });
		} else if (tagIds.length > 0) {
			steps.push({ label: 'tags', run: () => put('tags', 'PUT', '/tags', { refs: tagIds }) });
		} else {
			// Docspell reports "Not found" when there is nothing to remove, so only the items
			// that carry a tag are sent.
			const tagged = ids.filter((_, index) => ((current[index].tags as unknown[] | undefined) ?? []).length > 0);
			if (tagged.length > 0) steps.push({ label: 'tags', run: () => put('tags', 'PUT', '/tags', { refs: [] }, tagged) });
		}
	}

	for (const { field, value } of customFields) {
		const label = `custom field "${field.trim()}"`;
		steps.push({ label, run: () => put(label, 'PUT', '/customfield', { field: { field: field.trim(), value } }) });
	}
	for (const name of removeCustomFields) {
		const label = `removal of custom field "${name}"`;
		steps.push({ label, run: () => put(label, 'POST', '/customfieldremove', { name }) });
	}

	const result: INodeExecutionData[] = [];
	try {
		for (const step of steps) await step.run();
		for (const id of ids) {
			const item = await docspellApiRequest(context, { method: 'GET', endpoint: `/sec/item/${encodeURIComponent(id)}` }, { 404: `Item "${id}" was not found` });
			result.push(...context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(item), { itemData: { item: itemIndex } }));
		}
	} catch (error) {
		return rethrowWithApplied(applied, error, fail);
	}
	return result;
}
