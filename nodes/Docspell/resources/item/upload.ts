import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { docspellApiRequest, resolveTags, splitList } from '../../../Common/GenericFunctions';

const show = { resource: ['item'], operation: ['upload'] };

export const itemUploadDescription: INodeProperties[] = [
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		description:
			'Name of the binary property that holds the file. Separate several names with commas to upload several files at once.',
		displayOptions: { show },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Attachments Only',
				name: 'attachmentsOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to import only the attachments of e-mail files and discard the e-mail body',
			},
			{
				displayName: 'Direction',
				name: 'direction',
				type: 'options',
				options: [
					{ name: 'Incoming', value: 'incoming' },
					{ name: 'Outgoing', value: 'outgoing' },
				],
				default: 'incoming',
			},
			{
				displayName: 'File Filter',
				name: 'fileFilter',
				type: 'string',
				default: '',
				placeholder: '*.pdf',
				description: 'A glob that selects which files to import from archives such as ZIP files or e-mails',
			},
			{
				displayName: 'Flatten Archives',
				name: 'flattenArchives',
				type: 'boolean',
				default: false,
				description: 'Whether to treat every ZIP file as a container of independent files, each becoming its own item',
			},
			{
				displayName: 'Folder Name or ID',
				name: 'folder',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getFolders' },
				default: '',
				description: 'The new items go into this folder. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'eng',
				description: 'Three-letter code of the document language, such as eng or deu. Defaults to the language in your Docspell settings.',
			},
			{
				displayName: 'One Item for All Files',
				name: 'oneItem',
				type: 'boolean',
				default: false,
				description: 'Whether to put all files of an upload into a single Docspell item instead of one item per file',
			},
			{
				displayName: 'Skip Duplicates',
				name: 'skipDuplicates',
				type: 'boolean',
				default: false,
				description: 'Whether to skip a file that Docspell already has, found by its checksum',
			},
			{
				displayName: 'Tag Names or IDs',
				name: 'tags',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTags' },
				default: [],
				description: 'A tag that does not exist is an error. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

export async function executeItemUpload(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const fail = (message: string) => new NodeOperationError(context.getNode(), message, { itemIndex });

	const propertyNames = splitList(context.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string);
	if (propertyNames.length === 0) throw fail('Name the binary field that holds the file');
	const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const language = String(options.language ?? '').trim();
	if (language !== '' && !/^[a-z]{3}$/i.test(language)) {
		throw fail(`Language "${language}" is not a three-letter code such as eng or deu`);
	}
	if (options.oneItem === true && options.flattenArchives === true) {
		throw fail('"One Item for All Files" and "Flatten Archives" contradict each other');
	}

	// The files come first, so a missing binary field is reported before anything is asked of Docspell.
	const form = new FormData();
	const fileNames: string[] = [];
	const files: Array<{ blob: Blob; fileName: string }> = [];
	for (const propertyName of propertyNames) {
		const binary = context.helpers.assertBinaryData(itemIndex, propertyName);
		const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, propertyName);
		const fileName = binary.fileName ?? propertyName;
		fileNames.push(fileName);
		files.push({ blob: new Blob([new Uint8Array(buffer)], { type: binary.mimeType }), fileName });
	}

	// Docspell silently ignores an unknown folder or tag, so both are resolved here.
	const meta: IDataObject = { multiple: options.oneItem !== true };
	if (options.direction) meta.direction = options.direction as string;
	if (options.skipDuplicates === true) meta.skipDuplicates = true;
	if (options.flattenArchives === true) meta.flattenArchives = true;
	if (options.attachmentsOnly === true) meta.attachmentsOnly = true;
	if (language !== '') meta.language = language.toLowerCase();
	if (options.fileFilter) meta.fileFilter = options.fileFilter as string;

	const folder = String(options.folder ?? '').trim();
	if (folder !== '') {
		const { items } = (await docspellApiRequest(context, { method: 'GET', endpoint: '/sec/folder' })) as {
			items: Array<{ id: string; name: string }>;
		};
		const found = items.find((entry) => entry.id === folder) ?? items.find((entry) => entry.name === folder);
		if (!found) throw fail(`Folder "${folder}" was not found in Docspell`);
		meta.folder = found.id;
	}

	const wantedTags = splitList(String(options.tags ?? ''));
	if (wantedTags.length > 0) {
		const { names, unknown } = await resolveTags(context, wantedTags);
		if (unknown.length > 0) {
			throw fail(`Tag${unknown.length > 1 ? 's' : ''} not found in Docspell: ${unknown.map((tag) => `"${tag}"`).join(', ')}`);
		}
		meta.tags = { items: names };
	}

	form.append('meta', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
	for (const { blob, fileName } of files) form.append('file', blob, fileName);

	const result = await docspellApiRequest(context, { method: 'POST', endpoint: '/sec/upload/item', body: form });
	// Docspell reports a refused upload as HTTP 200 with success: false.
	if (result.success === false) throw fail(`Docspell did not accept the upload: ${String(result.message)}`);

	return context.helpers.constructExecutionMetaData(
		context.helpers.returnJsonArray({ success: true, message: String(result.message ?? ''), files: fileNames }),
		{ itemData: { item: itemIndex } },
	);
}
