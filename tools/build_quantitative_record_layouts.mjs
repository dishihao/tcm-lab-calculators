import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { normalizeWordTable, normalizeOfficeMath } from './build_gc_word_layouts.mjs';

const root=path.resolve(import.meta.dirname,'..');
const registry=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'gc-word-embedded-object-semantics.json'),'utf8'));
const approved=new Map(registry.entries.map(x=>[x.sourceDigest,x]));
const payloadRegistry=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'reviewed-record-object-payloads.json'),'utf8'));
const compact=x=>String(x??'').replace(/\s+/gu,'');
// Authenticated exact OLE + preview payload set: seen in the existing reviewed
// GC sampleMean object b01ca5a3... . A placement/size difference is not a new
// equation. Both bytes must match; never identify an equation from its label.
const meanPayloads=['5235d99895010a5b4b5f7e2e21ab7b3cae2dfb94c68424b42eabca7a38e8166c','9aa619e3e7490b7761d4a612afaa22f01ef1713330597bc2a5bd0747cb8fde59'];
export function sourceObjectSemantic(run){
  const exact=approved.get(run.sourceDigest);
  if(exact) return {type:exact.semanticType,ast:structuredClone(registry.semanticAsts[exact.semanticType])};
  const payloadMatch=payloadRegistry.entries.find(entry=>entry.containerCategory===run.containerCategory
    && JSON.stringify(entry.payloadDigests)===JSON.stringify([...(run.payloadDigests||[])].sort()));
  if(payloadMatch)return {type:payloadMatch.semanticType,ast:structuredClone(registry.semanticAsts[payloadMatch.semanticType])};
  if(JSON.stringify([...(run.payloadDigests||[])].sort())===JSON.stringify(meanPayloads)) return {type:'sampleMean',ast:structuredClone(registry.semanticAsts.sampleMean)};
  return null;
}
export function isSourceAverageLine(cell,run){
  if(run.containerCategory!=='floating-overline'||!/^(?:样品)?平均峰面积A(?:样)?$/u.test(compact(cell.text)))return false;
  const lines=[...String(cell.ooxml||'').matchAll(/<v:line\b[^>]*(?:\/>|>[\s\S]*?<\/v:line>)/gu)];
  if(lines.length!==1)return false;
  const from=lines[0][0].match(/\bfrom="([\d.-]+)pt,([\d.-]+)pt"/u);
  const to=lines[0][0].match(/\bto="([\d.-]+)pt,([\d.-]+)pt"/u);
  if(!from||!to)return false;
  const width=Number(to[1])-Number(from[1]),height=Math.abs(Number(to[2])-Number(from[2]));
  return width>=3&&width<=15&&height<=0.15&&!/stroked="f"|opacity:0|(?:end|start)arrow="(?!none)|<v:textbox|<v:imagedata/u.test(lines[0][0]);
}
function sourceDrawingLine(cell,run){
  if(run.containerCategory!=='floating-overline'||compact(cell.text))return null;
  const lines=[...String(cell.ooxml||'').matchAll(/<v:line\b[^>]*(?:\/>|>[\s\S]*?<\/v:line>)/gu)];
  if(lines.length!==1)return null;
  const xml=lines[0][0],from=xml.match(/\bfrom="([\d.-]+)pt,([\d.-]+)pt"/u),to=xml.match(/\bto="([\d.-]+)pt,([\d.-]+)pt"/u);
  if(!from||!to||/stroked="f"|(?:end|start)arrow="(?!none)|<v:textbox|<v:imagedata|strokecolor/u.test(xml))return null;
  const values=[...from.slice(1),...to.slice(1)].map(Number);
  if(!values.every(value=>Number.isFinite(value)&&Math.abs(value)<2000))return null;
  return {kind:'line',x1:values[0],y1:values[1],x2:values[2],y2:values[3],weight:Number(xml.match(/strokeweight="([\d.]+)pt"/u)?.[1]||0.75)};
}
const safeKeys=new Set(['ooxml','mathOoxml','wordOpenXml','sourceOoxmlHash','sourceTableIndex','sourcePath','sourceFile','sourceDigest','sourceIdentity','payloadDigests','objectIdentity','sourceCellId']);
export function safeRecordValue(value){
  if(Array.isArray(value))return value.map(safeRecordValue);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([k,v])=>!safeKeys.has(k)&&v!==null&&v!==undefined).map(([k,v])=>[k,safeRecordValue(v)]));
}
export function normalizeRecordTable(raw,context={}){
  if(raw.status && raw.status!=='ok') throw new Error(raw.reason||'source parse unresolved');
  const clean=structuredClone(raw), objects=[];
  for(const cell of clean.cells){
    if(cell.margins) cell.margins=Object.fromEntries(Object.entries(cell.margins).filter(([,v])=>v!=null).map(([k,v])=>[k,typeof v==='number'?v:v.valuePt]));
    for(const [pi,p] of (cell.paragraphs||[]).entries()) for(const [ri,r] of (p.runs||[]).entries())if(r.kind==='sourceObject') objects.push({cell,pi,ri,run:r});
  }
  const table=normalizeWordTable(clean,context);
  // normalizeWordTable excludes raw objects; rebuild source run sequence here
  // in its original order and fail closed for every unrecognized object.
  for(const cell of clean.cells){
    if(cell.verticalMerge==='continue')continue;
    const target=table.cells.find(c=>c.row===cell.rowIndex-1&&c.column===cell.gridColumnIndex-1);
    if(!target)continue;
    for(const [pi,p] of (cell.paragraphs||[]).entries()){
      const runs=[];
      let floatingAverage=false;
      for(const r of p.runs||[]){
        if(r.kind==='sourceObject'){
          const semantic=sourceObjectSemantic(r)||(isSourceAverageLine(cell,r)?{type:'externalSampleAverage',ast:structuredClone(registry.semanticAsts.externalSampleAverage)}:null);
          if(!semantic){
            const line=sourceDrawingLine(cell,r);
            if(line){runs.push(line);target.fixedDrawing=true;continue;}
            table.unresolved.push({type:'unknown-source-object',cellId:target.id,digest:r.sourceDigest});continue;
          }
          if(semantic.type==='externalSampleAverage'){
            floatingAverage=true;continue;
          }
          runs.push({kind:'math',math:semantic.ast,properties:safeRecordValue(r.properties)});
        } else if(r.kind==='math') {
          const math=normalizeOfficeMath(r.mathOoxml);
          runs.push({kind:'math',math:math.ast});
        } else runs.push({kind:'text',text:r.text||'',properties:safeRecordValue(r.properties)});
      }
      if(floatingAverage){
        const at=runs.findIndex(run=>run.kind==='text'&&/A\s*$/u.test(run.text));
        if(at<0)table.unresolved.push({type:'floating-overline-target-missing',cellId:target.id});
        else {const original=runs[at];const index=original.text.lastIndexOf('A');runs.splice(at,1,
          {...original,text:original.text.slice(0,index)},
          {kind:'math',math:structuredClone(registry.semanticAsts.externalSampleAverage)},
          {...original,text:original.text.slice(index+1)});}
      }
      target.paragraphs[pi].runs=runs;
    }
  }
  // Retain table-level borders for cells that inherit them in the source.
  for(const cell of table.cells){
    if(cell.isGridGap)continue;
    const borders=table.tableProperties?.borders;
    if(borders){cell.borders||={};for(const side of ['top','bottom','left','right']){
      const outer=side==='top'?cell.row===0:side==='bottom'?cell.row+cell.rowSpan===table.rowCount:side==='left'?cell.column===0:cell.column+cell.colSpan===table.columnCount;
      cell.borders[side]??=borders[outer?side:['top','bottom'].includes(side)?'insideHorizontal':'insideVertical']||borders[outer?side:['top','bottom'].includes(side)?'insideH':'insideV'];
    }}
  }
  return table;
}

