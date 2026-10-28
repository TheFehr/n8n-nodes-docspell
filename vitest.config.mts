import { defineConfig } from 'vitest/config';

// Tests that need no Docspell run in their own project, so they do not wait for the
// seeding that the others depend on.
const LOCAL_ONLY = ['tests/DocspellLoginTimeout.spec.ts'];

export default defineConfig({
	test: {
		testTimeout: 30_000,
		// The tests share one Docspell instance and spy on global fetch.
		fileParallelism: false,
		projects: [
			{
				extends: true,
				test: {
					name: 'docspell',
					include: ['tests/**/*.spec.ts'],
					exclude: LOCAL_ONLY,
					globalSetup: ['tests/globalSetup.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'local',
					include: LOCAL_ONLY,
				},
			},
		],
	},
});
