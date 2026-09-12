import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('assets/gc-record-table-layouts.js', root), 'utf8'), context);
const defaultsFile = new URL('assets/gc-pubiao-defaults.js', root);
if (fs.existsSync(defaultsFile)) vm.runInContext(fs.readFileSync(defaultsFile, 'utf8'), context);
assert.equal(vm.runInContext('typeof GcPubiaoDefaults', context), 'object', '缺少只向原表空项回填的蒲标网参数实现');
const run = code => vm.runInContext(code, context);
run("var state = {'assay.Cref':'0.2031','assay.Ws.1':'2.0145','assay.f.1':'','assay.refInjection':0}; GcPubiaoDefaults.fill('mint-menthol', state, GC_WORD_TABLE_LAYOUTS['mint-menthol']);");
assert.equal(run("state['assay.Cref']"), '0.2031', '已有实际浓度不可覆盖');
assert.equal(run("state['assay.Ws.1']"), '2.0145');
assert.equal(run("state['assay.refInjection']"), 0, '0不是空项');
assert.equal(run("state['assay.f.1']"), '50');
assert.equal(run("state['assay.sampleInjection.2']"), '1');
run("var fresh = {}; GcPubiaoDefaults.fill('mugwort-borneol', fresh, GC_WORD_TABLE_LAYOUTS['mugwort-borneol']);");
assert.equal(run("fresh['assay.Cref']"), undefined, '对照品浓度不预填');
assert.equal(run("fresh['assay.f.2']"), '10');
assert.equal(run("fresh['assay.Ws.1']"), undefined);
assert.equal(run("fresh['assay.refPurity']"), undefined);
run("var absent = {}; GcPubiaoDefaults.fill('mint-menthol', absent, {templateId:'mint-menthol',bindings:[]});");
assert.equal(run('Object.keys(absent).length'), 0, '原表不存在字段时不得新增');
run("var dendrobium = {}; GcPubiaoDefaults.fill('dendrobium-dendrobine', dendrobium, GC_WORD_TABLE_LAYOUTS['dendrobium-dendrobine']);");
assert.deepEqual(Array.from(run('Object.keys(dendrobium)')).sort(),
  ['assay.f.1','assay.f.2','assay.refInjection','assay.sampleInjection.1','assay.sampleInjection.2'],
  '石斛：只补进样量与稀释倍数');
