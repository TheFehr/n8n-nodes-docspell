import type {
	ICredentialDataDecryptedObject,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
} from 'n8n-workflow';

import { DocspellApi } from '../credentials/DocspellApi.credentials';
import { ACCOUNT, DOCSPELL_URL, PASSWORD } from './helpers';

type Parameters = IDataObject | ((itemIndex: number) => IDataObject);

interface Options {
	parameters: Parameters;
	inputItems?: INodeExecutionData[];
	credentials?: Partial<ICredentialDataDecryptedObject>;
	continueOnFail?: boolean;
	// Fails matching requests with an HTTP error before they reach Docspell.
	failWhen?: (request: RecordedRequest) => boolean;
}

export interface RecordedRequest {
	method?: string;
	url: string;
	body?: unknown;
}

// A readable form of a multipart body for the recorded requests: the metadata part parsed,
// and the files by name.
async function describeForm(form: FormData): Promise<{ meta?: unknown; files: string[] }> {
	const described: { meta?: unknown; files: string[] } = { files: [] };
	for (const [name, value] of form.entries()) {
		if (name === 'meta') described.meta = JSON.parse(await (value as Blob).text());
		else described.files.push((value as File).name);
	}
	return described;
}

// A stand-in for the parts of n8n's execution context a node uses. The HTTP helper is
// real: it authenticates through the credential under test and calls the live server,
// then fails the way n8n's helper does (an error carrying the HTTP status).
export function createExecuteContext(options: Options) {
	const requests: RecordedRequest[] = [];
	const credentials = { url: DOCSPELL_URL, account: ACCOUNT, password: PASSWORD, ...options.credentials };
	const inputItems = options.inputItems ?? [{ json: {} }];

	const httpRequestWithAuthentication = async (
		credentialType: string,
		requestOptions: IHttpRequestOptions,
	) => {
		if (credentialType !== 'docspellApi') throw new Error(`unexpected credential ${credentialType}`);
		const { authenticate } = new DocspellApi();
		if (typeof authenticate !== 'function') throw new Error('authenticate must be a function');
		const authenticated = await authenticate(credentials, { ...requestOptions });
		// n8n's HTTP helper sends no body at all for an empty object.
		const multipart = authenticated.body instanceof FormData;
		const hasBody =
			authenticated.body !== undefined &&
			(multipart || !(typeof authenticated.body === 'object' && Object.keys(authenticated.body as object).length === 0));

		const base = authenticated.baseURL ? authenticated.baseURL.replace(/\/+$/, '') : '';
		const query = authenticated.qs
			? `?${new URLSearchParams(authenticated.qs as Record<string, string>)}`
			: '';
		const url = `${base}${authenticated.url}${query}`;
		const recorded = {
			method: authenticated.method,
			url,
			body: multipart ? await describeForm(authenticated.body as FormData) : authenticated.body,
		};
		requests.push(recorded);
		if (options.failWhen?.(recorded)) {
			throw Object.assign(new Error('Request failed with status code 503'), {
				httpCode: '503',
				response: { status: 503, data: 'unavailable' },
			});
		}

		const response = await fetch(url, {
			method: authenticated.method ?? 'GET',
			headers: {
				Accept: 'application/json',
				// fetch sets the multipart boundary itself.
				...(hasBody && !multipart ? { 'Content-Type': 'application/json' } : {}),
				...(authenticated.headers as Record<string, string>),
			},
			body: hasBody ? (multipart ? (authenticated.body as FormData) : JSON.stringify(authenticated.body)) : undefined,
		});
		if (requestOptions.encoding === 'arraybuffer' && response.ok) {
			const body = Buffer.from(await response.arrayBuffer());
			if (!requestOptions.returnFullResponse) return body;
			return { body, headers: Object.fromEntries(response.headers.entries()), statusCode: response.status };
		}
		const text = await response.text();
		if (!response.ok) {
			throw Object.assign(new Error(`Request failed with status code ${response.status}`), {
				httpCode: String(response.status),
				response: { status: response.status, data: text },
			});
		}
		return text ? JSON.parse(text) : {};
	};

	const binaryOf = (itemIndex: number, propertyName: string) => {
		const binary = inputItems[itemIndex]?.binary?.[propertyName];
		if (!binary) throw new Error(`Item has no binary property "${propertyName}"`);
		return binary;
	};

	const context = {
		getInputData: () => inputItems,
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			const values = typeof options.parameters === 'function' ? options.parameters(itemIndex) : options.parameters;
			return values[name] === undefined ? fallback : values[name];
		},
		getCredentials: async () => credentials,
		getNode: () => ({
			id: 'test',
			name: 'Docspell',
			type: 'n8n-nodes-docspell.docspell',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		continueOnFail: () => options.continueOnFail ?? false,
		helpers: {
			prepareBinaryData: async (buffer: Buffer, fileName?: string, mimeType?: string) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType: mimeType ?? 'application/octet-stream',
				fileSize: String(buffer.length),
			}),
			assertBinaryData: (itemIndex: number, propertyName: string) => binaryOf(itemIndex, propertyName),
			getBinaryDataBuffer: async (itemIndex: number, propertyName: string) =>
				Buffer.from(binaryOf(itemIndex, propertyName).data, 'base64'),
			httpRequestWithAuthentication,
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (data: INodeExecutionData[], meta: { itemData: { item: number } }) =>
				data.map((item) => ({ ...item, pairedItem: meta.itemData })),
		},
	};

	return { context: context as unknown as IExecuteFunctions, requests };
}
