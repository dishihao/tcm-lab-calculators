import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const PAGE_URL = new URL('../index.html', import.meta.url).href;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const field = (page, key) => page.locator(`[data-k="${key}"]`);
const acceptInitialize = async (page, projectId) => {
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-initialize-project="${projectId}"]`).click();
};

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto(PAGE_URL);
await page.waitForLoadState('networkidle');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState('networkidle');

const qualityItems = ['impurity', 'moisture', 'ash', 'extract'];
for (const item of qualityItems) {
  const template = await page.evaluate(id => QUALITY_TEMPLATES.find(t => t.item === id), item);
  await page.locator(`[data-tab="${item}"]`).click();
  await page.locator(`[data-quality-search="${item}"]`).fill(template.baseProduct);
  await page.locator(`[data-quality-product="${template.baseProduct}"]`).click();
  await page.locator(`[data-quality-template="${template.id}"]`).click();

  const cells = page.locator('.sheet.active input.cell');
  assert(await cells.count() > 0, `${item}: 没有可填写数据`);
  await cells.first().fill('12.34');
  await field(page, `${item}.limval`).fill('99');
  await acceptInitialize(page, item);

  const values = await page.locator('.sheet.active input.cell').evaluateAll(inputs => inputs.map(input => input.value));
  assert(values.every(value => value === ''), `${item}: 初始化后仍有检验数据`);
  assert(await field(page, `${item}.limval`).inputValue() === template.limit,
    `${item}: 初始化后没有恢复模板限度`);
  assert(await page.locator(`[data-quality-template="${template.id}"].selected`).count() === 1,
    `${item}: 初始化后没有保留模板`);
}

await page.locator('[data-tab="assay"]').click();
const assayTemplate = await page.evaluate(() =>
  HPLC_TEMPLATES.find(t => !t.incomplete && t.kind === '原料' && t.limit && t.standardText)
);
await page.locator('[data-assay-search]').fill(assayTemplate.product);
await page.locator(`[data-assay-product-choice="${assayTemplate.product}"]`).click();
await page.locator(`[data-assay-template-button="${assayTemplate.id}"]`).click();
await field(page, 'assay.Cref').fill('0.5');
await field(page, 'assay.refA.0').fill('12345');
await field(page, 'assay.Ws.1').fill('0.25');
await field(page, 'assay.limval').fill('99');
await acceptInitialize(page, 'assay');

for (const key of ['assay.Cref', 'assay.refA.0', 'assay.Ws.1']) {
  assert(await field(page, key).inputValue() === '', `含量测定: ${key} 没有清空`);
}
assert(await field(page, 'assay.limval').inputValue() === assayTemplate.limit,
  '含量测定: 初始化后没有恢复模板限度');
assert(await field(page, 'assay.name').inputValue() === assayTemplate.name,
  '含量测定: 初始化后没有保留成分模板');
assert(await page.locator(`[data-assay-template-button="${assayTemplate.id}"].selected`).count() === 1,
  '含量测定: 初始化后没有保留模板');

// 精确 GC 初始化：清空新增的批次/来源/进样量/峰面积及输出，
// 但保留模板、源固定文字、公开安全的模板/角色路由和可见布局。
await field(page, 'assay.tech').selectOption('gc');
const assayProductChange = page.locator('[data-change-assay-product]');
if (await assayProductChange.count()) await assayProductChange.click();
await page.locator('[data-assay-search]').fill('广藿香');
await page.waitForTimeout(100);
await page.locator('[data-assay-product-choice="广藿香"]').click();
await page.waitForTimeout(100);
await page.evaluate(() => applyAssayTemplate('patchouli-patchoulol'));
const gcTemplateBeforeInit = await page.evaluate(() => {
  const active = document.querySelector('.sheet.active');
  const tables = Array.from(active?.querySelectorAll('.word-record-table') || []);
  const standard = active?.querySelector('.standard-quote')?.innerText || '';
  if (store['assay.template'] !== 'patchouli-patchoulol') throw new Error('精确 GC 模板没有被选中');
  if (store['assay.template'] !== 'patchouli-patchoulol') throw new Error(`精确 GC 模板状态错误: ${store['assay.template']}`);
  if (!standard) throw new Error('广藿香标准原文为空');
  if (!standard.includes('百秋李醇')) throw new Error(`百秋李醇标准原文缺失: ${standard}`);
  if (tables.length !== 2) throw new Error(`精确 GC 未渲染两张 Word 表: ${tables.length}`);
  const routes = tables.map(table => ({ templateId: table.getAttribute('data-word-template-id'), role: table.getAttribute('data-word-table-role') }));
  if (JSON.stringify(routes) !== JSON.stringify([{ templateId: 'patchouli-patchoulol', role: 'reference' }, { templateId: 'patchouli-patchoulol', role: 'sample' }])) throw new Error(`广藿香公开路由错误: ${JSON.stringify(routes)}`);
  if (tables.some(table => table.hasAttribute('data-source-table-index'))) throw new Error('精确 GC DOM 泄露源表索引');
  const geometry = tables.map(table => ({
    width: Number(table.getAttribute('data-word-render-width-pt')),
    scale: Number(table.getAttribute('data-word-render-scale')),
    rows: table.rows.length,
  }));
  if (!geometry.every(item => item.width > 0 && item.scale > 0 && item.rows > 0)) throw new Error('精确 GC 可见几何属性缺失');
  const cellText = (table, marker) => Array.from(table.querySelectorAll('th,td'))
    .map(cell => cell.innerText).find(text => text.includes(marker)) || '';
  const fixedLabels = {
    reference: [cellText(tables[0], '正十八烷批号'), cellText(tables[0], '百秋李醇批号')],
    sample: [cellText(tables[1], '样品编号'), cellText(tables[1], '正十八烷峰面积'), cellText(tables[1], '百秋李醇面积')],
  };
  if (fixedLabels.reference.some(text => !text) || fixedLabels.sample.some(text => !text)) throw new Error('精确 GC 源表固定标签缺失');
  return { id: store['assay.template'], standard, routes, geometry, fixedLabels };
});
for (const [key, value] of Object.entries({
  'assay.refBatch': 'REF-INIT', 'assay.refSource': 'SRC-INIT', 'assay.refInjection': '0.8',
  'assay.internalBatch': 'IS-INIT', 'assay.sampleInjection.1': '1.0', 'assay.sampleInjection.2': '1.1',
  'assay.refA.0': '101', 'assay.refA.1': '102', 'assay.refA.2': '103', 'assay.refA.3': '104', 'assay.refA.4': '105',
  'assay.Cref': '2', 'assay.Cis': '1', 'assay.Q': '0',
  'assay.refIS.0': '200', 'assay.refIS.1': '200', 'assay.refIS.2': '200', 'assay.refIS.3': '200', 'assay.refIS.4': '200',
  'assay.smpA.1.0': '11', 'assay.smpA.1.1': '12', 'assay.smpA.1.2': '13',
  'assay.smpA.2.0': '21', 'assay.smpA.2.1': '22', 'assay.smpA.2.2': '23',
  'assay.smpIS.1.0': '200', 'assay.smpIS.1.1': '200', 'assay.smpIS.2.0': '200', 'assay.smpIS.2.1': '200',
  'assay.Ws.1': '1', 'assay.Ws.2': '1', 'assay.f.1': '10', 'assay.f.2': '10',
})) await field(page, key).fill(value);
assert(await page.locator('#assay\\.out\\.MEAN').innerText() !== '', '精确 GC 初始化前没有计算输出');
await acceptInitialize(page, 'assay');
await page.locator('[data-tab="assay"]').click();
assert(await field(page, 'assay.tech').inputValue() === 'gc', '精确气相初始化后方法被改回液相');
for (const key of [
  'assay.refIS.0', 'assay.refIS.1', 'assay.refIS.2', 'assay.refIS.3', 'assay.refIS.4',
  'assay.smpIS.1.0', 'assay.smpIS.1.1', 'assay.smpIS.2.0', 'assay.smpIS.2.1',
]) assert(await field(page, key).inputValue() === '', `精确气相初始化后没有清空 ${key}`);
for (const key of [
  'assay.refBatch', 'assay.refInjection', 'assay.internalBatch',
  'assay.sampleInjection.1', 'assay.sampleInjection.2', 'assay.refA.0', 'assay.refA.4',
  'assay.smpA.1.0', 'assay.smpA.2.2',
]) assert(await field(page, key).inputValue() === '', `精确气相初始化后没有清空 ${key}`);
for (const key of ['assay.out.Aref', 'assay.out.A.1', 'assay.out.A.2', 'assay.out.MEAN'])
  assert(await page.locator(`#${key.replaceAll('.', '\\.')}`).innerText() === '', `精确气相初始化后没有清空 ${key}`);
