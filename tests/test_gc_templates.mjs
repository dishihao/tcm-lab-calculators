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
  const product = page.locator('[data-assay-search]');
  const options = await product.locator('option').allTextContents();
  assert(options.includes(template.product), `品名下拉中找不到 ${template.product}`);
  await product.selectOption(template.product);
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
  gcRawRecords: new Set(GC_TEMPLATES.filter(t => t.kind === '原料').map(t => t.recordKey)).size,
  gcFinishedRecords: new Set(GC_TEMPLATES.filter(t => t.kind === '成品').map(t => t.recordKey)).size,
  invalidTech: ASSAY_TEMPLATES.filter(t => !['hplc', 'gc'].includes(t.tech)).map(t => t.id),
}));
const visibleGeometryAsset = await page.evaluate(() => ({
  present: typeof GC_WORD_TABLE_VISIBLE_GEOMETRY !== 'undefined',
  layouts: typeof GC_WORD_TABLE_VISIBLE_GEOMETRY === 'undefined'
    ? [] : Object.keys(GC_WORD_TABLE_VISIBLE_GEOMETRY),
}));
assert(visibleGeometryAsset.present, '缺少经 Word PNG 审计的可见几何资产');
assert(visibleGeometryAsset.layouts.length === 35,
  `可见几何资产模板数量错误: ${visibleGeometryAsset.layouts.length}`);
const visibleGeometryCoverage = await page.evaluate(() => Object.entries(GC_WORD_TABLE_VISIBLE_GEOMETRY).flatMap(([templateId, roles]) =>
  ['reference', 'sample'].map(role => {
    const geometry = roles[role];
    return {
      templateId, role,
      renderWidthPt: geometry?.renderWidthPt,
      renderCanvasWidthPt: geometry?.renderCanvasWidthPt,
      renderCanvasHeightPt: geometry?.renderCanvasHeightPt,
      renderInkWidthPt: geometry?.renderInkWidthPt,
      renderIndentPt: geometry?.renderIndentPt,
      visibleColumnCount: geometry?.visibleColumnCount,
      renderGridPt: geometry?.renderGridPt,
      renderHeightPt: geometry?.renderHeightPt,
      sourceTextLineCounts: geometry?.sourceTextLineCounts,
    };
  })
));
assert(visibleGeometryCoverage.length === 70, `可见几何资产表格数量错误: ${visibleGeometryCoverage.length}`);
for (const item of visibleGeometryCoverage) {
  assert(Number.isFinite(item.renderWidthPt) && item.renderWidthPt > 0,
    `${item.templateId}:${item.role} 缺少有效的 Word 可见宽度`);
  assert(Number.isFinite(item.renderCanvasWidthPt) && item.renderCanvasWidthPt > 0
    && Number.isFinite(item.renderCanvasHeightPt) && item.renderCanvasHeightPt > 0,
  `${item.templateId}:${item.role} 缺少有效的 Word 可见画布`);
  assert(Number.isFinite(item.renderInkWidthPt) && item.renderInkWidthPt > 0
    && item.renderInkWidthPt <= item.renderCanvasWidthPt,
  `${item.templateId}:${item.role} 缺少 Word 最右可见墨迹边界`);
  assert(Number.isFinite(item.renderIndentPt) && Math.abs(item.renderIndentPt) < 1584,
    `${item.templateId}:${item.role} 缺少严格可比较的 Word 可见缩进`);
  assert(Number.isInteger(item.visibleColumnCount) && item.visibleColumnCount > 0,
    `${item.templateId}:${item.role} 缺少 Word 可见列数`);
  assert(Array.isArray(item.renderGridPt) && item.renderGridPt.length > 0 && item.renderGridPt.every(value => Number.isFinite(value) && value >= 0),
    `${item.templateId}:${item.role} 缺少有效的 Word 可见列宽`);
  assert(Array.isArray(item.renderHeightPt) && item.renderHeightPt.length > 0 && item.renderHeightPt.every(value => Number.isFinite(value) && value > 0),
    `${item.templateId}:${item.role} 缺少有效的 Word 可见行高`);
  assert(item.sourceTextLineCounts && typeof item.sourceTextLineCounts === 'object',
    `${item.templateId}:${item.role} 缺少 Word 源单元格行数策略`);
  assert(item.renderGridPt.length === item.visibleColumnCount,
    `${item.templateId}:${item.role} 可见列数与非均匀网格不一致`);
}
const sourceSubscriptFixture = await page.evaluate(() =>
  GC_WORD_TABLE_VISIBLE_GEOMETRY['mugwort-eucalyptol'].reference.sourceTextLineCounts['reference-r3c1']);
assert(sourceSubscriptFixture === 1,
  '真实 Word 源的下标标签 对照品浓度C对（mg/ml）必须固定为一行');
