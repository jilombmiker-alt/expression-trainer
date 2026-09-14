import { cp, mkdir, readdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';

// A separate, allowlisted bundle keeps private keys, other products and local data out.
const root = resolve(import.meta.dirname, '..');
const privateRoot = join(root, '.private-deploy');
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
if ((await lstat(privateRoot)).isSymbolicLink()) throw new Error('Private staging must not be a symlink');
const bundle = join(privateRoot, 'vefaas-training-bundle');
await mkdir(bundle, { recursive: true, mode: 0o700 });
const permitted = (source) => {
  const name = basename(source);
  return !name.startsWith('.') && name !== '__pycache__' && !name.startsWith('test_')
    && !name.endsWith('.test.js') && !name.endsWith('.pyc');
};
for (const dir of ['services', 'web']) {
  await cp(join(root, dir), join(bundle, dir), {
    recursive: true,
    dereference: false,
    filter: async (source) => permitted(source) && !(await lstat(source)).isSymbolicLink(),
  });
}
await cp(join(root, 'deploy/vefaas/main.py'), join(bundle, 'main.py'));
await cp(join(root, 'services/requirements-speech-tested.txt'), join(bundle, 'requirements.txt'));
await writeFile(join(bundle, '.vefaasignore'), '.vefaas\n.env\n.env.*\n__pycache__\n*.pyc\n');
const names = await readdir(bundle);
console.log(JSON.stringify({ bundle, entries: names, copyScope: ['services', 'web', 'cloud entrypoint', 'requirements'], deployed: false }, null, 2));
