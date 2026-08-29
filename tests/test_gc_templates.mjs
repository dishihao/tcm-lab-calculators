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
  gcRawRecords: new Set(GC_TEMPLATES.filter(t => t.kind === '原料').map(t => t.recordKey)).size,
  gcFinishedRecords: new Set(GC_TEMPLATES.filter(t => t.kind === '成品').map(t => t.recordKey)).size,
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
assert(audit.gcRawRecords === 14, '气相原料记录数量不正确');
assert(audit.gcFinishedRecords === 14, '气相成品记录数量不正确');
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
assert(await page.locator('.word-record-table').count() === 0,
  '液相不应混入气相Word精确表');

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
  const expectedTables = await page.evaluate(id => {
    const layout = GC_WORD_TABLE_LAYOUTS[id];
    return [layout.referenceTable.sourceTableIndex, layout.sampleTable.sourceTableIndex];
  }, templateId);
  assert(await field(page, 'assay.name').inputValue() === template.name, `${templateId}: 成分名错误`);
  assert(await field(page, 'assay.tech').inputValue() === 'gc', `${templateId}: 不是气相`);
  assert(await field(page, 'assay.mode').inputValue() === template.mode, `${templateId}: 定量方法错误`);
  assert(await field(page, 'assay.platesLim').inputValue() === template.plates, `${templateId}: 板数错误`);
  assert(await field(page, 'assay.limval').inputValue() === template.limit, `${templateId}: 判定限度错误`);
  assert(await field(page, 'assay.dryBasis').isChecked() === template.dry, `${templateId}: 干燥品口径错误`);
  assert((await page.locator('.standard-quote').innerText()).includes(template.standardText),
    `${templateId}: 标准规定原文错误`);
  const exactTables = page.locator('.word-record-table');
  assert(await exactTables.count() === 2, `${templateId}: 未渲染两张Word精确表`);
  assert(await page.locator('.generic-assay-table').count() === 0,
    `${templateId}: 气相混入通用含量表`);
  assert(await exactTables.nth(0).getAttribute('data-source-table-index') === String(expectedTables[0]),
    `${templateId}: 对照品源表索引错误`);
  assert(await exactTables.nth(1).getAttribute('data-source-table-index') === String(expectedTables[1]),
    `${templateId}: 供试品源表索引错误`);
}

// 同名气相原料/成品必须保持各自标准。
await chooseTemplate(page, 'mint-menthol');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.20%'), '薄荷原料标准错误');
await chooseTemplate(page, 'mint-menthol-finished');
assert((await page.locator('.standard-quote').innerText()).includes('不得少于0.13%'), '薄荷成品标准错误');

// 对照品和供试品表格必须按每份气相记录切换，不能继续共用固定布局。
await chooseTemplate(page, 'clove-eugenol');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-source-table-index') === '6',
  '丁香原料对照品源表不是索引6');
assert(await page.locator('[data-assay-sample-table] .word-record-table').getAttribute('data-source-table-index') === '7',
  '丁香原料供试品源表不是索引7');
assert((await page.locator('[data-assay-reference-table]').innerText()).includes('对照品批号'),
  '丁香原料对照品表缺少记录中的批号行');
assert((await page.locator('[data-assay-reference-table]').innerText()).includes('对照品进样量'),
  '丁香原料对照品表缺少记录中的进样量行');
assert(!(await page.locator('[data-assay-sample-table]').innerText()).includes('水分Q'),
  '丁香原料供试品表不应显示水分行');
assert(await field(page, 'assay.sampleInjection.1').count() === 1,
  '丁香原料供试品表缺少第一份样品进样量');

await chooseTemplate(page, 'clove-eugenol-finished');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-source-table-index') === '6',
  '丁香成品对照品源表不是索引6');
assert(await page.locator('[data-assay-sample-table] .word-record-table').getAttribute('data-source-table-index') === '7',
  '丁香成品供试品源表不是索引7');
assert(await field(page, 'assay.dryBasis').isChecked() === false,
  '丁香成品计算口径不应被表格布局改写');
assert((await page.locator('[data-assay-sample-table]').innerText()).includes('水分Q'),
  '丁香成品记录的供试品表应显示水分行');

// Word 原始记录表必须保留源文件 pt 几何：窄屏只允许外层横向滚动，不能缩放或重排列宽。
const wordReferenceScroller = page.locator('[data-assay-reference-table].word-table-scroll');
assert(await wordReferenceScroller.count() === 1,
  '丁香成品Word对照品表没有专用横向滚动容器');
