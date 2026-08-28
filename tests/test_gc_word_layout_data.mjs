import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, '..', 'tools', 'gc-word-table-manifest.json');
const extractPath = path.join(here, '..', 'tools', 'gc-word-table-extract.json');
const assetPath = path.join(here, '..', 'assets', 'gc-record-table-layouts.js');
const builderPath = path.join(here, '..', 'tools', 'build_gc_word_layouts.mjs');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = manifest.entries;
const requireExtract = process.argv.includes('--require-extract');
const requireAsset = process.argv.includes('--require-asset');
const requireBuilder = process.argv.includes('--require-builder');

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

// This source-authoritative map is deliberately independent from the builder's
// label rules. It locks each browser layout's expected injection-slot shape.
const EXPECTED_NEEDLE_SLOT_COUNTS = Object.freeze({
  'patchouli-patchoulol': { refA: 5, refIS: 5, smpA: [3, 3], smpIS: [2, 2] },
  'patchouli-patchoulol-finished': { refA: 5, refIS: 5, smpA: [3, 3], smpIS: [2, 2] },
  'mugwort-eucalyptol': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'mugwort-borneol': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'mugwort-eucalyptol-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'mugwort-borneol-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'star-anise-anethole': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'star-anise-anethole-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'mint-menthol': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'mint-menthol-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'clove-eugenol': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'clove-eugenol-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'cardamom-eucalyptol': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'cardamom-eucalyptol-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'dendrobium-dendrobine': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'homalomena-linalool': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'homalomena-linalool-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'amomum-bornyl-acetate': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'amomum-bornyl-acetate-finished-national': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'amomum-bornyl-acetate-finished-shanghai': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'amomum-bornyl-acetate-finished-beijing': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'fennel-anethole': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'fennel-anethole-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'fennel-anethole-salted-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'brucea-oleic': { refA: 5, refIS: 5, smpA: [3, 3], smpIS: [2, 2] },
  'brucea-oleic-finished': { refA: 5, refIS: 5, smpA: [3, 3], smpIS: [2, 2] },
  'flax-linoleic': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'flax-linolenic': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'elsholtzia-thymol': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'elsholtzia-carvacrol': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'elsholtzia-thymol-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'elsholtzia-carvacrol-finished': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
  'pine-alpha-pinene': { refA: 5, refIS: 0, smpA: [2, 2], smpIS: [0, 0] },
});

const EXPECTED_UNBOUND_NON_GAP_BLANKS = Object.freeze({
  'patchouli-patchoulol': ['reference-r10c1', 'reference-r10c2'],
  'patchouli-patchoulol-finished': ['reference-r10c1', 'reference-r10c2'],
  'brucea-oleic': ['reference-r10c1', 'reference-r10c2'],
  'brucea-oleic-finished': ['reference-r10c1', 'reference-r10c2'],
});

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

