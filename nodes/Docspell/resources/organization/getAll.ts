import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { docspellApiRequest } from '../../../Common/GenericFunctions';

const show = { resource: ['organization'], operation: ['getAll'] };

export const organizationGetAllDescription: INodeProperties[] = [
	{
		displayName: 'Filter',
		name: 'query',
		type: 'string',
		default: '',
		description: 'Only organizations whose name or short name contains this text. Leave empty to list all.',
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
];

export async function executeOrganizationGetAll(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const query = (context.getNodeParameter('query', itemIndex, '') as string).trim();

	// Without full=true Docspell lists only the ID and name of each organization.
	const result = (await docspellApiRequest(context, {
		method: 'GET',
		endpoint: '/sec/organization',
		qs: { full: 'true', ...(query ? { q: query } : {}) },
	})) as { items?: IDataObject[] };

	// Docspell does not page this list, so the limit is applied here.
	const all = result.items ?? [];
	const organizations = context.getNodeParameter('returnAll', itemIndex, false)
		? all
		: all.slice(0, context.getNodeParameter('limit', itemIndex, 50) as number);

	return context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(organizations), {
		itemData: { item: itemIndex },
	});
}
