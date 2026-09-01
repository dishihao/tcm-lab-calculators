import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const EMBEDDED_REGISTRY = JSON.parse(fs.readFileSync(
  path.join(MODULE_DIR, 'gc-word-embedded-object-semantics.json'), 'utf8',
));
if (EMBEDDED_REGISTRY.version !== 1 || EMBEDDED_REGISTRY.entries.length !== 95) {
  throw new Error('embedded-object registry must be reviewed version 1 with 95 entries');
}
const EMBEDDED_BY_IDENTITY = new Map(EMBEDDED_REGISTRY.entries.map(entry => [entry.identity, entry]));

const INTERNAL_REFERENCE_LABELS = Object.freeze({
  '正十八烷批号': { type: 'single', role: 'input', field: 'assay.internalBatch', inputMode: 'text' },
  '百秋李醇批号': { type: 'single', role: 'input', field: 'assay.refBatch', inputMode: 'text' },
  '苯甲酸苯酯批号': { type: 'single', role: 'input', field: 'assay.internalBatch', inputMode: 'text' },
  '油酸批号': { type: 'single', role: 'input', field: 'assay.refBatch', inputMode: 'text' },
  '正十八烷来源': { type: 'single', role: 'input', field: 'assay.internalSource', inputMode: 'text' },
  '百秋李醇来源': { type: 'single', role: 'input', field: 'assay.refSource', inputMode: 'text' },
  '苯甲酸苯酯来源': { type: 'single', role: 'input', field: 'assay.internalSource', inputMode: 'text' },
  '油酸来源': { type: 'single', role: 'input', field: 'assay.refSource', inputMode: 'text' },
  '正十八烷浓度Cs（mg/ml）': { type: 'single', role: 'input', field: 'assay.Cis', inputMode: 'decimal' },
  '百秋李醇浓度CR（mg/ml）': { type: 'single', role: 'input', field: 'assay.Cref', inputMode: 'decimal' },
  '苯甲酸苯酯浓度Cs（mg/ml）': { type: 'single', role: 'input', field: 'assay.Cis', inputMode: 'decimal' },
  '油酸浓度CR（mg/ml）': { type: 'single', role: 'input', field: 'assay.Cref', inputMode: 'decimal' },
  '进样体积（ul）': { type: 'single', role: 'input', field: 'assay.refInjection', inputMode: 'decimal' },
  '正十八烷峰面积A': { type: 'group', role: 'input', field: 'assay.refIS', inputMode: 'decimal' },
  '苯甲酸苯酯峰面积A': { type: 'group', role: 'input', field: 'assay.refIS', inputMode: 'decimal' },
  '正十八烷平均峰面积As': { type: 'single', role: 'output', field: 'assay.out.ISref' },
  '苯甲酸苯酯平均峰面积As': { type: 'single', role: 'output', field: 'assay.out.ISref' },
  '百秋李醇峰面积A': { type: 'group', role: 'input', field: 'assay.refA', inputMode: 'decimal' },
  '油酸峰面积A': { type: 'group', role: 'input', field: 'assay.refA', inputMode: 'decimal' },
  '百秋李醇平均峰面积AR': { type: 'single', role: 'output', field: 'assay.out.Aref' },
  '油酸平均峰面积AR': { type: 'single', role: 'output', field: 'assay.out.Aref' },
  'RSD (%)': { type: 'single', role: 'output', field: 'assay.out.RSD' },
});

const EXTERNAL_REFERENCE_LABELS = Object.freeze({
  '对照品批号': { type: 'single', role: 'input', field: 'assay.refBatch', inputMode: 'text' },
  '纯 度 S': { type: 'single', role: 'input', field: 'assay.refPurity', inputMode: 'decimal' },
  '对照品来源': { type: 'single', role: 'input', field: 'assay.refSource', inputMode: 'text' },
  '干燥条件': { type: 'single', role: 'input', field: 'assay.refDrying', inputMode: 'text' },
  '对照品浓度C对（mg/ml）': { type: 'single', role: 'input', field: 'assay.Cref', inputMode: 'decimal' },
  '对照品进样量V对（μl）': { type: 'single', role: 'input', field: 'assay.refInjection', inputMode: 'decimal' },
  '对照品峰面积A对': { type: 'group', role: 'input', field: 'assay.refA', inputMode: 'decimal' },
  '对照品平均峰面积': { type: 'single', role: 'output', field: 'assay.out.Aref' },
  'RSD (%)': { type: 'single', role: 'output', field: 'assay.out.RSD' },
});

