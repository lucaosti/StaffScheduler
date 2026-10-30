/**
 * One MySQL image, pinned, everywhere it runs.
 *
 * Production pinned mysql:8.0.42 while CI ran a floating mysql:8.0, so the
 * migrations, the integration suite and the backup round-trip were proven on
 * whatever 8.0 the registry served that day rather than on what is deployed,
 * and the whole line reached end of life unnoticed (#849). A floating tag also
 * makes a red build unreproducible. This scans every file that names a MySQL
 * image and requires the same exact x.y.z, on the 8.4 LTS line.
 *
 * @author Luca Ostinelli
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const workflows = readdirSync(path.join(root, '.github', 'workflows'))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => path.join('.github', 'workflows', name));
const FILES = ['docker-compose.yml', 'docker-compose.verify.yml', ...workflows];

// `mysql:<tag>` as an image reference; the lookbehind skips the host:port in
// a DATABASE_URL (`@mysql:3306`) and names like `bitnami/mysql:`.
const IMAGE = /(?<![\w/.@-])mysql:(\d[\w.-]*)/g;

const references = FILES.flatMap((file) =>
  [...readFileSync(path.join(root, file), 'utf8').matchAll(IMAGE)].map((match) => ({ file, tag: match[1] })),
);

test('the deployment, the verification stack and CI name MySQL images', () => {
  for (const file of ['docker-compose.yml', 'docker-compose.verify.yml', '.github/workflows/ci.yml', '.github/workflows/backup-restore.yml']) {
    assert.ok(references.some((ref) => ref.file === file), `${file} names no MySQL image`);
  }
});

test('every MySQL image is the same exact 8.4 LTS release (#849)', () => {
  const tags = new Set(references.map((ref) => ref.tag));
  assert.equal(tags.size, 1, `several MySQL tags: ${JSON.stringify(references)}`);
  const [tag] = tags;
  assert.match(tag, /^8\.4\.\d+$/, `not a pinned 8.4 LTS release: ${tag}`);
});
