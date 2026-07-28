import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(here, 'quality-template-extract.json');
const rawOverlayPath = path.join(here, 'quality-template-raw-extract.json');
const outputPath = path.join(here, '..', 'assets', 'quality-templates.js');
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, ''));
if (fs.existsSync(rawOverlayPath)) {
  const raw = JSON.parse(fs.readFileSync(rawOverlayPath, 'utf8').replace(/^\uFEFF/, ''));
  source.records = source.records.filter(record => record.kind !== '原料').concat(raw.records);
}

function cleanProduct(file, kind) {
  let stem = file.replace(/\.docx?$/i, '').replace(/^\d+/, '').trim();
  const marker = /(?:原料|成品)?检验记(?:录)?/;
  const match = marker.exec(stem);
  if (!match) return stem.replace(/\s+/g, '');
  const base = stem.slice(0, match.index).trim().replace(/[.。]+$/g, '');
  let suffix = stem.slice(match.index + match[0].length).trim();
  suffix = suffix.replace(/\(\d+\)$/g, '').trim();
  suffix = suffix.replace(/[123]$/g, '').trim();
  suffix = suffix.replace(/^[.。\-—_]+/, '').trim();
  return (base + suffix).replace(/\s+/g, '');
}

function methodInfo(record) {
  const text = String(record.method || '').replace(/\s+/g, ' ').trim();
  if (record.item === 'moisture') {
    const n = text.match(/0832\s*第?([一二三四1234]+)法/);
    const methodType = n && /四|4/.test(n[1]) ? 'fourth' : 'dry';
    const summary = n
      ? `照水分测定法（通则0832第${n[1]}法）测定。`
      : (text.match(/烘干法/) ? '照《中国药典》水分测定法（烘干法）测定。' : '照水分测定法测定。');
    return { methodType, method: summary };
  }
  if (record.item === 'extract') {
    const type = (text.match(/(水溶性|醇溶性)浸出物/) || [])[1] || '';
    const mode = (text.match(/(冷浸法|热浸法)/) || [])[1] || '';
    const solvent = (text.match(/用([^。；]{1,20})作溶剂/) || [])[1] || '';
    const details = [type && `${type}浸出物测定法`, mode, solvent && `${solvent}作溶剂`].filter(Boolean);
    return {
      methodType: mode === '热浸法' ? 'hot' : (mode === '冷浸法' ? 'cold' : 'unknown'),
      method: details.length
        ? `照${details[0] || '浸出物测定法'}（通则2201）${mode ? `项下的${mode}` : ''}测定${solvent ? `，用${solvent}作溶剂` : ''}。`
        : '照浸出物测定法（通则2201）测定。'
    };
  }
  if (record.item === 'impurity') {
    return { methodType: 'default', method: '照杂质测定法（通则2301）测定。' };
  }
  return { methodType: 'default', method: '照总灰分测定法（通则2302）测定。' };
}

function legalLimits(record) {
  const standardText = String(record.standard || '').replace(/\s+/g, ' ').trim();
  const legalText = standardText.split(/内控(?:标准)?/)[0];
  const re = /([^，。；;:：]{0,18}?)(不得过|不得超过|不应超过|不得少于|不少于|应不低于)\s*([0-9]+(?:\.[0-9]+)?)\s*[%％]/g;
  const found = [...legalText.matchAll(re)];
  const expected = record.item === 'extract' ? 'ge' : 'le';
  const limits = found.map(match => {
    const phrase = match[2];
    const op = /少于|低于/.test(phrase) ? 'ge' : 'le';
    let variant = match[1]
      .replace(/^.*标准规定[：:]?/, '')
      .replace(/^[，。；;:：\s]+|[，。；;:：\s]+$/g, '');
    if (/^(本品|含量|水分|杂质|总灰分)$/.test(variant)) variant = '';
    return { op, limit: match[3], variant };
  }).filter(limit => limit.op === expected);

  if (limits.length <= 1) return limits.map(limit => ({ ...limit, variant: '' }));
  return limits;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const ch of text) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

const candidates = [];
for (const record of source.records) {
  const kind = /原料检验/.test(record.file) ? '原料'
    : (/成品检验/.test(record.file) ? '成品' : record.kind);
  const product = cleanProduct(record.file, record.kind);
  if (!product) continue;
  const method = methodInfo(record);
  const limits = legalLimits(record);
  for (const limit of limits) {
    const variant = limit.variant;
    const label = `${product}${variant ? `·${variant}` : ''}（${kind}）`;
    const key = [record.item, kind, product, variant].join('|');
    candidates.push({
      id: `q-${record.item}-${fnv1a(key)}`,
      item: record.item,
      product,
      kind,
      variant,
      label,
      standardText: String(record.standard || '').replace(/\s+/g, ' ').trim(),
      limop: limit.op,
      limit: limit.limit,
      method: method.method,
      methodType: method.methodType,
      sourceFile: record.file,
      modified: record.modified || ''
    });
  }
}

const unique = new Map();
for (const item of candidates) {
  const key = [item.item, item.kind, item.product, item.variant].join('|');
  const previous = unique.get(key);
  if (!previous || item.modified > previous.modified) unique.set(key, item);
}

const order = { impurity: 0, moisture: 1, ash: 2, extract: 3 };
const templates = [...unique.values()]
  .sort((a, b) =>
    order[a.item] - order[b.item] ||
    a.product.localeCompare(b.product, 'zh-CN') ||
    a.kind.localeCompare(b.kind, 'zh-CN') ||
    a.variant.localeCompare(b.variant, 'zh-CN')
  )
  .map(({ modified, ...item }) => item);

const counts = Object.fromEntries(
  Object.keys(order).map(item => [item, templates.filter(t => t.item === item).length])
);

const output = [
  '/* Generated by tools/build_quality_templates.mjs from local inspection records. */',
  `const QUALITY_TEMPLATES = ${JSON.stringify(templates)};`,
  `const QUALITY_TEMPLATE_COUNTS = ${JSON.stringify(counts)};`,
  ''
].join('\n');
fs.writeFileSync(outputPath, output, 'utf8');
console.log(JSON.stringify({ outputPath, total: templates.length, counts }, null, 2));
