import { cp, mkdir, readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const privateRoot = join(root, '.private-deploy');
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
if ((await lstat(privateRoot)).isSymbolicLink()) throw new Error('Private staging must not be a symlink');
const bundle = join(privateRoot, 'vefaas-frontend-preview');
await mkdir(bundle, { recursive: true, mode: 0o700 });
await cp(join(root, 'web'), join(bundle, 'web'), { recursive: true, filter: async (path) => {
  const name = basename(path);
  return !name.startsWith('.') && !name.endsWith('.test.js') && !(await lstat(path)).isSymbolicLink();
} });
await cp(join(root, 'deploy/frontend-preview/main.py'), join(bundle, 'main.py'));
await cp(join(root, 'deploy/frontend-preview/realtime_host.py'), join(bundle, 'realtime_host.py'));
await cp(join(root, 'deploy/frontend-preview/requirements.txt'), join(bundle, 'requirements.txt'));
await cp(join(root, 'deploy/frontend-preview/preview-mode.js'), join(bundle, 'web/preview-mode.js'));
await mkdir(join(bundle, 'services'), { recursive: true, mode: 0o700 });
for (const name of ['audio_tasks.py', 'volcano_stream.py', 'audio_pauses.py']) {
  await cp(join(root, 'services', name), join(bundle, 'services', name));
}
for (const name of await readdir(join(bundle, 'web'))) {
  if (!name.endsWith('.html')) continue;
  const file = join(bundle, 'web', name);
  let html = await readFile(file, 'utf8');
  html = html.replace(/(<script src="frontend-foundation\.js[^"]*"><\/script>)/, '$1\n  <script src="preview-mode.js"></script>');
  html = html.replace(/\s*<script src="analytics-settings\.js[^"]*"><\/script>/, '');
  await writeFile(file, html);
}
await writeFile(join(bundle, '.vefaasignore'), '.vefaas\n.env\n.env.*\n__pycache__\n*.pyc\n');
console.log(JSON.stringify({
  bundle,
  mode: 'speech-preview',
  includes: ['web', 'Python host', 'Volcano streaming ASR proxy'],
  modelKeys: false,
  backend: 'volcano-speech-proxy',
}));
