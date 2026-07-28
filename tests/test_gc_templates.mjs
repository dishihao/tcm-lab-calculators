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
  const template = await page.evaluate(id => ASSAY_TEMPLATES.find(t => t.id === id), templateId);
  assert(template, `找不到模板 ${templateId}`);
  if (await field(page, 'assay.tech').inputValue() !== template.tech) {
    await field(page, 'assay.tech').selectOption(template.tech);
  }
  const change = page.locator('[data-change-assay-product]');
  if (await change.count()) await change.click();
  await page.locator('[data-assay-search]').fill(template.product);
  const product = page.locator(`[data-assay-product-choice="${template.product}"]`);
  assert(await product.count() === 1, `品名搜索中找不到 ${template.product}`);
  await product.click();
  const button = page.locator(`[data-assay-template-button="${template.id}"]`);
  assert(await button.count() === 1, `${template.product} 下找不到模板 ${template.id}`);
  await button.click();
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

const audit = await page.evaluate(() => ({
  hplc: HPLC_TEMPLATE_COUNTS,
  hplcIds: HPLC_TEMPLATES.map(t => t.id),
  hplcProducts: new Set(HPLC_TEMPLATES.map(t => t.product)).size,
  gcIds: GC_TEMPLATES.map(t => t.id),
  gcRecords: new Set(GC_TEMPLATES.map(t => t.recordKey)).size,
  invalidTech: ASSAY_TEMPLATES.filter(t => !['hplc', 'gc'].includes(t.tech)).map(t => t.id),
}));
assert(audit.hplc.records === 603, '液相记录总数错误');
assert(audit.hplc.rawRecords === 250, '液相原料记录数错误');
assert(audit.hplc.finishedRecords === 353, '液相成品记录数错误');
assert(audit.hplc.templates === 1037, '液相成分模板总数错误');
assert(audit.hplc.products === 385, '液相去重品名数错误');
assert(audit.hplcProducts === audit.hplc.products, '液相品名统计不一致');
assert(new Set(audit.hplcIds).size === audit.hplcIds.length, '液相模板 ID 不唯一');
assert(audit.gcIds.length === 33, '气相成分模板数量不正确');
assert(audit.gcRecords === 28, '气相原料/成品记录数量不正确');
assert(audit.invalidTech.length === 0, '存在未区分液相/气相的模板');

// 默认液相：先选品名，再显示该品名的原料/成品及成分模板。
assert(await field(page, 'assay.tech').inputValue() === 'hplc', '默认方法不是液相');
assert((await page.locator('[data-assay-picker] .quality-picker-title').innerText()).includes(`${audit.hplc.products} 个品名`),
  '液相品名总数没有显示');
const hplcComplete = await page.evaluate(() =>
  HPLC_TEMPLATES.find(t => !t.incomplete && t.kind === '原料' && t.limit && t.standardText)
);
const chosenHplc = await chooseTemplate(page, hplcComplete.id);
assert(await field(page, 'assay.tech').inputValue() === 'hplc', '液相模板错误切换到气相');
assert(await field(page, 'assay.name').inputValue() === chosenHplc.name, '液相成分名错误');
assert(await field(page, 'assay.limval').inputValue() === chosenHplc.limit, '液相判定限度错误');
assert((await page.locator('.standard-quote').innerText()).includes(chosenHplc.standardText),
  '液相标准规定原文错误');

const rangeHplc = await page.evaluate(() => HPLC_TEMPLATES.find(t => t.limop === 'range' && t.upperLimit));
await chooseTemplate(page, rangeHplc.id);
assert(await field(page, 'assay.limop').inputValue() === 'range', '液相范围限度方向错误');
assert(await field(page, 'assay.limval').inputValue() === rangeHplc.limit, '液相范围下限错误');
assert(await field(page, 'assay.limmax').inputValue() === rangeHplc.upperLimit, '液相范围上限错误');
await page.screenshot({ path: 'C:/tmp/hplc-template-selected.png', fullPage: true });

