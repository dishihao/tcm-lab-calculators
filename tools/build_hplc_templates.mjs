import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(here, 'hplc-template-extract.json');
const outputPath = path.join(here, '..', 'assets', 'hplc-templates.js');
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, ''));

function cleanText(value) {
  return String(value || '')
    .replace(/\u0001/g, 'X̄')
    .replace(/\s+/g, ' ')
    .replace(/(\d)\.\s+(\d)/g, '$1.$2')
    .trim();
}

function cleanRecordLabel(value, kind) {
  return cleanText(value || kind)
    .replace(/([）)])\s*[123]$/, '$1')
    .replace(/^(原料|成品)\s*[123]$/, '$1');
}

function cleanProduct(record) {
  let stem = String(record.file || '').replace(/\.docx?$/i, '').replace(/^[A-Za-z]?\d+/, '').trim();
  const marker = /(?:原料|成品)?(?:质量标准|检(?:验)?记(?:录)?|检记录|检验原始记录)/;
  const match = marker.exec(stem);
  if (match) stem = stem.slice(0, match.index);
  stem = stem.replace(/\s+/g, '').replace(/[.。_\-]+$/g, '');
  return stem || String(record.product || '').trim();
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const ch of text) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function standardStatements(section) {
  const lines = String(section || '').split(/\n+/).map(cleanText).filter(Boolean);
  const found = [];
  let hplcEvidence = false;
  for (const line of lines) {
    if (/高效液相色谱仪|注入液相色谱|液相色谱-质谱联用仪/.test(line)) hplcEvidence = true;
    if (/【浸出物】|挥发油测定器|气相色谱法|紫外分光光度计|滴定管/.test(line)) hplcEvidence = false;
    if (!/(不得少于|不得过|不得超过|应不低于|不少于|不应超过|应为)/.test(line)) continue;
    if (!/(标准规定|本品|每\s*\d+(?:\.\d+)?\s*g\s*含)/.test(line)) continue;
    if (/RSD|理论板数|重复性/.test(line)) continue;
    if (!hplcEvidence) continue;
    let text = line
      .replace(/^.*?(?:\d+\.?\s*)?(?:标准规定)\s*[：:]?\s*/i, '')
      .replace(/^7\.?\s*/, '')
      .trim();
    if (text.length > 600) text = text.slice(0, 600);
    if (text && !found.includes(text)) found.push(text);
  }
  return found;
}