assert(audit.hplc.records === 603, '液相记录总数错误');
assert(audit.hplc.rawRecords === 250, '液相原料记录数错误');
assert(audit.hplc.finishedRecords === 353, '液相成品记录数错误');
assert(audit.hplc.templates === 1037, '液相成分模板总数错误');
assert(audit.hplc.products === 385, '液相去重品名数错误');
assert(audit.hplcProducts === audit.hplc.products, '液相品名统计不一致');
assert(new Set(audit.hplcIds).size === audit.hplcIds.length, '液相模板 ID 不唯一');
assert(audit.gcIds.length === 35, '气相成分模板数量不正确');
assert(audit.gcRecords === 30, '气相原料/成品记录数量不正确');
assert(audit.gcRawRecords === 15, '气相原料记录数量不正确');
assert(audit.gcFinishedRecords === 15, '气相成品记录数量不正确');
assert(audit.invalidTech.length === 0, '存在未区分液相/气相的模板');

// 默认液相：先选品名，再显示该品名的原料/成品及成分模板。
assert(await field(page, 'assay.tech').inputValue() === 'hplc', '默认方法不是液相');
assert((await page.locator('[data-assay-picker] .quality-picker-title').innerText()).includes(`${audit.hplc.products} 个品名`),
  '液相品名总数没有显示');
const hplcComplete = await page.evaluate(() =>
  HPLC_TEMPLATES.find(t => !t.incomplete && t.kind === '原料' && t.limit && t.standardText && HPLC_RECORD_LAYOUTS.templates[t.id]?.status === 'mapped')
);
const chosenHplc = await chooseTemplate(page, hplcComplete.id);
assert(await field(page, 'assay.tech').inputValue() === 'hplc', '液相模板错误切换到气相');
assert(await field(page, 'assay.name').inputValue() === chosenHplc.name, '液相成分名错误');
assert(await field(page, 'assay.limval').inputValue() === chosenHplc.limit, '液相判定限度错误');
assert((await page.locator('.standard-quote').innerText()).includes(chosenHplc.standardText),
  '液相标准规定原文错误');
assert(await page.locator('.word-record-table').count() === 2,
  '液相应显示本记录的两张表');

const rangeHplc = await page.evaluate(() => HPLC_TEMPLATES.find(t => t.limop === 'range' && t.upperLimit));
await chooseTemplate(page, rangeHplc.id);
assert(await field(page, 'assay.limop').inputValue() === 'range', '液相范围限度方向错误');
assert(await field(page, 'assay.limval').inputValue() === rangeHplc.limit, '液相范围下限错误');
assert(await field(page, 'assay.limmax').inputValue() === rangeHplc.upperLimit, '液相范围上限错误');
await page.screenshot({ path: 'C:/tmp/hplc-template-selected.png', fullPage: true });

// 方法切换必须分开列表，不能让当前方法显示另一种方法的模板。
await field(page, 'assay.tech').selectOption('gc');
assert(await page.locator('select[data-assay-search]').count() === 1, '切换气相后没有品名下拉选择');
const gcProductOptions = await page.locator('[data-assay-search] option').allTextContents();
assert(gcProductOptions.length === 16 && gcProductOptions[0] === '请选择品名（共 15 个）',
  `气相品名下拉应列出14个品名，实际 ${JSON.stringify(gcProductOptions)}`);
assert(!gcProductOptions.includes('薄荷脑'), '气相下拉不应出现成分名');
await page.locator('[data-assay-search]').selectOption('薄荷');
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
  const exactTables = page.locator('.word-record-table');
  for (const [key, expected] of Object.entries({ 'assay.refDrying': '——', 'assay.refSource': '中检院' })) {
    assert(await field(page, key).count() === 0, `${templateId}: ${key} 不应为可填参数`);
    const fixed = page.locator(`[data-fixed-field="${key}"]`);
    if (await fixed.count()) assert(await fixed.innerText() === expected, `${templateId}: ${key} 固定文字错误`);
  }
  assert(await exactTables.count() === 2, `${templateId}: 未渲染两张Word精确表`);
  assert(await page.locator('.generic-assay-table').count() === 0,
    `${templateId}: 气相混入通用含量表`);
  assert(await exactTables.nth(0).getAttribute('data-word-template-id') === templateId
    && await exactTables.nth(0).getAttribute('data-word-table-role') === 'reference',
  `${templateId}: 对照品运行时路由标识错误`);
  assert(await exactTables.nth(1).getAttribute('data-word-template-id') === templateId
    && await exactTables.nth(1).getAttribute('data-word-table-role') === 'sample',
  `${templateId}: 供试品运行时路由标识错误`);
  assert(await exactTables.evaluateAll(tables => tables.every(table => !table.hasAttribute('data-source-table-index'))),
    `${templateId}: 公共 DOM 泄露源表索引`);
}

