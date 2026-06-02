import {INodeType, INodeTypeDescription} from 'n8n-workflow';

import * as doc from './openapi.json';
import { N8NPropertiesBuilder, N8NPropertiesBuilderConfig } from '@devlikeapro/n8n-openapi-node';

const config: N8NPropertiesBuilderConfig = {}
const parser = new N8NPropertiesBuilder(doc, config);
const properties = parser.build()

export class Docspell implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Docspell',
		name: 'docspell',
		icon: 'file:docspell.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + " " + $parameter["resource"]}}',
		description: 'Consume Docspell API',
		defaults: {
			name: 'Docspell',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'docspellApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.url}}/api/v1'
		},
		properties: properties
	};
}
