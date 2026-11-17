import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
 const page=await browser.newPage();
 await page.goto(new URL('../index.html',import.meta.url).href);
 await page.waitForLoadState('networkidle');
 const result=await page.evaluate(()=>{
  store={};
  const moisture=CALCS.find(c=>c.id==='moisture');
  const defaults=['12','12.00'].map(lim=>{
   store['moisture.limval']=lim; store['assay.limval']=lim;
   return {ind:calcDp(moisture,'ind'),mean:calcDp(moisture,'mean'),rd:assayDp('rd'),scoped:assayDp('rd','assay.component2.')};
  });
  store['moisture.dp.ind']='3'; store['assay.dp.rd']='2';
  return {defaults,manual:[calcDp(moisture,'ind'),assayDp('rd')]};
 });
 for(const row of result.defaults) assert.deepEqual(row,{ind:1,mean:1,rd:1,scoped:1});
 assert.deepEqual(result.manual,[3,2]);
 console.log('PASS: moisture and relative deviation default to one decimal; explicit overrides preserved');
} finally {await browser.close();}
