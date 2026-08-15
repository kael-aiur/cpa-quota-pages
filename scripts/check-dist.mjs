/**
 * `check:dist` implementation: verify the committed dist artifacts are exactly
 * what a clean rebuild of the current sources produces.
 *
 * Steps:
 *  1. Require a clean working tree for `dist/` (the caller already ran
 *     `git diff --exit-code -- dist`; this script must never silently bless
 *     uncommitted dist edits).
 *  2. Capture the `cpa-quota-source-revision` meta value from each COMMITTED
 *     artifact.
 *  3. Rebuild (`npm run build`).
 *  4. Fail loudly unless dist contains exactly the two tracked artifacts.
 *  5. Replace the freshly stamped revision meta in the rebuilt files with the
 *     captured committed value.
 *  6. `git diff --exit-code -- dist` — everything except the normalized
 *     revision meta must match byte-for-byte.
 *
 * Why the revision normalization is unavoidable and legitimate: the source
 * revision is stamped at BUILD TIME from the then-current HEAD, while dist is
 * committed in the SAME commit it was built from. A rebuild after that commit
 * stamps the new HEAD, so without normalization `git diff -- dist` always
 * reports a difference and the guard can never pass. Normalizing removes ONLY
 * this self-referential meta value; every other byte of both artifacts must
 * still match exactly.
 */

import { execFileSync } from 'node:child_process';
import { exit } from 'node:process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const distDirectory = resolve(projectRoot, 'dist');
const artifacts = ['quota.html', 'quota-admin.html'];
const revisionPattern = /<meta name="cpa-quota-source-revision" content="([^"]*)">/;

function fail(message) {
  console.error(`check:dist: ${message}`);
  exit(1);
}

function committedContent(name) {
  return execFileSync('git', ['show', `HEAD:dist/${name}`], { cwd: projectRoot, encoding: 'utf8' });
}

function committedRevision(name) {
  const match = revisionPattern.exec(committedContent(name));
  if (!match || match[1] === '') {
    fail(`committed dist/${name} lacks a non-empty cpa-quota-source-revision meta`);
  }
  return match[1];
}

function normalizeRevision(name, revision) {
  const path = resolve(distDirectory, name);
  const rebuilt = readFileSync(path, 'utf8');
  const match = revisionPattern.exec(rebuilt);
  if (!match || match[1] === '') {
    fail(`rebuilt dist/${name} lacks a non-empty cpa-quota-source-revision meta`);
  }
  writeFileSync(path, rebuilt.replace(revisionPattern, `<meta name="cpa-quota-source-revision" content="${revision}">`));
}

// 1. Uncommitted dist edits are never blessed.
execFileSync('git', ['diff', '--exit-code', '--', 'dist'], { cwd: projectRoot, stdio: 'inherit' });

// 2. Capture the committed revisions before the rebuild overwrites the files.
const revisions = new Map(artifacts.map((name) => [name, committedRevision(name)]));

// 3. Rebuild from current sources.
execFileSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'inherit' });

// 4. The rebuild must produce exactly the tracked artifact set.
const names = readdirSync(distDirectory).sort();
const expected = [...artifacts].sort();
if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
  fail(`rebuild produced unexpected dist file set: ${names.join(', ')} (expected ${expected.join(', ')})`);
}

// 5. Normalize the build-time self-reference (see header comment).
for (const name of artifacts) normalizeRevision(name, revisions.get(name));

// 6. Everything else must match the committed artifacts byte-for-byte.
execFileSync('git', ['diff', '--exit-code', '--', 'dist'], { cwd: projectRoot, stdio: 'inherit' });

console.log('check:dist: committed dist matches a clean rebuild of the current sources');
