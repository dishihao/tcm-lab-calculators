import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const parserPath = path.join(here, '..', 'tools', 'gc_word_rendered_semantic_capture.js');
assert.ok(fs.existsSync(parserPath), 'render-derived semantic capture parser is required');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><style>
    .word-math-overline{text-decoration:overline}
    .word-math-denominator{border-top:1px solid #000}
  </style><body></body>`);
  await page.addScriptTag({ path: parserPath });

  const parse = async html => {
    await page.locator('body').evaluate((body, content) => { body.innerHTML = content; }, html);
    return page.locator('#cell').evaluate(cell => GcWordRenderedSemanticCapture.parseCell(cell));
  };
  const stale = ' data-fixed-semantic="stale-declaration-that-must-be-ignored"';

  const overlineExpected = 'text("平均含量")|overline(text("X"))|text("（%）")';
  assert.equal(await parse(`<div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline"><span class="word-math-text">X</span></span><span>（%）</span></p></div>`), overlineExpected);
  await assert.rejects(() => parse(`<div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline" style="text-decoration:none"><span class="word-math-text">X</span></span><span>（%）</span></p></div>`), /overline style/);
  assert.notEqual(await parse(`<div id="cell"${stale}><p><span>平均含量X（%）</span></p></div>`), overlineExpected,
    'omitted overline passed because a stale declaration remained');

  const fractionExpected = 'text("f＝")|fraction(text("A")|subscript(text("S")),text("C")|superscript(text("2")))';
  const goodFraction = `<div id="cell"${stale}><p><span>f＝</span><span class="word-math-fraction"><span class="word-math-numerator"><span class="word-math-text">A</span><sub><span class="word-math-text">S</span></sub></span><span class="word-math-denominator"><span class="word-math-text">C</span><sup><span class="word-math-text">2</span></sup></span></span></p></div>`;
  assert.equal(await parse(goodFraction), fractionExpected);
  await assert.rejects(() => parse(`<div id="cell"${stale}><p><span>f＝</span><span class="word-math-fraction"><span class="word-math-denominator"><span>C</span></span></span></p></div>`), /fraction numerator|fraction structure/);
  await assert.rejects(() => parse(goodFraction.replace('word-math-denominator', 'word-math-denominator" style="border-top:0')), /fraction bar/);

  assert.notEqual(await parse(goodFraction.replace('<sub>', '<span>').replace('</sub>', '</span>')), fractionExpected,
    'broken subscript structure passed');
  assert.notEqual(await parse(goodFraction.replace('<sup>', '<span>').replace('</sup>', '</span>')), fractionExpected,
    'broken superscript structure passed');
  assert.notEqual(await parse(goodFraction.replace('<span class="word-math-text">A</span><sub><span class="word-math-text">S</span></sub>', '<sub><span class="word-math-text">S</span></sub><span class="word-math-text">A</span>')), fractionExpected,
    'wrong semantic node order passed');
  assert.notEqual(await parse(goodFraction.replace('>A<', '>B<')), fractionExpected,
    'mutated visible text leaf passed');

  console.log('PASS: semantic QA derives overline/fraction/subscript/superscript/text/order from rendered DOM and ignores stale declarations');
} finally {
  await browser.close();
}
