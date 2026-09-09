import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { matchHplcTables } from './match_hplc_record_tables.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventory = path.join(root, 'output/record-table-inventory');
const fullContexts=JSON.parse(fs.readFileSync(path.join(inventory,'table-section-contexts.json'),'utf8'));
const sources = fs.readdirSync(inventory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
  .map(name => JSON.parse(fs.readFileSync(path.join(inventory, name), 'utf8')));
const files = new Map();
for (const source of sources) {
  const key = `${source.kind}|${source.sourceFile}`;
  if (!files.has(key)) files.set(key, []);
  files.get(key).push(source);
}
function load(file, global) {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', file), 'utf8') + `;this.values=${global}`, sandbox);
  return sandbox.values;
}
function compact(text) { return String(text).replace(/\s+/gu, ''); }
export function classify(table) {
  const text = compact(table.text);
  const context = compact(table.context.join('\n'));
  if (/检验单号|请验部门|报告日期|批准人|检验依据/.test(text)) return null;
  if (table.rows < 2) return null;
  if (/对照品峰面积|对照品浓度/.test(text)) return { project:'assay', role:'reference' };
  if (/样品峰面积|供试品峰面积/.test(text)) return { project:'assay', role:'sample' };
  if (/滴定液浓度/.test(text) && /消耗体积/.test(text) && /空白/.test(text)) return { project:'sulfur', role:'result' };
  if (/杂质重量|杂质含量/.test(text)) return { project:'impurity', role:'result' };
  if (/酸不溶性灰分/.test(text)) return { project:'acid-insoluble-ash', role:'result' };
  if (/总灰分|灰分含量/.test(text)) return { project:'ash', role:'result' };
  if (/浸出物/.test(text) && /称样量|取样量|蒸发皿/.test(text)) return { project:'extract', role:'result' };
  if (/水分|干燥失重/.test(text) && /瓶重|馏出水|水量|称样量/.test(text)) return { project:'moisture', role:'result' };
  if (/显微/.test(context) && /结果|特征|观察/.test(text)) return { project:'microscopy', role:'result' };
  if (/薄层/.test(context) && /结果|斑点|供试品/.test(text)) return { project:'tlc', role:'result' };
  if (/理化|化学鉴别/.test(context) && /结果|现象|反应/.test(text)) return { project:'physicochemical', role:'result' };
  return null;
}
const templates = [
  ...load('quality-templates.js', 'QUALITY_TEMPLATES'),
  ...load('sulfur-dioxide-templates.js', 'SULFUR_DIOXIDE_TEMPLATES'),
  ...load('identification-templates.js', 'IDENTIFICATION_TEMPLATES'),
  ...load('hplc-templates.js', 'HPLC_TEMPLATES').map(item => ({...item,item:'assay'})),
];
const rows = templates.map(template => {
  let matches = files.get(`${template.kind}|${template.sourceFile}`) || [];
  // Some original raw/finished records are stored in the opposite directory.
  // An exact globally unique basename is still an exact source identity.
  if (!matches.length) matches=sources.filter(source=>source.sourceFile === template.sourceFile);
  const base = {templateId:template.id,project:template.item,product:template.product,kind:template.kind,sourceFile:template.sourceFile};
  if (matches.length !== 1) return {...base,status:matches.length ? 'ambiguous-source' : 'source-not-scanned',tables:[]};
  const source=matches[0];
  if (source.status !== 'ok') return {...base,status:'source-error',reason:source.error,tables:[]};
  let tables = source.tables.map(table => ({...table,followingStandard:fullContexts[source.id]?.find(item=>item.index===table.index)?.followingStandard,classification:classify(table)}))
    .filter(table => table.classification?.project === template.item);
  let status=tables.length ? 'candidate-needs-review' : 'no-candidate-table';
  let resolvedName=null;
  if (template.item === 'assay') {
    const result=matchHplcTables(template, templates.filter(item => item.item === 'assay' && item.kind === template.kind && item.sourceFile === template.sourceFile), tables);
    tables=result.tables; status=result.status;resolvedName=result.resolvedName||null;
  }
  return {...base,sourceId:source.id,status,resolvedName,tables:tables.map(table => ({index:table.index,role:table.classification.role,rows:table.rows,embeddedObjects:table.embeddedObjects,text:table.text,context:table.context}))};
});
const counts={};
for (const row of rows) {
  counts[row.project] ??= {templates:0,status:{},candidateTables:0};
  counts[row.project].templates++;
  counts[row.project].status[row.status]=(counts[row.project].status[row.status] || 0)+1;
  counts[row.project].candidateTables+=row.tables.length;
}
fs.writeFileSync(path.join(inventory,'template-map.json'),JSON.stringify({sourceFilesScanned:sources.length,counts,templates:rows},null,2));
console.log(JSON.stringify({sourceFilesScanned:sources.length,counts},null,2));
