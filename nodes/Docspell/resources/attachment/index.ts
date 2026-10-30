import type { INodeProperties } from 'n8n-workflow';

import { attachmentDownloadDescription } from './download';

export const attachmentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['attachment'] } },
		options: [
			{
				name: 'Download',
				value: 'download',
				description: 'Download the file of an attachment',
				action: 'Download an attachment',
			},
		],
		default: 'download',
	},
	...attachmentDownloadDescription,
];