const SAMPLE_LABELS = Object.freeze({
  '水分Q': { type: 'single', role: 'input', field: 'assay.Q', inputMode: 'decimal' },
  '取样量W样（g）': { type: 'pair', role: 'input', field: 'assay.Ws', inputMode: 'decimal' },
  '样品稀释倍数V': { type: 'pair', role: 'input', field: 'assay.f', inputMode: 'decimal' },
  '样品稀释倍数f样': { type: 'pair', role: 'input', field: 'assay.f', inputMode: 'decimal' },
  '进样量V样（μl）': { type: 'pair', role: 'input', field: 'assay.sampleInjection', inputMode: 'decimal' },
  '样品峰面积A样': { type: 'sample-group', role: 'input', field: 'assay.smpA', inputMode: 'decimal', samples: 2 },
  '正十八烷峰面积A': { type: 'sample-group', role: 'input', field: 'assay.smpIS', inputMode: 'decimal', samples: 2 },
  '苯甲酸苯酯峰面积A': { type: 'sample-group', role: 'input', field: 'assay.smpIS', inputMode: 'decimal', samples: 2 },
  '正十八烷平均峰面积AS': { type: 'pair', role: 'output', field: 'assay.out.IS' },
  '苯甲酸苯酯平均峰面积AS': { type: 'pair', role: 'output', field: 'assay.out.IS' },
  '百秋李醇面积A': { type: 'sample-group', role: 'input', field: 'assay.smpA', inputMode: 'decimal', samples: 2 },
  '油酸面积A': { type: 'sample-group', role: 'input', field: 'assay.smpA', inputMode: 'decimal', samples: 2 },
  '样品平均峰面积A': { type: 'pair', role: 'output', field: 'assay.out.A' },
  '百秋李醇平均峰面积AR': { type: 'pair', role: 'output', field: 'assay.out.A' },
  '油酸平均峰面积AR': { type: 'pair', role: 'output', field: 'assay.out.A' },
  '含量X（%）': { type: 'pair', role: 'output', field: 'assay.out.X' },
  '相对偏差(％)': { type: 'single', role: 'output', field: 'assay.out.RD' },
  '平均含量（%）': { type: 'single', role: 'output', field: 'assay.out.MEAN' },
});

const FIXED_ONLY_LABELS = new Set(['样品编号', '1', '2']);
const RAW_KEYS = new Set([
  'ooxml', 'mathOoxml', 'wordOpenXml', 'sourceOoxml', 'internalQaImage',
  'sourceFile', 'sourceOoxmlHash', 'sourceTableIndex', 'objectHash', 'objectIdentity',
  'sourceIdentity', 'sourceCellId', 'sourceDigest', 'sourceObjectEvidence', 'payloadDigests',
  'containerCategory', 'containerType', 'semanticContent',
  'usedTempRecovery', 'recoveryReason', 'temporarySuffix',
]);

function cleanLabel(value) {
  return String(value ?? '').replace(/\s+$/u, '').replace(/^\s+/u, '');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (RAW_KEYS.has(key)) continue;
    result[key] = sanitize(child);
  }
  return result;
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  const tokens = String(xml ?? '').match(/<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('<?') || token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith('<')) {
      const selfClosing = /\/>$/.test(token);
      const match = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/);
      if (!match) continue;
      const node = { name: match[1].split(':').pop(), attrs: {}, children: [] };
      for (const attr of match[2].matchAll(/([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
        node.attrs[attr[1].split(':').pop()] = decodeXml(attr[3]);
      }
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }
    const text = decodeXml(token);
    if (text.trim()) stack.at(-1).children.push({ name: '#text', text });
  }
  return root;
}

function sequence(children) {
  return { type: 'sequence', children };
}

