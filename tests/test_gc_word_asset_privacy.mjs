import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const assets = [
  ['assets/gc-record-table-layouts.js', 'GC_WORD_TABLE_LAYOUTS'],
  ['assets/gc-word-table-visible-geometry.js', 'GC_WORD_TABLE_VISIBLE_GEOMETRY'],
];
const forbiddenKeys = /^(?:sourceFile|sourcePath|sourceSha256|sourceOoxmlHash|imageDpi|rowBoundariesPx144|outerBoundariesPx144|boundaryAssertions|recoveryReason|temporarySuffix|usedTempRecovery|wordOpenXml|ooxml|mathOoxml|objectHash)$/i;
const forbiddenStrings = /(?:[A-Za-z]:[\\/]|(?:^|[\\/])(?:visual-qa|output)[\\/]|<w:(?:object|pict|drawing)\b|<o:OLEObject\b|<v:(?:shape|imagedata)\b|PK\u0003\u0004)/i;

function inspect(value, location) {
  if (typeof value === 'string') {
    assert.doesNotMatch(value, forbiddenStrings, `${location}: private path/OOXML/binary marker leaked`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, forbiddenKeys, `${location}.${key}: QA-only key leaked`);
    inspect(child, `${location}.${key}`);
  }
}

for (const [relative, globalName] of assets) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, 'utf8');
  assert.doesNotMatch(source, forbiddenStrings, `${relative}: private source marker leaked`);
  const context = Object.create(null);
  vm.runInNewContext(`${source}\n;this.value = ${globalName};`, context, { filename });
  inspect(context.value, globalName);
}

console.log('PASS: browser-loaded GC Word assets contain runtime data only');
