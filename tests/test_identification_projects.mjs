import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const PAGE_URL = new URL('../index.html', import.meta.url).href;
const EXPECTED = {
  microscopy:{ raw:463, finished:520, total:983, products:626 },
  tlc:{ raw:411, finished:580, total:991, products:635 },
  physicochemical:{ raw:103, finished:100, total:203, products:138 }
};
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
  const actualCounts = {};
  for (const item of ['microscopy', 'tlc', 'physicochemical']) {
    const rows = IDENTIFICATION_TEMPLATES.filter(template => template.item === item);
    actualCounts[item] = {
      raw: rows.filter(template => template.kind === '原料').length,
      finished: rows.filter(template => template.kind === '成品').length,
      total: rows.length,
      products: new Set(rows.map(template => template.baseProduct)).size
    };
  }
  const invalid = IDENTIFICATION_TEMPLATES.filter(template =>
    !template.id || !template.product || !template.baseProduct || !template.label ||
    !['原料', '成品'].includes(template.kind) || !template.sourceFile ||
    !Array.isArray(template.blocks) || !template.blocks.length ||
    template.blocks.some(block => !Array.isArray(block.lines) || !block.lines.length)
  ).map(template => template.id || template.sourceFile);
  const leakedHeadings = IDENTIFICATION_TEMPLATES.flatMap(template =>
    template.blocks.flatMap(block => block.lines
      .filter(line => /【(?:检查|含量测定|浸出物|性状)】/.test(line))
      .map(line => `${template.id}: ${line}`))
  );
  return {
    total: IDENTIFICATION_TEMPLATES.length,
    uniqueIds: new Set(IDENTIFICATION_TEMPLATES.map(template => template.id)).size,
    uniqueRecords: new Set(IDENTIFICATION_TEMPLATES.map(template =>
      [template.item, template.kind, template.product].join('|'))).size,
    actualCounts,
    declaredCounts: IDENTIFICATION_TEMPLATE_COUNTS,
    invalid,
    leakedHeadings
  };
});

assert(audit.total === 2177, `鉴别模板总数错误：${audit.total}`);
assert(audit.uniqueIds === audit.total, '鉴别模板 ID 不唯一');
assert(audit.uniqueRecords === audit.total, '同项目、类型、品名出现重复模板');
assert(audit.invalid.length === 0, `鉴别模板字段不完整：${audit.invalid.slice(0, 10).join(',')}`);
assert(audit.leakedHeadings.length === 0, `鉴别正文越界到其他项目：${audit.leakedHeadings[0] || ''}`);
assert(JSON.stringify(audit.actualCounts) === JSON.stringify(EXPECTED), '鉴别模板实际数量错误');
assert(JSON.stringify(audit.declaredCounts) === JSON.stringify(EXPECTED), '鉴别模板声明数量错误');

for (const item of ['microscopy', 'tlc', 'physicochemical']) {
  assert(await page.locator(`[data-tab="${item}"]`).count() === 1, `${item}: 页签缺失`);
  const template = await page.evaluate(id => IDENTIFICATION_TEMPLATES.find(candidate =>
    candidate.item === id && /^[\u4e00-\u9fff]+$/.test(candidate.baseProduct) &&
    candidate.blocks.every(block => block.lines.every(line => !/[\u0000-\u0008]/.test(line)))
  ), item);
  assert(template, `${item}: 没有可测试模板`);

  await page.locator(`[data-tab="${item}"]`).click();
  await page.locator(`[data-identification-search="${item}"]`).fill(template.baseProduct);
  const productButton = page.locator(`[data-identification-product="${template.baseProduct}"]`);
  assert(await productButton.count() === 1, `${item}: 搜索不到 ${template.baseProduct}`);
  await productButton.click();

  const expectedProductTemplates = await page.evaluate(({ id, product }) =>
    IDENTIFICATION_TEMPLATES.filter(candidate =>
      candidate.item === id && candidate.baseProduct === product).length,
  { id:item, product:template.baseProduct });
  assert(await page.locator('.sheet.active [data-identification-template]').count() === expectedProductTemplates,
    `${item}: 品名下模板数量错误`);
  await page.locator(`[data-identification-template="${template.id}"]`).click();

  assert((await page.locator('.sheet.active .identification-source').innerText()).includes(template.label),
    `${item}: 当前模板名称错误`);
  assert(await page.locator('.sheet.active .identification-block').count() === template.blocks.length,
    `${item}: 正文分块数量错误`);
  const firstBlockLines = await page.locator('.sheet.active .identification-block').first().locator('p').allInnerTexts();
  assert(JSON.stringify(firstBlockLines) === JSON.stringify(template.blocks[0].lines),
    `${item}: 模板正文与提取数据不一致`);
  assert(await field(page, `${item}.result`).count() === 1, `${item}: 结果填写框缺失`);
  assert(await field(page, `${item}.conclusion`).count() === 1, `${item}: 结论选项缺失`);
}