export function normalizeOfficeMath(mathOoxml) {
  const unresolved = new Set();
  const ignored = new Set(['fPr', 'sSubPr', 'sSupPr', 'sSubSupPr', 'ctrlPr']);
  const childrenOf = node => node.children.filter(child => child.name !== '#text');
  const textOf = node => node.children.map(child => child.name === '#text' ? child.text : textOf(child)).join('');
  const childNamed = (node, name) => childrenOf(node).find(child => child.name === name);

  const convertSequence = node => sequence(childrenOf(node).flatMap(child => {
    if (ignored.has(child.name) || child.name === 'dPr') return [];
    const converted = convert(child);
    return converted ? [converted] : [];
  }));
  const wrapped = (node, name) => {
    const child = childNamed(node, name);
    return child ? convertSequence(child) : sequence([]);
  };
  const convert = node => {
    switch (node.name) {
      case 'oMath': case 'oMathPara': case 'e': case 'num': case 'den': case 'sub': case 'sup':
        return convertSequence(node);
      case 'r':
        return { type: 'run', text: textOf(node) };
      case 'f':
        return { type: 'fraction', numerator: wrapped(node, 'num'), denominator: wrapped(node, 'den') };
      case 'sSub':
        return { type: 'subscript', base: wrapped(node, 'e'), subscript: wrapped(node, 'sub') };
      case 'sSup':
        return { type: 'superscript', base: wrapped(node, 'e'), superscript: wrapped(node, 'sup') };
      case 'sSubSup':
        return { type: 'subsup', base: wrapped(node, 'e'), subscript: wrapped(node, 'sub'), superscript: wrapped(node, 'sup') };
      case 'd': {
        const properties = childNamed(node, 'dPr');
        const beginning = properties ? childNamed(properties, 'begChr')?.attrs.val : undefined;
        const ending = properties ? childNamed(properties, 'endChr')?.attrs.val : undefined;
        return { type: 'delimiter', beginning: beginning ?? '(', ending: ending ?? ')', content: wrapped(node, 'e') };
      }
      default:
        unresolved.add(node.name);
        return null;
    }
  };

  const document = parseXml(mathOoxml);
  const roots = childrenOf(document);
  const astChildren = roots.flatMap(node => {
    const converted = convert(node);
    return converted?.type === 'sequence' ? converted.children : converted ? [converted] : [];
  });
  return { ast: sequence(astChildren), unresolved: [...unresolved].sort() };
}

export function normalizeEmbeddedObjectRun(run, expectedIdentity) {
  const approved = EMBEDDED_BY_IDENTITY.get(expectedIdentity);
  if (!approved || !run?.approved || run.objectIdentity !== expectedIdentity
      || run.sourceIdentity !== approved.sourceIdentity
      || run.sourceDigest !== approved.sourceDigest) {
    throw new Error(`${expectedIdentity}: unknown embedded object digest ${String(run?.sourceDigest)}`);
  }
  const ast = EMBEDDED_REGISTRY.semanticAsts[approved.semanticType];
  if (!ast) throw new Error(`${expectedIdentity}: approved semantic AST missing`);
  return { kind: 'math', math: structuredClone(ast) };
}

function normalizeParagraph(paragraph, cellId, unresolved) {
  return {
    text: paragraph.text ?? '',
    properties: sanitize(paragraph.properties),
    runs: (paragraph.runs ?? []).flatMap(run => {
      if (run.kind === 'sourceObject') return [];
      if (run.kind !== 'math') {
        return [{ kind: 'text', text: run.text ?? '', properties: sanitize(run.properties) }];
      }
      const math = normalizeOfficeMath(run.mathOoxml);
      for (const node of math.unresolved) unresolved.push({ type: 'unsupported-math-node', cellId, node });
      return [{ kind: 'math', text: run.text ?? '', math: math.ast }];
    }),
  };
}

