import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(here, '..', 'assets', 'gc-word-table-renderer.js');
const context = Object.create(null);
context.window = context;
const rendererSource = fs.existsSync(rendererPath) ? fs.readFileSync(rendererPath, 'utf8') : '';
vm.runInNewContext(`${rendererSource}\n;this.renderer = GcWordTableRenderer;`, context, {
  filename: rendererPath,
});
const { renderer } = context;

const runProperties = Object.freeze({
  fonts: { highAnsi: 'SimSun' },
  fontSizePt: 10.5,
  verticalAlign: null,
});

const fixture = Object.freeze({
  templateId: 'renderer-fixture',
  tableRole: 'reference',
  sourceTableIndex: 7,
  widthPt: 300,
  indentPt: 5,
  paddingPt: { top: 1, right: 2, bottom: 3, left: 4 },
  gridPt: [120, 80, 100],
  rowCount: 3,
  columnCount: 3,
  rows: [
    { heightPt: 22, heightRule: 'exact' },
    { heightPt: 18, heightRule: 'atLeast' },
    { heightPt: 12, heightRule: 'exact' },
  ],
  bindings: [
    { cellId: 'reference-r2c3', role: 'input', field: 'assay.Cref', inputMode: 'decimal' },
  ],
  cells: [
    {
      id: 'reference-r1c1', row: 0, column: 0, rowSpan: 2, colSpan: 2, widthPt: 200,
      margins: { top: 1, right: 2, bottom: 3, left: 4 },
      borders: {
        top: { value: 'single', sizePt: 0.5, color: '000000' },
        right: { value: 'double', sizePt: 1, color: 'FF0000' },
        bottom: { value: 'dashed', sizePt: 0.5, color: '00AA00' },
        left: { value: 'dotted', sizePt: 0.5, color: '0000FF' },
      },
      verticalAlign: 'center', textDirection: null, noWrap: null, fitText: null,
      paragraphs: [{
        properties: {
          alignment: 'center', spacing: { beforePt: 1, afterPt: 2, line: '240', lineRule: 'auto' },
          defaultRunProperties: { fonts: { highAnsi: 'SimSun' }, fontSizePt: 10.5, characterSpacingPt: 0.25 },
        },
        runs: [
          { kind: 'text', text: 'A < B & C', properties: {} },
          { kind: 'text', text: '2', properties: { verticalAlign: 'subscript' } },
        ],
      }],
    },
    {
      id: 'reference-r1c3', row: 0, column: 2, rowSpan: 1, colSpan: 1, widthPt: 100,
      margins: null, borders: null, verticalAlign: 'top', textDirection: null, noWrap: null, fitText: null,
      paragraphs: [{ properties: {}, runs: [{ kind: 'math', math: {
        type: 'fraction',
        numerator: { type: 'sequence', children: [{ type: 'text', text: 'x' }] },
        denominator: { type: 'sequence', children: [{ type: 'subscript', base: { type: 'text', text: 'C' }, subscript: { type: 'text', text: 's' } }] },
      } }] }],
    },
    {
      id: 'reference-r2c3', row: 1, column: 2, rowSpan: 1, colSpan: 1, widthPt: 100,
      margins: null, borders: null, verticalAlign: 'bottom', textDirection: null, noWrap: true, fitText: null,
      paragraphs: [],
    },
    {
      id: 'reference-r3gap1', row: 2, column: 0, rowSpan: 1, colSpan: 3, widthPt: 300,
      margins: null, borders: null, verticalAlign: null, textDirection: null, noWrap: null, fitText: null,
      paragraphs: [], isGridGap: true,
    },
  ],
});

const html = renderer.render(fixture, {
  input(binding) {
    assert.equal(binding.field, 'assay.Cref');
    return '<input data-k="assay.Cref">';
  },
  output() { return '<output></output>'; },
});

