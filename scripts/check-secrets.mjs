// Conservative publish gate. Prints paths/reasons only, never credential values.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paths = [...new Set(execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
const privatePath = /(^|\/)(\.private-deploy|\.p0-data|\.vefaas|\.model-cache|\.venv-funasr)(\/|$)|(^|\/)\.env(?!\.example$)(\.|$)|\.(jks|keystore|pem)$/;
const sensitive = [];
const localConfig = resolve(root, '.private-deploy/beta.env');
if (existsSync(localConfig)) {
  for (const line of readFileSync(localConfig, 'utf8').split('\n')) {
    const match = line.match(/^(EXPRESSION_LLM_API_KEY|EXPRESSION_ADMIN_TOKEN|EXPRESSION_BETA_PASSWORD)='([^']+)'$/);
    if (match && match[2].length >= 8) sensitive.push(match[2]);
  }
}
const findings = [];
for (const path of paths) {
  if (privatePath.test(path)) { findings.push({ path, reason: 'private path would be published' }); continue; }
  let body;
  try { body = readFileSync(resolve(root, path)); } catch { continue; }
  if (sensitive.some((secret) => body.includes(Buffer.from(secret)))) findings.push({ path, reason: 'private credential copied into publishable file' });
  const text = body.toString('utf8');
  const keys = text.match(/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/g) || [];
  const fixture = /(^|\/)(test[^/]*|e2e)(\/|\.)|\.test\./.test(path);
  if (keys.some((key) => !(fixture && key.startsWith('sk-test-')))) findings.push({ path, reason: 'possible hard-coded credential' });
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.push({ path, reason: 'private signing key' });
}
console.log(JSON.stringify({ scannedFiles: paths.length, findings, boundary: 'Working-tree publish candidates and known beta credentials only; not a historical-repository security audit.' }, null, 2));
if (findings.length) process.exitCode = 1;
