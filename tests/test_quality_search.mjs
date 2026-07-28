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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto(PAGE_URL);
await page.waitForLoadState('networkidle');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState('networkidle');

const audit = await page.evaluate(() => {
  const ids = QUALITY_TEMPLATES.map(t => t.id);
  return {
    total: ids.length,
    uniqueIds: new Set(ids).size,
    counts: QUALITY_TEMPLATE_COUNTS,
    invalid: QUALITY_TEMPLATES.filter(t =>
      !t.label || !t.standardText || !t.method || !['le', 'ge'].includes(t.limop) ||
      !Number.isFinite(Number(t.limit))
    ).map(t => t.id)
  };
});
assert(audit.total === 3665, '质量项目模板总数错误');
assert(audit.uniqueIds === audit.total, '质量项目模板 ID 不唯一');
assert(audit.invalid.length === 0, `存在无效模板: ${audit.invalid.join(',')}`);

const selectTemplate = async (item, template) => {
  await page.locator(`[data-tab="${item}"]`).click();
  const search = page.locator(`[data-quality-search="${item}"]`);
  await search.fill(template.label);
  const result = page.locator(`[data-quality-template="${template.id}"]`);
  assert(await result.count() === 1, `${item}: 搜索结果中找不到 ${template.label}`);
  await result.click();
  assert(await field(page, `${item}.limop`).inputValue() === template.limop, `${item}: 判定方向错误`);
  assert(await field(page, `${item}.limval`).inputValue() === template.limit, `${item}: 判定限度错误`);
  assert((await page.locator('.sheet.active .standard-quote').innerText()).includes(template.standardText),
    `${item}: 标准规定原文错误`);
  assert((await page.locator('.sheet.active .method').innerText()).includes(template.method),
    `${item}: 测定方法错误`);
};

for (const item of ['impurity', 'moisture', 'ash', 'extract']) {
  const template = await page.evaluate(id => QUALITY_TEMPLATES.find(t => t.item === id), item);
  assert(template, `${item}: 没有模板`);
  await selectTemplate(item, template);
}

// 搜索组件不是 datalist/超长 select，并且空关键词只显示提示。
await page.locator('[data-tab="impurity"]').click();
assert(await page.locator('[data-quality-search="impurity"]').getAttribute('list') === null, '仍在使用 datalist');
await page.locator('[data-quality-search="impurity"]').focus();
assert(await page.locator('[data-quality-results="impurity"]').isVisible(), '搜索结果面板没有显示');

// 水分第四法使用馏出水量公式；第二/三法及烘干法使用质量差公式。
const fourth = await page.evaluate(() => QUALITY_TEMPLATES.find(t => t.item === 'moisture' && t.methodType === 'fourth'));
await selectTemplate('moisture', fourth);
assert(await field(page, 'moisture.Vwater.1').count() === 1, '第四法没有馏出水量输入');
await field(page, 'moisture.Ws.1').fill('10');
await field(page, 'moisture.Vwater.1').fill('0.5');
await field(page, 'moisture.Ws.2').fill('10');
await field(page, 'moisture.Vwater.2').fill('0.5');
assert(await page.locator('#moisture\\.out\\.MEAN').innerText() === '5.0', '第四法水分计算错误');

const dry = await page.evaluate(() => QUALITY_TEMPLATES.find(t => t.item === 'moisture' && t.methodType === 'dry'));
await selectTemplate('moisture', dry);
assert(await field(page, 'moisture.W0b.1').count() === 1, '干燥称量法字段缺失');
assert(await field(page, 'moisture.Vwater.1').count() === 0, '干燥称量法仍显示第四法字段');

// 清除模板后恢复手工标准模式。
await page.locator('[data-clear-quality-template="moisture"]').click();
assert(await page.locator('.sheet.active .standard-quote').count() === 0, '清除模板后仍显示模板标准');

await page.locator('[data-quality-search="moisture"]').fill('薄荷');
assert(await page.locator('[data-quality-results="moisture"] .quality-result').count() > 0, '薄荷搜索没有结果');
await page.screenshot({ path: 'C:/tmp/quality-template-search.png', fullPage: true });
assert(errors.length === 0, `页面脚本错误: ${errors.join('; ')}`);
await browser.close();
console.log(`PASS: ${audit.total} 条质量项目模板、四类搜索、标准原文及水分方法分支`);
