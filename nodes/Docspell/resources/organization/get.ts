import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { docspellApiRequest } from '../../../Common/GenericFunctions';

export const organizationGetDescription: INodeProperties[] = [
	{
		displayName: 'Organization ID',
		name: 'organizationId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID of the organization, such as the correspondent organization of an item',
		displayOptions: { show: { resource: ['organization'], operation: ['get'] } },
	},
];

export async function executeOrganizationGet(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const organizationId = (context.getNodeParameter('organizationId', itemIndex, '') as string).trim();
	if (!organizationId) {
		throw new NodeOperationError(context.getNode(), 'The Organization ID is empty', { itemIndex });
	}

	const organization = await docspellApiRequest(
		context,
		{ method: 'GET', endpoint: `/sec/organization/${encodeURIComponent(organizationId)}` },
		{ 404: `Organization "${organizationId}" was not found` },
	);

	return context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(organization as IDataObject), {
		itemData: { item: itemIndex },
	});
}