assert.match(html, /^<div class="word-indent-canvas"/);
assert.match(html, /<div class="word-record-frame"/);
assert.match(html, /<table class="word-record-table"/);
assert.match(html, /data-word-table-role="reference"/);
assert.match(html, /data-word-template-id="renderer-fixture"/);
assert.doesNotMatch(html, /data-source-table-(?:index|number|id)/i);
assert.match(html, /<col style="width:120pt">/);
assert.match(html, /<td[^>]*rowspan="2" colspan="2"/);
assert.match(html, /<p style="margin:0;text-align:center;margin-top:1pt;margin-bottom:2pt;line-height:1;font-family:SimSun;font-size:10.5pt;letter-spacing:0.25pt">/);
assert.match(html, /<span style="font-family:SimSun;font-size:10.5pt;letter-spacing:0.25pt">A &lt; B &amp; C<\/span><sub/);
assert.match(html, /<sub><span style="font-family:SimSun;font-size:10.5pt;letter-spacing:0.25pt">2<\/span><\/sub>/);
assert.match(html, /<p style="margin:0"><span class="word-math-fraction" style="display:inline-flex;flex-direction:column;vertical-align:middle;line-height:1;text-align:center">/);
assert.match(html, /class="word-math-numerator" style="display:block;padding:0 0.15em">/);
assert.match(html, /class="word-math-denominator" style="display:block;border-top:1px solid currentColor;padding:0 0.15em">/);
assert.match(html, /<sub><span class="word-math-text">s<\/span><\/sub>/);