assert.equal(run("dendrobium['assay.Cref']"), undefined, '内标法记录不得把浓度填进外标表');
assert.equal(run("dendrobium['assay.f.1']"), '62.5');
run("var shanghai = {}; GcPubiaoDefaults.fill('amomum-bornyl-acetate-finished-shanghai', shanghai, GC_WORD_TABLE_LAYOUTS['amomum-bornyl-acetate-finished-shanghai']);");
assert.equal(run("shanghai['assay.f.1']"), '25');
assert.equal(run("shanghai['assay.refInjection']"), undefined, '上海2018记录未写进样量，不猜补');
run("var beijing = {}; GcPubiaoDefaults.fill('amomum-bornyl-acetate-finished-beijing', beijing, GC_WORD_TABLE_LAYOUTS['amomum-bornyl-acetate-finished-beijing']);");
assert.equal(run("beijing['assay.f.2']"), '25');
assert.equal(run("beijing['assay.sampleInjection.1']"), undefined, '北京2023记录未写进样量，不猜补');
run("var mismatch = {}; GcPubiaoDefaults.fill('mint-menthol', mismatch, GC_WORD_TABLE_LAYOUTS['mugwort-borneol']);");
assert.equal(run('Object.keys(mismatch).length'), 0, '不能向其他模板布局回填');
run("var anise = {}; GcPubiaoDefaults.fill('star-anise-anethole', anise, GC_WORD_TABLE_LAYOUTS['star-anise-anethole']);");
assert.equal(run("anise['assay.refInjection']"), '2');
assert.equal(run("anise['assay.sampleInjection.1']"), '2');
assert.equal(run("anise['assay.f.1']"), '25');
run("var brucea = {}; GcPubiaoDefaults.fill('brucea-oleic', brucea, GC_WORD_TABLE_LAYOUTS['brucea-oleic']);");
assert.equal(run("brucea['assay.Cref']"), undefined, '对照品浓度不预填');
assert.equal(run("brucea['assay.Cis']"), undefined, '内标浓度不预填');
assert.ok(Math.abs(run("Number(brucea['assay.f.1'])") - 200/3) < 1e-12);
run("var flax = {}; GcPubiaoDefaults.fill('flax-linoleic', flax, GC_WORD_TABLE_LAYOUTS['flax-linoleic']);");
assert.equal(run("flax['assay.refInjection']"), '1');
assert.equal(run("flax['assay.Cref']"), undefined, '不可把150mg精密称量当作实际值');
assert.equal(run("flax['assay.f.1']"), undefined, '亚麻子脂肪油换算缺少实测量，不填5');
run("var elsholtzia = {}; GcPubiaoDefaults.fill('elsholtzia-thymol', elsholtzia, GC_WORD_TABLE_LAYOUTS['elsholtzia-thymol']);");
assert.equal(run("elsholtzia['assay.refInjection']"), '2');
assert.equal(run("elsholtzia['assay.Cref']"), undefined, '对照品浓度不预填');
assert.equal(run("elsholtzia['assay.f.1']"), '20');
run("var pine = {}; GcPubiaoDefaults.fill('pine-alpha-pinene', pine, GC_WORD_TABLE_LAYOUTS['pine-alpha-pinene']);");
assert.equal(run("pine['assay.Cref']"), undefined, '对照品浓度不预填');
assert.equal(run("pine['assay.f.1']"), '20');
const allowed = ['assay.f.1','assay.f.2','assay.refInjection','assay.sampleInjection.1','assay.sampleInjection.2'];
for (const [id,entry] of Object.entries(run('GcPubiaoDefaults.entries'))) {
  for (const key of Object.keys(entry.values)) {
    assert.ok(allowed.includes(key), `${id}: 只允许回填进样量与样品稀释倍数，不接受 ${key}`);
  }
}
run("var upgraded = {'assay.Cref':'0.2','assay.f.1':''}; GcPubiaoDefaults.fill('mint-menthol', upgraded, GC_WORD_TABLE_LAYOUTS['mint-menthol'], '20260910-1');");
assert.equal(run("upgraded['assay.Cref']"), undefined, '上一版自动写入的目标浓度应随升级撤除');
assert.equal(run("upgraded['assay.f.1']"), '50');
run("var typed = {'assay.Cref':'0.2','assay.f.1':''}; GcPubiaoDefaults.fill('mint-menthol', typed, GC_WORD_TABLE_LAYOUTS['mint-menthol'], undefined);");
assert.equal(run("typed['assay.Cref']"), '0.2', '未经过上一版回填的记录不得被撤销');
run("var userConcentration = {'assay.Cref':'0.2031'}; GcPubiaoDefaults.fill('mint-menthol', userConcentration, GC_WORD_TABLE_LAYOUTS['mint-menthol'], '20260910-1');");
assert.equal(run("userConcentration['assay.Cref']"), '0.2031', '检验人员手填的浓度即使同版本升级也不撤除');
for (const [id,entry] of Object.entries(run('GcPubiaoDefaults.entries'))) {
  const layout=run(`GC_WORD_TABLE_LAYOUTS[${JSON.stringify(id)}]`);
  for (const key of Object.keys(entry.values)) {
    const binding=layout.bindings.find(b=>b.role==='input' && b.field===key);
    assert.ok(binding,`${id}: ${key} 必须是原表输入格`);
    const cell=[...layout.referenceTable.cells,...layout.sampleTable.cells].find(c=>c.id===binding.cellId);
    assert.equal(cell.text.trim(),'',`${id}: ${key} 原表单元格必须为空`);
  }
}
console.log('PASS GC 蒲标网空项回填：只写进样量与稀释倍数、保留已有值、保留实测空白、方法不符不混填');
