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
