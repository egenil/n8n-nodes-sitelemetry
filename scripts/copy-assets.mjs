// Copy the non-TypeScript files n8n needs at runtime (node icons and codex
// metadata) next to the compiled sources in dist/.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const EXTENSIONS = new Set(['.svg', '.png', '.json']);

function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const file = join(dir, entry);
		if (statSync(file).isDirectory()) {
			walk(file);
			continue;
		}
		const extension = entry.slice(entry.lastIndexOf('.'));
		if (!EXTENSIONS.has(extension)) continue;
		const target = join(dist, relative(root, file));
		mkdirSync(dirname(target), { recursive: true });
		cpSync(file, target);
	}
}

for (const folder of ['nodes', 'credentials']) {
	const dir = join(root, folder);
	if (existsSync(dir)) walk(dir);
}