// Word 原件的可见矩形是精确 GC 路径的合同。所有数值均为从固定的
// 144-DPI Word PNG 边界手工抄录的独立字面量，不能从 renderer 所加载的
// companion asset 反推；这样 renderer/asset 同时漂移不会让回归测试失效。
const expectedWordGeometry = {
  'amomum-bornyl-acetate:reference': { canvasWidthPx: 660, canvasHeightPx: 237.333333, tableWidthPx: 659.666, renderWidthPt: 493.9995, indentPx: -0.933335, visibleColumns: 8, rowsPx: [33.667,32,62.667,32.666,42,33] },
  'amomum-bornyl-acetate:sample': { canvasWidthPx: 660, canvasHeightPx: 333.333333, tableWidthPx: 659.666, renderWidthPt: 493.9995, indentPx: -0.933335, visibleColumns: 5, rowsPx: [32.334,32,32,32,32,32.666,31.334,32.666,31.334,43.666] },
  'patchouli-patchoulol:reference': { canvasWidthPx: 660.666667, canvasHeightPx: 361.333333, tableWidthPx: 660.333, renderWidthPt: 494.49975, indentPx: 7.066665, visibleColumns: 8, rowsPx: [33.667,32,38.667,32,31.333,32,32,32,32,64.333] },
  'patchouli-patchoulol:sample': { canvasWidthPx: 660.666667, canvasHeightPx: 397.333333, tableWidthPx: 660.333, renderWidthPt: 494.49975, indentPx: 7.066665, visibleColumns: 6, rowsPx: [32.334,32,32,32,32,32.666,31.334,32.666,31.334,32,32,43.666] },
  'brucea-oleic:sample': { canvasWidthPx: 718, canvasHeightPx: 397.333333, tableWidthPx: 667.333, renderWidthPt: 499.7505, indentPx: 0.399999, visibleColumns: 6, rowsPx: [32.334,32,32,32,32,32.666,31.334,32.666,31.334,32,32,43.666] }
};
for (const [key, expected] of Object.entries(expectedWordGeometry)) {
  const [templateId, role] = key.split(':');
  await chooseTemplate(page, templateId);
  const geometry = await page.locator(`[data-word-table-role="${role}"]`).evaluate(table => {
    const outer = table.getBoundingClientRect(), frame = table.closest('[data-word-table-frame]'), frameRect = frame.getBoundingClientRect();
    const rows = Array.from(table.rows).map(row => {
      const rect = row.getBoundingClientRect();
      return { heightPx: rect.height, topPx: rect.top - outer.top };
    });
    return {
      tableWidthPx: outer.width,
      canvasWidthPx: frameRect.width,
      canvasHeightPx: frameRect.height,
      indentPx: Number.parseFloat(getComputedStyle(frame).marginLeft),
      renderWidthPt: Number(table.getAttribute('data-word-render-width-pt')),
      visibleColumns: table.querySelectorAll('col').length,
      rows,
      gridGaps: Array.from(table.querySelectorAll('.word-grid-gap')).map(cell => ({
        text: cell.textContent, border: getComputedStyle(cell).borderTopWidth
      }))
    };
  });
  assert(Math.abs(geometry.canvasWidthPx - expected.canvasWidthPx) <= 1,
    `${key}: Word 可见画布宽错误 ${geometry.canvasWidthPx} != ${expected.canvasWidthPx}`);
  assert(Math.abs(geometry.canvasHeightPx - expected.canvasHeightPx) <= 1,
    `${key}: Word 可见画布高错误 ${geometry.canvasHeightPx} != ${expected.canvasHeightPx}`);
  assert(Math.abs(geometry.tableWidthPx - expected.tableWidthPx) <= 1,
    `${key}: Word 主外框宽错误 ${geometry.tableWidthPx} != ${expected.tableWidthPx}`);
  assert(Math.abs(geometry.renderWidthPt - expected.renderWidthPt) <= 0.000001,
    `${key}: Word 可见表宽属性错误 ${geometry.renderWidthPt} != ${expected.renderWidthPt}`);
  assert(Math.abs(geometry.indentPx - expected.indentPx) <= 1,
    `${key}: Word 可见缩进错误 ${geometry.indentPx} != ${expected.indentPx}`);
  assert(geometry.visibleColumns === expected.visibleColumns,
    `${key}: Word 可见列数错误 ${geometry.visibleColumns} != ${expected.visibleColumns}`);
  let rowTopPx = 0;
  for (const [index, sourceRowPx] of expected.rowsPx.entries()) {
    assert(Math.abs(geometry.rows[index].heightPx - sourceRowPx) <= 1,
      `${key}: 第 ${index + 1} 行高度偏离 Word 可见行高 ${geometry.rows[index].heightPx} != ${sourceRowPx}`);
    assert(Math.abs(geometry.rows[index].topPx - rowTopPx) <= 1,
      `${key}: 第 ${index + 1} 行累计 Y 偏移 ${geometry.rows[index].topPx} != ${rowTopPx}`);
    rowTopPx += sourceRowPx;
  }
  assert(geometry.gridGaps.every(gap => gap.text === '' && gap.border === '0px'),
    `${key}: 八列内部表的未绑定网格空白不得呈现为数据单元格`);
}