function cleanAnalyteName(value) {
  let name = cleanText(value)
    .replace(/^.*?[，,；;：:]\s*/, '')
    .replace(/^(?:(?:本品|按干燥品计算|以干燥品计算|每\d+(?:\.\d+)?g|含|和|与|及|其中|折合成|以)\s*)+/g, '')
    .replace(/[，,；;：:（(]+$/g, '')
    .trim();
  if (name.length > 40) {
    const pieces = name.split(/[，,；;：:]/);
    name = pieces[pieces.length - 1].trim();
  }
  return name;
}

function formulaPairs(context) {
  const pairs = [];
  const re = /([^。；;：:\n]{1,90}?)\s*[（(]\s*([A-Za-z][A-Za-z0-9\s]*)\s*[）)]/g;
  for (const match of context.matchAll(re)) {
    const name = cleanAnalyteName(match[1]);
    if (!name || /^(通则|内控标准|标准规定)$/.test(name)) continue;
    pairs.push({ name, formulaText: match[2].replace(/\s+/g, '') });
  }
  return pairs;
}

function fallbackAnalyte(section, standard) {
  const table = String(section).match(/(?:数据记录及计算公式|数据记录及计算)[\s\S]{0,180}?\n\s*([^\n：:]{1,50})[：:]?\s*\n\s*对照品批号/);
  if (table) return cleanAnalyteName(table[1]);
  const heading = String(section).match(/^含量测定】?\s*([^\n。]{1,30}?)(?:\s+照高效液相|$)/);
  if (heading) return cleanAnalyteName(heading[1]);
  const simple = standard.match(/(?:每\s*\d+(?:\.\d+)?\s*g\s*)?含\s*([^，,；;。]{1,40}?)(?:不得|应不|不少于)/);
  return simple ? cleanAnalyteName(simple[1]) : '待测成分';
}

function normalizeUnit(rawUnit, standard) {
  const compact = rawUnit.replace(/\s+/g, '').replace('％', '%').replace('／', '/').toLowerCase();
  if (compact === 'mg' && /每\s*\d+(?:\.\d+)?\s*g\s*含/.test(standard)) return 'mg/g';
  if (compact === 'g' && /每\s*\d+(?:\.\d+)?\s*g\s*含/.test(standard)) return 'g/g';
  if (compact === 'ug/g' || compact === 'μg/g') return 'μg/g';
  return compact || '%';
}

function limitsFromStandard(standard, section) {
  const results = [];
  const legal = standard.replace(
    /内控(?:标准)?\s*[：:]?\s*(?:总量)?(?:不得少于|不少于|应不低于|不得过|不得超过|不应超过)\s*[0-9]+(?:\.[0-9]+)?\s*(?:%|％|mg\s*[\/／]\s*g|μg\s*[\/／]\s*g|ug\s*[\/／]\s*g|g\s*[\/／]\s*kg|mg\s*[\/／]\s*kg|mg|g)?/gi,
    ' '
  );
  const limitRe = /(不得少于|不少于|应不低于|不得过|不得超过|不应超过)\s*([0-9]+(?:\.[0-9]+)?)\s*(%|％|mg\s*\/\s*g|mg\s*／\s*g|μg\s*\/\s*g|ug\s*\/\s*g|g\s*\/\s*kg|mg\s*\/\s*kg|mg|g)?/gi;
  const rangeRe = /应为\s*([0-9]+(?:\.[0-9]+)?)\s*(%|％|mg\s*[\/／]\s*g|μg\s*[\/／]\s*g|ug\s*[\/／]\s*g|g\s*[\/／]\s*kg|mg\s*[\/／]\s*kg|mg|g)?\s*[～~\-—至]\s*([0-9]+(?:\.[0-9]+)?)\s*(%|％|mg\s*[\/／]\s*g|μg\s*[\/／]\s*g|ug\s*[\/／]\s*g|g\s*[\/／]\s*kg|mg\s*[\/／]\s*kg|mg|g)?/gi;
  for (const match of legal.matchAll(rangeRe)) {
    const context = legal.slice(0, match.index);
    const pairs = formulaPairs(context);
    const pair = pairs[pairs.length - 1] || { name: fallbackAnalyte(section, legal), formulaText: '' };
    results.push({
      name: pair.name,
      formulaText: pair.formulaText,
      limit: match[1],
      upperLimit: match[3],
      limop: 'range',
      unit: normalizeUnit(match[2] || match[4] || '%', legal),
      totalLabel: '',
      partner: ''
    });
  }
  const matches = [...legal.matchAll(limitRe)];
  let contextStart = 0;
  for (const match of matches) {
    const context = legal.slice(contextStart, match.index);
    let pairs = formulaPairs(context);
    const isTotal = /总量/.test(context);
    if (!pairs.length) {
      pairs = [{ name: fallbackAnalyte(section, legal), formulaText: '' }];
    }
    const phrase = match[1];
    const limop = /少于|低于/.test(phrase) ? 'ge' : 'le';
    const unit = normalizeUnit(match[3] || '%', legal);
    const selectedPairs = isTotal ? pairs.slice(-4) : [pairs[pairs.length - 1]];
    for (const pair of selectedPairs) {
      results.push({
        name: pair.name,
        formulaText: pair.formulaText,
        limit: match[2],
        upperLimit: '',
        limop,
        unit,
        totalLabel: isTotal ? selectedPairs.map(item => item.name).join('与') + '的总量' : '',
        partner: isTotal
          ? selectedPairs.filter(item => item.name !== pair.name).map(item => item.name).join('＋')
          : ''
      });
    }
    contextStart = match.index + match[0].length;
  }
  return results;
}

function platesLimit(section) {
  const text = cleanText(section);
  const match = text.match(/理论板数[\s\S]{0,100}?(?:不低于|不得少于)\s*([0-9]+)/);
  return match ? match[1] : '3000';
}

function rsdLimit(section) {
  const text = cleanText(section);
  const match = text.match(/RSD[\s\S]{0,80}?(?:不大于|不得过)\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? match[1] : '2.0';
}

const candidates = [];
for (const record of source.records) {
  const section = String(record.section || '');
  const standards = standardStatements(section);
  if (!standards.length && (
    /结果判断[\s\S]{0,500}?(?:不得出现|应不得出现|吸收光谱应不同)/.test(section) ||
    /(?:若检出|若出现)[\s\S]{0,300}?高效液相色谱法(?:验证|验正)/.test(section)
  )) {
    continue;
  }
  const analytes = standards.flatMap(standard =>
    limitsFromStandard(standard, section).map(analyte => ({ ...analyte, standardText: standard }))
  );
  if (!analytes.length) {
    analytes.push({
      name: fallbackAnalyte(section, standards.join(' ')),
      formulaText: '',
      limit: '',
      upperLimit: '',
      limop: 'ge',
      unit: '%',
      totalLabel: '',
      partner: '',
      standardText: standards.join(' ') || '原记录未自动识别到标准规定，请核对源文件。'
    });
  }

  const recordKey = `hplc-${fnv1a(`${record.kind}|${record.file}`)}`;
  const product = cleanProduct(record);
  const seen = new Set();
  for (const analyte of analytes) {
    const analyteKey = [analyte.name, analyte.limit, analyte.upperLimit || '', analyte.unit, analyte.totalLabel].join('|');
    if (seen.has(analyteKey)) continue;
    seen.add(analyteKey);
    candidates.push({
      id: `${recordKey}-${fnv1a(`${record.sectionIndex}|${analyteKey}`)}`,
      tech: 'hplc',
      recordKey,
      product,
      recordLabel: cleanRecordLabel(record.recordLabel, record.kind),
      kind: record.kind,
      mode: /内标法/.test(section) ? 'internal' : 'external',
      internalName: '',
      dry: /按干燥品计算|以干燥品计算/.test(analyte.standardText),
      plates: platesLimit(section),
      rsdLimit: rsdLimit(section),
      standardText: analyte.standardText,
      name: analyte.name,
      formulaText: analyte.formulaText,
      limit: analyte.limit,
      upperLimit: analyte.upperLimit || '',
      limop: analyte.limop,
      unit: analyte.unit,
      totalLabel: analyte.totalLabel,
      partner: analyte.partner,
      sourceFile: record.file,
      incomplete: !analyte.limit || analyte.name === '待测成分'
    });
  }
}

const templates = candidates.sort((a, b) =>
  a.product.localeCompare(b.product, 'zh-CN') ||
  a.kind.localeCompare(b.kind, 'zh-CN') ||
  a.recordLabel.localeCompare(b.recordLabel, 'zh-CN') ||
  a.name.localeCompare(b.name, 'zh-CN')
);

const records = new Set(templates.map(template => template.recordKey));
const products = new Set(templates.map(template => template.product));
const counts = {
  templates: templates.length,
  records: records.size,
  products: products.size,
  rawRecords: new Set(templates.filter(t => t.kind === '原料').map(t => t.recordKey)).size,
  finishedRecords: new Set(templates.filter(t => t.kind === '成品').map(t => t.recordKey)).size,
  incomplete: templates.filter(t => t.incomplete).length
};

const output = [
  '/* Generated by tools/build_hplc_templates.mjs from local inspection records. */',
  `const HPLC_TEMPLATES = ${JSON.stringify(templates)};`,
  `const HPLC_TEMPLATE_COUNTS = ${JSON.stringify(counts)};`,
  ''
].join('\n');
fs.writeFileSync(outputPath, output, 'utf8');
console.log(JSON.stringify({ outputPath, ...counts }, null, 2));
