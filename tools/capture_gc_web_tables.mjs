#!/usr/bin/env node
/* Capture live Chromium Word-table geometry at a fixed viewport/zoom. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('usage: node tools/capture_gc_web_tables.mjs --output <audit-root>');
const outputRoot = path.resolve(args[outputIndex + 1]);
const runs = fs.readdirSync(outputRoot, { withFileTypes: true }).filter(item => item.isDirectory() && item.name.startsWith('visual-qa-'))
  .map(item => path.join(outputRoot, item.name)).sort();
if (!runs.length) throw new Error(`no visual-qa-* export run under ${outputRoot}`);
const run = runs.at(-1);
const pageUrl = new URL('../index.html', import.meta.url).href;

const chooseTemplate = async (page, templateId) => {
  const template = await page.evaluate(id => ASSAY_TEMPLATES.find(t => t.id === id), templateId);
  if (!template) throw new Error(`template not found: ${templateId}`);
  if (await page.locator('[data-k="assay.tech"]').inputValue() !== template.tech) await page.locator('[data-k="assay.tech"]').selectOption(template.tech);
  const change = page.locator('[data-change-assay-product]');
  if (await change.count()) await change.click();
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
  const ids = await page.evaluate(() => GC_TEMPLATES.map(item => item.id));
  if (ids.length !== 33) throw new Error(`expected 33 GC templates, got ${ids.length}`);
  for (const templateId of ids) {
    await chooseTemplate(page, templateId);
    const target = path.join(run, templateId); fs.mkdirSync(target, { recursive: true });
    const data = {};
    for (const role of ['reference', 'sample']) {
      const locator = page.locator(`[data-word-table-role="${role}"]`);
      if (await locator.count() !== 1) throw new Error(`${templateId}/${role}: expected exactly one data-word-table-role table`);
      await locator.screenshot({ path: path.join(target, `${role}-web.png`) });
      data[role] = await locator.evaluate(table => {
        const rect = table.getBoundingClientRect();
        const style = getComputedStyle(table);
        return {
          dpi: 96, outer: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          border: { top: style.borderTopWidth, right: style.borderRightWidth, bottom: style.borderBottomWidth, left: style.borderLeftWidth },
          columns: Array.from(table.querySelectorAll('col')).map((col, index) => ({ index, width: col.getBoundingClientRect().width })),
          rows: Array.from(table.rows).map((row, index) => ({ index, y: row.getBoundingClientRect().y - rect.y, height: row.getBoundingClientRect().height })),
          cells: Array.from(table.querySelectorAll('td,th')).map((cell, index) => { const r = cell.getBoundingClientRect(), s = getComputedStyle(cell); return { index, row: cell.parentElement.rowIndex, column: cell.cellIndex, rowSpan: cell.rowSpan, colSpan: cell.colSpan, x: r.x - rect.x, y: r.y - rect.y, width: r.width, height: r.height, text: cell.innerText, font: { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, whiteSpace: s.whiteSpace } }; }),
        };
      });
      fs.writeFileSync(path.join(target, `${role}-web.json`), JSON.stringify({ dpi: 96, ...data[role] }, null, 2));
    }
    fs.writeFileSync(path.join(target, 'web-metrics.json'), JSON.stringify({ templateId, ...data }, null, 2));
  }
  console.log(`Captured 33 templates / 66 tables in ${run}`);
} finally { await browser.close(); }
