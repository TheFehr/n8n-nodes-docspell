import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

interface DocspellRequest {
	method: IHttpRequestMethods;
	endpoint: string;
	body?: IHttpRequestOptions['body'];
	qs?: IDataObject;
}

// Replaces n8n's generic wording for statuses where Docspell's meaning is known.
export type StatusMessages = Partial<Record<number, string>>;

export async function docspellApiRequest(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	{ method, endpoint, body, qs }: DocspellRequest,
	statusMessages: StatusMessages = {},
): Promise<IDataObject> {
	const { url } = await context.getCredentials('docspellApi');

	const options: IHttpRequestOptions = {
		method,
		baseURL: `${String(url).replace(/\/+$/, '')}/api/v1`,
		url: endpoint,
		body,
		qs,
		json: true,
	};

	try {
		return (await context.helpers.httpRequestWithAuthentication.call(
			context,
			'docspellApi',
			options,
		)) as IDataObject;
	} catch (error) {
		const status = Number(
			(error as { httpCode?: string }).httpCode ?? (error as { response?: { status?: number } }).response?.status,
		);
		throw new NodeApiError(context.getNode(), error as JsonObject, {
			message: statusMessages[status],
		});
	}
}

interface Named {
	id: string;
	name: string;
}

export interface ResolvedTags {
	ids: string[];
	names: string[];
	unknown: string[];
}

// Docspell silently drops tags it does not know, so callers resolve them first. A token is
// an ID or a name.
export async function resolveTags(context: IExecuteFunctions, tokens: string[]): Promise<ResolvedTags> {
	const known = ((await docspellApiRequest(context, { method: 'GET', endpoint: '/sec/tag' })) as { items: Named[] }).items;
	const resolved = tokens.map((token) => known.find((tag) => tag.id === token) ?? known.find((tag) => tag.name === token));
	return {
		ids: resolved.filter((tag): tag is Named => tag !== undefined).map((tag) => tag.id),
		names: resolved.filter((tag): tag is Named => tag !== undefined).map((tag) => tag.name),
		unknown: tokens.filter((_, index) => resolved[index] === undefined),
	};
}

// Splits "a, b" into trimmed, non-empty tokens.
export function splitList(text: string): string[] {
	return text
		.split(',')
		.map((token) => token.trim())
		.filter((token) => token !== '');
}

export interface DownloadedFile {
	buffer: Buffer;
	headers: Record<string, string>;
}

// Files are fetched as raw bytes: decoding them as text would corrupt anything that is not UTF-8.
export async function docspellDownload(
	context: IExecuteFunctions,
	endpoint: string,
	statusMessages: StatusMessages = {},
): Promise<DownloadedFile> {
	const { url } = await context.getCredentials('docspellApi');

	const options: IHttpRequestOptions = {
		method: 'GET',
		baseURL: `${String(url).replace(/\/+$/, '')}/api/v1`,
		url: endpoint,
		encoding: 'arraybuffer',
		returnFullResponse: true,
		json: false,
	};

	try {
		const response = (await context.helpers.httpRequestWithAuthentication.call(context, 'docspellApi', options)) as {
			body: Buffer | ArrayBuffer;
			headers: Record<string, string>;
		};
		return { buffer: Buffer.from(response.body as ArrayBuffer), headers: response.headers };
	} catch (error) {
		const status = Number(
			(error as { httpCode?: string }).httpCode ?? (error as { response?: { status?: number } }).response?.status,
		);
		throw new NodeApiError(context.getNode(), error as JsonObject, {
			message: statusMessages[status],
		});
	}
}
