import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

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

// The tags field holds a list since it became a picker, but a workflow saved before that, or
// an expression, still gives "a, b". Every entry is split again, so both read the same.
export function tagTokens(value: unknown): string[] {
	const entries = Array.isArray(value) ? value : [value];
	return entries.flatMap((entry) => splitList(entry === undefined || entry === null ? '' : String(entry)));
}

// An expression that resolves to nothing is not "no tags": read as an empty list it would make
// Replace remove every tag. Only [] and '' mean none.
export function hasMissingTag(value: unknown): boolean {
	return (Array.isArray(value) ? value : [value]).some((entry) => entry === undefined || entry === null);
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

// Docspell takes a date as epoch milliseconds, or null to remove it. A day that does not exist
// (February 30) is an error, where Date would roll it over into the next month.
export function dateBody(label: string, value: unknown, fail: (message: string) => Error): IDataObject {
	if (value === '' || value === undefined || value === null) return { date: null };
	const text = String(value);
	const time = new Date(text).getTime();
	if (Number.isNaN(time)) throw fail(`${label} "${text}" is not a valid date`);
	const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
	if (day) {
		const [year, month, date] = day.slice(1).map(Number);
		const check = new Date(Date.UTC(year, month - 1, date));
		if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
			throw fail(`${label} "${text}" is not a valid date`);
		}
	}
	return { date: time };
}

// An error after the first change still has to say what was already changed.
export function rethrowWithApplied(applied: string[], error: unknown, fail: (message: string) => Error): never {
	if (applied.length === 0) throw error;
	const note = `already applied: ${applied.join(', ')}`;
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		if (!`${error.message} ${error.description ?? ''}`.includes('already applied')) {
			// Continue On Fail outputs only the message; the UI shows the description.
			error.message = `${error.message} (${note})`;
			error.description = error.description ? `${error.description} (${note})` : note;
		}
		throw error;
	}
	throw fail(`${error instanceof Error ? error.message : String(error)} (${note})`);
}