// 四张八列内部标样品表必须按 Word 当前可见的前六列重建；尾部结构空洞
// 不得继续制造 borderless 右区，也不得成为语义数据单元格。
for (const templateId of ['patchouli-patchoulol', 'patchouli-patchoulol-finished', 'brucea-oleic', 'brucea-oleic-finished']) {
  await chooseTemplate(page, templateId);
  const grid = await page.locator('[data-word-table-role="sample"]').evaluate(table => ({
    columns: Array.from(table.querySelectorAll('col')).map(col => col.getBoundingClientRect().width),
    gaps: table.querySelectorAll('.word-grid-gap').length,
    fullHeightBorders: Array.from(table.rows[0].cells).map(cell => cell.getBoundingClientRect().right - table.getBoundingClientRect().left)
  }));
  assert(grid.columns.length === 6, `${templateId}: 内标供试品必须只渲染六个 Word 可见网格列`);
  assert(grid.gaps === 0, `${templateId}: Word 可见区域不得保留 borderless grid gap`);
  assert(grid.fullHeightBorders.length === 3, `${templateId}: 顶行必须保留三列主外框`);
  const expectedMain = templateId.startsWith('patchouli') ? [172.667, 419.333, 659.333] : [188.667, 426, 666];
  expectedMain.forEach((expected, index) => assert(Math.abs(grid.fullHeightBorders[index] - expected) <= 1,
    `${templateId}: 主竖线 ${index + 1} 偏离 Word ${grid.fullHeightBorders[index]} != ${expected}`));
}

// 非均匀列重建不得缩小 Word 字体；源一行标签仍保持 10.5pt x 1.5。
for (const templateId of ['patchouli-patchoulol', 'brucea-oleic']) {
  await chooseTemplate(page, templateId);
  const fontMetrics = await page.locator('[data-word-table-role="sample"]').evaluate(table => {
    const labelCell = Array.from(table.rows[0].cells).find(cell => cell.textContent.includes('样品编号'));
    const span = labelCell?.querySelector('span');
    const paragraph = labelCell?.querySelector('p');
    const spanStyle = span ? getComputedStyle(span) : null;
    const paragraphStyle = paragraph ? getComputedStyle(paragraph) : null;
    return {
      text: labelCell?.innerText,
      fontSizePx: spanStyle ? Number.parseFloat(spanStyle.fontSize) : null,
      lineHeightPx: paragraphStyle ? Number.parseFloat(paragraphStyle.lineHeight) : null,
      whiteSpace: labelCell ? getComputedStyle(labelCell).whiteSpace : null
    };
  });
  assert(Math.abs(fontMetrics.fontSizePx - 14) <= 0.1,
    `${templateId}: 样品表源标签字号不能按 renderScale 缩小 ${fontMetrics.fontSizePx}`);
  assert(Math.abs(fontMetrics.lineHeightPx - 21) <= 0.1,
    `${templateId}: 样品表源标签行高必须保持 Word 10.5pt x 1.5 ${fontMetrics.lineHeightPx}`);
  assert(fontMetrics.whiteSpace === 'nowrap',
    `${templateId}: Word 源一行标签应按 sourceTextLineCounts 保持一行`);
}

await chooseTemplate(page, 'patchouli-patchoulol');
assert(await page.locator('#assay\\.out\\.Aref').innerText() === '',
  '精确 GC 未计算的输出必须保持 Word 原件空白，而非通用占位符');
await chooseTemplate(page, hplcComplete.id);
assert(await page.locator('#assay\\.out\\.Aref').innerText() === '',
  '源记录 HPLC 未计算输出应保持原表空白');
await field(page, 'assay.tech').selectOption('gc');
await page.locator('[data-assay-product]').fill('自定义品种');
await page.locator('[data-assay-product]').press('Enter');
assert(await page.locator('#assay\\.out\\.Aref').innerText() === '—',
  '手工自定义 GC 未计算输出必须保留通用破折号占位符');

// 同名气相原料/成品必须保持各自标准。
await chooseTemplate(page, 'mint-menthol');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.20%'), '薄荷原料标准错误');
await chooseTemplate(page, 'mint-menthol-finished');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.13%'), '薄荷成品标准错误');

// 对照品和供试品表格必须按每份气相记录切换，不能继续共用固定布局。
await chooseTemplate(page, 'clove-eugenol');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-word-template-id') === 'clove-eugenol',
  '丁香原料对照品运行时模板路由错误');
assert((await page.locator('[data-assay-reference-table]').innerText()).includes('对照品批号'),
  '丁香原料对照品表缺少记录中的批号行');