function injectApprovedSemantic(cell, approval) {
  const ast = EMBEDDED_REGISTRY.semanticAsts[approval.semanticType];
  if (!ast) throw new Error(`${approval.identity}: approved semantic AST missing`);
  if (!cell.paragraphs.length) cell.paragraphs.push({ text: '', properties: null, runs: [] });
  const mathRun = { kind: 'math', math: structuredClone(ast) };
  if (approval.semanticType === 'externalSampleAverage') {
    const needle = approval.consumeAdjacentText?.value;
    for (let paragraphIndex = cell.paragraphs.length - 1; paragraphIndex >= 0; paragraphIndex -= 1) {
      const runs = cell.paragraphs[paragraphIndex].runs;
      for (let runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
        const run = runs[runIndex];
        if (run.kind !== 'text' || !needle) continue;
        const at = run.text.lastIndexOf(needle);
        if (at < 0) continue;
        const before = { ...run, text: run.text.slice(0, at) };
        const after = { ...run, text: run.text.slice(at + needle.length) };
        runs.splice(runIndex, 1, ...([before.text ? before : null, mathRun, after.text ? after : null].filter(Boolean)));
        cell.semanticContent = `样品平均峰面积|overline(A)`;
        return;
      }
    }
    throw new Error(`${approval.identity}: reviewed adjacent text ${JSON.stringify(needle)} not found`);
  }
  const paragraph = cell.paragraphs[0];
  if (approval.semanticType === 'sampleMean') {
    const suffixIndex = paragraph.runs.findIndex(run => run.kind === 'text' && /[（(]/u.test(run.text));
    paragraph.runs.splice(suffixIndex < 0 ? paragraph.runs.length : suffixIndex, 0, mathRun);
    cell.semanticContent = `平均含量|overline(X)|（%）`;
    return;
  }
  paragraph.runs.push(mathRun);
  cell.semanticContent = approval.semanticType === 'externalReferenceAverage'
    ? '对照品平均峰面积|subscript(overline(A),对)'
    : '校正因子f＝fraction(A_sub_S／C_sub_S,A_sub_R／C_sub_R)';
}

export function normalizeWordTable(rawTable, context = {}) {
  const templateId = context.templateId ?? rawTable.templateId ?? 'unknown';
  const tableRole = context.tableRole ?? rawTable.role ?? 'unknown';
  const rowCount = rawTable.rows.length;
  const columnCount = rawTable.gridPt.length;
  const unresolved = [];
  const cells = [];
  const verticalOwners = new Map();

  for (const rawCell of rawTable.cells) {
    const row = rawCell.rowIndex - 1;
    const column = rawCell.gridColumnIndex - 1;
    const colSpan = rawCell.gridSpan ?? 1;
    const id = `${tableRole}-r${rawCell.rowIndex}c${rawCell.gridColumnIndex}`;
    if (!Number.isInteger(row) || !Number.isInteger(column) || !Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(`templateId=${templateId} tableRole=${tableRole} cellId=${id} has invalid coordinates or span`);
    }
    if (row < 0 || column < 0 || row >= rowCount || column + colSpan > columnCount) {
      throw new Error(`templateId=${templateId} tableRole=${tableRole} cellId=${id} exceeds source table bounds`);
    }
    const mergeKey = `${column}:${colSpan}`;
    if (rawCell.verticalMerge === 'continue') {
      const owner = verticalOwners.get(mergeKey);
      if (!owner || owner.row + owner.rowSpan !== row) {
        throw new Error(`templateId=${templateId} tableRole=${tableRole} cellId=${tableRole}-r${rawCell.rowIndex}c${rawCell.gridColumnIndex} invalid vertical merge continuation`);
      }
      owner.rowSpan += 1;
      continue;
    }

    const cell = {
      id, row, column, rowSpan: 1, colSpan,
      widthPt: rawCell.width?.valuePt ?? rawTable.gridPt.slice(column, column + colSpan).reduce((a, b) => a + b, 0),
      margins: sanitize(rawCell.margins), borders: sanitize(rawCell.borders), shading: sanitize(rawCell.shading),
      verticalAlign: rawCell.verticalAlign, textDirection: rawCell.textDirection,
      noWrap: rawCell.noWrap, fitText: rawCell.fitText,
      text: rawCell.text ?? '',
      paragraphs: (rawCell.paragraphs ?? []).map(paragraph => normalizeParagraph(paragraph, id, unresolved)),
    };
    cells.push(cell);
    if (rawCell.verticalMerge === 'restart') verticalOwners.set(mergeKey, cell);
  }

  for (const object of rawTable.embeddedObjects ?? []) {
    const approval = EMBEDDED_BY_IDENTITY.get(object.objectIdentity);
    if (!approval || !object.approved || approval.sourceIdentity !== object.sourceIdentity
        || approval.sourceDigest !== object.sourceDigest
        || approval.targetCellId !== object.targetCellId) {
      throw new Error(`templateId=${templateId} tableRole=${tableRole} unknown embedded object digest ${String(object.sourceDigest)}`);
    }
    const target = cells.find(cell => cell.id === approval.targetCellId);
    if (!target) throw new Error(`${approval.identity}: target cell missing`);
    injectApprovedSemantic(target, approval);
  }

  const occupied = Array.from({ length: rowCount }, () => Array(columnCount).fill(false));
  for (const cell of cells) {
    for (let row = cell.row; row < cell.row + cell.rowSpan && row < rowCount; row += 1) {
      for (let column = cell.column; column < cell.column + cell.colSpan && column < columnCount; column += 1) {
        occupied[row][column] = true;
      }
    }
  }
  for (let row = 0; row < rowCount; row += 1) {
    let start = null;
    for (let column = 0; column <= columnCount; column += 1) {
      if (column < columnCount && !occupied[row][column] && start === null) start = column;
      if ((column === columnCount || occupied[row][column]) && start !== null) {
        cells.push({
          id: `${tableRole}-r${row + 1}gap${start + 1}`,
          row, column: start, rowSpan: 1, colSpan: column - start,
          widthPt: rawTable.gridPt.slice(start, column).reduce((a, b) => a + b, 0),
          margins: null, borders: null, shading: null, verticalAlign: null, textDirection: null,
          noWrap: null, fitText: null, text: '', paragraphs: [], isGridGap: true,
        });
        start = null;
      }
    }
  }

  const table = {
    templateId, tableRole, sourceTableIndex: rawTable.sourceTableIndex,
    sourceOoxmlHash: rawTable.sourceOoxmlHash,
    widthPt: rawTable.widthPt,
    indentPt: rawTable.indentPt ?? 0,
    paddingPt: {
      top: rawTable.topPaddingPt ?? 0, right: rawTable.rightPaddingPt ?? 0,
      bottom: rawTable.bottomPaddingPt ?? 0, left: rawTable.leftPaddingPt ?? 0,
    },
    gridPt: [...rawTable.gridPt], columnCount, rowCount,
    tableProperties: sanitize(rawTable.tableProperties),
    rows: rawTable.rows.map(row => ({
      heightPt: row.heightPt, heightRule: row.heightRule,
      cantSplit: row.cantSplit, repeatHeader: row.repeatHeader,
    })),
    cells: cells.sort((a, b) => a.row - b.row || a.column - b.column),
    unresolved,
  };
  validateTableGeometry(table);
  return table;
}

function geometryError(table, cellId, message) {
  throw new Error(`templateId=${table.templateId} tableRole=${table.tableRole} cellId=${cellId} ${message}`);
}

export function validateTableGeometry(table) {
  const gridWidth = table.gridPt.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(table.widthPt) || Math.abs(gridWidth - table.widthPt) > 0.05) {
    geometryError(table, 'table', `grid width ${gridWidth}pt differs from table width ${table.widthPt}pt`);
  }
  const occupied = Array.from({ length: table.rowCount }, () => Array(table.columnCount).fill(null));
  for (const cell of table.cells) {
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.column)
        || !Number.isInteger(cell.rowSpan) || !Number.isInteger(cell.colSpan)
        || cell.row < 0 || cell.column < 0 || cell.rowSpan < 1 || cell.colSpan < 1) {
      geometryError(table, cell.id ?? 'unknown', 'has invalid coordinates or spans');
    }
    for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
      for (let column = cell.column; column < cell.column + cell.colSpan; column += 1) {
        if (row >= table.rowCount || column >= table.columnCount) {
          geometryError(table, cell.id, `exceeds bounds at row=${row} column=${column}`);
        }
        if (occupied[row][column]) {
          geometryError(table, cell.id, `overlap with ${occupied[row][column]} at row=${row} column=${column}`);
        }
        occupied[row][column] = cell.id;
      }
    }
  }
  for (let row = 0; row < table.rowCount; row += 1) {
    for (let column = 0; column < table.columnCount; column += 1) {
      if (!occupied[row][column]) geometryError(table, 'none', `hole at row=${row} column=${column}`);
    }
  }
  return true;
}

