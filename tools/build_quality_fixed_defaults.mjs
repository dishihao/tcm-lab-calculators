/*
 * 由原检验记录的「测定法」原文派生杂质、水分、总灰分、浸出物的固定测定条件，
 * 输出 assets/quality-fixed-defaults.js。这些条件由标准或原记录确定，
 * 检验人员不需要修改或填写，因此在原记录表格里按固定文字（黑体）显示。
 *
 * 只回填原表确有依据的格子：原文写明条件的按原文，原文只写「照××法（通则××××）测定」
 * 的按所引通则的方法条件；原文没有规定、需要现场确定的（如浸出物蒸发皿的预干燥条件、
 * 水分甲苯法的加甲苯量与回流时间）一律不填，保持可编辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const templatesPath = path.join(root, 'assets', 'quality-templates.js');
const extractPath = path.join(here, 'quality-template-extract.json');
const rawOverlayPath = path.join(here, 'quality-template-raw-extract.json');
const layoutPath = path.join(root, 'assets', 'quantitative-record-layouts.js');
const outputPath = path.join(root, 'assets', 'quality-fixed-defaults.js');
const reportPath = path.join(root, 'output', 'quality-fixed-defaults-report.json');

function loadGlobal(file, name) {
  const context = { window: {} };
  vm.createContext(context);
  const source = fs.readFileSync(file, 'utf8');
  vm.runInContext(source, context);
  const value = context[name] ?? context.window[name] ?? vm.runInContext(name, context);
  if (!value) throw new Error(`${path.basename(file)} 未导出 ${name}`);
  return value;
}

const templates = loadGlobal(templatesPath, 'QUALITY_TEMPLATES');
const layouts = loadGlobal(layoutPath, 'QUANTITATIVE_RECORD_LAYOUTS');

function readRecords() {
  const source = JSON.parse(fs.readFileSync(extractPath, 'utf8').replace(/^\uFEFF/, ''));
  const records = source.records.filter(record => record.kind !== '原料');
  if (fs.existsSync(rawOverlayPath)) {
    const raw = JSON.parse(fs.readFileSync(rawOverlayPath, 'utf8').replace(/^\uFEFF/, ''));
    records.push(...raw.records);
  }
  return records;
}

const normalize = text => String(text || '')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .trim();

const RANGE = String.raw`(\d{2,3}(?:\s*[～~]\s*\d{2,3})?)`;
const compact = value => String(value).replace(/\s*[～~]\s*/, '～');

/** 通则规定的默认条件，仅在此前没有写明条件时使用 */
const STANDARD = {
  moistureDryTemp: '100～105',
  moistureDryFirst: '5',
  moistureDrySecond: '1',
  ashTemp: '500～600',
  ashTime: '至恒重',
  extractTemp: '105',
  extractTime: '3',
  /** 原文明写「干燥／炽灼至恒重」的空容器，时间栏按至恒重记 */
  wareTime: '至恒重'
};

/**
 * 从一条记录的「测定法」原文派生固定测定条件。
 * 返回 null 表示该项目原表没有由标准确定的温度／时间条件。
 */
function conditionsOf(item, methodType, method) {
  const text = normalize(method).replace(/\s+/g, ' ');
  if (item === 'moisture') {
    // 甲苯法（通则0832第四法）：原表只记馏出水量，加甲苯量与回流时间由现场确定，不预填。
    if (methodType === 'fourth' || /第四法/.test(text)) return null;
    const stated = text.match(new RegExp(`在\\s*${RANGE}\\s*[℃°]\\s*干燥`))
      || text.match(new RegExp(`温度[为是]\\s*${RANGE}\\s*[℃°]`));
    const hours = [...text.matchAll(/干燥\s*(\d+(?:\.\d+)?)\s*小时/g)].map(match => match[1]);
    return {
      temp: stated ? compact(stated[1]) : STANDARD.moistureDryTemp,
      first: hours[0] || STANDARD.moistureDryFirst,
      second: hours[1] || STANDARD.moistureDrySecond,
      basis: stated || hours.length ? '记录原文' : '通则0832第二法'
    };
  }
  if (item === 'ash') {
    const stated = text.match(new RegExp(`至\\s*${RANGE}\\s*[℃°]`));
    return {
      temp: stated ? compact(stated[1]) : STANDARD.ashTemp,
      time: STANDARD.ashTime,
      basis: stated ? '记录原文' : '通则2302'
    };
  }
  if (item === 'extract') {
    const stated = text.match(new RegExp(`于\\s*${RANGE}\\s*[℃°]\\s*干燥\\s*(\\d+(?:\\.\\d+)?)\\s*小时`));
    return {
      temp: stated ? compact(stated[1]) : STANDARD.extractTemp,
      time: stated ? stated[2] : STANDARD.extractTime,
      basis: stated ? '记录原文' : '通则2201'
    };
  }
  return null;
}

/**
 * 空容器（称量瓶、坩埚、蒸发皿）按原文「干燥／炽灼至恒重」处理，
 * 样品或残渣一行按原文写明的干燥时间处理；返回 null 表示这一格保持可填。
 */