assert((await page.locator('[data-assay-reference-table]').innerText()).includes('对照品进样量'),
  '丁香原料对照品表缺少记录中的进样量行');
assert(!(await page.locator('[data-assay-sample-table]').innerText()).includes('水分Q'),
  '丁香原料供试品表不应显示水分行');
assert(await page.locator('[data-fixed-field="assay.sampleInjection.1"]').count() === 1,
  '丁香原料供试品表缺少第一份样品进样量');
assert((await page.locator('[data-fixed-field="assay.sampleInjection.1"]').innerText()).trim() === '1',
  '丁香原料进样量应按标准显示为固定值1');

await chooseTemplate(page, 'clove-eugenol-finished');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-word-template-id') === 'clove-eugenol-finished',
  '丁香成品对照品运行时模板路由错误');
assert(await field(page, 'assay.dryBasis').isChecked() === false,
  '丁香成品计算口径不应被表格布局改写');
assert((await page.locator('[data-assay-sample-table]').innerText()).includes('水分Q'),
  '丁香成品记录的供试品表应显示水分行');

const renderedWordHtml = await page.evaluate(() => renderAssaySheet());
assert(renderedWordHtml.includes('class="tscroll word-table-scroll" data-assay-reference-table'),
  'renderAssaySheet 返回的Word对照品包装器没有专用横向滚动类');
assert(renderedWordHtml.includes('class="tscroll word-table-scroll" data-assay-sample-table'),
  'renderAssaySheet 返回的Word供试品包装器没有专用横向滚动类');
assert(renderedWordHtml.includes('class="cell word-cell-input"'),
  'renderAssaySheet 返回的Word输入框没有专用控件类');
assert(renderedWordHtml.includes('class="out empty word-cell-output"'),
  'renderAssaySheet 返回的Word输出框没有专用控件类');

// Word 原始记录表必须保留源文件 pt 几何：窄屏只允许外层横向滚动，不能缩放或重排列宽。
const wordReferenceScroller = page.locator('[data-assay-reference-table].word-table-scroll');
assert(await wordReferenceScroller.count() === 1,
  '丁香成品Word对照品表没有专用横向滚动容器');
const wordReferenceTable = wordReferenceScroller.locator('.word-record-table');
const wordReferenceInput = wordReferenceTable.locator('.word-cell-input').first();
assert(await wordReferenceInput.count() === 1, '丁香成品Word表没有精确输入控件类');
assert(await wordReferenceTable.locator('.word-cell-output').count() > 0, '丁香成品Word表没有精确输出控件类');
const desktopWordGeometry = await wordReferenceTable.evaluate(table => ({
  scrollWidth: table.scrollWidth,
  tableLayout: getComputedStyle(table).tableLayout,
  columns: Array.from(table.querySelectorAll('col')).map(column => column.getBoundingClientRect().width),
  rows: Array.from(table.rows).map(row => row.getBoundingClientRect().height),
  width: table.getBoundingClientRect().width,
}));
assert(desktopWordGeometry.tableLayout === 'fixed', '丁香成品Word表未使用固定列布局');

await page.setViewportSize({ width: 390, height: 1000 });
const mobileWordGeometry = await wordReferenceTable.evaluate(table => {
  const scroller = table.closest('.word-table-scroll');
  return {
    scrollWidth: table.scrollWidth,
    tableLayout: getComputedStyle(table).tableLayout,
    columns: Array.from(table.querySelectorAll('col')).map(column => column.getBoundingClientRect().width),
    rows: Array.from(table.rows).map(row => row.getBoundingClientRect().height),
    width: table.getBoundingClientRect().width,
    scrollerScrollWidth: scroller.scrollWidth,
    scrollerClientWidth: scroller.clientWidth,
  };
});
assert(mobileWordGeometry.scrollWidth === desktopWordGeometry.scrollWidth,
  `手机端Word表宽度改变: ${mobileWordGeometry.scrollWidth} != ${desktopWordGeometry.scrollWidth}`);
assert(mobileWordGeometry.tableLayout === 'fixed', '手机端Word表没有保留固定列布局');
assert(mobileWordGeometry.scrollerScrollWidth > mobileWordGeometry.scrollerClientWidth,
  '手机端Word表没有通过专用容器横向滚动');
assert(mobileWordGeometry.columns.every((width, index) => Math.abs(width - desktopWordGeometry.columns[index]) <= 0.1),
  `手机端Word表列宽改变: ${mobileWordGeometry.columns.join(',')} != ${desktopWordGeometry.columns.join(',')}`);
assert(mobileWordGeometry.rows.every((height, index) => Math.abs(height - desktopWordGeometry.rows[index]) <= 0.1),
  `手机端Word表行高改变: ${mobileWordGeometry.rows.join(',')} != ${desktopWordGeometry.rows.join(',')}`);

