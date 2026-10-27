import {
	IAuthenticate,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

import { DocspellLoginCredentials, getSessionToken } from './DocspellSession';

export class DocspellApi implements ICredentialType {
	name = 'docspellApi';
	displayName = 'Docspell API';
	documentationUrl = 'https://docspell.org/docs/api/intro/#authentication';
	properties: INodeProperties[] = [
		{
			displayName: 'URL',
			name: 'url',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Account Name',
			name: 'account',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials?.url?.replace(/\\/$/, \'\')}}',
			url: '/api/v1/open/auth/login',
			method: 'POST',
			body: {
				account: '={{$credentials?.account}}',
				password: '={{$credentials?.password}}',
			},
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					message: "Login wasn't successful",
					key: 'success',
					value: false,
				},
			},
		],
	};

	authenticate: IAuthenticate = async (rawCredentials, requestOptions): Promise<IHttpRequestOptions> => {
		const token = await getSessionToken(rawCredentials as unknown as DocspellLoginCredentials);

		return {
			...requestOptions,
			headers: { ...requestOptions.headers, 'X-Docspell-Auth': token },
		};
	};
}
