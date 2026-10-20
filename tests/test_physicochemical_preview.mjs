import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.locator('[data-tab="physicochemical"]').click();
  await page.locator('[data-identification-search="physicochemical"]').fill('薄荷');
  await page.locator('[data-identification-product="薄荷"]').click();
  await page.locator('[data-identification-template="id-physicochemical-1ixe5uj"]').click();
  assert.equal(await page.locator('.standard-paper').count(), 1, '理化应显示固定 A4 标准预览');
  assert.deepEqual(await page.locator('.standard-answer').allTextContents(), ['黄色至橙黄色', '紫红色']);
  assert(await page.locator('.standard-answer').first().evaluate(el => getComputedStyle(el).color === 'rgb(192, 0, 0)'));
  assert(await page.locator('.standard-paper').evaluate(el => /SimSun|宋体/.test(getComputedStyle(el).fontFamily)));
  assert.equal(await page.locator('.standard-paper textarea, .standard-paper input').count(), 0,
    '标准答案应直接写在原文横线上');
  const before = await page.locator('.standard-blank').evaluateAll(fields => fields.map(el => el.offsetWidth));
  await page.locator('[data-standard-scale="large"]').click();
  assert.deepEqual(await page.locator('.standard-blank').evaluateAll(fields => fields.map(el => el.offsetWidth)), before,
    '字号切换应缩放整个记录，不能改变字段相对位置');
  await page.locator('[data-standard-scale="standard"]').click();
  await page.evaluate(() => applyIdentificationTemplate('physicochemical', 'id-physicochemical-1mpmjob'));
  assert.deepEqual(await page.locator('.standard-answer').allTextContents(), ['白']);
  assert((await page.locator('.standard-paper').innerText()).includes('色浑浊'));
  await page.evaluate(() => applyIdentificationTemplate('physicochemical', 'id-physicochemical-1lwnpk6'));
  assert.equal(await page.locator('.standard-answer').count(), 0, '天平型号和编号不得从标准填入');
  assert(await page.locator('.standard-blank').count() >= 2, '仪器填写横线应保留');

  for (const id of ['id-physicochemical-1086la8', 'id-physicochemical-18zciaj']) {
    await page.evaluate(id => applyIdentificationTemplate('physicochemical', id), id);
    assert.deepEqual(await page.locator('.standard-answer:not([hidden])').allTextContents(),
      ['透明状黏液层薄', '为种子宽度的1/5以下', '透明状黏液层较厚', '超过种子宽度的1/2以上'],
      `${id}: 葶苈子应在横线上显示四处标准答案`);
    assert((await page.locator('.standard-preview-status').innerText()).includes('已核实 4 处'));
  }

  const catalog = await page.evaluate(() => PHYSICOCHEMICAL_TEMPLATES.map(t => t.id));
  assert.equal(catalog.length, 203);
  let shortRecords = 0;
  for (const id of catalog) {
    await page.evaluate(id => applyIdentificationTemplate('physicochemical', id), id);
    const actual = await page.evaluate(id => {
      const layout = PHYSICOCHEMICAL_ANSWER_LAYOUTS.templates[id];
      const fields = [...document.querySelectorAll('.standard-blank')];
      return { filled: document.querySelectorAll('.standard-answer').length, expected: layout.filled,
        fields: fields.length, expectedFields: layout.blankCount,
        originals: [...document.querySelectorAll('.standard-paper p')].map(p => p.dataset.sourceText),
        expectedOriginals: layout.blocks.flatMap(b => b.lines.map(l => l.runs.map(r => r.text).join(''))),
        short: fields.flatMap(el => { const a = el.querySelector('.standard-answer'); return a?.hidden ? [a.textContent] : []; }),
        review: [...document.querySelectorAll('.standard-short-answers li b')].map(el => el.textContent),
        noteHidden: document.querySelector('.standard-short-answers').hidden,
        emptyFields: fields.filter(el => !el.querySelector('.standard-answer')).every(el => !el.textContent.trim()),
        collisions: fields.filter(el => {
          const a = el.querySelector('.standard-answer'); if (!a || a.hidden) return false;
          const ar = a.getBoundingClientRect(), fr = el.getBoundingClientRect();
          return ar.left < fr.left - 1 || ar.right > fr.right + 1;
        }).length,
        illegible: fields.filter(el => {
          const answer = el.querySelector('.standard-answer');
          if (!answer || answer.hidden) return false;
          const scale = /scaleX\(([^)]+)\)/.exec(answer.style.transform);
          return scale && Number(scale[1]) < 0.55;
        }).length };
    }, id);
    assert.equal(actual.filled, actual.expected, `${id}: 答案数量不符`);
    assert.equal(actual.fields, actual.expectedFields, `${id}: 原横线缺失`);
    assert.deepEqual(actual.originals, actual.expectedOriginals, `${id}: 原文顺序变化`);
    assert(actual.emptyFields, `${id}: 未确认空格不应显示猜测答案`);
    assert.equal(actual.collisions, 0, `${id}: 答案超出原横线`);
    assert.equal(actual.illegible, 0, `${id}: 答案压缩后无法阅读`);
    assert.deepEqual(actual.review, actual.short, `${id}: 过短横线的答案应保留完整核对文本`);
    if (actual.short.length){ shortRecords++; assert(!actual.noteHidden, `${id}: 核对说明应可见`); }
  }
  assert(shortRecords > 0, '原横线过短的真实记录未被覆盖');
  await page.evaluate(() => applyIdentificationTemplate('physicochemical', 'id-physicochemical-i6v0vw'));
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手机只在预览区横向滑动');
  assert(await page.locator('.standard-paper-scroll').evaluate(el => el.scrollWidth > el.clientWidth));
  fs.mkdirSync(new URL('../output/playwright', import.meta.url), {recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('../output/playwright/physicochemical-answers-mobile.png', import.meta.url)),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:fileURLToPath(new URL('../output/playwright/physicochemical-answers-desktop.png', import.meta.url)),fullPage:true});
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.standard-paper:visible').count(), 1);
  assert.equal(await page.locator('.standard-preview-tools:visible').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: all 203 standard previews preserve underlines, fit red answers, leave unknown fields blank; A4 scale/mobile/print');
} finally { await browser.close(); }
