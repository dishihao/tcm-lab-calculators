#!/usr/bin/env node
/* Capture table pixels and semantic DOM geometry from fixed Chromium. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const args = process.argv.slice(2), index = args.indexOf('--output');
if (args.includes('--self-test')) {
  const runSelfTest = async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; font: 16px/1.2 Arial, sans-serif; }
    table { border-collapse: collapse; table-layout: fixed; width: 240px; }
    col { width: 120px; }
    td { padding: 4px; vertical-align: top; border: 1px solid #000; }
    #empty-double { border: 4px double #000; }
    .wrapbox { width: 45px; word-break: break-all; }
  </style>
</head>
<body>
  <table>
    <colgroup><col><col></colgroup>
    <tr>
      <td id="subsup">普通H<sub>2</sub>O<sup>2</sup></td>
      <td id="empty-double"></td>
    </tr>
    <tr>
      <td id="wrap"><div class="wrapbox">ABCDEFG</div></td>
      <td>plain</td>
    </tr>
  </table>
</body>
</html>`);
      const result = await page.evaluate(() => {
        const num = value => Number.parseFloat(value) || 0;
        const table = document.querySelector('table');
        const tableRect = table.getBoundingClientRect();
        const border = (style, side) => ({ widthPx: num(style[`border${side[0].toUpperCase()}${side.slice(1)}Width`]), style: style[`border${side[0].toUpperCase()}${side.slice(1)}Style`] });
        const textLines = cell => {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: node => node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
          const rects = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) if (rect.width && rect.height) rects.push({ top: rect.top - tableRect.top, bottom: rect.bottom - tableRect.top, height: rect.height });
          }
          rects.sort((a, b) => a.top - b.top || a.bottom - b.bottom || a.height - b.height);
          const boxes = [];
          for (const rect of rects) {
            const box = boxes.find(candidate => {
              const overlapAllowance = 1;
              const centerAllowance = Math.max(8, Math.min(rect.height, candidate.height) * 0.5);
              const rectCenter = rect.top + rect.height / 2;
              const candidateCenter = candidate.top + candidate.height / 2;
              return (rect.top <= candidate.bottom + overlapAllowance && rect.bottom >= candidate.top - overlapAllowance) || Math.abs(rectCenter - candidateCenter) <= centerAllowance;
            });
            if (box) {
              box.top = Math.min(box.top, rect.top);
              box.bottom = Math.max(box.bottom, rect.bottom);
              box.height = box.bottom - box.top;
              box.rects.push(rect);
            } else {
              boxes.push({ top: rect.top, bottom: rect.bottom, height: rect.height, rects: [rect] });
            }
          }
          return { count: boxes.length, rects, boxes };
        };
        return Object.fromEntries([...table.querySelectorAll('td')].map(cell => [cell.id, { textLineCount: textLines(cell).count, textLineRects: textLines(cell).rects, textLineBoxes: textLines(cell).boxes, text: cell.innerText, borders: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, border(getComputedStyle(cell), side)])) }]));
      });
      if (result.subsup.textLineCount !== 1) throw new Error(`expected sub/sup cell to count once, got ${result.subsup.textLineCount}`);
      if (result['empty-double'].textLineCount !== 0) throw new Error(`expected empty double-bordered cell to count 0, got ${result['empty-double'].textLineCount}`);
      if (result.wrap.textLineCount !== 2) throw new Error(`expected genuine two-line wrap to count 2, got ${result.wrap.textLineCount}`);
      console.log('SELF-TEST GREEN: fixed-Chrome sub/sup counted once; empty double-bordered cell counted 0; genuine two-line wrap counted 2');
      return 0;
    } finally {
      await browser.close();
    }
  };
  const code = await runSelfTest();
  process.exit(code);
}
if (index < 0 || !args[index + 1]) throw new Error('usage: node tools/capture_gc_web_tables.mjs --output <audit-root>');
const outputRoot = path.resolve(args[index + 1]);
const runs = fs.readdirSync(outputRoot, { withFileTypes: true }).filter(x => x.isDirectory() && x.name.startsWith('visual-qa-')).map(x => path.join(outputRoot, x.name)).sort();
if (!runs.length) throw new Error(`no visual-qa-* export run under ${outputRoot}`);
const run = runs.at(-1), pageUrl = new URL('../index.html', import.meta.url).href;

const chooseTemplate = async (page, id) => {
  const template = await page.evaluate(x => ASSAY_TEMPLATES.find(y => y.id === x), id);
  if (!template) throw new Error(`template not found: ${id}`);
  if (await page.locator('[data-k="assay.tech"]').inputValue() !== template.tech) await page.locator('[data-k="assay.tech"]').selectOption(template.tech);
  const change = page.locator('[data-change-assay-product]'); if (await change.count()) await change.click();
  await page.locator('[data-assay-search]').fill(template.product);
  await page.locator(`[data-assay-product-choice="${template.product}"]`).click();
  await page.locator(`[data-assay-template-button="${template.id}"]`).click();
};

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
    await page.goto(pageUrl); await page.waitForLoadState('networkidle');
    await page.evaluate(() => { localStorage.clear(); document.body.style.zoom = '100%'; });
    await page.reload(); await page.waitForLoadState('networkidle'); await page.locator('[data-tab="assay"]').click();
    const ids = await page.evaluate(() => GC_TEMPLATES.map(x => x.id));
  if (ids.length !== 33) throw new Error(`expected 33 GC templates, got ${ids.length}`);
    for (const templateId of ids) {
      await chooseTemplate(page, templateId); const target = path.join(run, templateId); fs.mkdirSync(target, { recursive: true }); const all = {};
      for (const role of ['reference', 'sample']) {
        const table = page.locator(`[data-word-table-role="${role}"]`);
        if (await table.count() !== 1) throw new Error(`${templateId}/${role}: expected exactly one semantic table`);
        const frame = page.locator(`[data-word-table-frame="${role}"]`);
        if (await frame.count() !== 1) throw new Error(`${templateId}/${role}: expected exactly one render frame`);
        await frame.screenshot({ path: path.join(target, `${role}-web.png`) });
        all[role] = await table.evaluate((element, roleName) => {
          const num = value => Number.parseFloat(value) || 0, tableRect = element.getBoundingClientRect(), tableStyle = getComputedStyle(element), frame = element.closest('[data-word-table-frame]'), frameRect = frame.getBoundingClientRect();
          const container = element.closest('[data-word-indent-canvas]'), containerRect = container.getBoundingClientRect(), containerPaddingLeft = num(getComputedStyle(container).paddingLeft), occupied = [], cells = [];
          const border = (style, side) => ({ widthPx: num(style[`border${side[0].toUpperCase()}${side.slice(1)}Width`]), style: style[`border${side[0].toUpperCase()}${side.slice(1)}Style`] });
          const textLines = cell => {
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: node => node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
            const rects = [];
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) if (rect.width && rect.height) rects.push({ top: rect.top - tableRect.top, bottom: rect.bottom - tableRect.top, height: rect.height });
            }
            rects.sort((a, b) => a.top - b.top || a.bottom - b.bottom || a.height - b.height);
            const boxes = [];
            for (const rect of rects) {
              const box = boxes.find(candidate => {
                const overlapAllowance = 1;
                const centerAllowance = Math.max(8, Math.min(rect.height, candidate.height) * 0.5);
                const rectCenter = rect.top + rect.height / 2;
                const candidateCenter = candidate.top + candidate.height / 2;
                return (rect.top <= candidate.bottom + overlapAllowance && rect.bottom >= candidate.top - overlapAllowance) || Math.abs(rectCenter - candidateCenter) <= centerAllowance;
              });
              if (box) {
                box.top = Math.min(box.top, rect.top);
                box.bottom = Math.max(box.bottom, rect.bottom);
                box.height = box.bottom - box.top;
                box.rects.push(rect);
              } else {
                boxes.push({ top: rect.top, bottom: rect.bottom, height: rect.height, rects: [rect] });
              }
            }
            return { count: boxes.length, rects, boxes };
          };
          [...element.rows].forEach((row, r) => { let col = 0; while (occupied[r]?.[col]) col++; [...row.cells].forEach(cell => { while (occupied[r]?.[col]) col++; const rect = cell.getBoundingClientRect(), style = getComputedStyle(cell), rowSpan = cell.rowSpan, gridSpan = cell.colSpan, lines = textLines(cell), isGridGap = cell.classList.contains('word-grid-gap'); for (let rr = r; rr < r + rowSpan; rr++) { occupied[rr] ||= []; for (let cc = col; cc < col + gridSpan; cc++) occupied[rr][cc] = true; } cells.push({ id: `r${r + 1}c${col + 1}`, rowIndex: r + 1, gridColumnIndex: col + 1, rowSpan, gridSpan, x: rect.left - tableRect.left, y: rect.top - tableRect.top, width: rect.width, height: rect.height, text: cell.innerText, fixedSemantic: cell.getAttribute('data-fixed-semantic'), textLineCount: lines.count, textLineRects: lines.rects, textLineBoxes: lines.boxes, className: cell.className, isGridGap, borders: Object.fromEntries(['top','right','bottom','left'].map(side => [side, border(style, side)])) }); col += gridSpan; }); });
          // isGridGap is a structural occupancy sentinel, not a Word data cell.
          // Keep it for correct HTML-table coordinate allocation but exclude it
          // from source-vs-web semantic records.
          return { dpi: 96, outer: { width: frameRect.width, height: frameRect.height }, placement: { tableLeftInContainerPx: frameRect.left - containerRect.left - containerPaddingLeft, tableTopInContainerPx: frameRect.top - containerRect.top, frameMarginLeftPx: num(getComputedStyle(frame).marginLeft), containerPaddingLeftPx: containerPaddingLeft }, columns: [...element.querySelectorAll('col')].map((col, i) => ({ index: i + 1, widthPx: col.getBoundingClientRect().width })), rows: [...element.rows].map((row, i) => { const rect = row.getBoundingClientRect(); return { index: i + 1, y: rect.top - tableRect.top, heightPx: rect.height }; }), cells: cells.filter(cell => !cell.isGridGap) };
        }, role);
      fs.writeFileSync(path.join(target, `${role}-web.json`), JSON.stringify(all[role], null, 2));
    }
    fs.writeFileSync(path.join(target, 'web-metrics.json'), JSON.stringify({ templateId, ...all }, null, 2));
  }
  console.log(`Captured 33 templates / 66 tables in ${run}`);
} finally { await browser.close(); }
