import { seed } from '../scripts/seed-docspell.mjs';

export default async function setup(): Promise<void> {
	await seed();
}
