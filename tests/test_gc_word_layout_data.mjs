import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, '..', 'tools', 'gc-word-table-manifest.json');
const extractPath = path.join(here, '..', 'tools', 'gc-word-table-extract.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = manifest.entries;
const requireExtract = process.argv.includes('--require-extract');

const EXPECTED_TEMPLATE_IDS = [
  'patchouli-patchoulol','patchouli-patchoulol-finished',
  'mugwort-eucalyptol','mugwort-borneol',
  'mugwort-eucalyptol-finished','mugwort-borneol-finished',
  'star-anise-anethole','star-anise-anethole-finished',
  'mint-menthol','mint-menthol-finished',
  'clove-eugenol','clove-eugenol-finished',
  'cardamom-eucalyptol','cardamom-eucalyptol-finished',
  'dendrobium-dendrobine','homalomena-linalool','homalomena-linalool-finished',
  'amomum-bornyl-acetate','amomum-bornyl-acetate-finished-national',
  'amomum-bornyl-acetate-finished-shanghai','amomum-bornyl-acetate-finished-beijing',
  'fennel-anethole','fennel-anethole-finished','fennel-anethole-salted-finished',
  'brucea-oleic','brucea-oleic-finished',
  'flax-linoleic','flax-linolenic',
  'elsholtzia-thymol','elsholtzia-carvacrol',
  'elsholtzia-thymol-finished','elsholtzia-carvacrol-finished',
  'pine-alpha-pinene'
];

assert.ok(Array.isArray(entries), 'manifest.entries must be an array');
assert.equal(entries.length, EXPECTED_TEMPLATE_IDS.length);
assert.deepEqual(entries.map(({ templateId }) => templateId), EXPECTED_TEMPLATE_IDS);
assert.equal(new Set(entries.map(({ templateId }) => templateId)).size, 33);
assert.equal(new Set(entries.map(({ recordKey }) => recordKey)).size, 28);
assert.equal(new Set(entries.filter(({ kind }) => kind === '原料').map(({ recordKey }) => recordKey)).size, 14);
assert.equal(new Set(entries.filter(({ kind }) => kind === '成品').map(({ recordKey }) => recordKey)).size, 14);

for (const entry of entries) {
  assert.equal(typeof entry.templateId, 'string');
  assert.equal(typeof entry.recordKey, 'string');
  assert.ok(entry.kind === '原料' || entry.kind === '成品');
  assert.equal(typeof entry.root, 'string');
  assert.equal(typeof entry.sourceFile, 'string');
  assert.ok(/\.docx?$/i.test(entry.sourceFile), `${entry.sourceFile} must be .doc or .docx`);
  assert.ok(Number.isInteger(entry.referenceTableIndex) && entry.referenceTableIndex > 0);
  assert.ok(Number.isInteger(entry.sampleTableIndex) && entry.sampleTableIndex > 0);
  assert.ok(entry.referenceTableIndex < entry.sampleTableIndex);
}

const totalTables = entries.reduce((sum, entry) => sum + 2, 0);

if (requireExtract) {
  assert.ok(fs.existsSync(extractPath), 'gc-word-table-extract.json is required');

  const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
  assert.equal(extract.templates.length, 33);
  assert.deepEqual(extract.errors, []);

  const tables = extract.templates.flatMap(({ referenceTable, sampleTable }) => [referenceTable, sampleTable]);
  assert.equal(tables.length, 66);

  for (const table of tables) {
    assert.ok(Number.isFinite(table.widthPt) && table.widthPt > 0, `${table.role} widthPt must be finite and positive`);
    assert.ok(Array.isArray(table.gridPt) && table.gridPt.length > 0, `${table.role} gridPt must not be empty`);
    assert.ok(Array.isArray(table.rows) && table.rows.length > 0, `${table.role} rows must not be empty`);
    assert.ok(Array.isArray(table.cells) && table.cells.length > 0, `${table.role} cells must not be empty`);
    assert.match(table.sourceOoxmlHash, /^[a-f0-9]{64}$/i, `${table.role} sourceOoxmlHash must be SHA-256`);

    for (const row of table.rows) {
      assert.ok(Number.isFinite(row.heightPt) && row.heightPt > 0, `${table.role} row heightPt must be finite and positive`);
    }
  }
}

console.log(`${entries.length} templates / ${new Set(entries.map(({ recordKey }) => recordKey)).size} records / ${totalTables} tables`);
