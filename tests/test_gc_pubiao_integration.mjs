import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror', e=>errors.push(String(e)));
  await page.goto(new URL('../index.html',import.meta.url).href);
  await page.evaluate(()=>applyAssayTemplate('mint-menthol'));
  const field = key=>page.locator(`[data-k="assay.${key}"]`);
  assert.equal(await field('Cref').inputValue(),'0.2','选薄荷模板后，原有对照品浓度空格应显示蒲标网值');
  assert.equal(await field('f.1').inputValue(),'50');
  assert.equal(await field('Ws.1').inputValue(),'');
  fs.mkdirSync(new URL('../output/',import.meta.url),{recursive:true});
  await page.locator('[data-assay-reference-table]').screenshot({path:fileURLToPath(new URL('../output/gc-pubiao-mint-reference.png',import.meta.url))});
  await field('Cref').fill('0.2031');
  await field('Ws.1').fill('2.0145');
  await field('refInjection').fill('');
  await page.evaluate(()=>applyAssayTemplate('star-anise-anethole'));
  assert.equal(await field('refInjection').inputValue(),'2');
  await page.evaluate(()=>applyAssayTemplate('mint-menthol'));
  assert.equal(await field('Cref').inputValue(),'0.2031');
  assert.equal(await field('Ws.1').inputValue(),'2.0145');
  assert.equal(await field('refInjection').inputValue(),'','用户主动清空后，不应被切换或刷新反复填回');
  await page.reload();
  assert.equal(await field('Cref').inputValue(),'0.2031');
  assert.equal(await field('refInjection').inputValue(),'');
  // Old saved records must gain missing defaults once without replacing measurements.
  await page.evaluate(()=>{
    localStorage.setItem('tcm-lab-calc-v2',JSON.stringify({store:{
      'assay.template':'mint-menthol','assay.tech':'gc','assay.mode':'external',
      'assay.Cref':'0.202','assay.Ws.1':'2.012','assay.f.1':'',
      __assayTemplateStates:{'mugwort-borneol':{'assay.Cref':'0.102','assay.f.1':''}}
    }}));
  });
  await page.reload();
  assert.equal(await field('Cref').inputValue(),'0.202');
  assert.equal(await field('Ws.1').inputValue(),'2.012');
  assert.equal(await field('f.1').inputValue(),'50');
  await page.evaluate(()=>applyAssayTemplate('mugwort-borneol'));
  assert.equal(await field('Cref').inputValue(),'0.102');
  assert.equal(await field('f.1').inputValue(),'10');
  await page.evaluate(()=>{
    store.__assayTemplateStates['patchouli-patchoulol']={'assay.tech':'gc','assay.mode':'external'};
    applyAssayTemplate('patchouli-patchoulol');
  });
  assert.equal(await page.evaluate(()=>store['assay.Cis']),undefined,'错误mode不回填（外标视图无内标输入格）');
  await page.evaluate(()=>{store['assay.mode']='internal';build();});
  assert.equal(await field('Cis').inputValue(),'1.5','回到正确内标方法后才补空项');
  await page.evaluate(()=>applyAssayTemplate('brucea-oleic'));
  assert.equal(await field('Cref').inputValue(),'3.75');
  assert.equal(await field('Cis').inputValue(),'4');
  await field('Q').fill('0');
  for(let s=1;s<=2;s++){
    await field(`Ws.${s}`).fill('3');
    const a=page.locator(`[data-k^="assay.smpA.${s}."]`);
    const is=page.locator(`[data-k^="assay.smpIS.${s}."]`);
    for(let i=0;i<await a.count();i++) await a.nth(i).fill('3600');
    for(let i=0;i<await is.count();i++) await is.nth(i).fill('4000');
  }
  for(const [stem,value] of [['refA','3750'],['refIS','4000']]){
    const peaks=page.locator(`[data-k^="assay.${stem}."]`);
    for(let i=0;i<await peaks.count();i++) await peaks.nth(i).fill(value);
  }
  assert.equal((await page.locator('[id="assay.out.MEAN"]').innerText()).trim(),'8.0','鸦胆子多步稀释计算应为8.0%，不可二倍或四倍误算');
  const audit=await page.evaluate(()=>{
    const result=[];
    for(const t of GC_TEMPLATES){
      applyAssayTemplate(t.id);
      const layout=GC_WORD_TABLE_LAYOUTS[t.id];
      const original=layout.bindings.filter(b=>b.role==='input'&&!['assay.refDrying','assay.refSource'].includes(b.field)).map(b=>b.field).sort();
      const actual=Array.from(document.querySelectorAll('[data-assay-reference-table] input[data-k], [data-assay-sample-table] input[data-k]')).map(el=>el.dataset.k).sort();
      result.push({id:t.id,original,actual});
    }
    return result;
  });
  for(const item of audit) assert.deepEqual(item.actual,item.original,`${item.id} 不得增减表格输入字段`);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${audit.length} GC模板字段不变；新模板回填、旧记录迁移、已有值和主动清空保留`);
} finally {await browser.close();}
