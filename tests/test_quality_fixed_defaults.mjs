/*
 * 杂质／水分／总灰分／浸出物原记录表格里的温度、时间空格：
 * 由标准或原检验记录确定的部分按固定文字（黑体）显示，不需要检验人员修改或填写；
 * 原记录没有规定的（水分甲苯法加甲苯量与回流时间、浸出物溶剂体积与取滤液体积等）
 * 必须保持可编辑，不能被固定值覆盖。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(new URL('assets/quality-templates.js', root), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('assets/quality-fixed-defaults.js', root), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('assets/quantitative-record-layouts.js', root), 'utf8'), context);
const run = code => vm.runInContext(code, context);
const templates = run('QUALITY_TEMPLATES');
const entries = run('QualityFixedDefaults.entries');
const layouts = run('window.QUANTITATIVE_RECORD_LAYOUTS');
const conditionRuns = template => {
  const fields = [];
  for (const key of layouts.templates[template.id]?.tableKeys || []) {
    for (const cell of layouts.tables[key].cells) {
      for (const paragraph of cell.paragraphs || []) {
        for (const item of paragraph.runs || []) {
          if (item.kind === 'input' && /温度|时间/.test(item.label || '')) fields.push(item.field);
        }
      }
    }
  }
  return fields;
};

assert(Object.keys(entries).length > 2000, '质量项目固定条件数量异常偏少');
const allowedValues = new Set(['100～105', '80', '500～600', '105', '5', '1', '3', '至恒重']);
const itemOf = id => id.replace(/^q-/, '').split('-')[0];
for (const [id, entry] of Object.entries(entries)) {
  const item = itemOf(id);
  assert(['moisture', 'ash', 'extract'].includes(item), `不应固定该项目：${id}`);
  const fields = Object.keys(entry.values);
  assert(fields.length > 0, `${id} 没有任何固定值`);
  for (const [field, value] of Object.entries(entry.values)) {
    assert(field.startsWith(`${item}.record.`), `${id} 固定值字段越界：${field}`);
    assert(allowedValues.has(value), `${id} 出现未核定的固定值：${value}`);
  }
  assert(['记录原文', '通则0832第二法', '通则2302', '通则2201'].includes(entry.basis), `${id} 依据缺失`);
  assert.equal(JSON.stringify(entry).includes('sourceFile'), false, `${id} 运行数据不得带源文件名`);
}

// 杂质没有温度／时间条件；水分甲苯法（第四法）的加甲苯量与回流时间由现场确定，不得预填。
assert.equal(Object.keys(entries).filter(id => itemOf(id) === 'impurity').length, 0, '杂质不得有固定条件');
const fourth = templates.filter(t => t.item === 'moisture' && t.methodType === 'fourth');
assert(fourth.length > 100, '甲苯法模板数量异常');
for (const template of fourth) assert.equal(entries[template.id], undefined, `甲苯法不得预填：${template.id}`);

const dry = templates.filter(t => t.item === 'moisture' && t.methodType !== 'fourth');
for (const template of dry) {
  const fields = conditionRuns(template);
  const values = Object.values(entries[template.id]?.values || {});
  assert(fields.length >= 2, `烘干法原表温度／时间空格数量异常：${template.id}`);
  assert.equal(values.length, fields.length, `烘干法固定条件不完整：${template.id}`);
  assert(values.includes('5'), `烘干法缺少首次干燥时间：${template.id}`);
}
for (const template of templates.filter(t => t.item === 'ash' && layouts.templates[t.id]?.status === 'mapped')) {
  const values = new Set(Object.values(entries[template.id].values));
  assert.equal(conditionRuns(template).length, Object.keys(entries[template.id].values).length,
    `总灰分固定条件不完整：${template.id}`);
  assert.deepEqual([...values].sort(), ['500～600', '至恒重'], `总灰分固定条件异常：${template.id}`);
}
for (const template of templates.filter(t => t.item === 'extract' && layouts.templates[t.id]?.status === 'mapped')) {
  const values = new Set(Object.values(entries[template.id].values));
  assert.equal(conditionRuns(template).length, Object.keys(entries[template.id].values).length,
    `浸出物固定条件不完整：${template.id}`);
  assert(values.has('105'), `浸出物缺少干燥温度：${template.id}`);
  assert(values.has('3'), `浸出物缺少干燥时间：${template.id}`);
  assert(values.has('至恒重'), `浸出物空蒸发皿应按至恒重：${template.id}`);
}

const byLabel = label => templates.find(t => t.label === label && entries[t.id]);
const houpohua = byLabel('厚朴花（原料）');
const gouqizi = templates.find(t => t.item === 'moisture' && /枸杞子/.test(t.label) && entries[t.id]);
const singleTime = houpohua && Object.values(entries[houpohua.id].values);
assert(singleTime && singleTime.length === 2 && singleTime.filter(v => v === '5').length === 1,
  '厚朴花原表每行只有一个时间空格，应按空瓶至恒重、含样 5 小时');
assert(gouqizi && Object.values(entries[gouqizi.id].values).includes('80'), '枸杞子按 80℃ 干燥，不得套用 105℃');

// 原文写明的条件与通则默认分别标注，便于核对来源。
const fromRecord = Object.values(entries).filter(e => e.basis === '记录原文').length;
assert(fromRecord > 1000, '依据原文条件的模板数量异常');

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  for (const [project, label] of [['moisture', '北沙参（原料）'], ['ash', '北沙参（原料）'], ['extract', '北沙参（原料）']]) {
    const template = templates.find(t => t.item === project && t.label === label && entries[t.id]);
    assert(template, `${label} 缺少 ${project} 固定条件模板`);
    await page.evaluate(({ project, id }) => { applyQualityTemplate(project, id); showTab(project); },
      { project, id: template.id });
    const sheet = page.locator(`.sheet.active`);
    const fixed = sheet.locator(`[data-fixed-field^="${project}.record."]`);
    const count = await fixed.count();
    assert(count > 0, `${project} 未显示固定条件`);
    assert.equal(await sheet.locator('input[aria-label="温度（℃）"], input[aria-label="时间（小时）"]').count(), 0,
      `${project} 固定条件仍可编辑`);
    assert.equal(await sheet.locator(`[data-fixed-field^="${project}.record."]`).count(), count);
    const fonts = await fixed.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontFamily));
    assert(fonts.every(family => /黑体|SimHei/.test(family)), `${project} 固定条件未使用黑体`);
    const text = (await sheet.locator('.word-record-table').innerText()).replace(/\s+/g, '');
    assert(!text.includes('至恒重小时'), `${project} 出现「至恒重小时」`);
    assert(text.includes('至恒重'), `${project} 缺少至恒重条件`);
  }
  // 浸出物的溶剂体积与取滤液体积由现场量取，必须保持可填。
  await page.evaluate(() => { applyQualityTemplate('extract', QUALITY_TEMPLATES.find(t =>
    t.item === 'extract' && t.label === '北沙参（原料）').id); showTab('extract'); });
  assert(await page.locator('.sheet.active [data-k^="extract.V."]').count() > 0, '溶剂体积必须保持可填');
  assert(await page.locator('.sheet.active [data-k^="extract.Vs."]').count() > 0, '取滤液体积必须保持可填');
  assert.deepEqual(errors, []);
  console.log(`PASS: ${Object.keys(entries).length} 个质量项目模板显示标准固定条件（黑体、不可编辑），甲苯法与现场量取值保持可填`);
} finally {
  await browser.close();
}