function ruleTable(tableRole, label) {
  if (tableRole === 'sample') return SAMPLE_LABELS[label];
  return INTERNAL_REFERENCE_LABELS[label] ?? EXTERNAL_REFERENCE_LABELS[label];
}

function targetCells(table, labelCell) {
  const nextLabel = table.cells
    .filter(cell => !cell.isGridGap && cell.row === labelCell.row
      && cell.column >= labelCell.column + labelCell.colSpan && cleanLabel(cell.text))
    .sort((a, b) => a.column - b.column)[0];
  const endColumn = nextLabel?.column ?? table.columnCount;
  return table.cells.filter(cell => !cell.isGridGap && cell.row === labelCell.row
    && cell.column >= labelCell.column + labelCell.colSpan && cell.column < endColumn
    && cleanLabel(cell.text) === '');
}

function fieldsForRule(rule, targetCount) {
  if (rule.type === 'single') return [rule.field];
  if (rule.type === 'pair') return [`${rule.field}.1`, `${rule.field}.2`];
  if (rule.type === 'group') return Array.from({ length: targetCount }, (_, index) => `${rule.field}.${index}`);
  if (rule.type === 'sample-group') {
    if (targetCount % rule.samples !== 0) return null;
    const shots = targetCount / rule.samples;
    return Array.from({ length: targetCount }, (_, index) =>
      `${rule.field}.${Math.floor(index / shots) + 1}.${index % shots}`);
  }
  return null;
}

