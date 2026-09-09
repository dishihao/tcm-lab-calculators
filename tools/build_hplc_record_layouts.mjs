import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {normalizeRecordTable,safeRecordValue} from './build_quantitative_record_layouts.mjs';
import {buildBindings} from './build_gc_word_layouts.mjs';

const root=path.resolve(import.meta.dirname,'..');
export function bindHplcRecordTable(table,role,template){
  const view=structuredClone(table);let micro=false;
  for(const cell of view.cells){
    const label=String(cell.text||'').replace(/\s+/gu,'');
    if(label==='进样量V样（ul）')cell.text='进样量V样（μl）';
    if(label==='样品量W样（g）')cell.text='取样量W样（g）';
    if(label==='稀释倍数f样')cell.text='样品稀释倍数f样';
    if(label==='平均峰面积A样')cell.text='样品平均峰面积A';
    if(/^平均含量X（[%％]）$/u.test(label))cell.text='平均含量（%）';
    if(label==='含量X（％）')cell.text='含量X（%）';
    if(label==='RSD(％)')cell.text='RSD (%)';
    if(/对照品批号$/u.test(label))cell.text='对照品批号';
    if(/^对照品浓度C对（[uμ]g\/ml）$/u.test(label)){cell.text='对照品浓度C对（mg/ml）';micro=true;}
  }
  const bound=buildBindings(view,role,{templateId:template.id});
  const waterCell=table.cells.find(cell=>String(cell.text).replace(/\s/gu,'')==='水分Q');
  if(waterCell&&role==='sample'){
    const targets=table.cells.filter(cell=>cell.row===waterCell.row&&cell.column>waterCell.column&&!cell.isGridGap&&!cell.text.trim());
    if(targets.length===2){
      bound.unresolved=bound.unresolved.filter(issue=>!(issue.type==='binding-cardinality'&&issue.cellId===waterCell.id));
      targets.forEach((cell,i)=>bound.bindings.push({cellId:cell.id,role:'input',field:`assay.Q.${i+1}`,inputMode:'decimal',sourceLabel:waterCell.text}));
      bound.unmappedBlankCells=bound.unmappedBlankCells.filter(cell=>!targets.some(target=>target.id===cell.cellId));
      table.waterPerSample=true;
    }
  }
  const curveCell=table.cells.find(cell=>String(cell.text).replace(/\s/gu,'')==='通过方程读取样品浓度C样（mg/ml）');
  if(curveCell&&role==='sample'){
    const targets=table.cells.filter(cell=>cell.row===curveCell.row&&cell.column>curveCell.column&&!cell.isGridGap&&!cell.text.trim());
    if(targets.length===2){
      bound.unresolved=bound.unresolved.filter(issue=>!(issue.type==='unsupported-label'&&issue.cellId===curveCell.id));
      targets.forEach((cell,i)=>bound.bindings.push({cellId:cell.id,role:'input',field:`assay.Csample.${i+1}`,inputMode:'decimal',sourceLabel:curveCell.text}));
      bound.unmappedBlankCells=bound.unmappedBlankCells.filter(cell=>!targets.some(target=>target.id===cell.cellId));
      table.quantification='curve-readback';
    }
  }
  const header=table.cells.find(cell=>cell.row===0&&cell.column===0&&String(cell.text).replace(/\s/gu,'')==='样品编号');
  if(header&&role==='sample'){
    const blanks=bound.unmappedBlankCells.filter(cell=>cell.row===0).sort((a,b)=>a.column-b.column);
    if(blanks.length===2){
      blanks.forEach((cell,i)=>bound.bindings.push({cellId:cell.cellId,role:'input',field:`assay.sampleNo.${i+1}`,inputMode:'text',sourceLabel:'样品编号'}));
      bound.unmappedBlankCells=bound.unmappedBlankCells.filter(cell=>cell.row!==0);
    }
  }
  if(micro){
    for(const binding of bound.bindings)if(binding.field==='assay.Cref')binding.field='assay.CrefMicro';
    table.referenceConcentrationField='assay.CrefMicro';table.referenceConcentrationScale=0.001;
  }
  return bound;
}
function bindCurveReference(table){
  const bindings=[],unresolved=[...(table.unresolved||[])];
  const used=new Set();
  const scalar={'对照品批号':['refBatch','text'],'纯度S':['refPurity','decimal'],'对照品来源':['refSource','text'],'干燥条件':['refDrying','text'],'对照品浓度C对（mg/ml）':['Cref','decimal'],'标准曲线方程':['curveEquation','text'],'相关系数（R）':['curveCorrelation','decimal'],'RSD(％)':['curveRsd','decimal']};
  const labels=table.cells.filter(cell=>!cell.isGridGap&&cell.text.trim());
  for(const label of labels){
    const key=label.text.replace(/\s/gu,'');
    const next=labels.filter(c=>c.row===label.row&&c.column>label.column).sort((a,b)=>a.column-b.column)[0];
    let targets=table.cells.filter(c=>!c.isGridGap&&!c.text.trim()&&c.row===label.row&&c.column>=label.column+label.colSpan&&c.column<(next?.column??table.columnCount)).sort((a,b)=>a.column-b.column);
    const put=(c,role,field,inputMode='decimal')=>{used.add(c.id);bindings.push({cellId:c.id,role,field:'assay.'+field,inputMode,sourceLabel:label.text});};
    if(scalar[key]){if(targets.length!==1)unresolved.push({type:'curve-scalar-cardinality',label:key});else put(targets[0],'input',...scalar[key]);}
    else if(key==='对照品溶液体积（ul）'||key==='平均峰面积'){
      if(targets.length!==2)unresolved.push({type:'curve-level-cardinality',label:key});
      else targets.forEach((c,i)=>put(c,key==='平均峰面积'?'output':'input',key==='平均峰面积'?`out.curveA.${i+1}`:`curveVolume.${i+1}`));
    }else if(key==='对照品峰面积'){
      const end=labels.find(c=>c.text.replace(/\s/gu,'')==='平均峰面积')?.row;
      if(end===undefined){unresolved.push({type:'curve-repeat-boundary'});continue;}
      targets=table.cells.filter(c=>!c.isGridGap&&!c.fixedDrawing&&!c.text.trim()&&c.row>=label.row&&c.row<end&&c.column>=label.column+label.colSpan);
      const columns=[...new Set(targets.map(c=>c.column))].sort((a,b)=>a-b);
      if(columns.length<1||columns.length>2)unresolved.push({type:'curve-repeat-levels'});
      else columns.forEach((column,i)=>targets.filter(c=>c.column===column).sort((a,b)=>a.row-b.row).forEach((c,j)=>put(c,'input',`curveA.${i+1}.${j}`)));
    }else unresolved.push({type:'curve-unsupported-label',label:key});
  }
  return {bindings,unresolved,unmappedBlankCells:table.cells.filter(c=>!c.isGridGap&&!c.fixedDrawing&&!c.text.trim()&&!used.has(c.id)).map(c=>({cellId:c.id}))};
}
export function buildHplcRecordLayouts(){
  const dir=path.join(root,'output/record-table-inventory');
  const mapping=JSON.parse(fs.readFileSync(path.join(dir,'template-map.json'),'utf8'));
  const sandbox={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/hplc-templates.js'),'utf8')+';this.templates=HPLC_TEMPLATES',sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/gc-word-table-renderer.js'),'utf8'),sandbox);
  const meta=new Map(sandbox.templates.map(t=>[t.id,t]));
  const asset={version:1,templates:{},tables:{}};
  const audit=[],cache=new Map(),models=new Map();
  for(const match of mapping.templates.filter(t=>t.project==='assay')){
    const row={templateId:match.templateId,sourceId:match.sourceId,status:'needs-review',reason:match.status};audit.push(row);
    try {
      if(match.status!=='candidate-pair-needs-review')continue;
      const template=meta.get(match.templateId);
      if(template.mode!=='external'){row.reason='internal-method-requires-specific-mapping';continue;}
      if(!cache.has(match.sourceId))cache.set(match.sourceId,JSON.parse(fs.readFileSync(path.join(dir,'parsed',match.sourceId+'.json'),'utf8').replace(/^\uFEFF/u,'')));
      const parsed=cache.get(match.sourceId);const tables=[],bindings=[];const issues=[];
      for(const pair of match.tables){
        const raw=parsed.tables.find(t=>t.sourceTableIndex===pair.index);
        const table=normalizeRecordTable(raw,{templateId:template.id,tableRole:pair.role});
        table.indentPt ??= 0;
        const curve=pair.role==='reference'&&table.cells.some(cell=>cell.text.replace(/\s/gu,'')==='标准曲线方程');
        const bound=curve?bindCurveReference(table):bindHplcRecordTable(table,pair.role,template);
        issues.push(...bound.unresolved,...bound.unmappedBlankCells.map(c=>({type:'unbound-cell',cell:c.cellId})));
        table.bindings=bound.bindings;bindings.push(...bound.bindings);
        if(!issues.length)sandbox.window.GcWordTableRenderer.render(table,{input:()=>'',output:()=>''});
        tables.push(table);
      }
      const water=bindings.some(b=>/^assay\.Q(?:\.[12])?$/u.test(b.field));
      if(water!==!!template.dry){
        const source=JSON.parse(fs.readFileSync(path.join(dir,match.sourceId+'.json'),'utf8'));
        const sampleIndex=match.tables.find(t=>t.role==='sample')?.index;
        const formula=source.tables.find(t=>t.index===sampleIndex+1&&t.rows<=2)?.text.replace(/\s/gu,'')||'';
        if(water&&!template.dry&&/1[－−-](?:Q|水分)/u.test(formula))row.verifiedDryBasis=true;
        else issues.push({type:'source-water-standard-mismatch'});
      }
      for(const field of [tables[0]?.referenceConcentrationField||'assay.Cref',tables[1]?.quantification==='curve-readback'?'assay.Csample.1':'assay.refA.0','assay.Ws.1','assay.Ws.2','assay.f.1','assay.f.2','assay.smpA.1.0','assay.smpA.2.0','assay.out.MEAN']){
        if(!bindings.some(b=>b.field===field))issues.push({type:'missing-calculation-field',field});
      }
      if(issues.length){row.reason='source-binding-review';row.issues=issues;continue;}
      row.tableKeys=tables.map(table=>{
        const safe=safeRecordValue(table);delete safe.templateId;delete safe.unresolved;
        const key=JSON.stringify(safe);
        if(!models.has(key)){const id=`table${models.size+1}`;models.set(key,id);asset.tables[id]=safe;}
        return models.get(key);
      });
      row.status='mapped';delete row.reason;
    }catch(error){row.reason=error.message;}
    finally {asset.templates[match.templateId]={status:row.status,...(match.resolvedName?{resolvedName:match.resolvedName}:{}),...(row.status==='mapped'&&row.verifiedDryBasis!==undefined?{verifiedDryBasis:row.verifiedDryBasis}:{}),...(row.tableKeys?{tableKeys:row.tableKeys}:{})};}
  }
  const counts={};for(const row of audit)counts[row.status]=(counts[row.status]||0)+1;
  fs.writeFileSync(path.join(dir,'hplc-binding-audit.json'),JSON.stringify({counts,templates:audit},null,2));
  fs.writeFileSync(path.join(root,'assets/hplc-record-layouts.js'),'/* Source record table layouts; private audit retained locally. */\nwindow.HPLC_RECORD_LAYOUTS='+JSON.stringify(asset)+';\n'
    +'for(const template of HPLC_TEMPLATES){const entry=window.HPLC_RECORD_LAYOUTS.templates[template.id];if(entry?.resolvedName&&entry.resolvedName!==template.name){template.originalName=template.name;template.name=entry.resolvedName;}if(entry?.verifiedDryBasis!==undefined){template.originalDry=template.dry;template.dry=entry.verifiedDryBasis;}}\n');
  return {counts,tables:models.size};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildHplcRecordLayouts(),null,2));
