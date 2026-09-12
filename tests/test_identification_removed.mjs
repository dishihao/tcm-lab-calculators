/*
 * 显微、薄层、理化三个鉴别项目已按要求从页面去掉：
 * 不再生成页签和表格，也不再向浏览器加载 2.6MB 的鉴别模板与源表状态资产。
 * 模板数据本身仍保留在仓库里（离线校验），需要恢复时改 IDENTIFICATION_TABS_ENABLED 并加回脚本即可。
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
  assert.deepEqual(tabs, ['impurity', 'moisture', 'ash', 'extract', 'sulfur', 'assay', 'environment'],
    '页签应为杂质、水分、总灰分、浸出物、二氧化硫、含量测定、温湿度记录');
  for (const item of Object.keys(EXPECTED)) {
    assert.equal(await page.locator(`[data-tab="${item}"]`).count(), 0, `${item}: 页签仍存在`);
    assert.equal(await page.locator(`section[data-sheet="${item}"]`).count(), 0, `${item}: 页面仍存在`);
  }

  const loaded = await page.evaluate(() => ({
    templates: typeof IDENTIFICATION_TEMPLATES,
    recordTables: typeof window.IDENTIFICATION_RECORD_TABLES,
    requests: performance.getEntriesByType('resource').map(entry => entry.name),
  }));
  assert.equal(loaded.templates, 'undefined', '鉴别模板资产不应再加载到页面');
  assert.equal(loaded.recordTables, 'undefined', '鉴别源表状态资产不应再加载到页面');
  const identificationRequests = loaded.requests.filter(url => /identification-(templates|record-tables)/.test(url));
  assert.deepEqual(identificationRequests, [], `仍在请求鉴别资产：${identificationRequests.join(',')}`);

  // 去掉鉴别项目后其余页面仍可正常使用。
  await page.locator('[data-tab="moisture"]').click();
  await page.locator('[data-quality-search="moisture"]').fill('北沙参');
  await page.locator('[data-quality-product="北沙参"]').click();
  await page.locator('.sheet.active [data-quality-template]').first().click();
  assert(await page.locator('.sheet.active .word-record-table').count() > 0, '去掉鉴别项目后水分表格无法显示');
  assert.deepEqual(errors, []);
  console.log('PASS: 显微/薄层/理化页签与页面已去掉、资产不再加载，模板数据完整可恢复');
} finally {
  await browser.close();
}
