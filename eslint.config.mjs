import { config } from '@n8n/node-cli/eslint';

export default [
	...config,
	{
		// Tests and scripts are never shipped, so the community-node restrictions
		// (no dependencies, no restricted globals) do not apply to them.
		files: ['tests/**', 'scripts/**', 'vitest.config.mts'],
		rules: {
			'@n8n/community-nodes/no-restricted-imports': 'off',
			'@n8n/community-nodes/no-restricted-globals': 'off',
		},
	},
];
