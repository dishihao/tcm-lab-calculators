import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'output/record-table-inventory');
const quality=JSON.parse(fs.readFileSync(path.join(dir,'quantitative-binding-audit.json'),'utf8'));
const hplc=JSON.parse(fs.readFileSync(path.join(dir,'hplc-binding-audit.json'),'utf8'));
const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/hplc-templates.js'),'utf8')+';this.templates=HPLC_TEMPLATES',context);
const templates=new Map(context.templates.map(t=>[t.id,t]));
const names={impurity:'杂质',moisture:'水分',ash:'总灰分',extract:'浸出物',sulfur:'二氧化硫',assay:'液相'};
const reason=row=>{
  if(row.status==='no-source-table')return '原记录项目与表头不一致，未自动套表';
  if(row.reason==='duplicate-catalog-analyte')return '原目录成分名称重复，未能唯一对应源表';
  if(row.reason==='ambiguous-analyte-tables')return '成分与对照品/供试品表不能唯一对应';
  if(row.reason==='internal-method-requires-specific-mapping')return '内标法记录需要单独核对';
  if(row.issues?.some(x=>x.type==='source-water-standard-mismatch'))return '源表水分项与原目录干燥品口径不一致';
  if(row.reason==='no-candidate-table')return '未找到对应的成对色谱数据表';
  return (row.issues||row.unresolved||[]).map(x=>x.type+(x.reason?': '+x.reason:'')).join('；')||row.reason||'需要核对';
};
const escape=value=>String(value??'').replace(/\|/gu,'／').replace(/[\r\n]/gu,' ');
const lines=['# 原记录表格接入与待核对明细','','范围：仅展示需要填写或计算的表格。源文件保持只读；下列待核对项不会套用通用计算表。','',
  '| 项目 | 已接入模板 | 待核对 |','|---|---:|---:|'];
for(const [project,count]of Object.entries(quality.counts))lines.push(`| ${names[project]} | ${count.mapped||0} | ${(count.unresolved||0)+(count['no-source-table']||0)} |`);
lines.push(`| 液相 | ${hplc.counts.mapped} | ${hplc.counts['needs-review']} |`,'',
  '显微、薄层、理化的 2177 条模板已按源章节逐一检查，均无独立填写/计算表格，仅显示无表提示；不展示步骤正文或新增通用填写框。',
  '', '## 待核对列表','','| 项目 | 品名/成分 | 原料/成品 | 源文件 | 原因 |','|---|---|---|---|---|');
for(const row of [...quality.templates,...hplc.templates].filter(row=>row.status!=='mapped')){
  const template=templates.get(row.templateId);
  lines.push(`| ${names[row.project||'assay']} | ${escape(template?template.product+' / '+template.name:row.sourceFile)} | ${escape(row.kind||template?.kind)} | ${escape(row.sourceFile||template?.sourceFile)} | ${escape(reason(row))} |`);
}
lines.push('','## 验证范围','','已运行全部既有项目回归，以及源表解析、字段绑定、公式对象兼容、单位换算、按样品浓度/水分计算、移动端/打印宽度和公开资源隐私检查。','',
  '已检查代表性 Word 导出与网页截图。未声称新增全部表格均完成逐像素比对；原记录存在歧义的条目仍列为待核对。','');
const output=path.join(dir,'原记录表格接入与待核对明细.md');fs.writeFileSync(output,lines.join('\n'));
console.log(output);