assert(await field(page, 'assay.refSource').inputValue() === '中检院', '初始化后对照品来源应恢复默认值');
const gcTemplateAfterInit = await page.evaluate(() => ({
  id: store['assay.template'],
  standard: document.querySelector('.sheet.active')?.querySelector('.standard-quote')?.innerText || '',
  routes: Array.from(document.querySelector('.sheet.active')?.querySelectorAll('.word-record-table') || []).map(table => ({ templateId: table.getAttribute('data-word-template-id'), role: table.getAttribute('data-word-table-role') })),
  geometry: Array.from(document.querySelector('.sheet.active')?.querySelectorAll('.word-record-table') || []).map(table => ({
    width: Number(table.getAttribute('data-word-render-width-pt')),
    scale: Number(table.getAttribute('data-word-render-scale')),
    rows: table.rows.length,
  })),
  fixedLabels: (() => {
    const tables = Array.from(document.querySelector('.sheet.active')?.querySelectorAll('.word-record-table') || []);
    const cellText = (table, marker) => Array.from(table?.querySelectorAll('th,td') || [])
      .map(cell => cell.innerText).find(text => text.includes(marker)) || '';
    return {
      reference: [cellText(tables[0], '正十八烷批号'), cellText(tables[0], '百秋李醇批号')],
      sample: [cellText(tables[1], '样品编号'), cellText(tables[1], '正十八烷峰面积'), cellText(tables[1], '百秋李醇面积')],
    };
  })(),
}));
assert(JSON.stringify(gcTemplateAfterInit) === JSON.stringify(gcTemplateBeforeInit),
  `精确气相初始化不应改变模板、标准原文、公开路由或可见布局: ${JSON.stringify(gcTemplateBeforeInit)} -> ${JSON.stringify(gcTemplateAfterInit)}`);