const legacyMathHtml = renderer.render({
  ...fixture,
  cells: fixture.cells.map(cell => cell.id === 'reference-r1c3' ? {
    ...cell,
    paragraphs: [{ properties: {}, runs: [{ kind: 'math', math: {
      type: 'sequence', children: [
        { type: 'text', text: '<unsafe>' },
        { type: 'overline', base: { type: 'text', text: 'A' } },
        { type: 'subscript', base: { type: 'text', text: 'C' }, subscript: { type: 'text', text: 's' } },
      ],
    } }] }],
  } : cell),
}, { input: () => '<input>', output: () => '<output>' });
assert.match(legacyMathHtml, /&lt;unsafe&gt;/);
assert.match(legacyMathHtml, /class="word-math-overline"/);
assert.match(legacyMathHtml, /text-decoration:overline/);
assert.match(html, /<input data-k="assay.Cref">/);
assert.match(html, /class="word-grid-gap"/);
assert.match(html, /class="word-grid-gap"[^>]*style="border:0/);
assert.doesNotMatch(html, /A < B & C/);
assert.match(html, /<tr data-word-row-height-rule="exact"><td[^>]*rowspan="2" colspan="2"[^>]*><div class="word-row-content" style="min-height:35.25pt;box-sizing:border-box">/);
assert.doesNotMatch(html, /<td[^>]*rowspan="2" colspan="2"[^>]*><div class="word-row-content" style="height:22pt;max-height:22pt/);
assert.match(html, /<tr data-word-row-height-rule="atLeast"><td[^>]*><div class="word-row-content" style="min-height:14pt;box-sizing:border-box"><div class="word-bound-content" style="margin:0"><input data-k="assay.Cref"><\/div><\/div><\/td><\/tr>/);
assert.match(html, /<tr data-word-row-height-rule="exact"><td class="word-grid-gap"/);

const autoHeightHtml = renderer.render({ ...fixture, rows: fixture.rows.map((row, index) => index === 2 ? { ...row, heightRule: 'auto' } : row) }, {
  input: () => '<input>', output: () => '<output>',
});
assert.match(autoHeightHtml, /<tr data-word-row-height-rule="auto"><td class="word-grid-gap"/);

assert.throws(() => renderer.render({
  ...fixture,
  cells: fixture.cells.map(cell => cell.id === 'reference-r1c3' ? {
    ...cell,
    paragraphs: [{ properties: {}, runs: [{ kind: 'math', math: { type: 'radical', value: { type: 'text', text: 'x' } } }] }],
  } : cell),
}, { input: () => '', output: () => '' }),
/templateId=renderer-fixture tableRole=reference cellId=reference-r1c3 unsupported math node radical/);

assert.throws(() => renderer.render({
  ...fixture,
  cells: fixture.cells.map(cell => cell.id === 'reference-r1c1' ? {
    ...cell,
    paragraphs: [{ properties: {}, runs: [{ kind: 'text', text: 'x', properties: { fonts: { highAnsi: 'evil; color:red' } } }] }],
  } : cell),
}, { input: () => '', output: () => '' }),
/templateId=renderer-fixture tableRole=reference cellId=reference-r1c1 unsupported font family/);

assert.throws(() => renderer.render({
  ...fixture,
  cells: fixture.cells.map(cell => cell.id === 'reference-r1c1' ? {
    ...cell,
    paragraphs: [{
      properties: { defaultRunProperties: { fonts: { highAnsi: 'evil; color:red' } } },
      runs: [{ kind: 'text', text: 'x', properties: { fonts: { highAnsi: 'SimSun' } } }],
    }],
  } : cell),
}, { input: () => '', output: () => '' }),
/templateId=renderer-fixture tableRole=reference cellId=reference-r1c1 unsupported font family/);

assert.throws(() => renderer.validate({ ...fixture, gridPt: [120, 80] }),
/templateId=renderer-fixture tableRole=reference cellId=table grid column count/);

const clippedFixture = {
  ...fixture,
  visibleColumnCount: 2,
  renderWidthPt: 200,
  renderGridPt: [120, 80],
  renderIndentPt: 5,
  cells: fixture.cells.flatMap(cell => cell.id === 'reference-r3gap1' ? [
    { ...cell, id: 'reference-r3c1', column: 0, colSpan: 2, widthPt: 200, isGridGap: false },
    { ...cell, id: 'reference-r3gap3', column: 2, colSpan: 1, widthPt: 100 },
  ] : [cell]),
};
const clipped = renderer.render(clippedFixture, { input: () => '<input>', output: () => '<output>' });
assert.match(clipped, /<col style="width:120pt"><col style="width:80pt">/);
assert.doesNotMatch(clipped, /reference-r1c3/);
assert.doesNotMatch(clipped, /word-grid-gap/);

const layoutsPath = path.join(here, '..', 'assets', 'gc-record-table-layouts.js');
const geometryPath = path.join(here, '..', 'assets', 'gc-word-table-visible-geometry.js');
const layoutsContext = Object.create(null);
vm.runInNewContext(`${fs.readFileSync(layoutsPath, 'utf8')}\n${fs.readFileSync(geometryPath, 'utf8')}\n;this.layouts = GC_WORD_TABLE_LAYOUTS;this.geometry = GC_WORD_TABLE_VISIBLE_GEOMETRY;`, layoutsContext, {
  filename: layoutsPath,
});
for (const layout of Object.values(layoutsContext.layouts)) {
  for (const sourceTable of [layout.referenceTable, layout.sampleTable]) {
    const table = structuredClone(sourceTable);
    Object.assign(table, structuredClone(layoutsContext.geometry[layout.templateId][sourceTable.tableRole]));
    table.bindings = layout.bindings.filter(binding => table.cells.some(cell => cell.id === binding.cellId));
    const rendered = renderer.render(table, {
      input: binding => `<input data-bound="${binding.field}">`,
      output: binding => `<output data-bound="${binding.field}"></output>`,
    });
    assert.match(rendered, new RegExp(`data-word-table-role="${sourceTable.tableRole}"`));
    assert.match(rendered, new RegExp(`data-word-template-id="${layout.templateId}"`));
    assert.doesNotMatch(rendered, /data-source-table-(?:index|number|id)/i);
    assert.doesNotMatch(rendered, /undefined|null/);
  }
}

const realLayout = Object.values(layoutsContext.layouts)[0];
const realTable = structuredClone(realLayout.referenceTable);
Object.assign(realTable, structuredClone(layoutsContext.geometry[realLayout.templateId].reference));
realTable.bindings = realLayout.bindings.filter(binding => realTable.cells.some(cell => cell.id === binding.cellId));
const realRow = realTable.rows[0];
assert.equal(realRow.heightRule, null, 'approved source row must reproduce null hRule');
const realHtml = renderer.render(realTable, {
  input: () => '<input>', output: () => '<output>',
});
const expectedVisibleContentHeight = layoutsContext.geometry[realLayout.templateId].reference.renderHeightPt[0] - 0.75;
assert.match(realHtml, new RegExp(`<tr data-word-row-height-rule="atLeast">[^]*?<div class="word-row-content" style="min-height:${expectedVisibleContentHeight}pt;box-sizing:border-box">`));

console.log('PASS: pure GC Word-table renderer: geometry, runs, math, bindings, escaping, and fail-closed styles');