export function buildBindings(table, tableRole, templateMeta) {
  const templateId = templateMeta.templateId;
  const bindings = [];
  const unresolved = [...(table.unresolved ?? [])];
  const fixedLabels = [];
  const matchedTargetIds = new Set();
  const labelCounts = new Map();
  const needleCounts = [];

  for (const cell of table.cells.filter(cell => !cell.isGridGap && cleanLabel(cell.text))) {
    const label = cleanLabel(cell.text);
    fixedLabels.push({ cellId: cell.id, text: cell.text });
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    if (FIXED_ONLY_LABELS.has(label)) continue;
    const rule = ruleTable(tableRole, label);
    if (!rule) {
      unresolved.push({ type: 'unsupported-label', tableRole, cellId: cell.id, label: cell.text });
      continue;
    }
    const targets = targetCells(table, cell);
    const fields = fieldsForRule(rule, targets.length);
    const expected = rule.type === 'single' ? 1 : rule.type === 'pair' ? 2 : null;
    if ((expected !== null && targets.length !== expected) || !fields) {
      unresolved.push({ type: 'binding-cardinality', tableRole, cellId: cell.id,
        label: cell.text, expected: expected ?? `multiple of ${rule.samples ?? 1}`, actual: targets.length });
      continue;
    }
    if (rule.type === 'group' || rule.type === 'sample-group') {
      needleCounts.push({ label: cell.text, cellId: cell.id,
        total: targets.length, perSample: rule.type === 'sample-group' ? targets.length / rule.samples : targets.length });
    }
    targets.forEach((target, index) => {
      bindings.push({
        cellId: target.id, role: rule.role, field: fields[index],
        ...(rule.inputMode ? { inputMode: rule.inputMode } : {}),
        sourceLabel: cell.text,
      });
      matchedTargetIds.add(target.id);
    });
  }

  for (const formulaCell of table.cells.filter(cell =>
    cell.semanticContent?.startsWith('校正因子f＝fraction('))) {
    fixedLabels.push({ cellId: formulaCell.id, text: formulaCell.semanticContent });
    const targets = targetCells(table, formulaCell);
    if (targets.length !== 1) {
      unresolved.push({ type: 'binding-cardinality', tableRole, cellId: formulaCell.id,
        label: formulaCell.semanticContent, expected: 1, actual: targets.length });
      continue;
    }
    bindings.push({ cellId: targets[0].id, role: 'output', field: 'assay.out.factor',
      sourceLabel: formulaCell.semanticContent });
    matchedTargetIds.add(targets[0].id);
  }

  for (const [label, count] of labelCounts) {
    if (count !== 1) {
      throw new Error(`templateId=${templateId} tableRole=${tableRole} cellId=multiple label=${JSON.stringify(label)} expected exactly one match; found ${count}`);
    }
  }
  const fieldCounts = new Map();
  for (const binding of bindings) fieldCounts.set(binding.field, (fieldCounts.get(binding.field) ?? 0) + 1);
  for (const [field, count] of fieldCounts) {
    if (count !== 1) unresolved.push({ type: 'duplicate-field', tableRole, field, count });
  }
  const unmappedBlankCells = table.cells
    .filter(cell => !cell.isGridGap && !cleanLabel(cell.text) && !cell.semanticContent && !matchedTargetIds.has(cell.id))
    .map(cell => ({ cellId: cell.id, row: cell.row, column: cell.column, colSpan: cell.colSpan, rowSpan: cell.rowSpan }));
  return { bindings, fixedLabels, needleCounts, unmappedBlankCells, unresolved };
}

