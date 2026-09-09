import assert from 'node:assert/strict';
import {matchHplcTables} from '../tools/match_hplc_record_tables.mjs';
const siblings=[{name:'齐墩果酸'},{name:'熊果酸'}];
const table=(index,role,context)=>({index,classification:{role},context});
const candidates=[
  table(7,'reference',['对照品溶液齐墩果酸、熊果酸','齐墩果酸']),
  table(8,'sample',['齐墩果酸','供试品测量：']),
  table(10,'reference',['齐墩果酸','供试品测量：','熊果酸']),
  table(11,'sample',['齐墩果酸','熊果酸','供试品测量：']),
];
assert.deepEqual(matchHplcTables(siblings[0],siblings,candidates).tables.map(t=>t.index),[7,8]);
assert.deepEqual(matchHplcTables(siblings[1],siblings,candidates).tables.map(t=>t.index),[10,11]);
assert.equal(matchHplcTables(siblings[0],siblings,[table(1,'reference',['齐墩果酸和熊果酸配液']),table(2,'sample',[])]).status,'ambiguous-analyte-tables');
assert.equal(matchHplcTables(siblings[0],[siblings[0]],[table(1,'reference',[]),table(2,'reference',[])]).status,'ambiguous-analyte-tables');
assert.equal(matchHplcTables(siblings[0],[siblings[0]],[table(2,'reference',[]),table(1,'sample',[])]).status,'ambiguous-analyte-tables');
assert.equal(matchHplcTables(siblings[0],[siblings[0],siblings[0]],candidates).status,'duplicate-catalog-analyte');
assert.equal(matchHplcTables(siblings[0],siblings,[table(7,'reference',['齐墩果酸','甘氨酸：']),table(8,'sample',['齐墩果酸','甘氨酸：'])]).status,'ambiguous-analyte-tables');
console.log('PASS: multi-analyte source pairing uses the nearest explicit heading; ambiguous/inverted pairs are rejected');
