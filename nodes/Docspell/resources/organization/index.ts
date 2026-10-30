import type { INodeProperties } from 'n8n-workflow';

import { organizationGetDescription } from './get';
import { organizationGetAllDescription } from './getAll';

export const organizationDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['organization'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get one organization, including its short name',
				action: 'Get an organization',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the organizations, optionally filtered by name',
				action: 'Get many organizations',
			},
		],
		default: 'get',
	},
	...organizationGetDescription,
	...organizationGetAllDescription,
];
