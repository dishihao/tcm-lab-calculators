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
const total={name:'大黄酚',standardText:'含总蒽醌不得少于1.5%。'},free={name:'大黄酚',standardText:'含游离蒽醌不得少于0.35%。'};
const anthra=[table(1,'reference',['总蒽醌：大黄酚']),table(2,'sample',['总蒽醌：大黄酚','供试品测量：']),table(3,'reference',['游离蒽醌：大黄酚']),table(4,'sample',['游离蒽醌：大黄酚','供试品测量：'])];
assert.deepEqual(matchHplcTables(total,[total,free],anthra).tables.map(t=>t.index),[1,2]);
assert.deepEqual(matchHplcTables(free,[total,free],anthra).tables.map(t=>t.index),[3,4]);
assert.deepEqual(matchHplcTables({name:'梣酮'},[{name:'梣酮'},{name:'黄柏酮'}],[table(1,'reference',['6.2 数据记录及计算公式 梣酮']),table(2,'sample',['6.2 数据记录及计算公式 梣酮','供试品测量：'])]).tables.map(t=>t.index),[1,2]);
