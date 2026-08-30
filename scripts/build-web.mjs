import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const source = resolve(projectRoot, 'web');
const target = resolve(projectRoot, 'dist');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await writeFile(resolve(target, 'build-meta.json'), JSON.stringify({
  schemaVersion: 1,
  entry: 'concept-editorial.html?theme=v0',
  generatedAt: new Date().toISOString()
}, null, 2));

console.log('Static frontend build ready in dist/.');
