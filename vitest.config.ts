import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.spec.ts'],
		globalSetup: ['tests/globalSetup.ts'],
		testTimeout: 30_000,
		// The tests share one Docspell instance and spy on global fetch.
		fileParallelism: false,
	},
});
