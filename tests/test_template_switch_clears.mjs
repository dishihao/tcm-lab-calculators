import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');

  const qualityProjects = ['impurity', 'moisture', 'ash', 'extract', 'sulfur'];
  for (const project of qualityProjects) {
    const choices = await page.evaluate(item => {
      const pool = item === 'sulfur' ? SULFUR_DIOXIDE_TEMPLATES : QUALITY_TEMPLATES;
      return pool.filter(template => template.item === item).slice(0, 2)
        .map(template => ({ id: template.id, label: template.label }));
    }, project);
    assert.equal(choices.length, 2, `${project}: 缺少两个可切换模板`);

    await page.evaluate(({ item, id }) => {
      applyQualityTemplate(item, id);
      showTab(item);
    }, { item: project, id: choices[0].id });
    const oldKeys = await page.locator(`section[data-sheet="${project}"] input[data-k]`)
      .evaluateAll(inputs => inputs.slice(0, 3).map(input => input.dataset.k));
    assert(oldKeys.length > 0, `${project}: 第一个模板没有可填写数据`);
    for (const [index, key] of oldKeys.entries()) {
      await page.locator(`[data-k="${key}"]`).fill(`OLD-${project}-${index}`);
    }
    assert.deepEqual(
      await page.evaluate(keys => keys.map(key => store[key]), oldKeys),
      oldKeys.map((_, index) => `OLD-${project}-${index}`),
      `${project}: 测试前没有成功写入旧数据`
    );

    await page.evaluate(({ item, id }) => {
      applyQualityTemplate(item, id);
      showTab(item);
    }, { item: project, id: choices[1].id });
    assert.deepEqual(
      await page.evaluate(keys => keys.map(key => store[key]), oldKeys),
      oldKeys.map(() => undefined),
      `${project}: 更换模板后仍保留旧填写数据`
    );
    assert.equal(
      await page.evaluate(item => Object.keys(store.__qualityTemplateStates || {})
        .some(key => key.startsWith(`${item}:`)), project),
      false,
      `${project}: 更换模板后仍保留旧模板快照`
    );

    await page.evaluate(({ item, id }) => {
      applyQualityTemplate(item, id);
      showTab(item);
    }, { item: project, id: choices[0].id });
    assert.deepEqual(
      await page.evaluate(keys => keys.map(key => store[key]), oldKeys),
      oldKeys.map(() => undefined),
      `${project}: 切回旧品种后恢复了上一次批次数据`
    );
  }

  // 自定义含量测定品种也按品种名清空，并清除由旧输入得到的结果。
  await page.evaluate(() => applyAssayProduct('切换清空测试A'));
  await page.evaluate(() => {
    Object.assign(store, {
      'assay.tech': 'hplc', 'assay.mode': 'external', 'assay.dryBasis': '0',
      'assay.name': '测试成分', 'assay.Cref': '1', 'assay.Ws.1': '1', 'assay.Ws.2': '1',
      'assay.f.1': '1', 'assay.f.2': '1', 'assay.plates': '10000', 'assay.limval': '0.0',
    });
    for (let i = 0; i < 5; i++) store[`assay.refA.${i}`] = '100';
    for (const sample of [1, 2]) for (let i = 0; i < 2; i++) store[`assay.smpA.${sample}.${i}`] = '50';
    build();
    showTab('assay');
    computeAssay();
  });
  const oldAssayKeys = ['assay.Cref', 'assay.Ws.1', 'assay.Ws.2', 'assay.f.1', 'assay.f.2', 'assay.refA.0'];
  const oldAssayResult = await page.locator('#assay\\.out\\.MEAN').innerText();
  assert.notEqual(oldAssayResult, '', '测试含量结果没有生成');
  await page.evaluate(() => applyAssayProduct('切换清空测试B'));
  assert.deepEqual(
    await page.evaluate(keys => keys.map(key => store[key]), oldAssayKeys),
    oldAssayKeys.map(() => undefined),
    '含量测定更换自定义品种后仍保留旧填写数据'
  );
  assert.notEqual(await page.locator('#assay\\.out\\.MEAN').innerText(), oldAssayResult,
    '更换品种后仍显示旧计算结果');
  assert.deepEqual(Object.keys(await page.evaluate(() => store.__assayTemplateStates || {})), [],
    '含量测定更换品种后仍保留旧模板快照');

  await page.evaluate(() => applyAssayProduct('切换清空测试A'));
  assert.deepEqual(
    await page.evaluate(keys => keys.map(key => store[key]), oldAssayKeys),
    oldAssayKeys.map(() => undefined),
    '切回旧的自定义品种后恢复了上一次批次数据'
  );
  assert.deepEqual(await page.evaluate(() => Object.keys(store).filter(key => key.startsWith('assay.')
    && !['assay.tech', 'assay.mode', 'assay.dryBasis', 'assay.productName',
      'assay.selectedProduct', 'assay.template', 'assay.limop'].includes(key))),
    [], '切回旧自定义品种后仍残留批次字段');
  console.log('PASS: 五个质量项目与含量测定更换品种后清空旧录入、结果和模板快照');
} finally {
  await browser.close();
}
