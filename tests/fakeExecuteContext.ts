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
}

export interface RecordedRequest {
	method?: string;
	url: string;
	body?: unknown;
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

		const base = authenticated.baseURL ? authenticated.baseURL.replace(/\/+$/, '') : '';
		const query = authenticated.qs
			? `?${new URLSearchParams(authenticated.qs as Record<string, string>)}`
			: '';
		const url = `${base}${authenticated.url}${query}`;
		requests.push({ method: authenticated.method, url, body: authenticated.body });

		const response = await fetch(url, {
			method: authenticated.method ?? 'GET',
			headers: {
				Accept: 'application/json',
				...(authenticated.body ? { 'Content-Type': 'application/json' } : {}),
				...(authenticated.headers as Record<string, string>),
			},
			body: authenticated.body ? JSON.stringify(authenticated.body) : undefined,
		});
		const text = await response.text();
		if (!response.ok) {
			throw Object.assign(new Error(`Request failed with status code ${response.status}`), {
				httpCode: String(response.status),
				response: { status: response.status, data: text },
			});
		}
		return text ? JSON.parse(text) : {};
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
			httpRequestWithAuthentication,
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (data: INodeExecutionData[], meta: { itemData: { item: number } }) =>
				data.map((item) => ({ ...item, pairedItem: meta.itemData })),
		},
	};

	return { context: context as unknown as IExecuteFunctions, requests };
}
