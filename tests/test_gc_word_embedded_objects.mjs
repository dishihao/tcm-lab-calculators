import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const registryPath = path.join(root, 'tools', 'gc-word-embedded-object-semantics.json');
const extractPath = path.join(root, 'tools', 'gc-word-table-extract.json');
const builderPath = path.join(root, 'tools', 'build_gc_word_layouts.mjs');
const assetPath = path.join(root, 'assets', 'gc-record-table-layouts.js');

assert.ok(fs.existsSync(registryPath), 'reviewed embedded-object semantic registry is required');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
assert.equal(registry.version, 1);
assert.equal(registry.entries.length, 95, 'all 95 source-visible legacy objects must be approved');
assert.equal(new Set(registry.entries.map(entry => entry.identity)).size, 95,
  'source-cell identities must be unique');
assert.equal(new Set(registry.entries.map(entry => `${entry.identity}|${entry.objectHash}`)).size, 95,
  'identity/hash approval keys must be unique');
for (const entry of registry.entries) {
  assert.match(entry.objectHash, /^[a-f0-9]{64}$/);
  assert.ok(['externalReferenceAverage', 'externalSampleAverage', 'sampleMean', 'internalCorrectionFactor']
    .includes(entry.semanticType), `${entry.identity}: unknown reviewed semantic type`);
  assert.ok(registry.semanticAsts?.[entry.semanticType], `${entry.identity}: semantic AST missing`);
}
const semanticCounts = Object.fromEntries(Object.entries(Object.groupBy(
  registry.entries, entry => entry.semanticType,
)).map(([key, values]) => [key, values.length]));
assert.deepEqual(semanticCounts, {
  internalCorrectionFactor: 4,
  sampleMean: 33,
  externalReferenceAverage: 29,
  externalSampleAverage: 29,
});

assert.ok(fs.existsSync(extractPath), 'fresh GC Word extract is required');
const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const extractedObjects = extract.templates.flatMap(template => ['referenceTable', 'sampleTable']
  .flatMap(tableKey => template[tableKey].embeddedObjects ?? []));
assert.equal(extractedObjects.length, 95, 'extract must preserve all 95 approved objects');
for (const item of extractedObjects) {
  assert.match(item.objectHash, /^[a-f0-9]{64}$/);
  assert.ok(!('objectOoxml' in item), 'raw embedded OOXML must not survive extraction output');
  assert.ok(!('binary' in item), 'embedded binary data must not survive extraction output');
  assert.equal(item.approved, true, `${item.objectIdentity}: object must be registry-approved`);
}

const { normalizeEmbeddedObjectRun } = await import(`${pathToFileURL(builderPath).href}?embedded=${Date.now()}`);
const approved = registry.entries[0];
const approvedAst = registry.semanticAsts[approved.semanticType];
assert.deepEqual(
  normalizeEmbeddedObjectRun({ kind: 'embeddedObject', objectHash: approved.objectHash,
    objectIdentity: approved.identity, approved: true }, approved.identity),
  { kind: 'math', math: approvedAst },
);
assert.throws(() => normalizeEmbeddedObjectRun({ kind: 'embeddedObject', objectHash: '0'.repeat(64),
  objectIdentity: approved.identity, approved: false }, approved.identity),
/unknown embedded object hash/);

const context = Object.create(null);
vm.runInNewContext(`${fs.readFileSync(assetPath, 'utf8')}\n;this.layouts = GC_WORD_TABLE_LAYOUTS;`, context);
const publicMathRuns = Object.values(context.layouts).flatMap(layout =>
  [layout.referenceTable, layout.sampleTable].flatMap(table => table.cells.flatMap(cell =>
    (cell.paragraphs ?? []).flatMap(paragraph => (paragraph.runs ?? []).filter(run => run.kind === 'math')))));
assert.equal(publicMathRuns.length, 95, 'browser asset must contain all 95 safe semantic conversions');
const publicSource = fs.readFileSync(assetPath, 'utf8');
assert.doesNotMatch(publicSource, /<w:(?:object|pict|drawing)\b|<o:OLEObject\b|<v:(?:shape|imagedata)\b/i);
assert.doesNotMatch(publicSource, /Equation\.(?:3|KSEE3)|[A-Za-z]:\\/i);

for (const templateId of ['patchouli-patchoulol', 'patchouli-patchoulol-finished', 'brucea-oleic', 'brucea-oleic-finished']) {
  const table = context.layouts[templateId].referenceTable;
  const formulaCell = table.cells.find(cell => cell.id === 'reference-r10c1');
  assert.ok(formulaCell.paragraphs.some(paragraph => paragraph.runs.some(run => run.kind === 'math')),
    `${templateId}: fixed correction-factor formula must be rendered in source cell`);
}

console.log('PASS: 95 reviewed legacy Word objects convert to safe semantic AST and unknown objects fail closed');
