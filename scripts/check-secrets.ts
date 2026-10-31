/**
 * FACE VID — Phase 1A Secret, Credential & Default Password Exposure Scanner
 *
 * Scans source files to ensure no hardcoded API keys, private keys, tokens,
 * or default admin passwords exist in the repository.
 */

import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'coverage',
]);

const HIGH_RISK_PATTERNS: readonly { name: string; regex: RegExp }[] = [
  { name: 'PEM Private Key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe Live Secret Key', regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { name: 'GitHub Personal Access Token', regex: /\bghp_[0-9a-zA-Z]{36}\b/ },
  { name: 'Google API Key Literal', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: 'Hardcoded Default Admin Password', regex: /adminPassword\s*[:=]\s*['"][^'"]+['"]/i },
];

function walkFiles(dir: string, collected: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, collected);
    } else if (
      /\.(ts|tsx|js|mjs|json|yml|yaml|sql|sh|env)$/i.test(entry.name) &&
      entry.name !== 'bun.lock' &&
      entry.name !== 'pnpm-lock.yaml'
    ) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function main() {
  const rootDir = process.cwd();
  const files = walkFiles(rootDir);
  const findings: { file: string; patternName: string }[] = [];

  for (const file of files) {
    if (file.endsWith('check-secrets.ts')) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.regex.test(content)) {
        findings.push({
          file: path.relative(rootDir, file),
          patternName: pattern.name,
        });
      }
    }
  }

  if (findings.length > 0) {
    console.error('[SECURITY FAIL] Exposed credentials or secrets detected:');
    for (const f of findings) {
      console.error(` - ${f.file}: ${f.patternName}`);
    }
    process.exit(1);
  }

  console.log(
    `[SECURITY PASS] Scanned ${files.length} repository files. 0 hardcoded secrets, private keys, or default admin credentials found.`
  );
}

main();