await wordReferenceInput.focus();
assert(await wordReferenceInput.evaluate(input => document.activeElement === input),
  '打印测试没有先聚焦Word输入框');
await page.emulateMedia({ media: 'print' });
const printWordGeometry = await wordReferenceTable.evaluate(table => {
  const scroller = table.closest('.word-table-scroll');
  const input = table.querySelector('input');
  const inputStyle = getComputedStyle(input);
  return {
    overflowX: getComputedStyle(scroller).overflowX,
    width: table.getBoundingClientRect().width,
    scrollWidth: table.scrollWidth,
    tableLayout: getComputedStyle(table).tableLayout,
    columns: Array.from(table.querySelectorAll('col')).map(column => column.getBoundingClientRect().width),
    rows: Array.from(table.rows).map(row => row.getBoundingClientRect().height),
    inputFocused: document.activeElement === input,
    inputBackground: inputStyle.backgroundColor,
    inputBorderRadius: inputStyle.borderRadius,
    inputOutlineStyle: inputStyle.outlineStyle,
    inputBoxShadow: inputStyle.boxShadow,
  };
});
assert(printWordGeometry.overflowX === 'visible', '打印时Word表滚动容器没有取消溢出裁切');
assert(printWordGeometry.tableLayout === 'fixed', '打印时Word表没有保留固定列布局');
assert(Math.abs(printWordGeometry.width - desktopWordGeometry.width) <= 0.1
  && printWordGeometry.scrollWidth === desktopWordGeometry.scrollWidth,
`打印时Word表宽度改变: ${printWordGeometry.width}/${printWordGeometry.scrollWidth} != ${desktopWordGeometry.width}/${desktopWordGeometry.scrollWidth}`);
assert(printWordGeometry.columns.every((width, index) => Math.abs(width - desktopWordGeometry.columns[index]) <= 0.1),
  '打印时Word表列宽改变');
assert(printWordGeometry.rows.every((height, index) => Math.abs(height - desktopWordGeometry.rows[index]) <= 0.1),
  '打印时Word表行高改变');
assert(printWordGeometry.inputFocused, '打印样式未在输入框聚焦时验证');
assert(printWordGeometry.inputBackground === 'rgba(0, 0, 0, 0)',
  `打印时Word输入框保留焦点背景: ${printWordGeometry.inputBackground}`);
assert(printWordGeometry.inputBorderRadius === '0px',
  `打印时Word输入框保留焦点圆角: ${printWordGeometry.inputBorderRadius}`);
assert(printWordGeometry.inputOutlineStyle === 'none', '打印时Word输入框保留焦点外框');
assert(printWordGeometry.inputBoxShadow === 'none', '打印时Word输入框保留焦点阴影');
await page.emulateMedia({ media: 'screen' });
await page.setViewportSize({ width: 1440, height: 1000 });

await chooseTemplate(page, 'mugwort-eucalyptol');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-word-template-id') === 'mugwort-eucalyptol',
  '艾叶桉油精运行时路由错误');
await chooseTemplate(page, 'mugwort-borneol');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-word-template-id') === 'mugwort-borneol',
  '艾叶龙脑运行时路由错误');
await chooseTemplate(page, 'flax-linoleic');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-word-template-id') === 'flax-linoleic',
  '亚麻子亚油酸运行时路由错误');
await chooseTemplate(page, 'flax-linolenic');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-word-template-id') === 'flax-linolenic',
  '亚麻子亚麻酸运行时路由错误');

await chooseTemplate(page, 'patchouli-patchoulol');
const patchouliReferenceTable = await page.locator('[data-assay-reference-table]').innerText();
assert(patchouliReferenceTable.includes('正十八烷批号') && patchouliReferenceTable.includes('百秋李醇批号'),
  '广藿香内标法对照品表没有按记录显示两种物质的批号');
assert(patchouliReferenceTable.includes('正十八烷来源') && patchouliReferenceTable.includes('百秋李醇来源'),
  '广藿香内标法对照品表没有按记录显示两种物质的来源');
// 精确 GC 表中的批号、称样量和峰面积必须进入现有 assay.<field> 状态快照；
// 进样量与稀释倍数是标准固定参数，在表里是不可编辑的黑体文字。
await field(page, 'assay.refBatch').fill('REF-PATCHOULI');
await page.evaluate(() => { store['assay.refSource'] = 'SRC-PATCHOULI'; store['assay.refDrying'] = 'OLD'; });
await field(page, 'assay.Ws.1').fill('1.11');
await field(page, 'assay.Ws.2').fill('1.12');
await fillPeaks(page, 'assay.refA', [101, 102, 103, 104, 105]);
await field(page, 'assay.internalBatch').fill('IS-PATCHOULI');
await fillPeaks(page, 'assay.smpA.1', [11, 12, 13]);
await fillPeaks(page, 'assay.smpA.2', [21, 22, 23]);

