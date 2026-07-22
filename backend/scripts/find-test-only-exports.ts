#!/usr/bin/env ts-node

/**
 * Reports exports that nothing but a test refers to.
 *
 * WHY THIS EXISTS ALONGSIDE knip: `knip.json` lists the test files as entry
 * points. That is right for its purpose — without it, every helper exported
 * purely so a unit test can reach it is reported as unused — but it also means
 * anything a test reaches counts as used. Production code kept alive by
 * nothing but its own tests therefore sits behind a green dead-code gate, and
 * three separate reviews found instances of exactly that: CryptoUtils,
 * HierarchyUtils and ResponseUtils, ResponseUtils.paginated, and SkillService's
 * 634 lines implementing a skill catalog no route ever exposed.
 *
 * Configuring knip with a production entry point does not substitute for this:
 * verified against the tree that still contained SkillService, it reported
 * nothing.
 *
 * WHY IT ONLY WARNS: a test-only export is not automatically a defect. Internal
 * helpers exposed for unit testing (`parseCsv`, `hotp`, `buildVCard`), declared
 * test hooks (`resetModuleCacheForTests`) and the canonical constraint
 * validator — which is by construction the specification both scheduling
 * engines are held to — are all legitimate. The output is a list to judge, not
 * a gate to satisfy, so it prints and exits 0.
 *
 * Usage: `npm run deadcode:tests`
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

const isTest = (file: string): boolean => file.includes('__tests__');

const files = walk(SRC);
const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));

const findings: string[] = [];
for (const [file, source] of sources) {
  if (isTest(file)) continue;
  const names = new Set<string>();
  const re = /export (?:class|const|function|interface|type|enum) (\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.add(m[1]);

  for (const name of names) {
    const word = new RegExp(`\\b${name}\\b`);
    let testRefs = 0;
    let productionRefs = 0;
    for (const [other, otherSource] of sources) {
      if (other === file || !word.test(otherSource)) continue;
      if (isTest(other)) testRefs++;
      else productionRefs++;
    }
    if (testRefs > 0 && productionRefs === 0) {
      findings.push(`${path.relative(SRC, file)} :: ${name} (${testRefs} test file(s), no production reference)`);
    }
  }
}

if (findings.length === 0) {
  console.log('No exports are referenced only by tests.');
} else {
  console.log(`${findings.length} export(s) referenced only by tests — judge each, some are legitimate:`);
  for (const f of findings.sort()) console.log(`  ${f}`);
}
