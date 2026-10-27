import type { IDataObject, IExecuteFunctions, IHttpRequestMethods, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

interface DocspellRequest {
	method: IHttpRequestMethods;
	endpoint: string;
	body?: IDataObject;
	qs?: IDataObject;
}

// Replaces n8n's generic wording for statuses where Docspell's meaning is known.
export type StatusMessages = Partial<Record<number, string>>;

export async function docspellApiRequest(
	context: IExecuteFunctions,
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
