/*
 * 表格显示规则：
 * 1) 没有选择品种（成分模板或自定义品种）时，所有带表格的项目都不渲染数据表，只给一句提示；
 * 2) 选定品种后才出现表格，并且表格里的填写值、计算结果一律居中（与列中心对齐）。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const PROJECTS = ['impurity', 'moisture', 'ash', 'extract', 'sulfur', 'assay'];

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

  // 未选品种：六个带表格的项目都只有提示，没有任何表格。
  for (const project of PROJECTS) {
    const sheet = page.locator(`section[data-sheet="${project}"]`);
    assert.equal(await sheet.locator('.record-empty').count(), 1, `${project}: 未选品种时缺少提示`);
    assert.equal(await sheet.locator('table').count(), 0, `${project}: 未选品种时不应出现表格`);
    assert.equal(await sheet.locator('.formula-wrap, .verdict, [data-k$=".dp.ind"], [data-k$=".dp.mean"]').count(), 0,
      `${project}: 未选品种时不应出现公式、判定限度或修约位数`);
  }
  assert.equal(await page.locator('table').count(), 2, '页面上只应剩温湿度记录的两张表');

  // 选定品种后才出表格。
  for (const project of ['impurity', 'moisture', 'ash', 'extract', 'sulfur']) {
    await page.locator(`[data-tab="${project}"]`).click();
    const template = await page.evaluate(item => {
      const pool = item === 'sulfur' ? SULFUR_DIOXIDE_TEMPLATES : QUALITY_TEMPLATES;
      const chosen = pool.find(candidate => candidate.item === item && candidate.kind === '原料');
      return { id: chosen.id, product: chosen.baseProduct };
    }, project);
    await page.locator(`[data-quality-search="${project}"]`).fill(template.product);
    await page.locator(`[data-quality-product="${template.product}"]`).first().click();
    await page.locator(`.sheet.active [data-quality-template="${template.id}"]`).click();
    const sheet = page.locator('.sheet.active');
    assert.equal(await sheet.locator('.record-empty').count(), 0, `${project}: 选定品种后仍显示未选提示`);
    assert(await sheet.locator('.word-record-table').count() > 0, `${project}: 选定品种后没有出表格`);
    assert(await sheet.locator('.formula-wrap').count() === 1, `${project}: 选定品种后缺少公式区`);
  }

  // 含量测定：选模板或套用自定义品种都出表格。
  await page.locator('[data-tab="assay"]').click();
  assert.equal(await page.locator('section[data-sheet="assay"] table').count(), 0, '含量测定未选品种时不应出现表格');
  await page.evaluate(() => applyAssayTemplate('mint-menthol'));
  await page.locator('[data-tab="assay"]').click();
  assert(await page.locator('section[data-sheet="assay"] .word-record-table').count() === 2,
    '含量测定选定气相模板后应显示两张原记录表');
  await page.evaluate(() => applyAssayProduct('薄荷'));
  await page.locator('[data-tab="assay"]').click();
  assert(await page.locator('section[data-sheet="assay"] table').count() > 0, '含量测定套用自定义品种后应出表格');

  // 表格数据居中：填写值与计算结果都按列中心对齐。
  await page.evaluate(() => { applyQualityTemplate('sulfur', SULFUR_DIOXIDE_TEMPLATES.find(t =>
    t.label === '麻黄根（原料）').id); showTab('sulfur'); });
  for (const [key, value] of Object.entries({
    'sulfur.C.1': '0.01014', 'sulfur.C.2': '0.01014', 'sulfur.Ws.1': '10.0503',
    'sulfur.Ws.2': '10.0574', 'sulfur.Vblank': '0.05', 'sulfur.Vsample.1': '0.15'
  })) {
    const input = page.locator(`[data-k="${key}"]`);
    if (await input.count()) await input.fill(value);
  }
  const alignment = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet.active .word-cell-input, .sheet.active .word-cell-output')]
      .map(element => {
        const cell = element.closest('td');
        const box = element.getBoundingClientRect();
        const cellBox = cell.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          key: element.dataset.k || element.id,
          output: element.classList.contains('word-cell-output'),
          textAlign: style.textAlign,
          weight: Number(style.fontWeight),
          color: style.color,
          offset: Math.abs((box.left + box.width / 2) - (cellBox.left + cellBox.width / 2)),
        };
      }));
  assert(alignment.length > 10, '没有取到表格数据格');
  for (const item of alignment) {
    assert.equal(item.textAlign, 'center', `${item.key}: 数据没有居中`);
    assert(item.weight >= 700, `${item.key}: 数据不够醒目（字重 ${item.weight}）`);
    assert.equal(item.color, item.output ? 'rgb(179, 39, 30)' : 'rgb(18, 54, 158)',
      `${item.key}: 填写值应为手写蓝、计算结果应为结果红，实际 ${item.color}`);
    assert(item.offset < 2, `${item.key}: 数据没有对齐列中心（偏差 ${item.offset.toFixed(1)}px）`);
  }

  // 通用计算表（未套用原记录表时）也保持居中。
  assert.equal(await page.locator('.sheet.active .word-cell-input[style*="width"]').count(), 0,
    '数据格不应再使用固定宽度导致不居中');
  assert.deepEqual(errors, []);
  console.log(`PASS: 未选品种不出表格（${PROJECTS.length} 个项目），选定后出表格且 ${alignment.length} 个数据格居中、加粗、蓝填红算`);
} finally {
  await browser.close();
}
