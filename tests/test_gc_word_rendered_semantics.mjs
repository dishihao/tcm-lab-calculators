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

  const visibilityFailures = [
    ['opacity 0 semantic element', `<div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline" style="opacity:0"><span class="word-math-text">X</span></span><span>（%）</span></p></div>`, /opacity|visible ink/],
    ['transparent semantic text', `<div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline"><span class="word-math-text" style="color:transparent">X</span></span><span>（%）</span></p></div>`, /text color|transparent/],
    ['transparent overline rule', `<div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline" style="text-decoration-color:transparent"><span class="word-math-text">X</span></span><span>（%）</span></p></div>`, /overline color|transparent/],
    ['transparent fraction rule', goodFraction.replace('word-math-denominator', 'word-math-denominator" style="border-top-color:transparent'), /fraction bar color|transparent/],
    ['transparent ancestor', `<div style="opacity:0"><div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline"><span class="word-math-text">X</span></span></p></div></div>`, /opacity|ancestor|visible ink/],
    ['hidden ancestor', `<div style="display:none"><div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline"><span class="word-math-text">X</span></span></p></div></div>`, /display|ancestor|visible ink/],
    ['visibility-hidden ancestor', `<div style="visibility:hidden"><div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline"><span class="word-math-text">X</span></span></p></div></div>`, /visibility|ancestor|visible ink/],
    ['filter-transparent ancestor', `<div style="filter:opacity(0)"><div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline"><span class="word-math-text">X</span></span></p></div></div>`, /opacity|ancestor|visible ink/],
    ['zero-size semantic ink', `<div id="cell"${stale}><p><span>平均含量</span><span class="word-math-overline" style="display:inline-block;width:0;height:0;overflow:hidden;font-size:0"><span class="word-math-text">X</span></span></p></div>`, /geometry|zero|clipped|visible ink/],
    ['fully clipped semantic ink', `<div id="cell"${stale}><p><span>平均含量</span><span style="display:inline-block;position:relative;width:4px;height:4px;overflow:hidden"><span class="word-math-overline" style="position:absolute;left:100px;top:100px"><span class="word-math-text">X</span></span></span></p></div>`, /clipped|visible ink|geometry/],
    ['transparent text ancestor', `<div id="cell"${stale}><p style="color:rgba(0,0,0,0)"><span>平均含量</span><span class="word-math-overline"><span class="word-math-text">X</span></span></p></div>`, /text color|transparent/],
  ];
  for (const [name, html, error] of visibilityFailures) {
    await assert.rejects(() => parse(html), error, `${name} self-certified with a stale declaration`);
  }

  console.log('PASS: semantic QA derives visible overline/fraction/subscript/superscript/text/order ink from rendered DOM and rejects transparent/hidden/zero/clipped ink despite stale declarations');
} finally {
  await browser.close();
}