const wordReferenceTable = wordReferenceScroller.locator('.word-record-table');
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

await page.emulateMedia({ media: 'print' });
const printWordGeometry = await wordReferenceTable.evaluate(table => {
  const scroller = table.closest('.word-table-scroll');
  const input = table.querySelector('input');
  return {
    overflowX: getComputedStyle(scroller).overflowX,
    width: table.getBoundingClientRect().width,
    scrollWidth: table.scrollWidth,
    tableLayout: getComputedStyle(table).tableLayout,
    columns: Array.from(table.querySelectorAll('col')).map(column => column.getBoundingClientRect().width),
    rows: Array.from(table.rows).map(row => row.getBoundingClientRect().height),
    inputOutlineStyle: getComputedStyle(input).outlineStyle,
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
assert(printWordGeometry.inputOutlineStyle === 'none', '打印时Word输入框保留焦点外框');
await page.emulateMedia({ media: 'screen' });
await page.setViewportSize({ width: 1440, height: 1000 });

await chooseTemplate(page, 'mugwort-eucalyptol');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-source-table-index') === '7'
  && await page.locator('[data-assay-sample-table] .word-record-table').getAttribute('data-source-table-index') === '8',
  '艾叶桉油精没有显示源表7/8');
await chooseTemplate(page, 'mugwort-borneol');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-source-table-index') === '9'
  && await page.locator('[data-assay-sample-table] .word-record-table').getAttribute('data-source-table-index') === '10',
  '艾叶龙脑没有显示源表9/10');
await chooseTemplate(page, 'flax-linoleic');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-source-table-index') === '3'
  && await page.locator('[data-assay-sample-table] .word-record-table').getAttribute('data-source-table-index') === '4',
  '亚麻子亚油酸没有显示源表3/4');
await chooseTemplate(page, 'flax-linolenic');
assert(await page.locator('[data-assay-reference-table] .word-record-table').getAttribute('data-source-table-index') === '5'
  && await page.locator('[data-assay-sample-table] .word-record-table').getAttribute('data-source-table-index') === '6',
  '亚麻子亚麻酸没有显示源表5/6');

await chooseTemplate(page, 'patchouli-patchoulol');
const patchouliReferenceTable = await page.locator('[data-assay-reference-table]').innerText();
assert(patchouliReferenceTable.includes('正十八烷批号') && patchouliReferenceTable.includes('百秋李醇批号'),
  '广藿香内标法对照品表没有按记录显示两种物质的批号');
assert(patchouliReferenceTable.includes('正十八烷来源') && patchouliReferenceTable.includes('百秋李醇来源'),
  '广藿香内标法对照品表没有按记录显示两种物质的来源');
await field(page, 'assay.internalBatch').fill('IS-PATCHOULI');
await field(page, 'assay.sampleInjection.1').fill('1.0');

await chooseTemplate(page, 'brucea-oleic');
const bruceaReferenceTable = await page.locator('[data-assay-reference-table]').innerText();
assert(bruceaReferenceTable.includes('苯甲酸苯酯批号') && bruceaReferenceTable.includes('油酸批号'),
  '鸦胆子内标法对照品表没有切换为本记录物质名称');
await field(page, 'assay.internalBatch').fill('IS-BRUCEA');
await field(page, 'assay.sampleInjection.1').fill('2.0');
await chooseTemplate(page, 'patchouli-patchoulol');
assert(await field(page, 'assay.internalBatch').inputValue() === 'IS-PATCHOULI',
  '切回广藿香后没有恢复其对照品表数据');
assert(await field(page, 'assay.sampleInjection.1').inputValue() === '1.0',
  '切回广藿香后没有恢复其供试品表数据');

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
  await field(page, `assay.f.${sample}`).fill('10');
  await fillPeaks(page, `assay.smpA.${sample}`, [50, 50]);
}
assert(await page.locator('#assay\\.out\\.MEAN').innerText() === '0.5', '外标法百分比计算错误');

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
  await field(page, `assay.f.${sample}`).fill('10');
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
assert(await page.locator('.generic-assay-table').count() === 2,
  '液相没有继续使用两张通用含量表');
assert(await page.locator('.word-record-table').count() === 0,
  '液相不应混入气相Word精确表');

await page.screenshot({ path: 'C:/tmp/assay-templates.png', fullPage: true });
assert(errors.length === 0, `页面脚本错误: ${errors.join('; ')}`);
await browser.close();
console.log(`PASS: ${audit.hplc.templates} 个液相模板/603 条记录，33 个气相模板，方法分离、标准原文及计算`);
