import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const file = path.resolve(import.meta.dirname,'../tools/build_quantitative_record_layouts.mjs');
assert.ok(fs.existsSync(file),'quantitative source binding builder exists');
const { classifyQuantitative, bindQuantitative, normalizeRecordTable } = await import(pathToFileURL(file));
// Break caught: a later acid-insoluble result table copied with a total-ash
// label must never silently replace the true total-ash table.
assert.equal(classifyQuantitative({text:'坩埚重 总灰分',context:['酸不溶性灰分','结果与计算']}),null);
assert.equal(classifyQuantitative({text:'瓶重 干燥失重x（%）',context:['干燥失重']}),'moisture');
assert.equal(classifyQuantitative({text:'滴定液浓度 消耗体积 空白 含量X（%）',context:['含量测定']}),null);
assert.equal(classifyQuantitative({text:'滴定液浓度 消耗体积 空白 含量X（mg/kg）',context:['二氧化硫残留量']}),'sulfur');
const table = {templateId:'sample',tableRole:'result',rowCount:7,columnCount:3,cells:[],bindings:[]};
['样品编号','瓶重W0(g)(小时)','称样量W样(g)','瓶+样W1(g)(小时)','干燥失重x（%）','相对偏差(%)','平均值（%）'].forEach((label,row)=>{
  table.cells.push({id:`r${row}c0`,row,column:0,colSpan:1,rowSpan:1,text:label,paragraphs:[]});
  const merged=row>=5;
  for(let col=1;col<(merged?2:3);col++) table.cells.push({id:`r${row}c${col}`,row,column:col,colSpan:merged?2:1,rowSpan:1,text:row===0?String(col):'',paragraphs:[]});
});
const bound=bindQuantitative(table,'moisture');
assert.equal(bound.unresolved.length,0,JSON.stringify(bound.unresolved));
assert.ok(bound.bindings.some(b=>b.field==='moisture.W0b.1'));
assert.ok(!bound.bindings.some(b=>b.field==='moisture.W0a.1'));
assert.ok(bound.bindings.some(b=>b.field==='moisture.W1b.2'));
assert.ok(bound.bindings.some(b=>b.field==='moisture.out.MEAN'));
const unknown=structuredClone(table);unknown.cells.find(c=>c.id==='r2c0').text='未知称量';
assert.ok(bindQuantitative(unknown,'moisture').unresolved.length>0,'unknown source fields explicitly unresolved');
const raw={role:'result',gridPt:[100],widthPt:100,rows:[{}],cells:[{rowIndex:1,gridColumnIndex:1,text:'平均值',paragraphs:[{text:'平均值',runs:[{kind:'sourceObject',sourceDigest:'not-reviewed',payloadDigests:['unknown']}]}]}]};
assert.ok(normalizeRecordTable(raw).unresolved.some(x=>x.type==='unknown-source-object'),'unknown math is never discarded');
console.log('PASS source classification, source row cardinality, fail-closed binding and unknown math');