function valueForRow(item, rowText, label, conditions, order) {
  if (!conditions) return null;
  const isTime = /时间/.test(label);
  if (item === 'moisture') {
    if (!/瓶/.test(rowText)) return null;
    if (!isTime) return conditions.temp;
    // 「瓶+样」一行记干燥 5 小时，第二行记再干燥 1 小时；空瓶两次称重按至恒重。
    if (!/\+样|＋样/.test(rowText)) return STANDARD.wareTime;
    return order === 1 ? conditions.first : conditions.second;
  }
  if (item === 'ash') {
    return isTime ? conditions.time : conditions.temp;
  }
  if (item === 'extract') {
    if (!isTime) return conditions.temp;
    return /残渣/.test(rowText) ? conditions.time : STANDARD.wareTime;
  }
  return null;
}

/**
 * 原表把「空瓶」和「瓶+样」各分成两行，第一行记干燥 X 小时、第二行记再干燥 Y 小时，
 * 因此按同一行标签出现的先后次序取首值／次值，而不是按输入框个数计数。
 */
function moistureRowOrder(runs) {
  const groups = new Map();
  for (const run of runs) {
    if (!/瓶/.test(run.rowText)) continue;
    const group = /样/.test(run.rowText) ? '样品' : '空瓶';
    if (!groups.has(group)) groups.set(group, []);
    const rows = groups.get(group);
    if (!rows.includes(run.row)) rows.push(run.row);
  }
  const order = new Map();
  for (const rows of groups.values()) {
    rows.sort((left, right) => left - right).forEach((row, index) => order.set(row, index + 1));
  }
  return order;
}

function collectRuns(layout) {
  const runs = [];
  for (const tableKey of layout.tableKeys) {
    const table = layouts.tables[tableKey];
    for (const cell of table.cells) {
      const rowText = normalize(cell.text);
      for (const paragraph of cell.paragraphs || []) {
        for (const run of paragraph.runs || []) {
          if (run.kind !== 'input' || !run.field) continue;
          runs.push({ row: cell.row, rowText, label: run.label || '', field: run.field });
        }
      }
    }
  }
  return runs.sort((left, right) => left.row - right.row);
}

const items = new Set(['impurity', 'moisture', 'ash', 'extract']);
const bySource = new Map();
for (const record of readRecords()) {
  if (!items.has(record.item)) continue;
  const key = `${record.item}|${record.file}`;
  const previous = bySource.get(key);
  if (!previous || String(record.modified || '') > String(previous.modified || '')) bySource.set(key, record);
}

const entries = {};
const report = { generatedFrom: path.basename(extractPath), items: {}, templates: {} };
const missingRecords = [];

for (const template of templates) {
  if (!items.has(template.item)) continue;
  const record = bySource.get(`${template.item}|${template.sourceFile}`);
  if (!record) { missingRecords.push(`${template.id} ${template.sourceFile}`); continue; }
  const conditions = conditionsOf(template.item, template.methodType, record.method);
  const layout = layouts.templates[template.id];
  if (!layout || layout.status !== 'mapped') continue;
  const runs = collectRuns(layout);
  const rowOrder = moistureRowOrder(runs);
  const values = {};
  for (const run of runs) {
    const isTime = /时间/.test(run.label);
    let value;
    if (template.item === 'moisture' && !/瓶/.test(run.rowText)) continue;
    value = valueForRow(template.item, run.rowText, run.label, conditions, rowOrder.get(run.row) || 1);
    if (value == null) continue;
    values[run.field] = value;
  }
  if (!Object.keys(values).length) continue;
  // 只保留浏览器需要的运行数据：字段、固定值、依据。源文件名等只写进 output/ 的核对报告。
  entries[template.id] = { values, basis: conditions.basis };
  report.templates[template.id] = {
    item: template.item,
    label: template.label,
    basis: conditions.basis,
    fields: values
  };
}

for (const template of templates) {
  if (!items.has(template.item)) continue;
  const bucket = report.items[template.item] || (report.items[template.item] = { total: 0, fixed: 0, unmapped: 0, noRecord: 0 });
  bucket.total += 1;
  const layout = layouts.templates[template.id];
  if (!layout || layout.status !== 'mapped') { bucket.unmapped += 1; continue; }
  if (entries[template.id]) bucket.fixed += 1;
  if (!bySource.get(`${template.item}|${template.sourceFile}`)) bucket.noRecord += 1;
}
report.missingRecords = missingRecords;

const output = [
  '/* Generated by tools/build_quality_fixed_defaults.mjs from local inspection records. */',
  'const QualityFixedDefaults = (() => {',
  `  const entries = ${JSON.stringify(entries)};`,
  '  function value(templateId, field) {',
  '    const entry = entries[templateId];',
  '    if (!entry || !Object.hasOwn(entry.values, field)) return null;',
  '    return entry.values[field];',
  '  }',
  '  return Object.freeze({ entries, value });',
  '})();',
  ''
].join('\n');
fs.writeFileSync(outputPath, output, 'utf8');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
  outputPath,
  templates: templates.length,
  fixed: Object.keys(entries).length,
  items: report.items,
  missingRecords: missingRecords.length
}, null, 2));
