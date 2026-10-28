import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { itemDescription } from './resources/item';
import { executeItemGet } from './resources/item/get';
import { executeItemSearch } from './resources/item/search';

export class Docspell implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Docspell',
		name: 'docspell',
		icon: 'file:docspell.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with the documents in your Docspell instance',
		usableAsTool: true,
		defaults: {
			name: 'Docspell',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'docspellApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Item', value: 'item' }],
				default: 'item',
			},
			...itemDescription,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				if (resource === 'item' && operation === 'get') {
					returnData.push(...(await executeItemGet(this, itemIndex)));
				} else if (resource === 'item' && operation === 'search') {
					returnData.push(...(await executeItemSearch(this, itemIndex)));
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported operation: ${resource}/${operation}`, { itemIndex });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					// Already a node error: rewrapping it would lose the HTTP status.
					error.context.itemIndex = itemIndex;
					// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
