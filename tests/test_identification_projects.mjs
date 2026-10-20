/*
 * 理化恢复后可选取原料/成品记录、填写结果；显微、薄层仍隐藏。
 * 浏览器只加载理化模板，完整鉴别模板保留供离线校验。
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

const EXPECTED = {
  microscopy: { raw: 463, finished: 520, total: 983, products: 626 },
  tlc: { raw: 411, finished: 580, total: 991, products: 635 },
  physicochemical: { raw: 103, finished: 100, total: 203, products: 138 }
};

// 离线校验：模板数据完整，随时可以恢复。
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(new URL('assets/identification-templates.js', root), 'utf8'), context);
const templates = vm.runInContext('IDENTIFICATION_TEMPLATES', context);
assert.equal(templates.length, 2177, '鉴别模板总数变化，恢复前需重新核对');
assert.equal(new Set(templates.map(template => template.id)).size, templates.length, '鉴别模板 ID 不唯一');
const invalid = templates.filter(template =>
  !template.id || !template.product || !template.baseProduct || !template.label ||
  !['原料', '成品'].includes(template.kind) || !template.sourceFile ||
  !Array.isArray(template.blocks) || !template.blocks.length ||
  template.blocks.some(block => !Array.isArray(block.lines) || !block.lines.length));
assert.equal(invalid.length, 0, `鉴别模板字段不完整：${invalid.slice(0, 5).map(t => t.id).join(',')}`);
for (const item of Object.keys(EXPECTED)) {
  const rows = templates.filter(template => template.item === item);
  assert.deepEqual({
    raw: rows.filter(template => template.kind === '原料').length,
    finished: rows.filter(template => template.kind === '成品').length,
    total: rows.length,
    products: new Set(rows.map(template => template.baseProduct)).size
  }, EXPECTED[item], `${item}: 模板数量变化`);
}
const leaked = templates.flatMap(template => template.blocks.flatMap(block => block.lines
  .filter(line => /【(?:检查|含量测定|浸出物|性状)】/.test(line))
  .map(line => `${template.id}: ${line}`)));
assert.equal(leaked.length, 0, `鉴别正文越界到其他项目：${leaked[0] || ''}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  const tabs = await page.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(tab => tab.dataset.tab));
  assert.deepEqual(tabs, ['impurity', 'moisture', 'ash', 'extract', 'sulfur', 'physicochemical', 'assay'],
    '应单独恢复理化项目');
  for (const item of ['microscopy', 'tlc']) {
    assert.equal(await page.locator(`[data-tab="${item}"]`).count(), 0, `${item}: 页签仍存在`);
    assert.equal(await page.locator(`section[data-sheet="${item}"]`).count(), 0, `${item}: 页面仍存在`);
  }

  const loaded = await page.evaluate(() => ({
    templates: ALL_IDENTIFICATION_TEMPLATES.map(template => template.id),
    recordTables: typeof window.IDENTIFICATION_RECORD_TABLES,
    requests: performance.getEntriesByType('resource').map(entry => entry.name),
  }));
  assert.deepEqual(loaded.templates, Array.from(templates.filter(t => t.item === 'physicochemical'), t => t.id),
    '应只加载完整的 203 条理化模板');
  assert.equal(loaded.recordTables, 'undefined', '鉴别源表状态资产不应再加载到页面');
  const identificationRequests = loaded.requests.filter(url => /identification-(templates|record-tables)/.test(url));
  assert.deepEqual(identificationRequests, [], `仍在请求鉴别资产：${identificationRequests.join(',')}`);

  await page.locator('[data-tab="physicochemical"]').click();
  assert.equal(await page.locator('.sheet.active .identification-record').count(), 0, '选模板前不显示记录表');
  await page.locator('[data-identification-search="physicochemical"]').fill('自然铜');
  await page.locator('[data-identification-product="自然铜"]').click();
  const choices = page.locator('.sheet.active [data-identification-template]');
  assert.equal(await choices.count(), 2, '自然铜原料/成品应分开选择');
  const finished = templates.find(t => t.item === 'physicochemical' && t.baseProduct === '自然铜' && t.kind === '成品');
  const raw = templates.find(t => t.item === 'physicochemical' && t.baseProduct === '自然铜' && t.kind === '原料');
  await page.locator(`[data-identification-template="${finished.id}"]`).click();
  assert((await page.locator('.sheet.active .identification-lines').innerText()).includes('硫氰酸铵试液'),
    '自然铜成品应显示原记录中的反应步骤');
  const field = key => page.locator(`[data-k="physicochemical.${key}"]`);
  await field('sampleNo').fill('LH-20261020');
  await field('result').fill('滴加硫氰酸铵试液，显血红色。');
  await field('conclusion').selectOption('符合规定');
  await page.reload();
  await page.locator('[data-tab="physicochemical"]').click();
  assert.equal(await field('sampleNo').inputValue(), 'LH-20261020');
  assert.equal(await field('result').inputValue(), '滴加硫氰酸铵试液，显血红色。');
  assert.equal(await field('conclusion').inputValue(), '符合规定');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-initialize-project="physicochemical"]').click();
  assert.equal(await field('sampleNo').inputValue(), 'LH-20261020', '取消初始化应保留数据');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-initialize-project="physicochemical"]').click();
  for (const key of ['sampleNo', 'result', 'conclusion']) assert.equal(await field(key).inputValue(), '');
  assert.equal(await page.locator(`[data-identification-template="${finished.id}"].selected`).count(), 1);
  await field('result').fill('旧批次数据');
  await page.locator(`[data-identification-template="${raw.id}"]`).click();
  assert.equal(await field('result').inputValue(), '', '更换原料/成品应清空旧数据');
  assert(!(await page.locator('.sheet.active .identification-lines').innerText()).includes('硫氰酸铵试液'),
    '原料不应混入成品记录的具体步骤');
  await page.locator(`[data-identification-template="${finished.id}"]`).click();
  assert.equal(await field('result').inputValue(), '', '切回模板不应恢复旧批次');

  // 全部理化模板均显示各自原文与空白填写区，结论须由检验员选择。
  for (const template of templates.filter(t => t.item === 'physicochemical')) {
    await page.evaluate(id => applyIdentificationTemplate('physicochemical', id), template.id);
    const actual = await page.locator('.sheet.active .identification-block').evaluateAll(blocks => blocks.map(block => ({
      title: block.querySelector('h3')?.textContent || '',
      lines: [...block.querySelectorAll('p')].map(p => p.textContent),
    })));
    assert.deepEqual(actual, JSON.parse(JSON.stringify(template.blocks)), `${template.id}: 原文不完整`);
    assert.equal(await field('conclusion').inputValue(), '', `${template.id}: 不应预判结论`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await field('result').isVisible(), '手机应可填写理化结果');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '手机页面不应横向溢出');
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 去掉鉴别项目后其余页面仍可正常使用。
  await page.locator('[data-tab="moisture"]').click();
  await page.locator('[data-quality-search="moisture"]').fill('北沙参');
  await page.locator('[data-quality-product="北沙参"]').click();
  await page.locator('.sheet.active [data-quality-template]').first().click();
  assert(await page.locator('.sheet.active .word-record-table').count() > 0, '去掉鉴别项目后水分表格无法显示');
  assert.deepEqual(errors, []);
  console.log('PASS: 理化 203 份原文、品名搜索、原料/成品隔离、保存、初始化和手机布局；显微/薄层仍隐藏');
} finally {
  await browser.close();
}
