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
assert.equal(registry.entries.length, 101, 'all 101 source-visible legacy objects must be approved');
assert.equal(new Set(registry.entries.map(entry => entry.identity)).size, 101,
  'source-cell identities must be unique');
assert.equal(new Set(registry.entries.map(entry => `${entry.sourceIdentity}|${entry.sourceDigest}`)).size, 101,
  'source identity/digest approval keys must be unique');
for (const entry of registry.entries) {
  assert.match(entry.sourceDigest, /^[a-f0-9]{64}$/);
  assert.match(entry.sourceIdentity, new RegExp(`^${entry.templateId}\\|${entry.tableRole}\\|${entry.sourceTableIndex}\\|`));
  assert.ok(entry.sourceCellId.startsWith(`${entry.tableRole}-r`));
  assert.ok(['embedded-equation', 'floating-overline'].includes(entry.containerCategory));
  assert.ok(['externalReferenceAverage', 'externalSampleAverage', 'sampleMean', 'internalCorrectionFactor']
    .includes(entry.semanticType), `${entry.identity}: unknown reviewed semantic type`);
  assert.ok(registry.semanticAsts?.[entry.semanticType], `${entry.identity}: semantic AST missing`);
}
const semanticCounts = Object.fromEntries(Object.entries(Object.groupBy(
  registry.entries, entry => entry.semanticType,
)).map(([key, values]) => [key, values.length]));
assert.deepEqual(semanticCounts, {
  internalCorrectionFactor: 4,
  sampleMean: 35,
  externalReferenceAverage: 31,
  externalSampleAverage: 31,
});

assert.ok(fs.existsSync(extractPath), 'fresh GC Word extract is required');
const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const extractedObjects = extract.templates.flatMap(template => ['referenceTable', 'sampleTable']
  .flatMap(tableKey => template[tableKey].embeddedObjects ?? []));
assert.equal(extractedObjects.length, 101, 'extract must preserve all 101 approved objects');
for (const item of extractedObjects) {
  assert.match(item.sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(typeof item.sourceIdentity, 'string');
  assert.ok(!('objectOoxml' in item), 'raw embedded OOXML must not survive extraction output');
  assert.ok(!('binary' in item), 'embedded binary data must not survive extraction output');
  assert.equal(item.approved, true, `${item.objectIdentity}: object must be registry-approved`);
  const registryEntry = registry.entries.find(entry => entry.identity === item.objectIdentity);
  assert.ok(registryEntry, `${item.objectIdentity}: registry entry missing`);
  assert.equal(item.sourceIdentity, registryEntry.sourceIdentity);
  assert.equal(item.sourceDigest, registryEntry.sourceDigest);
  assert.equal(item.sourceCellId, registryEntry.sourceCellId);
  assert.equal(item.containerCategory, registryEntry.containerCategory);
}

const { normalizeEmbeddedObjectRun } = await import(`${pathToFileURL(builderPath).href}?embedded=${Date.now()}`);
const approved = registry.entries[0];
const approvedAst = registry.semanticAsts[approved.semanticType];
assert.deepEqual(
  normalizeEmbeddedObjectRun({ kind: 'embeddedObject', sourceDigest: approved.sourceDigest,
    sourceIdentity: approved.sourceIdentity, objectIdentity: approved.identity, approved: true }, approved.identity),
  { kind: 'math', math: approvedAst },
);
assert.throws(() => normalizeEmbeddedObjectRun({ kind: 'embeddedObject', sourceDigest: '0'.repeat(64),
  sourceIdentity: approved.sourceIdentity, objectIdentity: approved.identity, approved: false }, approved.identity),
/unknown embedded object digest/);

const context = Object.create(null);
vm.runInNewContext(`${fs.readFileSync(assetPath, 'utf8')}\n;this.layouts = GC_WORD_TABLE_LAYOUTS;`, context);
const publicMathRuns = Object.values(context.layouts).flatMap(layout =>
  [layout.referenceTable, layout.sampleTable].flatMap(table => table.cells.flatMap(cell =>
    (cell.paragraphs ?? []).flatMap(paragraph => (paragraph.runs ?? []).filter(run => run.kind === 'math')))));
assert.equal(publicMathRuns.length, 101, 'browser asset must contain all 101 safe semantic conversions');
const publicSource = fs.readFileSync(assetPath, 'utf8');
assert.doesNotMatch(publicSource, /<w:(?:object|pict|drawing)\b|<o:OLEObject\b|<v:(?:shape|imagedata)\b/i);
assert.doesNotMatch(publicSource, /Equation\.(?:3|KSEE3)|[A-Za-z]:\\/i);

for (const templateId of ['patchouli-patchoulol', 'patchouli-patchoulol-finished', 'brucea-oleic', 'brucea-oleic-finished']) {
  const table = context.layouts[templateId].referenceTable;
  const formulaCell = table.cells.find(cell => cell.id === 'reference-r10c1');
  assert.ok(formulaCell.paragraphs.some(paragraph => paragraph.runs.some(run => run.kind === 'math')),
    `${templateId}: fixed correction-factor formula must be rendered in source cell`);
}

for (const templateId of ['amomum-bornyl-acetate', 'amomum-bornyl-acetate-finished-national',
  'amomum-bornyl-acetate-finished-shanghai', 'amomum-bornyl-acetate-finished-beijing']) {
  const meanCell = context.layouts[templateId].sampleTable.cells.find(cell => cell.id === 'sample-r10c1');
  const runs = meanCell.paragraphs.flatMap(paragraph => paragraph.runs);
  const mathIndex = runs.findIndex(run => run.kind === 'math');
  const suffixIndex = runs.findIndex(run => run.kind === 'text' && /[（(]/u.test(run.text));
  assert.ok(mathIndex >= 0 && suffixIndex > mathIndex,
    `${templateId}: rendered mean overline must precede the percent suffix`);
}

console.log('PASS: 101 reviewed legacy Word objects convert to safe semantic AST and unknown objects fail closed');
