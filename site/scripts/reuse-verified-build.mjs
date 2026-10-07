import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';

const { VERIFIED_ASSET_ID: asset, VERIFIED_ASSET_SHA256: digest,
  VERIFIED_SOURCE_COMMIT: source, GH_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
assert.equal(repo, 'bitcoinuniverseio/index-tandem');
assert.match(asset ?? '', /^[1-9][0-9]*$/);
assert.match(digest ?? '', /^[a-f0-9]{64}$/);
assert.match(source ?? '', /^[a-f0-9]{40}$/);
assert(token, 'A release asset read token is required');
execFileSync('git', ['merge-base', '--is-ancestor', source, 'HEAD']);
// Only this delivery helper and workflow may differ from the verified source.
const changed = execFileSync('git', ['diff', '--name-only', source, 'HEAD'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
assert(changed.every(path => ['.github/workflows/pages.yml', 'site/scripts/reuse-verified-build.mjs'].includes(path)),
  'Build inputs changed after verification; build the changed site normally');
const response = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream',
    'X-GitHub-Api-Version': '2026-03-10' }, signal: AbortSignal.timeout(120000),
});
assert(response.ok, `Release asset download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, 'Verified archive digest changed');
const archive = '.verified-site.tar.gz';
assert(!existsSync('site/dist'), 'Refuse to overwrite a previous build');
writeFileSync(archive, bytes);
try {
  const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert(paths.every(path => !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..')),
    'Archive contains an unsafe path');
  mkdirSync('site/dist');
  execFileSync('tar', ['-xzf', archive, '-C', 'site/dist']);
  assert(existsSync('site/dist/index.html'), 'Archive has no site entry point');
  console.log(JSON.stringify({ sourceCommit: source, archiveSha256: digest, reusedVerifiedBuild: true }));
} finally { rmSync(archive); }
