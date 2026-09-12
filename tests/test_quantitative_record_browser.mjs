import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(new URL('../index.html',import.meta.url).href);
  const coverage=await page.evaluate(()=>{
    const templates=[...QUALITY_TEMPLATES,...SULFUR_DIOXIDE_TEMPLATES],asset=QUANTITATIVE_RECORD_LAYOUTS,failures=[];
    for(const t of templates)if(!asset.templates[t.id])failures.push('missing status '+t.id);
    for(const [id,entry] of Object.entries(asset.templates)){
      if(entry.status==='mapped'&&entry.tableKeys.some(key=>!asset.tables[key]))failures.push('missing table '+id);
    }
    for(const [key,table] of Object.entries(asset.tables)){
      const holder=document.createElement('div');holder.innerHTML=GcWordTableRenderer.render({...table,templateId:'audit'},
        {input:binding=>`<input data-k="${binding.field}">`,output:binding=>`<div id="${binding.field}"></div>`,inlineInput:run=>`<input data-k="${run.field}">`});
      if(holder.querySelectorAll('table').length!==1)failures.push('bad table '+key);
      for(const binding of table.bindings){
        const selector=binding.role==='input'?`[data-k="${binding.field}"]`:`[id="${binding.field}"]`;
        if(holder.querySelectorAll(selector).length!==1)failures.push('binding '+key+' '+binding.field);
      }
    }
    return {failures,templates:templates.length,mapped:Object.values(asset.templates).filter(x=>x.status==='mapped').length,models:Object.keys(asset.tables).length};
  });
  assert.deepEqual(coverage.failures,[]);
  assert.equal(coverage.templates,5438);
  assert(coverage.mapped>5000);
  const cases={impurity:{M:100,M1:2},moisture:{W0a:10,W0b:10,Ws:2,W1a:11.8,W1b:11.8},ash:{W0a:10,W0b:10,Ws:2,W1a:10.1,W1b:10.1},extract:{W0a:10,W0b:10,Ws:2,W1:10.1,V:50,Vs:25,Q:0}};
  for(const [project,values] of Object.entries(cases)){
    const choice=await page.evaluate(project=>QUALITY_TEMPLATES.find(t=>t.item===project&&QUANTITATIVE_RECORD_LAYOUTS.templates[t.id]?.status==='mapped'&&(project!=='moisture'||t.methodType!=='fourth')),project);
    assert(choice);
    await page.evaluate(({project,id})=>{applyQualityTemplate(project,id);showTab(project);},{project,id:choice.id});
    for(const [key,value] of Object.entries(values))for(const sample of [1,2]){
      const input=page.locator(`[data-k="${project}.${key}.${sample}"]`);
      if(await input.count())await input.fill(String(value));
    }
    if(project==='extract'&&await page.locator('[data-k="extract.Q"]').count())await page.locator('[data-k="extract.Q"]').fill('0');
    const actual=Number(await page.locator(`[id="${project}.out.MEAN"]`).innerText());
    assert(Math.abs(actual-({impurity:2,moisture:10,ash:5,extract:10}[project]))<0.06,`${project}: unexpected result ${actual}`);
    const table=page.locator('.sheet.active .word-record-table');
    assert.equal(await table.count(),1);
    const width=await table.evaluate(t=>t.getBoundingClientRect().width);
    await page.setViewportSize({width:390,height:844});
    assert(Math.abs((await table.evaluate(t=>t.getBoundingClientRect().width))-width)<0.2,project+' mobile width changed');
    await page.setViewportSize({width:1440,height:1100});
    await page.emulateMedia({media:'print'});
    assert(Math.abs((await table.evaluate(t=>t.getBoundingClientRect().width))-width)<0.2,project+' print width changed');
    await page.emulateMedia({media:'screen'});
    if(project==='moisture'){
      // 原记录的温度／时间空格已改为标准或原记录确定的固定文字（黑体），不再是可填输入框。
      const fixed=await page.locator('.sheet.active [data-fixed-field^="moisture.record."]').count();
      assert(fixed>0,'source temperature/hour conditions missing');
      assert.equal(await page.locator('.sheet.active [data-k^="moisture.record."]').count(),0,'fixed moisture conditions must not stay editable');
      assert.equal(await page.locator('.sheet.active [data-fixed-field^="moisture.record."].word-standard-value').count(),fixed,'fixed conditions must render as standard text');
    }
    fs.mkdirSync(new URL('../output/record-table-browser/',import.meta.url),{recursive:true});
    await page.locator('.sheet.active').screenshot({path:fileURLToPath(new URL(`../output/record-table-browser/${project}.png`,import.meta.url))});
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${coverage.mapped}/${coverage.templates} mapped quantitative presets, ${coverage.models} distinct models; source bindings, computations, inline parameters and mobile widths`);
}finally{await browser.close();}
