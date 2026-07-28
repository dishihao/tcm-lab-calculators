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

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto(PAGE_URL);
await page.waitForLoadState('networkidle');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState('networkidle');

await page.locator('[data-tab="sulfur"]').click();
const audit = await page.evaluate(() => ({
  counts: SULFUR_DIOXIDE_TEMPLATE_COUNTS,
  ids: SULFUR_DIOXIDE_TEMPLATES.map(template => template.id),
  invalid: SULFUR_DIOXIDE_TEMPLATES.filter(template =>
    template.item !== 'sulfur' || !['原料', '成品'].includes(template.kind) ||
    template.limop !== 'le' || !Number.isFinite(Number(template.limit)) ||
    !template.standardText || !template.sourceFile ||
    !template.standardText.includes('mg/kg')
  ).map(template => template.id)
}));
assert(audit.counts.templates === 1545, '二氧化硫模板总数错误');
assert(audit.counts.records === 1543, '二氧化硫记录总数错误');
assert(audit.counts.products === 948, '二氧化硫品名总数错误');
assert(audit.counts.raw === 589, '二氧化硫原料模板数错误');
assert(audit.counts.finished === 956, '二氧化硫成品模板数错误');
assert(audit.counts.raw + audit.counts.finished === audit.counts.templates, '二氧化硫原料/成品计数不一致');
assert(new Set(audit.ids).size === audit.ids.length, '二氧化硫模板 ID 不唯一');
assert(audit.invalid.length === 0, `存在无效二氧化硫模板：${audit.invalid.join(',')}`);

const template = await page.evaluate(() =>
  SULFUR_DIOXIDE_TEMPLATES.find(item => item.limit === '150') || SULFUR_DIOXIDE_TEMPLATES[0]
);
await page.locator('[data-quality-search="sulfur"]').fill(template.baseProduct);
await page.locator(`[data-quality-product="${template.baseProduct}"]`).click();
await page.locator(`[data-quality-template="${template.id}"]`).click();
assert(await field(page, 'sulfur.limval').inputValue() === template.limit, '模板限度未带出');
const expectedStandard = template.standardText.replace(/^\d*\.?\s*标准规定\s*[：:]?\s*/, '');
assert((await page.locator('.sheet.active .standard-quote').innerText()).includes(expectedStandard),
  '标准规定原文未显示');

await field(page, 'sulfur.C').fill('0.01');
await field(page, 'sulfur.Vblank').fill('0.50');
await field(page, 'sulfur.VblankCorr').fill('-0.01');
await field(page, 'sulfur.Ws.1').fill('10');
await field(page, 'sulfur.Ws.2').fill('10');
await field(page, 'sulfur.Vsample.1').fill('1.50');
await field(page, 'sulfur.Vsample.2').fill('1.49');
await field(page, 'sulfur.VsampleCorr.1').fill('0.01');
await field(page, 'sulfur.VsampleCorr.2').fill('0.02');

assert(await page.locator('#sulfur\\.out\\.VblankPrime').innerText() === '0.490', '空白校正体积错误');
assert(await page.locator('#sulfur\\.out\\.Vprime\\.1').innerText() === '1.510', '供试品1校正体积错误');
assert(await page.locator('#sulfur\\.out\\.X\\.1').innerText() === '32.6', '供试品1计算错误');
assert(await page.locator('#sulfur\\.out\\.X\\.2').innerText() === '32.6', '供试品2计算错误');
assert(await page.locator('#sulfur\\.out\\.MEAN').innerText() === '33', '平均含量修约错误');
assert((await page.locator('#sulfur\\.judge').innerText()) === '符合规定', '限度判定错误');

page.once('dialog', dialog => dialog.accept());
await page.locator('[data-initialize-project="sulfur"]').click();
for (const key of ['sulfur.C', 'sulfur.Vblank', 'sulfur.Ws.1', 'sulfur.Vsample.1']) {
  assert(await field(page, key).inputValue() === '', `初始化未清空 ${key}`);
}
assert(await field(page, 'sulfur.limval').inputValue() === template.limit, '初始化后未保留模板限度');
assert(await page.locator(`[data-quality-template="${template.id}"].selected`).count() === 1,
  '初始化后未保留二氧化硫模板');

await page.screenshot({ path: 'C:/tmp/sulfur-dioxide-calculator.png', fullPage: true });
assert(errors.length === 0, `页面脚本错误：${errors.join('; ')}`);
await browser.close();
console.log(`PASS: ${audit.counts.templates} 个二氧化硫模板、滴定校正、计算、判定及初始化`);
