import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { docspellApiRequest } from '../../Common/GenericFunctions';

interface Entry {
	id: string;
	name: string;
	category?: string;
	label?: string;
}

async function entries(context: ILoadOptionsFunctions, endpoint: string): Promise<Entry[]> {
	return ((await docspellApiRequest(context, { method: 'GET', endpoint })) as { items?: Entry[] }).items ?? [];
}

// Docspell lists everything by name already.
// A single-choice field is empty unless one is chosen, so empty has to be a choice too. Update
// reads it as "remove" (its descriptions say so); Upload as "none".
const none: INodePropertyOptions = { name: 'None', value: '' };

async function pickOne(context: ILoadOptionsFunctions, endpoint: string): Promise<INodePropertyOptions[]> {
	const options = (await entries(context, endpoint)).map(({ id, name }) => ({ name, value: id }));
	return [none, ...options];
}

export const loadOptions = {
	async getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const options = (await entries(this, '/sec/tag')).map(({ id, name, category }) => ({
			name,
			value: id,
			...(category ? { description: `Category: ${category}` } : {}),
		}));
		return options;
	},

	getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return pickOne(this, '/sec/folder');
	},

	getOrganizations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return pickOne(this, '/sec/organization');
	},

	getPersons(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return pickOne(this, '/sec/person');
	},

	getEquipment(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return pickOne(this, '/sec/equipment');
	},

	// Items refer to a custom field by its name; the label is what people recognise.
	async getCustomFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const options = (await entries(this, '/sec/customfield')).map(({ name, label }) => ({
			name: label || name,
			value: name,
			description: label ? `Field name: ${name}` : undefined,
		}));
		return options;
	},
};
