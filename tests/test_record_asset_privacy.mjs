import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../assets/hplc-templates.js',import.meta.url),'utf8'),context);
const forbidden=new Set(['sourceTableIndex','sourceFile','sourcePath','sourceDigest','sourceIdentity','sourceOoxmlHash','sourceCellId','payloadDigests','ooxml','mathOoxml','wordOpenXml','sourceObjectEvidence']);
function check(value,where){
  if(typeof value==='string'){
    assert(!/[A-Za-z]:[\\/]|visual-qa|<w:|<pkg:|<v:|<o:OLEObject/u.test(value),where+': private source content');
  }else if(Array.isArray(value))value.forEach((item,index)=>check(item,where+'.'+index));
  else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
    assert(!forbidden.has(key),where+'.'+key+': private source key');check(item,where+'.'+key);
  }
}
for(const [file,name]of [['quantitative-record-layouts.js','QUANTITATIVE_RECORD_LAYOUTS'],['hplc-record-layouts.js','HPLC_RECORD_LAYOUTS'],['identification-record-tables.js','IDENTIFICATION_RECORD_TABLES']]){
  vm.runInNewContext(fs.readFileSync(new URL('../assets/'+file,import.meta.url),'utf8'),context);
  check(context.window[name],name);
}
console.log('PASS: all new browser record assets exclude source paths, indices, identities, hashes, binaries and raw XML');