if (requireBuilder) {
  assert.ok(fs.existsSync(builderPath), 'tools/build_gc_word_layouts.mjs missing');

  const {
    normalizeWordTable,
    validateTableGeometry,
    normalizeOfficeMath,
    buildBindings,
    emitBrowserAsset,
  } = await import(`${pathToFileURL(builderPath).href}?test=${Date.now()}`);

  const rawTable = {
    role: 'reference', sourceTableIndex: 7, widthPt: 30, indentPt: 0,
    gridPt: [10, 20], tableProperties: {}, sourceOoxmlHash: 'a'.repeat(64),
    rows: [
      { rowIndex: 1, heightPt: 12, heightRule: 'atLeast', cellIndexes: [1, 2] },
      { rowIndex: 2, heightPt: 13, heightRule: 'exact', cellIndexes: [3, 4] },
    ],
    cells: [
      { rowIndex: 1, cellIndex: 1, gridColumnIndex: 1, gridSpan: 1, verticalMerge: null,
        text: '标签一', paragraphs: [], ooxml: '<w:tc />' },
      { rowIndex: 1, cellIndex: 2, gridColumnIndex: 2, gridSpan: 1, verticalMerge: 'restart',
        text: '', paragraphs: [], ooxml: '<w:tc />' },
      { rowIndex: 2, cellIndex: 1, gridColumnIndex: 1, gridSpan: 1, verticalMerge: null,
        text: '标签二', paragraphs: [], ooxml: '<w:tc />' },
      { rowIndex: 2, cellIndex: 2, gridColumnIndex: 2, gridSpan: 1, verticalMerge: 'continue',
        text: '', paragraphs: [], ooxml: '<w:tc />' },
    ],
    wordOpenXml: '<pkg:package />',
  };
  const normalized = normalizeWordTable(rawTable, { templateId: 'fixture', tableRole: 'reference' });
  assert.equal(normalized.rowCount, 2);
  assert.equal(normalized.columnCount, 2);
  assert.equal(normalized.cells.length, 3);
  assert.equal(normalized.cells.find(({ id }) => id === 'reference-r1c2').rowSpan, 2);
  assert.ok(!JSON.stringify(normalized).includes('wordOpenXml'));
  assert.ok(!JSON.stringify(normalized).includes('ooxml'));
  validateTableGeometry(normalized);

  const rawWidthMismatch = structuredClone(rawTable);
  rawWidthMismatch.widthPt = 31;
  assert.throws(() => normalizeWordTable(rawWidthMismatch,
    { templateId: 'fixture', tableRole: 'reference' }),
  /templateId=fixture tableRole=reference cellId=table .*grid width/);

  const rawBadRow = structuredClone(rawTable);
  rawBadRow.cells[0].rowIndex = 0;
  assert.throws(() => normalizeWordTable(rawBadRow,
    { templateId: 'fixture', tableRole: 'reference' }),
  /templateId=fixture tableRole=reference cellId=reference-r0c1 .*bounds/);

  const rawBadColumn = structuredClone(rawTable);
  rawBadColumn.cells[0].gridColumnIndex = 0;
  assert.throws(() => normalizeWordTable(rawBadColumn,
    { templateId: 'fixture', tableRole: 'reference' }),
  /templateId=fixture tableRole=reference cellId=reference-r1c0 .*bounds/);

  const overlapping = structuredClone(normalized);
  overlapping.cells[2].column = 1;
  assert.throws(() => validateTableGeometry(overlapping),
    /templateId=fixture tableRole=reference cellId=reference-r2c1 .*overlap/);
  const widthMismatch = structuredClone(normalized);
  widthMismatch.widthPt = 31;
  assert.throws(() => validateTableGeometry(widthMismatch),
    /templateId=fixture tableRole=reference cellId=table .*grid width/);

  const fraction = normalizeOfficeMath(`
    <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
      <m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>
      <m:sSub><m:e><m:r><m:t>C</m:t></m:r></m:e><m:sub><m:r><m:t>样</m:t></m:r></m:sub></m:sSub>
      <m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
      <m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:r><m:t>q</m:t></m:r></m:e></m:d>
    </m:oMath>`);
  assert.deepEqual(fraction.unresolved, []);
  assert.deepEqual(fraction.ast.children.map(({ type }) => type),
    ['fraction', 'subscript', 'superscript', 'delimiter']);
  assert.deepEqual(fraction.ast.children[0].numerator, { type: 'sequence', children: [{ type: 'run', text: 'a' }] });
  const unsupportedMath = normalizeOfficeMath('<m:oMath xmlns:m="urn:m"><m:rad><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>');
  assert.deepEqual(unsupportedMath.unresolved, ['rad']);

  const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
  const manifestById = new Map(entries.map(entry => [entry.templateId, entry]));
  for (const templateId of ['clove-eugenol', 'patchouli-patchoulol']) {
    const rawTemplate = extract.templates.find(template => template.templateId === templateId);
    const meta = manifestById.get(templateId);
    const table = normalizeWordTable(rawTemplate.referenceTable,
      { templateId, tableRole: 'reference' });
    const bindingResult = buildBindings(table, 'reference', meta);
    assert.deepEqual(bindingResult.unresolved, []);
    assert.equal(new Set(bindingResult.bindings.map(({ field }) => field)).size,
      bindingResult.bindings.length, `${templateId} fields must be unique`);
    assert.ok(bindingResult.bindings.some(({ field }) => field === 'assay.refBatch'));
    assert.ok(bindingResult.bindings.some(({ field }) => field === 'assay.out.Aref'));
    assert.equal(bindingResult.bindings.filter(({ field }) => /^assay\.refA\.\d+$/.test(field)).length, 5);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-word-layout-test-'));
  try {
    const output = path.join(tempDir, 'asset.js');
    emitBrowserAsset({ fixture: {
      templateId: 'fixture', referenceTable: normalized, sampleTable: normalized,
      bindings: [], sourceOoxml: '<raw />', internalQaImage: 'secret.png',
    } }, output);
    const emitted = fs.readFileSync(output, 'utf8');
    assert.match(emitted, /^const GC_WORD_TABLE_LAYOUTS = Object\.freeze\(/);
    assert.ok(!emitted.includes('<raw />'));
    assert.ok(!emitted.includes('secret.png'));
    const emittedContext = Object.create(null);
    vm.runInNewContext(`${emitted}\n;this.value = GC_WORD_TABLE_LAYOUTS;`, emittedContext);
    assert.equal(emittedContext.value.fixture.templateId, 'fixture');

    const approvedAudit = JSON.parse(fs.readFileSync(
      path.join(here, '..', 'output', 'gc-word-layout-audit', 'field-map-report.json'), 'utf8'));
    const rejectedApprovals = [
      ['unreviewed', /is not reviewed/, audit => { audit.templates[0].reviewed = false; }],
      ['source-hash', /source OOXML hash changed/, audit => {
        audit.templates[0].sourceOoxmlHashes.reference = '0'.repeat(64);
      }],
      ['unresolved', /has unresolved audit items/, audit => {
        audit.templates[0].unresolved.push({ type: 'test-unresolved' });
      }],
      ['digest-tamper', /approved audit content changed/, audit => {
        audit.templates[0].inputFields[0].field = 'assay.testTamper';
      }],
    ];
    for (const [name, expectedError, mutate] of rejectedApprovals) {
      const auditPath = path.join(tempDir, `${name}.json`);
      const rejectedOutput = path.join(tempDir, `${name}.js`);
      const audit = structuredClone(approvedAudit);
      mutate(audit);
      fs.writeFileSync(auditPath, JSON.stringify(audit), 'utf8');
      const result = spawnSync(process.execPath, [builderPath,
        '--input', extractPath,
        '--manifest', manifestPath,
        '--approved-audit', auditPath,
        '--output', rejectedOutput,
      ], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${name} approval must fail`);
      assert.match(`${result.stdout}${result.stderr}`, expectedError);
      assert.ok(!fs.existsSync(rejectedOutput), `${name} approval must not emit an asset`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (requireAsset) {
  assert.ok(fs.existsSync(assetPath), 'assets/gc-record-table-layouts.js missing');

  const context = Object.create(null);
  const source = fs.readFileSync(assetPath, 'utf8');
  vm.runInNewContext(`${source}\n;this.__layouts = GC_WORD_TABLE_LAYOUTS;`, context, {
    filename: assetPath,
  });
  const layouts = context.__layouts;

  assert.deepEqual(Object.keys(layouts), EXPECTED_TEMPLATE_IDS);
  assert.equal(Object.keys(layouts).length, 33);
  assert.deepEqual(Object.keys(EXPECTED_NEEDLE_SLOT_COUNTS), EXPECTED_TEMPLATE_IDS);

  let unresolvedCount = 0;
  let gridGapCount = 0;
  for (const templateId of EXPECTED_TEMPLATE_IDS) {
    const layout = layouts[templateId];
    assert.equal(layout.templateId, templateId, `${templateId} must remain the sole runtime key`);
    assert.ok(layout.referenceTable, `${templateId} referenceTable missing`);
    assert.ok(layout.sampleTable, `${templateId} sampleTable missing`);
    assert.ok(Array.isArray(layout.bindings), `${templateId} bindings missing`);
    unresolvedCount += layout.unresolved?.length ?? 0;

    const tables = [
      ['reference', layout.referenceTable],
      ['sample', layout.sampleTable],
    ];
    const gapIds = new Set();
    const unboundNonGapBlankIds = [];
    for (const [tableRole, table] of tables) {
      const gridWidth = table.gridPt.reduce((sum, width) => sum + width, 0);
      assert.ok(
        Math.abs(gridWidth - table.widthPt) <= 0.05,
        `${templateId}/${tableRole} grid differs from width by ${Math.abs(gridWidth - table.widthPt)}pt`,
      );

      const occupied = Array.from({ length: table.rowCount }, () =>
        Array(table.columnCount).fill(null));
      for (const cell of table.cells) {
        assert.ok(Number.isInteger(cell.row) && cell.row >= 0, `${templateId}/${tableRole}/${cell.id} invalid row`);
        assert.ok(Number.isInteger(cell.column) && cell.column >= 0, `${templateId}/${tableRole}/${cell.id} invalid column`);
        assert.ok(Number.isInteger(cell.rowSpan) && cell.rowSpan > 0, `${templateId}/${tableRole}/${cell.id} invalid rowSpan`);
        assert.ok(Number.isInteger(cell.colSpan) && cell.colSpan > 0, `${templateId}/${tableRole}/${cell.id} invalid colSpan`);
        for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
          for (let column = cell.column; column < cell.column + cell.colSpan; column += 1) {
            assert.ok(row < table.rowCount && column < table.columnCount,
              `${templateId}/${tableRole}/${cell.id} exceeds table bounds`);
            assert.equal(occupied[row][column], null,
              `${templateId}/${tableRole}/${cell.id} overlaps ${occupied[row][column]} at ${row},${column}`);
            occupied[row][column] = cell.id;
          }
        }
      }
      for (let row = 0; row < table.rowCount; row += 1) {
        for (let column = 0; column < table.columnCount; column += 1) {
          assert.notEqual(occupied[row][column], null,
            `${templateId}/${tableRole} has a hole at ${row},${column}`);
        }
      }

      for (const cell of table.cells) {
        if (cell.isGridGap) {
          gridGapCount += 1;
          gapIds.add(cell.id);
          assert.equal(cell.borders, null, `${templateId}/${tableRole}/${cell.id} grid gap must be borderless`);
        }
      }
      const boundCellIds = new Set(layout.bindings.map(({ cellId }) => cellId));
      for (const cell of table.cells) {
        if (!cell.isGridGap && !String(cell.text ?? '').trim() && !boundCellIds.has(cell.id)) {
          unboundNonGapBlankIds.push(cell.id);
        }
      }
    }

    for (const binding of layout.bindings) {
      assert.ok(!gapIds.has(binding.cellId), `${templateId}/${binding.cellId} binding must not target a grid gap`);
    }
    assert.deepEqual(unboundNonGapBlankIds.sort(),
      [...(EXPECTED_UNBOUND_NON_GAP_BLANKS[templateId] ?? [])].sort(),
      `${templateId} unbound non-gap blanks changed`);

    const expectedSlots = EXPECTED_NEEDLE_SLOT_COUNTS[templateId];
    const countSlots = expression => layout.bindings.filter(({ field }) => expression.test(field)).length;
    assert.equal(countSlots(/^assay\.refA\.\d+$/), expectedSlots.refA,
      `${templateId} reference analyte injection slots changed`);
    assert.equal(countSlots(/^assay\.refIS\.\d+$/), expectedSlots.refIS,
      `${templateId} reference internal-standard injection slots changed`);
    assert.deepEqual([1, 2].map(sample => countSlots(new RegExp(`^assay\\.smpA\\.${sample}\\.\\d+$`))),
      expectedSlots.smpA, `${templateId} sample analyte injection slots changed`);
    assert.deepEqual([1, 2].map(sample => countSlots(new RegExp(`^assay\\.smpIS\\.${sample}\\.\\d+$`))),
      expectedSlots.smpIS, `${templateId} sample internal-standard injection slots changed`);
  }

  assert.equal(unresolvedCount, 0);
  assert.equal(gridGapCount, 44, 'whole asset must preserve 44 borderless structural grid gaps');
  console.log(`${EXPECTED_TEMPLATE_IDS.length} precise layouts; ${unresolvedCount} unresolved bindings`);
}

if (!requireAsset) {
  console.log(`${entries.length} templates / ${new Set(entries.map(({ recordKey }) => recordKey)).size} records / ${totalTables} tables`);
}