for (const item of ['microscopy', 'tlc', 'physicochemical']) {
  const template = await page.evaluate(id => IDENTIFICATION_TEMPLATES.find(t => t.item === id), item);
  assert(template, `${item}: 没有鉴别模板`);
  await page.locator(`[data-tab="${item}"]`).click();
  await page.locator(`[data-identification-search="${item}"]`).fill(template.baseProduct);
  await page.locator(`[data-identification-product="${template.baseProduct}"]`).click();
  await page.locator(`[data-identification-template="${template.id}"]`).click();
  await field(page, `${item}.sampleNo`).fill('TEST-001');
  await field(page, `${item}.result`).fill('测试填写内容');
  await field(page, `${item}.conclusion`).selectOption('符合规定');
  await acceptInitialize(page, item);
  assert(await field(page, `${item}.sampleNo`).inputValue() === '', `${item}: 样品编号没有清空`);
  assert(await field(page, `${item}.result`).inputValue() === '', `${item}: 检验结果没有清空`);
  assert(await field(page, `${item}.conclusion`).inputValue() === '', `${item}: 结论没有清空`);
  assert(await page.locator(`[data-identification-template="${template.id}"].selected`).count() === 1,
    `${item}: 初始化后没有保留鉴别模板`);
}

assert(await page.locator('[data-initialize-project]').count() === 9, '初始化按钮没有覆盖全部九个项目');
await page.screenshot({ path: 'C:/tmp/initialize-buttons.png', fullPage: true });
assert(errors.length === 0, `页面脚本错误: ${errors.join('; ')}`);
await browser.close();
console.log('PASS: 九个项目初始化按钮均能清空检验数据并保留当前模板标准');