await chooseTemplate(page, 'brucea-oleic');
const bruceaReferenceTable = await page.locator('[data-assay-reference-table]').innerText();
assert(bruceaReferenceTable.includes('苯甲酸苯酯批号') && bruceaReferenceTable.includes('油酸批号'),
  '鸦胆子内标法对照品表没有切换为本记录物质名称');
await field(page, 'assay.refBatch').fill('REF-BRUCEA');
await field(page, 'assay.Ws.1').fill('2.21');
await field(page, 'assay.Ws.2').fill('2.22');
await fillPeaks(page, 'assay.refA', [201, 202, 203, 204, 205]);
await field(page, 'assay.internalBatch').fill('IS-BRUCEA');
await fillPeaks(page, 'assay.smpA.1', [31, 32, 33]);
await fillPeaks(page, 'assay.smpA.2', [41, 42, 43]);
assert(await field(page, 'assay.refBatch').inputValue() === 'REF-BRUCEA'
  && await page.locator('[data-fixed-field="assay.refSource"]').innerText() === '中检院'
  && await field(page, 'assay.Ws.1').inputValue() === '2.21'
  && await field(page, 'assay.refA.0').inputValue() === '201'
  && await field(page, 'assay.smpA.2.2').inputValue() === '43',
  '鸦胆子切回前哨兵值没有正确写入');
await chooseTemplate(page, 'patchouli-patchoulol');
assert(await field(page, 'assay.refBatch').inputValue() === 'REF-PATCHOULI'
  && await page.locator('[data-fixed-field="assay.refSource"]').innerText() === '中检院'
  && await field(page, 'assay.Ws.1').inputValue() === '1.11',
  '切回广藿香后没有恢复其对照品批号、来源和称样量');
assert(await field(page, 'assay.internalBatch').inputValue() === 'IS-PATCHOULI',
  '切回广藿香后没有恢复其对照品表数据');
assert(await page.locator('[data-fixed-field="assay.f.1"]').innerText() === '10'
  && await page.locator('[data-fixed-field="assay.refInjection"]').innerText() === '1',
  '固定参数应按当前模板显示广藿香标准值');
assert(await field(page, 'assay.refA.0').inputValue() === '101'
  && await field(page, 'assay.refA.4').inputValue() === '105'
  && await field(page, 'assay.smpA.1.0').inputValue() === '11'
  && await field(page, 'assay.smpA.2.2').inputValue() === '23',
  '切回广藿香后没有恢复对照品及两份供试品峰面积');

// 手动改变定量方法时是自定义路径，恢复模板方法后重新使用精确表。
await field(page, 'assay.mode').selectOption('external');
assert(await page.locator('.generic-assay-table').count() === 2 && await page.locator('.word-record-table').count() === 0,
  '手动改变气相定量方法后没有进入通用表路径');
await field(page, 'assay.mode').selectOption('internal');
assert(await page.locator('.word-record-table').count() === 2 && await page.locator('.generic-assay-table').count() === 0,
  '恢复气相模板定量方法后没有恢复精确表');

// 任意输入一个未预置品种，也应保留为当前方法的自定义品种。
await page.locator('[data-assay-product]').fill('自定义品种');
await page.locator('[data-assay-product]').press('Enter');
assert(await page.locator('[data-assay-product]').inputValue() === '自定义品种', '自定义品种输入未保留');
assert(await field(page, 'assay.tech').inputValue() === 'gc', '自定义品种改变了色谱方法');
assert(await page.locator('.generic-assay-table').count() === 2 && await page.locator('.word-record-table').count() === 0,
  '自定义气相品种没有使用通用表路径');

// 外标法、非干燥品口径：不要求 Q。
await chooseTemplate(page, 'star-anise-anethole');
await fillPeaks(page, 'assay.refA', [100, 100, 100, 100, 100]);
await field(page, 'assay.Cref').fill('1');
for (const sample of [1, 2]) {
  await field(page, `assay.Ws.${sample}`).fill('1');
  await fillPeaks(page, `assay.smpA.${sample}`, [50, 50]);
}
assert(await page.locator('#assay\\.out\\.MEAN').innerText() === '1.2',
  '外标法百分比计算错误（八角茴香稀释倍数按标准固定25，1.25 修约到1位为1.2）');

// 内标法：f=(A内×C对)/(A对×C内)=4，两个样品含量均为 2.00%。
await chooseTemplate(page, 'patchouli-patchoulol');
assert(await field(page, 'assay.refA').count() === 0, '峰面积输入不应使用无编号字段');
assert(await page.locator('[data-k^="assay.refA."]').count() === 5,
  '广藿香对照品针数没有按布局绑定保留为5');
assert(await page.locator('[data-k^="assay.smpA.1."]').count() === 3
  && await page.locator('[data-k^="assay.smpA.2."]').count() === 3,
  '广藿香待测物每份三针没有全部保留');