export function classifyQuantitative(table){
  const t=compact(table.text),ctx=(table.context||[]).map(compact);
  if(/检验单号|请验部门|检验依据|报告日期/.test(t))return null;
  // Heading context is decisive for copied acid-insoluble table labels.
  const headingText=[...ctx].reverse().find(x=>/^(?:【检查】)?(?:[\d.]+)?(?:酸不溶性灰分|总灰分|灰分|水分|干燥失重|二氧化硫残留量|含量测定)[：:]?$/.test(x)
    || /测定法[：:]?照(?:酸不溶性灰分|总灰分)/.test(x));
  const heading=table.sectionHeading || headingText?.match(/测定法[：:]?照(酸不溶性灰分|总灰分)/)?.[1] || headingText;
  if(/酸不溶性灰分/.test(t) || (/酸不溶性灰分/.test(heading||'')&&/坩埚/.test(t)))return null;
  if(/杂质重量|杂质含量/.test(t))return 'impurity';
  if(/(?:总灰分|灰分)[xX（(]/.test(t)&&/坩埚/.test(t))return 'ash';
  if(/浸出物/.test(t)&&/蒸发皿/.test(t))return 'extract';
  if(/(?:水分|干燥失重)[xX（(]/.test(t)&&/瓶重|称样量|水量/.test(t))return 'moisture';
  const latestMethod=[...ctx].reverse().find(line=>/测定法/.test(line))||'';
  if(/滴定液浓度/.test(t)&&/消耗体积/.test(t)&&(!table.sectionHeading||table.sectionHeading==='二氧化硫残留量'||/二氧化硫|2331/.test(latestMethod))&&(/mg\/kg/i.test(t)||ctx.some(x=>/^二氧化硫残留量$/.test(x))))return 'sulfur';
  return null;
}

export function bindQuantitative(table,project){
  const bindings=[],unresolved=[], labels=table.cells.filter(c=>c.column===0&&!c.isGridGap).sort((a,b)=>a.row-b.row);
  const labelCounts=new Map();
  for(const c of labels){const t=compact(c.text);const family=/^(?:瓶重|坩埚重|蒸发皿)W0/.test(t)?'W0':/^(?:瓶\+样|坩埚\+残渣重)W1/.test(t)?'W1':null;if(family)labelCounts.set(family,(labelCounts.get(family)||0)+1);}
  const seen={};
  function bind(cell,role,field){if(!cell || cell.isGridGap || compact(cell.text)==='/')return; if(compact(cell.text)){unresolved.push({type:'nonempty-source-value',cellId:cell.id,text:cell.text});return;}bindings.push({cellId:cell.id,role,field:`${project}.${role==='output'?'out.':''}${field}`,inputMode:'decimal'});}
  for(const label of labels){
    const text=compact(label.text), values=table.cells.filter(c=>c.row===label.row&&c.column>0&&!c.isGridGap);
    if(/^(样品编号|NO\.|样品)$/.test(text))continue;
    let key=null, role='input',single=false;
    if(/^相对偏差/.test(text)){key='RD';role='output';single=true;}
    else if(/^(杂质平均|平均值|平均含量)/.test(text)){key='MEAN';role='output';single=true;}
    else if(/^(杂质含量|水分[xX]|干燥失重[xX]|总灰分[xX]|灰分[xX]|浸出物[xX]|含量X)/.test(text)){key='X';role='output';}
    else if(/^样品重量/.test(text))key='M';
    else if(/^杂质重量/.test(text))key='M1';
    else if(/^称样量|^样重/.test(text))key='Ws';
    else if(/^(?:瓶重|坩埚重|蒸发皿)W0/.test(text)){seen.W0=(seen.W0||0)+1;key=labelCounts.get('W0')===1?'W0b':seen.W0===1?'W0a':'W0b';}
    else if(/^(?:瓶\+样|坩埚\+残渣重)W1/.test(text)){seen.W1=(seen.W1||0)+1;key=labelCounts.get('W1')===1?'W1b':seen.W1===1?'W1a':'W1b';}
    else if(/^蒸发皿\+残渣W1/.test(text))key='W1';
    else if(/^水分Q?\(由水分项目得\)/.test(text)){key='Q';single=values.length===1;}
    else if(/^溶剂体积V/.test(text))key='V';
    else if(/^取滤液体积V/.test(text))key='Vs';
    else if(/^馏出水量|^水量/.test(text))key='Vwater';
    else if(/^定量称重|^称重补重|^称重定量/.test(text))key=`record.${label.id}`;
    else if(project==='sulfur'&&/^滴定液浓度/.test(text))key='C';
    else if(project==='sulfur'&&/^消耗体积/.test(text))key='Vsample';
    else if(project==='sulfur'&&/^滴定管校正值/.test(text))key='VsampleCorr';
    else if(project==='sulfur'&&/^校正后体积/.test(text)){key='Vprime';role='output';}
    if(!key){unresolved.push({type:'unmapped-source-label',cellId:label.id,text:label.text});continue;}
    const actual=values.filter(c=>compact(c.text)!=='/');
    if(single){if(actual.length!==1)unresolved.push({type:'single-field-cardinality',cellId:label.id,count:actual.length});else bind(actual[0],role,key);}
    else if(project==='sulfur'&&['Vsample','VsampleCorr','Vprime'].includes(key)){
      if(actual.length!==3)unresolved.push({type:'sulfur-blank-sample-cardinality',cellId:label.id,count:actual.length});
      else {bind(actual[0],role,{Vsample:'Vblank',VsampleCorr:'VblankCorr',Vprime:'VblankPrime'}[key]);actual.slice(1).forEach((c,i)=>bind(c,role,`${key}.${i+1}`));}
    } else {
      if(actual.length!==2)unresolved.push({type:'sample-cardinality',cellId:label.id,count:actual.length});
      else actual.forEach((c,i)=>bind(c,role,`${key}.${i+1}`));
    }
  }
  for(const family of ['W0','W1'])if((labelCounts.get(family)||0)>2)unresolved.push({type:'unsupported-weighing-count',family,count:labelCounts.get(family)});
  const required={impurity:['M.1','M1.1'],moisture:['Ws.1',labelCounts.has('W0')?'W0b.1':'Vwater.1'],ash:['Ws.1','W0b.1','W1b.1'],extract:['Ws.1','W0b.1','W1.1','V.1','Vs.1'],sulfur:['C.1','Ws.1','Vsample.1','Vblank']}[project]||[];
  for(const k of required)if(!bindings.some(b=>b.field===`${project}.${k}`))unresolved.push({type:'required-calculation-field-missing',field:k});
  return {bindings,unresolved};
}

export function bindInlineSourceBlanks(table,project){
  for(const cell of table.cells.filter(cell=>cell.column===0&&!cell.isGridGap)){
    for(const [paragraphIndex,paragraph] of cell.paragraphs.entries()){
      const text=paragraph.runs.map(run=>run.kind==='text'?run.text:'\uFFFC').join('');
      const matches=[...text.matchAll(/[ \u3000_]+(?=℃|小时)/gu)];
      for(const [number,match] of [...matches.entries()].reverse()){
        const start=match.index,end=start+match[0].length;let offset=0,inserted=false;const runs=[];
        for(const run of paragraph.runs){
          const length=run.kind==='text'?run.text.length:1,runStart=offset;offset+=length;
          if(run.kind!=='text'||offset<=start||runStart>=end){runs.push(run);continue;}
          const before=run.text.slice(0,Math.max(0,start-runStart));
          const after=run.text.slice(Math.max(0,end-runStart));
          if(before)runs.push({...run,text:before});
          if(!inserted){runs.push({kind:'input',field:`${project}.record.${cell.id}.p${paragraphIndex}.${number}`,
            label:text.slice(end).startsWith('℃')?'温度（℃）':'时间（小时）',widthPt:Math.min(40,Math.max(18,match[0].length*3)),properties:run.properties});inserted=true;}
          if(after)runs.push({...run,text:after});
        }
        paragraph.runs=runs;
      }
    }
  }
}

function loadTemplates(file,name){const s={};vm.runInNewContext(fs.readFileSync(path.join(root,'assets',file),'utf8')+`;this.values=${name}`,s);return s.values;}
export function buildQuantitativeAsset(inventory=path.join(root,'output/record-table-inventory')){
  const sources=fs.readdirSync(inventory).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(inventory,f),'utf8')));
  const templates=[...loadTemplates('quality-templates.js','QUALITY_TEMPLATES'),...loadTemplates('sulfur-dioxide-templates.js','SULFUR_DIOXIDE_TEMPLATES')];
  const byKey=new Map(),byName=new Map();for(const s of sources){for(const [map,key] of [[byKey,`${s.kind}|${s.sourceFile}`],[byName,s.sourceFile]]){const a=map.get(key)||[];a.push(s);map.set(key,a);}}
  const asset={version:1,templates:{},tables:{}}, audit=[], models=new Map(), parsedCache=new Map();
  const contexts=JSON.parse(fs.readFileSync(path.join(inventory,'table-section-contexts.json'),'utf8'));
  const rendererSandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/gc-word-table-renderer.js'),'utf8'),rendererSandbox);
  for(const tpl of templates){
    const candidates=byKey.get(`${tpl.kind}|${tpl.sourceFile}`)||byName.get(tpl.sourceFile)||[];
    const row={templateId:tpl.id,project:tpl.item,kind:tpl.kind,sourceFile:tpl.sourceFile,status:'unresolved',unresolved:[],tableKeys:[]};audit.push(row);
    try{
      if(candidates.length!==1)throw new Error(candidates.length?'ambiguous-source':'source-missing');
      const source=candidates[0];row.sourceId=source.id;row.sourceFolderKind=source.kind;
      let candidatesTables=source.tables.filter(t=>{
        const full=contexts[source.id]?.find(item=>item.index===t.index);
        const candidate=full?{...t,sectionHeading:full.heading,context:full.context||[]}:t;
        return classifyQuantitative(candidate)===tpl.item;
      });row.sourceTableIndexes=candidatesTables.map(t=>t.index);
      if(candidatesTables.length>1){
        const expected=compact(tpl.standardText||'').replace(/^.*?标准规定[：:]?/u,'');
        const sameStandard=candidatesTables.filter(table=>expected&&compact(contexts[source.id]?.find(t=>t.index===table.index)?.followingStandard||'').includes(expected));
        if(sameStandard.length===1)candidatesTables=sameStandard;
        row.sourceTableIndexes=candidatesTables.map(t=>t.index);
      }
      if(tpl.item==='extract'&&candidatesTables.length>1){
        const desired=tpl.method?.match(/水溶性|醇溶性/)?.[0];
        if(desired)candidatesTables=candidatesTables.filter(t=>{
          const method=[...(contexts[source.id]?.find(item=>item.index===t.index)?.context||[])].reverse().find(line=>/测定法/.test(line));
          return method?.match(/水溶性|醇溶性/)?.[0]===desired;
        });
        row.sourceTableIndexes=candidatesTables.map(t=>t.index);
      }
      if(!candidatesTables.length){row.status='no-source-table';continue;}
      if(candidatesTables.length!==1)throw new Error(`multiple-source-tables:${candidatesTables.map(t=>t.index).join(',')}`);
      const parsedFile=path.join(inventory,'parsed',`${source.id}.json`);
      if(!fs.existsSync(parsedFile))throw new Error('source-parse-pending');
      if(!parsedCache.has(source.id))parsedCache.set(source.id,JSON.parse(fs.readFileSync(parsedFile,'utf8')));
      const raw=parsedCache.get(source.id).tables.find(t=>t.sourceTableIndex===candidatesTables[0].index);
      const table=normalizeRecordTable(raw,{templateId:'record',tableRole:'result'}),bound=bindQuantitative(table,tpl.item);
      row.unresolved.push(...table.unresolved,...bound.unresolved); table.bindings=bound.bindings;
      if(row.unresolved.length)continue;
      bindInlineSourceBlanks(table,tpl.item);
      rendererSandbox.window.GcWordTableRenderer.render(table,{input:()=>'',output:()=>'',inlineInput:()=>''});
      const safe=safeRecordValue(table);delete safe.unresolved;delete safe.templateId;
      const serialized=JSON.stringify(safe);let key=models.get(serialized);
      if(!key){key=`layout${models.size+1}`;models.set(serialized,key);asset.tables[key]=safe;}
      row.tableKeys=[key];row.status='mapped';row.bindings=bound.bindings;row.rowCount=table.rowCount;row.columnCount=table.columnCount;
    }catch(error){row.unresolved.push({type:'source-table-review',reason:error.message});}
    finally {asset.templates[tpl.id]={status:row.status,tableKeys:row.tableKeys};}
  }
  const counts={};for(const r of audit){counts[r.project]??={};counts[r.project][r.status]=(counts[r.project][r.status]||0)+1;}
  fs.writeFileSync(path.join(inventory,'quantitative-binding-audit.json'),JSON.stringify({counts,templates:audit},null,2));
  fs.writeFileSync(path.join(root,'assets/quantitative-record-layouts.js'),`/* Generated from read-only source record table evidence. */\nwindow.QUANTITATIVE_RECORD_LAYOUTS=${JSON.stringify(asset)};\n`);
  return {counts,modelCount:models.size};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildQuantitativeAsset(),null,2));