// 方法切换必须分开列表，不能让当前方法显示另一种方法的模板。
await field(page, 'assay.tech').selectOption('gc');
assert(await page.locator('[data-assay-search]').count() === 1, '切换气相后没有品名搜索');
await page.locator('[data-assay-search]').fill('薄荷');
await page.locator('[data-assay-product-choice="薄荷"]').click();
const visibleTechs = await page.locator('[data-assay-template-button]').evaluateAll(buttons =>
  buttons.map(button => ASSAY_TEMPLATES.find(t => t.id === button.dataset.assayTemplateButton)?.tech)
);
assert(visibleTechs.length > 0 && visibleTechs.every(tech => tech === 'gc'), '气相页面混入液相模板');

for (const templateId of audit.gcIds) {
  const template = await chooseTemplate(page, templateId);
  assert(await field(page, 'assay.name').inputValue() === template.name, `${templateId}: 成分名错误`);
  assert(await field(page, 'assay.tech').inputValue() === 'gc', `${templateId}: 不是气相`);
  assert(await field(page, 'assay.mode').inputValue() === template.mode, `${templateId}: 定量方法错误`);
  assert(await field(page, 'assay.platesLim').inputValue() === template.plates, `${templateId}: 板数错误`);
  assert(await field(page, 'assay.limval').inputValue() === template.limit, `${templateId}: 判定限度错误`);
  assert(await field(page, 'assay.dryBasis').isChecked() === template.dry, `${templateId}: 干燥品口径错误`);
  assert((await page.locator('.standard-quote').innerText()).includes(template.standardText),
    `${templateId}: 标准规定原文错误`);
}

// 同名气相原料/成品必须保持各自标准。
await chooseTemplate(page, 'mint-menthol');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.20%'), '薄荷原料标准错误');
await chooseTemplate(page, 'mint-menthol-finished');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.13%'), '薄荷成品标准错误');

// 任意输入一个未预置品种，也应保留为当前方法的自定义品种。
await page.locator('[data-assay-product]').fill('自定义品种');
await page.locator('[data-assay-product]').press('Enter');
assert(await page.locator('[data-assay-product]').inputValue() === '自定义品种', '自定义品种输入未保留');
assert(await field(page, 'assay.tech').inputValue() === 'gc', '自定义品种改变了色谱方法');

// 外标法、非干燥品口径：不要求 Q。
await chooseTemplate(page, 'star-anise-anethole');
await fillPeaks(page, 'assay.refA', [100, 100, 100, 100, 100]);
await field(page, 'assay.Cref').fill('1');
for (const sample of [1, 2]) {
  await field(page, `assay.Ws.${sample}`).fill('1');
  await field(page, `assay.f.${sample}`).fill('10');
  await fillPeaks(page, `assay.smpA.${sample}`, [50, 50]);
}
assert(await page.locator('#assay\\.out\\.MEAN').innerText() === '0.5', '外标法百分比计算错误');

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

// 不同模板的数据应隔离保存。
await field(page, 'assay.Cref').fill('9');
await chooseTemplate(page, 'mint-menthol');
await field(page, 'assay.Cref').fill('8');
await chooseTemplate(page, 'patchouli-patchoulol');
assert(await field(page, 'assay.Cref').inputValue() === '9', '广藿香数据未恢复');
await chooseTemplate(page, 'mint-menthol');
assert(await field(page, 'assay.Cref').inputValue() === '8', '薄荷数据未恢复');

// 两成分总量模板。
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

await page.screenshot({ path: 'C:/tmp/assay-templates.png', fullPage: true });
assert(errors.length === 0, `页面脚本错误: ${errors.join('; ')}`);
await browser.close();
console.log(`PASS: ${audit.hplc.templates} 个液相模板/603 条记录，33 个气相模板，方法分离、标准原文及计算`);
