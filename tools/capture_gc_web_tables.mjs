#!/usr/bin/env node
/* Capture table pixels and semantic DOM geometry from fixed Chromium. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const args = process.argv.slice(2), index = args.indexOf('--output');
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
      await table.screenshot({ path: path.join(target, `${role}-web.png`) });
      all[role] = await table.evaluate((element, roleName) => {
        const num = value => Number.parseFloat(value) || 0, tableRect = element.getBoundingClientRect(), tableStyle = getComputedStyle(element);
        const container = element.closest(`[data-assay-${roleName}-table]`) || element.parentElement, containerRect = container.getBoundingClientRect(), occupied = [], cells = [];
        const border = (style, side) => ({ widthPx: num(style[`border${side[0].toUpperCase()}${side.slice(1)}Width`]), style: style[`border${side[0].toUpperCase()}${side.slice(1)}Style`] });
        const textLines = cell => { const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: node => node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }); const ys = []; for (let node = walker.nextNode(); node; node = walker.nextNode()) { const range = document.createRange(); range.selectNodeContents(node); for (const rect of range.getClientRects()) if (rect.width && rect.height) ys.push(rect.top - tableRect.top); } ys.sort((a,b) => a-b); return ys.reduce((values, y) => !values.length || Math.abs(y - values.at(-1)) > .75 ? [...values, y] : values, []).length; };
        [...element.rows].forEach((row, r) => { let col = 0; while (occupied[r]?.[col]) col++; [...row.cells].forEach(cell => { while (occupied[r]?.[col]) col++; const rect = cell.getBoundingClientRect(), style = getComputedStyle(cell), rowSpan = cell.rowSpan, gridSpan = cell.colSpan; for (let rr = r; rr < r + rowSpan; rr++) { occupied[rr] ||= []; for (let cc = col; cc < col + gridSpan; cc++) occupied[rr][cc] = true; } cells.push({ id: `r${r + 1}c${col + 1}`, rowIndex: r + 1, gridColumnIndex: col + 1, rowSpan, gridSpan, x: rect.left - tableRect.left, y: rect.top - tableRect.top, width: rect.width, height: rect.height, text: cell.innerText, textLineCount: textLines(cell), className: cell.className, borders: Object.fromEntries(['top','right','bottom','left'].map(side => [side, border(style, side)])) }); col += gridSpan; }); });
        return { dpi: 96, outer: { width: tableRect.width, height: tableRect.height }, placement: { tableLeftInContainerPx: tableRect.left - containerRect.left, tableTopInContainerPx: tableRect.top - containerRect.top, tableMarginLeftPx: num(tableStyle.marginLeft), containerPaddingLeftPx: num(getComputedStyle(container).paddingLeft) }, columns: [...element.querySelectorAll('col')].map((col, i) => ({ index: i + 1, widthPx: col.getBoundingClientRect().width })), rows: [...element.rows].map((row, i) => { const rect = row.getBoundingClientRect(); return { index: i + 1, y: rect.top - tableRect.top, heightPx: rect.height }; }), cells };
      }, role);
      fs.writeFileSync(path.join(target, `${role}-web.json`), JSON.stringify(all[role], null, 2));
    }
    fs.writeFileSync(path.join(target, 'web-metrics.json'), JSON.stringify({ templateId, ...all }, null, 2));
  }
  console.log(`Captured 33 templates / 66 tables in ${run}`);
} finally { await browser.close(); }
