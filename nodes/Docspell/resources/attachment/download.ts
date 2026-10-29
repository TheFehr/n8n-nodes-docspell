import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { docspellDownload } from '../../../Common/GenericFunctions';

const show = { resource: ['attachment'], operation: ['download'] };

const VERSIONS = {
	file: '',
	original: '/original',
	archive: '/archive',
	preview: '/preview',
} as const;

type Version = keyof typeof VERSIONS;

export const attachmentDownloadDescription: INodeProperties[] = [
	{
		displayName: 'Attachment ID',
		name: 'attachmentId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID of the attachment, as listed in the attachments of an item (Item > Get)',
		displayOptions: { show },
	},
	{
		displayName: 'Version',
		name: 'version',
		type: 'options',
		options: [
			{ name: 'Archive', value: 'archive', description: 'The archived PDF, if Docspell made one' },
			{ name: 'File', value: 'file', description: 'The file as Docspell shows it, the converted PDF where there is one' },
			{ name: 'Original', value: 'original', description: 'The file as it was uploaded' },
			{ name: 'Preview', value: 'preview', description: 'The preview image' },
		],
		default: 'file',
		displayOptions: { show },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		description: 'Name of the binary field that receives the file',
		displayOptions: { show },
	},
];

// Content-Disposition carries the name either plainly or percent-encoded (filename*=UTF-8'').
function fileNameOf(disposition: string | undefined): string | undefined {
	if (!disposition) return undefined;
	const encoded = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition);
	if (encoded) {
		try {
			return decodeURIComponent(encoded[1].trim());
		} catch {
			// Fall through to the plain form.
		}
	}
	return /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1].trim();
}

export async function executeAttachmentDownload(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const attachmentId = (context.getNodeParameter('attachmentId', itemIndex, '') as string).trim();
	if (!attachmentId) {
		throw new NodeOperationError(context.getNode(), 'The Attachment ID is empty', { itemIndex });
	}
	const requested = context.getNodeParameter('version', itemIndex, 'file') as string;
	const version: Version = requested in VERSIONS ? (requested as Version) : 'file';
	const binaryPropertyName = (context.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string).trim() || 'data';

	const notFound =
		version === 'file'
			? `Attachment "${attachmentId}" was not found`
			: `Attachment "${attachmentId}" was not found, or it has no ${version} version`;
	const { buffer, headers } = await docspellDownload(
		context,
		`/sec/attachment/${encodeURIComponent(attachmentId)}${VERSIONS[version]}`,
		{ 404: notFound },
	);

	const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
	const fileName = fileNameOf(lower['content-disposition']) ?? attachmentId;
	const mimeType = (lower['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
	const binary = await context.helpers.prepareBinaryData(buffer, fileName, mimeType);

	return [
		{
			json: { id: attachmentId, fileName, mimeType, size: buffer.length, version },
			binary: { [binaryPropertyName]: binary },
			pairedItem: { item: itemIndex },
		},
	];
}
