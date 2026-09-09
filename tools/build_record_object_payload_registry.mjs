import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const registry=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'gc-word-embedded-object-semantics.json'),'utf8'));
const extract=JSON.parse(fs.readFileSync(path.join(root,'.worktrees/gc-word-table-fidelity/tools/gc-word-table-extract.json'),'utf8').replace(/^\uFEFF/u,''));
const approvals=new Map(registry.entries.map(entry=>[entry.sourceIdentity,entry]));
const signatures=new Map();let authenticated=0;
for(const template of extract.templates)for(const role of ['referenceTable','sampleTable'])for(const evidence of template[role].sourceObjectEvidence){
  const approval=approvals.get(evidence.sourceIdentity);
  if(!approval||approval.sourceDigest!==evidence.sourceDigest)throw new Error('Prior source evidence does not match reviewed registry');
  authenticated++;
  if(evidence.containerCategory!=='embedded-equation'||!evidence.payloadDigests?.length)continue;
  const payloads=[...evidence.payloadDigests].sort();const key=JSON.stringify(payloads);
  if(signatures.has(key)&&signatures.get(key).semanticType!==approval.semanticType)throw new Error('Conflicting reviewed payload semantics');
  signatures.set(key,{containerCategory:evidence.containerCategory,payloadDigests:payloads,semanticType:approval.semanticType});
}
if(authenticated!==95)throw new Error('Prior reviewed source object inventory is incomplete');
const target=path.join(import.meta.dirname,'reviewed-record-object-payloads.json');
const additional=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')).entries.filter(entry=>entry.review):[];
for(const entry of additional){
  if(!registry.semanticAsts[entry.semanticType])throw new Error('Reviewed extra payload uses unsupported semantics');
  const key=JSON.stringify([...entry.payloadDigests].sort());
  if(signatures.has(key)&&signatures.get(key).semanticType!==entry.semanticType)throw new Error('Conflicting extra payload review');
  signatures.set(key,entry);
}
fs.writeFileSync(target,JSON.stringify({version:1,entries:[...signatures.values()]},null,2)+'\n');
console.log(`Authenticated ${authenticated} prior objects; emitted ${signatures.size} exact equation payload sets`);
