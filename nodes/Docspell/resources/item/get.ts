import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { docspellApiRequest } from '../../../Common/GenericFunctions';

export const itemGetDescription: INodeProperties[] = [
	{
		displayName: 'Item ID',
		name: 'itemId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID of the item, as returned by Search',
		displayOptions: { show: { resource: ['item'], operation: ['get'] } },
	},
];

export async function executeItemGet(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const itemId = (context.getNodeParameter('itemId', itemIndex, '') as string).trim();
	if (!itemId) {
		throw new NodeOperationError(context.getNode(), 'The Item ID is empty', { itemIndex });
	}

	const item = await docspellApiRequest(
		context,
		{ method: 'GET', endpoint: `/sec/item/${encodeURIComponent(itemId)}` },
		{ 404: `Item "${itemId}" was not found` },
	);

	return context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(item as IDataObject), {
		itemData: { item: itemIndex },
	});
}