assert(await page.locator('[data-k^="assay.smpIS.1."]').count() === 2
  && await page.locator('[data-k^="assay.smpIS.2."]').count() === 2,
  '广藿香内标物每份两针没有全部保留');
await fillPeaks(page, 'assay.refIS', [200, 200, 200, 200, 200]);
await fillPeaks(page, 'assay.refA', [100, 100, 100, 100, 100]);
await field(page, 'assay.Cis').fill('1');
await field(page, 'assay.Cref').fill('2');
await field(page, 'assay.Q').fill('0');
for (const sample of [1, 2]) {
  await field(page, `assay.Ws.${sample}`).fill('1');
  await fillPeaks(page, `assay.smpIS.${sample}`, [200, 200]);
  await fillPeaks(page, `assay.smpA.${sample}`, [50, 50, 200]);
}
assert(await page.locator('#assay\\.out\\.factor').innerText() === '4', '校正因子错误');
assert(await page.locator('#assay\\.out\\.MEAN').innerText() === '2.00', '内标法计算错误');
assert(await page.locator('#assay\\.out\\.A\\.1').innerText() === '100'
  && await page.locator('#assay\\.out\\.A\\.2').innerText() === '100',
  '内标法没有使用布局中全部三针计算样品平均峰面积');

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

const missingLayoutPaths = await page.evaluate(() => {
  const template = {
    id:'missing-gc-layout', tech:'gc', mode:'external', dry:false,
    product:'缺布局测试品', recordLabel:'原料', kind:'原料',
    name:'测试成分', formulaText:'C', plates:'10000', limit:'1.0', unit:'%',
    standardText:'本品含测试成分不得少于1.0%。'
  };
  const originalStore = JSON.parse(JSON.stringify(store));
  const errorOf = action => {
    try {
      action();
      return '';
    } catch (error) {
      return String(error.message || error);
    }
  };
  const selectMode = mode => {
    Object.keys(store).filter(key => key.startsWith('assay.')).forEach(key => delete store[key]);
    Object.assign(store, {
      'assay.template':template.id,
      'assay.tech':'gc',
      'assay.mode':mode,
      'assay.dryBasis':'0',
      'assay.productName':template.product,
      'assay.selectedProduct':template.product,
      'assay.name':template.name,
      'assay.formulaText':template.formulaText,
      'assay.platesLim':template.plates,
      'assay.limop':'ge',
      'assay.limval':template.limit,
      'assay.unit':template.unit
    });
  };
  ASSAY_TEMPLATES.push(template);
  try {
    selectMode(template.mode);
    const exactRenderError = errorOf(() => renderAssaySheet());
    const exactComputeError = errorOf(() => computeAssay());

    selectMode('internal');
    let genericHtml = '';
    const genericRenderError = errorOf(() => { genericHtml = renderAssaySheet(); });
    const genericComputeError = errorOf(() => computeAssay());
    const host = document.createElement('div');
    host.innerHTML = genericHtml;
    return {
      exactRenderError,
      exactComputeError,
      genericRenderError,
      genericComputeError,
      genericTables: host.querySelectorAll('.generic-assay-table').length,
      wordTables: host.querySelectorAll('.word-record-table').length
    };
  } finally {
    ASSAY_TEMPLATES.pop();
    Object.keys(store).forEach(key => delete store[key]);
    Object.assign(store, originalStore);
  }
});
const missingLayoutMessage = '气相模板 missing-gc-layout 缺少Word精确布局';
assert(missingLayoutPaths.exactRenderError === missingLayoutMessage,
  '气相模板原定量方法渲染时缺少精确布局没有硬失败');
assert(missingLayoutPaths.exactComputeError === missingLayoutMessage,
  '气相模板原定量方法计算时缺少精确布局没有硬失败');
assert(missingLayoutPaths.genericRenderError === '',
  '手动改变气相定量方法后渲染仍要求Word精确布局');
assert(missingLayoutPaths.genericComputeError === '',
  '手动改变气相定量方法后计算仍要求Word精确布局');
assert(missingLayoutPaths.genericTables === 2 && missingLayoutPaths.wordTables === 0,
  '手动改变气相定量方法后没有使用两张通用表');

await chooseTemplate(page, hplcComplete.id);
assert(await page.locator('.generic-assay-table').count() === 0,
  '已核对液相记录不应使用通用表');
assert(await page.locator('.word-record-table').count() === 2,
  '液相应切回本记录的两张源表');

await page.screenshot({ path: 'C:/tmp/assay-templates.png', fullPage: true });
assert(errors.length === 0, `页面脚本错误: ${errors.join('; ')}`);
await browser.close();
console.log(`PASS: ${audit.hplc.templates} 个液相模板/603 条记录，35 个气相模板，方法分离、标准原文及计算`);
