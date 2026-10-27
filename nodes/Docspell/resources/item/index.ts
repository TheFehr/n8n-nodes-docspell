import type { INodeProperties } from 'n8n-workflow';

import { itemSearchDescription } from './search';

export const itemDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['item'] } },
		options: [
			{
				name: 'Search',
				value: 'search',
				description: 'Search items with a Docspell query',
				action: 'Search items',
			},
		],
		default: 'search',
	},
	...itemSearchDescription,
];
