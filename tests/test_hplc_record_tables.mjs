import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(new URL('../index.html',import.meta.url).href);
  const coverage=await page.evaluate(()=>{
    const mapped=HPLC_TEMPLATES.filter(t=>window.HPLC_RECORD_LAYOUTS.templates[t.id]?.status==='mapped');
    const failures=[];
    for(const template of mapped){
      const layout=HplcRecordTables.layout(template);
      const holder=document.createElement('div');
      holder.innerHTML=['reference','sample'].map(role=>HplcRecordTables.render(template,role,{input:assayWordInput,output:assayWordOutput})).join('');
      if(holder.querySelectorAll('table.word-record-table').length!==2)failures.push(template.id+': missing pair');
      if(holder.querySelector('[data-source-table-index],[data-k="assay.refSource"],[data-k="assay.refDrying"]'))failures.push(template.id+': private/editable fixed field');
      for(const binding of layout.bindings){
        if(['assay.refSource','assay.refDrying'].includes(binding.field))continue;
        const target=binding.role==='input'?holder.querySelector(`[data-k="${binding.field}"]`):holder.querySelector(`[id="${binding.field}"]`);
        if(!target)failures.push(template.id+': missing '+binding.field);
      }
    }
    return {mapped:mapped.length,failures,all:HPLC_TEMPLATES.length,covered:Object.keys(window.HPLC_RECORD_LAYOUTS.templates).length,
      choice:mapped.find(t=>!t.totalLabel&&HplcRecordTables.layout(t).quantification!=='curve-readback'&&HplcRecordTables.layout(t).referenceConcentrationScale===1),pending:HPLC_TEMPLATES.find(t=>window.HPLC_RECORD_LAYOUTS.templates[t.id]?.status!=='mapped')};
  });
  assert(coverage.mapped>0,'No verified HPLC source pair rendered');
  assert.equal(coverage.covered,coverage.all);
  assert.deepEqual(coverage.failures,[]);
  assert(coverage.choice,'numeric example requires an individual analyte');
  await page.evaluate(id=>{applyAssayTemplate(id);showTab('assay');},coverage.choice.id);
  const fill=async(key,value)=>{await page.locator(`[data-k="${key}"]`).fill(String(value));};
  await fill('assay.Cref',2);
  for(const key of await page.locator('[data-k^="assay.refA."]').evaluateAll(nodes=>nodes.map(node=>node.dataset.k)))await fill(key,100);
  for(const key of await page.locator('[data-k^="assay.smpA."]').evaluateAll(nodes=>nodes.map(node=>node.dataset.k)))await fill(key,50);
  for(const s of [1,2]){await fill('assay.Ws.'+s,1);await fill('assay.f.'+s,10);}
  if(coverage.choice.dry)await fill('assay.Q',0);
  const expected=10*({'%':0.1,'mg/g':1,'g/kg':1,'μg/g':1000,'mg/kg':1000,'g/g':0.001}[coverage.choice.unit]||0.1);
  assert.equal(Number(await page.locator('[id="assay.out.MEAN"]').innerText()),expected);
  const width=await page.locator('.word-record-table').first().evaluate(table=>table.getBoundingClientRect().width);
  await page.setViewportSize({width:390,height:844});
  assert(Math.abs(await page.locator('.word-record-table').first().evaluate(table=>table.getBoundingClientRect().width)-width)<0.2,'mobile resized original columns');
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({media:'print'});
  assert(Math.abs(await page.locator('.word-record-table').first().evaluate(t=>t.getBoundingClientRect().width)-width)<0.2,'print resized original columns');
  await page.emulateMedia({media:'screen'});
  for(const kind of ['micro','curve','paired-water']){
    const result=await page.evaluate(kind=>{
      const template=HPLC_TEMPLATES.find(t=>{
        const layout=HplcRecordTables.layout(t);
        return layout&&(kind==='micro'?layout.referenceConcentrationScale===0.001:kind==='curve'?layout.quantification==='curve-readback':layout.sampleTable.waterPerSample);
      });
      if(!template)return null;
      applyAssayTemplate(template.id);
      const layout=HplcRecordTables.layout(template);
      for(const b of layout.bindings.filter(b=>b.role==='input')){
        const key=b.field;
        if(key==='assay.CrefMicro')store[key]='2000';
        else if(key==='assay.Cref')store[key]='2';
        else if(/^assay\.Q(?:\.[12])?$/u.test(key))store[key]='0';
        else if(key.startsWith('assay.refA.'))store[key]='100';
        else if(key.startsWith('assay.smpA.')||key.startsWith('assay.curveA.'))store[key]='50';
        else if(key.startsWith('assay.Ws.'))store[key]='1';
        else if(key.startsWith('assay.f.'))store[key]='10';
        else if(key.startsWith('assay.Csample.'))store[key]='1';
      }
      computeAssay();
      return {mean:Number(document.getElementById('assay.out.MEAN').textContent),expected:10*assayUnitScale()};
    },kind);
    assert(result,`${kind}: missing source fixture`);
    assert.equal(result.mean,result.expected,`${kind}: source concentration conversion is wrong`);
    if(kind==='curve')await page.locator('.sheet.active').screenshot({path:fileURLToPath(new URL('../output/record-table-browser/hplc-curve.png',import.meta.url))});
  }
  if(coverage.pending){
    await page.evaluate(id=>applyAssayTemplate(id),coverage.pending.id);
    assert.equal(await page.locator('.sheet.active .generic-assay-table').count(),0,'unreviewed preset silently fell back to generic');
    assert.equal(await page.locator('.sheet.active .hplc-record-review').count(),1);
    assert.equal(await page.locator('[id="assay.judge"]').innerText(),'待计算');
  }
  const corrected=await page.evaluate(()=>HPLC_TEMPLATES.find(t=>t.originalName&&HPLC_RECORD_LAYOUTS.templates[t.id]?.status==='mapped'));
  assert(corrected,'source-corrected name fixture missing');
  await page.evaluate(t=>localStorage.setItem('tcm-lab-calc-v2',JSON.stringify({store:{'assay.template':t.id,'assay.tech':'hplc','assay.name':t.originalName,'assay.Ws.1':'123'}})),corrected);
  await page.reload();
  assert.equal(await page.locator('[data-k="assay.name"]').inputValue(),corrected.name,'old auto-detected name was not corrected');
  assert.equal(await page.evaluate(()=>store['assay.Ws.1']),'123','source-name correction changed entered sample data');
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${coverage.mapped} mapped HPLC source pairs, complete status coverage, calculations, mobile widths and review gating`);
}finally{await browser.close();}
