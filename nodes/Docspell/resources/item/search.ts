import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { docspellApiRequest } from '../../../Common/GenericFunctions';

const show = { resource: ['item'], operation: ['search'] };

export const itemSearchDescription: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		default: '',
		placeholder: 'tag:invoice date>2026-01-01',
		description:
			'Search query in Docspell\'s query language. Leave empty to match all items. <a href="https://docspell.org/docs/query/">Query syntax</a>.',
		displayOptions: { show },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { ...show, returnAll: [false] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Include Details',
				name: 'withDetails',
				type: 'boolean',
				default: false,
				description: 'Whether to include the tags and attachments of each item',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				description: 'Number of items to skip',
			},
			{
				displayName: 'Search In',
				name: 'searchMode',
				type: 'options',
				default: 'normal',
				options: [
					{ name: 'Items', value: 'normal', description: 'Items that are not deleted' },
					{ name: 'Trash', value: 'trashed', description: 'Only deleted items' },
					{ name: 'Items and Trash', value: 'all' },
				],
			},
		],
	},
];

interface SearchBody extends IDataObject {
	query: string;
	withDetails?: boolean;
	searchMode?: string;
}

interface SearchResult {
	groups: Array<{ items: IDataObject[] }>;
	limit: number;
}

const QUERY_REJECTED =
	'Docspell could not parse the search query. See https://docspell.org/docs/query/ for the syntax.';

// Docspell groups results by month; the node returns them as one flat list.
async function searchPage(context: IExecuteFunctions, body: SearchBody, limit: number, offset: number) {
	const result = (await docspellApiRequest(
		context,
		{ method: 'POST', endpoint: '/sec/item/search', body: { ...body, limit, offset } },
		{ 400: QUERY_REJECTED },
	)) as unknown as SearchResult;

	return { items: result.groups.flatMap((group) => group.items), serverLimit: result.limit };
}

export async function searchAllPages(
	context: IExecuteFunctions,
	body: SearchBody,
	pageSize = 100,
	startOffset = 0,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let offset = startOffset;

	for (;;) {
		const page = await searchPage(context, body, pageSize, offset);
		items.push(...page.items);
		// The server may cap the page size; a page shorter than what it applied is the last.
		if (page.items.length === 0 || page.items.length < page.serverLimit) return items;
		offset += page.items.length;
	}
}

export async function executeItemSearch(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const options = context.getNodeParameter('options', itemIndex, {}) as {
		offset?: number;
		withDetails?: boolean;
		searchMode?: string;
	};
	const body: SearchBody = {
		query: context.getNodeParameter('query', itemIndex, '') as string,
		withDetails: options.withDetails ?? false,
		searchMode: options.searchMode ?? 'normal',
	};
	const offset = options.offset ?? 0;

	const items = context.getNodeParameter('returnAll', itemIndex, false)
		? await searchAllPages(context, body, 100, offset)
		: (await searchPage(context, body, context.getNodeParameter('limit', itemIndex, 50) as number, offset)).items;

	return context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(items), {
		itemData: { item: itemIndex },
	});
}
