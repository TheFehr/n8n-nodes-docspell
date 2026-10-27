import type { INodeProperties } from 'n8n-workflow';

import { itemGetDescription } from './get';
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
				name: 'Get',
				value: 'get',
				description: 'Get the details of one item',
				action: 'Get an item',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Search items with a Docspell query',
				action: 'Search items',
			},
		],
		default: 'get',
	},
	...itemGetDescription,
	...itemSearchDescription,
];