// 同名原料和成品必须作为两个独立模板出现。
const pair = await page.evaluate(() => {
  const groups = new Map();
  for (const template of IDENTIFICATION_TEMPLATES.filter(candidate => candidate.item === 'tlc')) {
    if (!groups.has(template.baseProduct)) groups.set(template.baseProduct, []);
    groups.get(template.baseProduct).push(template);
  }
  return [...groups.entries()]
    .map(([product, templates]) => ({ product, templates }))
    .find(group => group.templates.some(template => template.kind === '原料') &&
      group.templates.some(template => template.kind === '成品'));
});
assert(pair, '薄层项目没有可验证的同名原料/成品模板');
await page.locator('[data-tab="tlc"]').click();
const changeTlc = page.locator('[data-change-identification-product="tlc"]');
if (await changeTlc.count()) await changeTlc.click();
await page.locator('[data-identification-search="tlc"]').fill(pair.product);
await page.locator(`[data-identification-product="${pair.product}"]`).click();
const pairText = await page.locator('.sheet.active .quality-step-title').innerText();
const pairRaw = pair.templates.filter(template => template.kind === '原料').length;
const pairFinished = pair.templates.filter(template => template.kind === '成品').length;
assert(pairText.includes(`原料 ${pairRaw}`) && pairText.includes(`成品 ${pairFinished}`),
  '同名原料/成品数量没有分别显示');

// 切换模板时，各模板填写内容独立保存。
const first = pair.templates[0];
const second = pair.templates[1];
await page.locator(`[data-identification-template="${first.id}"]`).click();
await field(page, 'tlc.result').fill('模板一结果');
await field(page, 'tlc.conclusion').selectOption('符合规定');
await page.locator('[data-change-identification-product="tlc"]').click();
await page.locator('[data-identification-search="tlc"]').fill(second.baseProduct);
await page.locator(`[data-identification-product="${second.baseProduct}"]`).click();
await page.locator(`[data-identification-template="${second.id}"]`).click();
await field(page, 'tlc.result').fill('模板二结果');
await page.locator('[data-change-identification-product="tlc"]').click();
await page.locator('[data-identification-search="tlc"]').fill(first.baseProduct);
await page.locator(`[data-identification-product="${first.baseProduct}"]`).click();
await page.locator(`[data-identification-template="${first.id}"]`).click();
assert(await field(page, 'tlc.result').inputValue() === '模板一结果', '切回模板后填写结果没有恢复');
assert(await field(page, 'tlc.conclusion').inputValue() === '符合规定', '切回模板后结论没有恢复');

await page.screenshot({ path:'C:/tmp/identification-projects.png', fullPage:true });
assert(errors.length === 0, `页面脚本错误：${errors.join('; ')}`);
await browser.close();
console.log('PASS: 2177 条显微/薄层/理化模板、搜索选择、原料成品分离及填写状态');
