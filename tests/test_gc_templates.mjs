import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const PAGE_URL = new URL('../index.html', import.meta.url).href;
const TEMPLATES = {
  'patchouli-patchoulol': ['百秋李醇', 'internal', '50000', true],
  'mugwort-eucalyptol': ['桉油精', 'external', '50000', true],
  'mugwort-borneol': ['龙脑', 'external', '50000', true],
  'star-anise-anethole': ['反式茴香脑', 'external', '30000', false],
  'mint-menthol': ['薄荷脑', 'external', '10000', true],
  'clove-eugenol': ['丁香酚', 'external', '1500', false],
  'homalomena-linalool': ['芳樟醇', 'external', '20000', true],
  'fennel-anethole': ['反式茴香脑', 'external', '5000', false],
  'brucea-oleic': ['油酸', 'internal', '5000', true],
  'flax-linoleic': ['亚油酸', 'external', '20000', true],
  'flax-linolenic': ['α-亚麻酸', 'external', '20000', true],
  'elsholtzia-thymol': ['麝香草酚', 'external', '1700', true],
  'elsholtzia-carvacrol': ['香荆芥酚', 'external', '1700', true],
};

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const field = (page, key) => page.locator(`[data-k="${key}"]`);
const fillPeaks = async (page, prefix, values) => {
  for (let i = 0; i < values.length; i++) {
    await field(page, `${prefix}.${i}`).fill(String(values[i]));
  }
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

let templateSelect = page.locator('[data-assay-template]');
assert(await templateSelect.locator('option').count() === Object.keys(TEMPLATES).length + 1,
  '模板数量不正确');

for (const [templateId, [name, mode, plates, dry]] of Object.entries(TEMPLATES)) {
  await templateSelect.selectOption(templateId);
  templateSelect = page.locator('[data-assay-template]');
  assert(await field(page, 'assay.name').inputValue() === name, `${templateId}: 成分名错误`);
  assert(await field(page, 'assay.tech').inputValue() === 'gc', `${templateId}: 不是气相`);
  assert(await field(page, 'assay.mode').inputValue() === mode, `${templateId}: 定量方法错误`);
  assert(await field(page, 'assay.platesLim').inputValue() === plates, `${templateId}: 板数错误`);
  assert(await field(page, 'assay.dryBasis').isChecked() === dry, `${templateId}: 干燥品口径错误`);
  assert(await page.locator('th', { hasText: '水分 Q' }).count() === (dry ? 1 : 0),
    `${templateId}: 水分行错误`);
}

// 外标法、非干燥品口径：不要求 Q。
await templateSelect.selectOption('star-anise-anethole');
await fillPeaks(page, 'assay.refA', [100, 100, 100, 100, 100]);
await field(page, 'assay.Cref').fill('1');
for (const sample of [1, 2]) {
  await field(page, `assay.Ws.${sample}`).fill('1');
  await field(page, `assay.f.${sample}`).fill('10');
  await fillPeaks(page, `assay.smpA.${sample}`, [50, 50]);
}
assert(await page.locator('#assay\\.out\\.MEAN').innerText() === '0.5', '外标法计算错误');

// 内标法：f=(A内×C对)/(A对×C内)=4，两个样品含量均为 2.00%。
templateSelect = page.locator('[data-assay-template]');
await templateSelect.selectOption('patchouli-patchoulol');
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
await page.locator('[data-assay-template]').selectOption('mint-menthol');
await field(page, 'assay.Cref').fill('8');
await page.locator('[data-assay-template]').selectOption('patchouli-patchoulol');
assert(await field(page, 'assay.Cref').inputValue() === '9', '广藿香数据未恢复');
await page.locator('[data-assay-template]').selectOption('mint-menthol');
assert(await field(page, 'assay.Cref').inputValue() === '8', '薄荷数据未恢复');

// 两成分总量模板：当前 0.10% + 另一成分 13.00% = 13.10%。
await page.locator('[data-assay-template]').selectOption('flax-linoleic');
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
console.log(`PASS: ${Object.keys(TEMPLATES).length} 个气相成分模板、外标法、内标法、总量判定及数据隔离`);