function stripPrivate(value) {
  if (Array.isArray(value)) return value.map(stripPrivate);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (RAW_KEYS.has(key) || key === 'internalQaImages') continue;
    result[key] = stripPrivate(child);
  }
  return result;
}

export function emitBrowserAsset(layouts, outputPath) {
  const publicLayouts = stripPrivate(layouts);
  const source = `const GC_WORD_TABLE_LAYOUTS = Object.freeze(${JSON.stringify(publicLayouts)});\n`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, source, 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function auditProjection(entry) {
  const { reviewed: _reviewed, auditDigest: _digest, ...projection } = entry;
  return projection;
}

function buildAll(extract, manifest) {
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== 33) throw new Error('manifest must contain exactly 33 entries');
  if (!Array.isArray(extract.templates) || extract.templates.length !== 33) throw new Error('extract must contain exactly 33 templates');
  if (!Array.isArray(extract.errors) || extract.errors.length !== 0) throw new Error(`extract has ${extract.errors?.length ?? 'unknown'} errors`);
  const extractById = new Map(extract.templates.map(template => [template.templateId, template]));
  if (extractById.size !== 33) throw new Error('extract templateId values must be unique');
  const layouts = {};
  const auditTemplates = [];

  for (const meta of manifest.entries) {
    const raw = extractById.get(meta.templateId);
    if (!raw) throw new Error(`templateId=${meta.templateId} missing from extract`);
    if (raw.sourceFile !== meta.sourceFile) throw new Error(`templateId=${meta.templateId} source file mismatch`);
    if (raw.referenceTable.sourceTableIndex !== meta.referenceTableIndex
        || raw.sampleTable.sourceTableIndex !== meta.sampleTableIndex) {
      throw new Error(`templateId=${meta.templateId} source table index mismatch`);
    }
    const referenceTable = normalizeWordTable(raw.referenceTable, { templateId: meta.templateId, tableRole: 'reference' });
    const sampleTable = normalizeWordTable(raw.sampleTable, { templateId: meta.templateId, tableRole: 'sample' });
    const reference = buildBindings(referenceTable, 'reference', meta);
    const sample = buildBindings(sampleTable, 'sample', meta);
    const unresolved = [...reference.unresolved, ...sample.unresolved];
    const bindings = [...reference.bindings, ...sample.bindings];
    const layout = {
      templateId: meta.templateId, recordKey: meta.recordKey, sourceFile: meta.sourceFile,
      referenceTable, sampleTable, bindings, unresolved,
    };
    layouts[meta.templateId] = layout;
    const audit = {
      templateId: meta.templateId, recordKey: meta.recordKey, sourceFile: meta.sourceFile,
      referenceTableIndex: meta.referenceTableIndex, sampleTableIndex: meta.sampleTableIndex,
      sourceOoxmlHashes: {
        reference: raw.referenceTable.sourceOoxmlHash,
        sample: raw.sampleTable.sourceOoxmlHash,
      },
      fixedLabels: { reference: reference.fixedLabels, sample: sample.fixedLabels },
      inputFields: bindings.filter(binding => binding.role === 'input'),
      outputFields: bindings.filter(binding => binding.role === 'output'),
      needleCounts: { reference: reference.needleCounts, sample: sample.needleCounts },
      unmappedBlankCells: {
        reference: reference.unmappedBlankCells,
        sample: sample.unmappedBlankCells,
      },
      unresolved,
      reviewed: false,
    };
    audit.auditDigest = sha256(JSON.stringify(auditProjection(audit)));
    auditTemplates.push(audit);
  }
  if (Object.keys(layouts).length !== 33) throw new Error('layouts must use 33 unique template.id keys');
  return { layouts, auditTemplates };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    parsed[flag.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function writeAudit(auditTemplates, outputPath, inputPath, manifestPath) {
  const report = {
    schemaVersion: 1,
    inputFile: inputPath,
    manifestFile: manifestPath,
    templateCount: auditTemplates.length,
    reviewedCount: 0,
    unresolvedCount: auditTemplates.reduce((sum, entry) => sum + entry.unresolved.length, 0),
    templates: auditTemplates,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function verifyApprovedAudit(approved, currentTemplates) {
  if (approved.schemaVersion !== 1 || approved.templateCount !== 33 || !Array.isArray(approved.templates)) {
    throw new Error('approved audit has invalid schema or template count');
  }
  const approvedById = new Map(approved.templates.map(entry => [entry.templateId, entry]));
  if (approvedById.size !== 33) throw new Error('approved audit templateId values must be unique');
  let reviewedCount = 0;
  let unresolvedCount = 0;
  for (const current of currentTemplates) {
    const entry = approvedById.get(current.templateId);
    if (!entry) throw new Error(`templateId=${current.templateId} missing from approved audit`);
    if (entry.reviewed !== true) throw new Error(`templateId=${current.templateId} is not reviewed`);
    reviewedCount += 1;
    unresolvedCount += entry.unresolved?.length ?? 0;
    if ((entry.unresolved?.length ?? 0) !== 0 || current.unresolved.length !== 0) {
      throw new Error(`templateId=${current.templateId} has unresolved audit items`);
    }
    if (entry.sourceOoxmlHashes?.reference !== current.sourceOoxmlHashes.reference
        || entry.sourceOoxmlHashes?.sample !== current.sourceOoxmlHashes.sample) {
      throw new Error(`templateId=${current.templateId} source OOXML hash changed`);
    }
    if (entry.auditDigest !== current.auditDigest
        || sha256(JSON.stringify(auditProjection(entry))) !== entry.auditDigest) {
      throw new Error(`templateId=${current.templateId} approved audit content changed`);
    }
  }
  if (reviewedCount !== 33 || unresolvedCount !== 0) {
    throw new Error(`approved audit has ${reviewedCount}/33 reviewed and ${unresolvedCount} unresolved`);
  }
  return { reviewedCount, unresolvedCount };
}

async function main(args) {
  const options = parseArgs(args);
  if (!options.input || !options.manifest) throw new Error('--input and --manifest are required');
  if (Boolean(options['audit-only']) === Boolean(options['approved-audit'])) {
    throw new Error('choose exactly one of --audit-only or --approved-audit');
  }
  const extract = JSON.parse(fs.readFileSync(options.input, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  const { layouts, auditTemplates } = buildAll(extract, manifest);
  const unresolvedCount = auditTemplates.reduce((sum, entry) => sum + entry.unresolved.length, 0);
  if (options['audit-only']) {
    const report = writeAudit(auditTemplates, options['audit-only'], options.input, options.manifest);
    console.log(`AUDIT: ${report.templateCount} templates; ${report.reviewedCount} reviewed; ${report.unresolvedCount} unresolved`);
    return;
  }
  if (!options.output) throw new Error('--output is required with --approved-audit');
  if (unresolvedCount !== 0) throw new Error(`generation blocked: ${unresolvedCount} unresolved`);
  const approved = JSON.parse(fs.readFileSync(options['approved-audit'], 'utf8'));
  const verification = verifyApprovedAudit(approved, auditTemplates);
  emitBrowserAsset(layouts, options.output);
  console.log(`EMITTED: ${Object.keys(layouts).length} layouts; ${verification.reviewedCount} reviewed; ${verification.unresolvedCount} unresolved`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
