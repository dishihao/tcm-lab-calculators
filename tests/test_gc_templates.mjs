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
const fillPeaks = async (page, prefix, values) => {
  for (let i = 0; i < values.length; i++) {
    await field(page, `${prefix}.${i}`).fill(String(values[i]));
  }
};
const chooseTemplate = async (page, templateId) => {
  const template = await page.evaluate(id => GC_TEMPLATES.find(t => t.id === id), templateId);
  assert(template, `找不到模板 ${templateId}`);
  const productInput = page.locator('[data-assay-product]');
  await productInput.fill(template.product);
  await productInput.press('Enter');
  const record = page.locator('[data-assay-record]');
  if (await record.count()) await record.selectOption(template.recordKey);
  const component = page.locator('[data-assay-component]');
  if (await component.count()) await component.selectOption(templateId);
  return template;
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
await page.locator('[data-tab="assay"]').click();

const templateIds = await page.evaluate(() => GC_TEMPLATES.map(t => t.id));
const recordCount = await page.evaluate(() => new Set(GC_TEMPLATES.map(t => t.recordKey)).size);
assert(await page.locator('#gcProductList option').count() === 14, '品种候选数量不正确');
assert(templateIds.length === 33, '气相成分模板数量不正确');
assert(recordCount === 28, '原料/成品记录数量不正确');

for (const templateId of templateIds) {
  const template = await chooseTemplate(page, templateId);
  assert(await page.locator('[data-assay-product]').inputValue() === template.product, `${templateId}: 品种名错误`);
  assert(await field(page, 'assay.name').inputValue() === template.name, `${templateId}: 成分名错误`);
  assert(await field(page, 'assay.tech').inputValue() === 'gc', `${templateId}: 不是气相`);
  assert(await field(page, 'assay.mode').inputValue() === template.mode, `${templateId}: 定量方法错误`);
  assert(await field(page, 'assay.platesLim').inputValue() === template.plates, `${templateId}: 板数错误`);
  assert(await field(page, 'assay.limval').inputValue() === template.limit, `${templateId}: 判定限度错误`);
  assert(await field(page, 'assay.dryBasis').isChecked() === template.dry, `${templateId}: 干燥品口径错误`);
  assert(await page.locator('th', { hasText: '水分 Q' }).count() === (template.dry ? 1 : 0),
    `${templateId}: 水分行错误`);
  assert((await page.locator('.standard-quote').innerText()).includes(template.standardText),
    `${templateId}: 标准规定原文错误`);
}

// 同名原料/成品必须保持各自标准；新增四个品种必须可选。
await chooseTemplate(page, 'mint-menthol');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.20%'), '薄荷原料标准错误');
assert((await page.locator('.standard-quote').innerText()).includes('内控标准'), '薄荷原料内控标准缺失');
await chooseTemplate(page, 'mint-menthol-finished');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.13%'), '薄荷成品标准错误');
await chooseTemplate(page, 'fennel-anethole-salted-finished');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于1.3%'), '盐小茴香标准错误');
for (const id of ['cardamom-eucalyptol', 'dendrobium-dendrobine', 'amomum-bornyl-acetate', 'pine-alpha-pinene']) {
  await chooseTemplate(page, id);
}

// 任意输入一个未预置品种，也应保留为自定义品种。
await page.locator('[data-assay-product]').fill('自定义品种');
await page.locator('[data-assay-product]').press('Enter');
assert(await page.locator('[data-assay-product]').inputValue() === '自定义品种', '自定义品种输入未保留');

// 外标法、非干燥品口径：不要求 Q。
await chooseTemplate(page, 'star-anise-anethole');
await fillPeaks(page, 'assay.refA', [100, 100, 100, 100, 100]);
await field(page, 'assay.Cref').fill('1');
for (const sample of [1, 2]) {
  await field(page, `assay.Ws.${sample}`).fill('1');
  await field(page, `assay.f.${sample}`).fill('10');
  await fillPeaks(page, `assay.smpA.${sample}`, [50, 50]);
}
assert(await page.locator('#assay\\.out\\.MEAN').innerText() === '0.5', '外标法计算错误');

// 内标法：f=(A内×C对)/(A对×C内)=4，两个样品含量均为 2.00%。
await chooseTemplate(page, 'patchouli-patchoulol');
await fillPeaks(page, 'assay.refIS', [200, 200, 200, 200, 200]);
await fillPeaks(page, 'assay.refA', [100, 100, 100, 100, 100]);
await field(page, 'assay.Cis').fill('1');
await field(page, 'assay.Cref').fill('2');
await field(page, 'assay.Q').fill('0');
for (const sample of [1, 2]) {
  await field(page, `assay.Ws.${sample}`).fill('1');
  await field(page, `assay.f.${sample}`).fill('10');
  await fillPeaks(page, `assay.smpIS.${sample}`, [200, 200]);
  await fillPeaks(page, `assay.smpA.${sample}`, [100, 100]);
}
assert(await page.locator('#assay\\.out\\.factor').innerText() === '4', '校正因子错误');
assert(await page.locator('#assay\\.out\\.MEAN').innerText() === '2.00', '内标法计算错误');
await page.screenshot({ path: 'C:/tmp/gc-internal-template.png', fullPage: true });

// 不同模板的数据应隔离保存。
await field(page, 'assay.Cref').fill('9');
await chooseTemplate(page, 'mint-menthol');
await field(page, 'assay.Cref').fill('8');
await chooseTemplate(page, 'patchouli-patchoulol');
assert(await field(page, 'assay.Cref').inputValue() === '9', '广藿香数据未恢复');
await chooseTemplate(page, 'mint-menthol');
assert(await field(page, 'assay.Cref').inputValue() === '8', '薄荷数据未恢复');

// 两成分总量模板：当前 0.10% + 另一成分 13.00% = 13.10%。
await chooseTemplate(page, 'flax-linoleic');
await fillPeaks(page, 'assay.refA', [100, 100, 100, 100, 100]);
await field(page, 'assay.Cref').fill('1');
await field(page, 'assay.Q').fill('0');
for (const sample of [1, 2]) {
  await field(page, `assay.Ws.${sample}`).fill('1');
  await field(page, `assay.f.${sample}`).fill('1');
  await fillPeaks(page, `assay.smpA.${sample}`, [100, 100]);
}
await field(page, 'assay.partnerMean').fill('13');
assert(await page.locator('#assay\\.out\\.TOTAL').innerText() === '13.1', '双成分总量错误');
assert(await page.locator('#assay\\.judge').innerText() === '符合规定', '双成分总量判定错误');

await page.screenshot({ path: 'C:/tmp/gc-templates.png', fullPage: true });
assert(errors.length === 0, `页面脚本错误: ${errors.join('; ')}`);
await browser.close();
console.log(`PASS: ${templateIds.length} 个气相成分模板、${recordCount} 条原料/成品记录、标准原文、计算及数据隔离`);
