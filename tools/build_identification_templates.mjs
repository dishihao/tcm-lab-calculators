import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(here, 'identification-template-extract.json');
const outputPath = path.join(here, '..', 'assets', 'identification-templates.js');
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, ''));

const itemOrder = { microscopy:0, tlc:1, physicochemical:2 };

function cleanProduct(file) {
  let stem = file.replace(/\.docx?$/i, '').replace(/^[a-z]?\d+\s*/i, '').trim();
  stem = stem.replace(/要加补充检验.*$/, '').trim();
  const leadingRegion = stem.match(/^([（(][^）)]+[）)])\s*\d+\s*(.+)$/);
  if (leadingRegion) stem = `${leadingRegion[2]}${leadingRegion[1]}`;
  const marker = /(?:原料|成品)?(?:质量标准|检验(?:原始)?记(?:录)?|检验)/;
  const match = marker.exec(stem);
  if (!match) return stem.replace(/\s+/g, '');
  const base = stem.slice(0, match.index).trim().replace(/[.。]+$/g, '');
  let suffix = stem.slice(match.index + match[0].length).trim();
  suffix = suffix.replace(/\(\d+\)$/g, '').trim();
  suffix = suffix.replace(/[123]$/g, '').trim();
  suffix = suffix.replace(/^[.。\-—_]+/, '').trim();
  suffix = suffix.replace(/\.?docx?$/i, '').trim();
  if (suffix && !/^[（(]/.test(suffix)) suffix = `（${suffix}）`;
  return (base + suffix).replace(/\s+/g, '');
}

function baseProductOf(product) {
  let base = product;
  while (/(?:（[^（）]+）|\([^()]+\))$/.test(base)) {
    base = base.replace(/(?:（[^（）]+）|\([^()]+\))$/, '');
  }
  return base || product;
}

function isMajorHeading(line) {
  return /【(?:性状|检查|含量测定|浸出物)】/.test(line) ||
    /^(?:【?(?:性状|检查|含量测定|浸出物|杂质|水分|总灰分|酸不溶性灰分|二氧化硫残留量)】?)(?:\s|$|（|\(|\d+[.、])/.test(line);
}

function normalizeBlocks(blocks) {
  const normalized = (Array.isArray(blocks) ? blocks : (blocks ? [blocks] : []))
    .map(block => {
      const lines = [...new Set((Array.isArray(block.lines) ? block.lines : (block.lines ? [block.lines] : []))
        .map(line => String(line || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean))];
      const stopIndex = lines.findIndex(isMajorHeading);
      const resultIndex = lines.findIndex(line => /^结果[：:].*符合规定/.test(line));
      const endIndex = Math.min(
        stopIndex >= 0 ? stopIndex : lines.length,
        resultIndex >= 0 ? resultIndex + 1 : lines.length
      );
      return {
        title: String(block.title || '').replace(/\s+/g, ' ').trim(),
        lines: lines.slice(0, endIndex)
      };
    })
    .filter(block => block.lines.length);
  const merged = [];
  for (const block of normalized) {
    if (merged.length && /(?:实验方法及结果.*)?照薄层色谱法/.test(block.title)) {
      const previous = merged[merged.length - 1];
      previous.lines = [...new Set([...previous.lines, block.title, ...block.lines])];
    } else {
      merged.push(block);
    }
  }
  return merged;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

const candidates = [];
for (const record of source.records || []) {
  if (!(record.item in itemOrder)) continue;
  const kind = /原料检验/.test(record.file) ? '原料'
    : (/成品检验|成品质量标准/.test(record.file) ? '成品' : record.kind);
  if (!['原料', '成品'].includes(kind)) continue;
  const product = cleanProduct(record.file);
  const blocks = normalizeBlocks(record.blocks);
  if (!product || !blocks.length) continue;
  const baseProduct = baseProductOf(product);
  const variant = product.slice(baseProduct.length);
  const key = [record.item, kind, product].join('|');
  candidates.push({
    id: `id-${record.item}-${fnv1a(key)}`,
    item: record.item,
    recordKey: `${kind}|${record.file}`,
    product,
    baseProduct,
    kind,
    variant,
    label: `${product}（${kind}）`,
    blocks,
    sourceFile: record.file,
    modified: record.modified || ''
  });
}

const unique = new Map();
for (const candidate of candidates) {
  const key = [candidate.item, candidate.kind, candidate.product].join('|');
  const previous = unique.get(key);
  if (!previous || candidate.modified > previous.modified) unique.set(key, candidate);
}

const templates = [...unique.values()]
  .sort((a, b) =>
    itemOrder[a.item] - itemOrder[b.item] ||
    a.baseProduct.localeCompare(b.baseProduct, 'zh-CN') ||
    (a.kind === b.kind ? a.product.localeCompare(b.product, 'zh-CN') : (a.kind === '原料' ? -1 : 1))
  )
  .map(({ modified, ...template }) => template);

const counts = {};
for (const item of Object.keys(itemOrder)) {
  const rows = templates.filter(template => template.item === item);
  counts[item] = {
    raw: rows.filter(template => template.kind === '原料').length,
    finished: rows.filter(template => template.kind === '成品').length,
    total: rows.length,
    products: new Set(rows.map(template => template.baseProduct)).size
  };
}

const ids = templates.map(template => template.id);
if (new Set(ids).size !== ids.length) throw new Error('鉴别模板 ID 不唯一');
for (const template of templates) {
  if (!template.blocks.length || template.blocks.some(block => !block.lines.length)) {
    throw new Error(`鉴别模板正文为空：${template.sourceFile}/${template.item}`);
  }
}

const output = [
  '/* Generated by tools/build_identification_templates.mjs from local inspection records. */',
  `const IDENTIFICATION_TEMPLATES = ${JSON.stringify(templates)};`,
  `const IDENTIFICATION_TEMPLATE_COUNTS = ${JSON.stringify(counts)};`,
  ''
].join('\n');
fs.writeFileSync(outputPath, output, 'utf8');
console.log(JSON.stringify({
  outputPath,
  total: templates.length,
  counts,
  sourceAmbiguous: (source.ambiguous || []).length,
  sourceErrors: (source.errors || []).length
}, null, 2));
