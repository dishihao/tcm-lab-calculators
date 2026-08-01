import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/37475/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
);

const PAGE_URL = new URL('../index.html', import.meta.url).href;
const OUTPUT_DIR = fileURLToPath(new URL('../output/playwright/', import.meta.url));
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

mkdirSync(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

await page.goto(PAGE_URL);
await page.waitForLoadState('networkidle');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState('networkidle');

await page.locator('[data-tab="environment"]').click();
assert(await page.locator('[data-sheet="environment"].active').count() === 1, '温湿度页签未打开');
assert(await page.locator('[data-env-room]').count() === 8, '两间房的四组范围输入未完整显示');

await page.locator('[data-env-month]').fill('2026-08');
await page.locator('[data-env-month]').dispatchEvent('change');

await page.locator('[data-env-room="specimen"][data-env-field="temperatureMin"]').fill('30');
await page.locator('[data-env-room="specimen"][data-env-field="temperatureMax"]').fill('20');
await page.locator('[data-env-generate]').click();
assert(await page.locator('.env-alert.error').count() === 1, '无效范围没有被阻止');
assert(await page.locator('[data-env-room-table]').count() === 0, '无效范围仍生成了数据');
await page.locator('[data-env-room="specimen"][data-env-field="temperatureMin"]').fill('18');
await page.locator('[data-env-room="specimen"][data-env-field="temperatureMax"]').fill('26');
await page.locator('[data-env-generate]').click();

assert(await page.locator('.env-alert.success').count() === 1, '生成后未显示固定保存提示');
assert(await page.locator('[data-env-room-table]').count() === 2, '没有同时生成两间房记录');
assert(await page.locator('[data-env-room-table="specimen"] tbody tr').count() === 26,
  '标本室 2026 年 8 月应有 26 个非星期日记录日');
assert(await page.locator('[data-env-room-table="instrument"] tbody tr').count() === 26,
  '普通仪器室 2026 年 8 月应有 26 个非星期日记录日');
assert(await page.locator('[data-env-generate]').count() === 0, '生成后仍可直接重复生成');
assert(await page.locator('.env-primary.fixed:disabled').count() === 1, '生成后没有锁定按钮');

const generated = await page.evaluate(() => window.EnvironmentRecorder.getState());
const august = generated.months['2026-08'];
assert(Boolean(august), '固定月份没有写入本地状态');
assert(august.entries.length === 26, '生成记录日数量错误');
assert(august.skippedSundays.length === 5, '2026 年 8 月应跳过 5 个星期日');
assert(august.entries.every(entry => new Date(`${entry.date}T12:00:00`).getDay() !== 0), '记录中混入了星期日');

for (const entry of august.entries){
  for (const roomId of ['specimen', 'instrument']){
    const limits = august.settings[roomId];
    for (const period of ['morning', 'afternoon']){
      const reading = entry.readings[roomId][period];
      assert(reading.temperature >= limits.temperatureMin && reading.temperature <= limits.temperatureMax,
        `${roomId} ${entry.date} ${period} 温度越界`);
      assert(reading.humidity >= limits.humidityMin && reading.humidity <= limits.humidityMax,
        `${roomId} ${entry.date} ${period} 湿度越界`);
    }
  }
}

const storedBeforeReload = await page.evaluate(() => localStorage.getItem('tcm-lab-environment-v1'));
const tableBeforeReload = await page.locator('.env-records').innerText();
await page.reload();
await page.waitForLoadState('networkidle');
await page.locator('[data-tab="environment"]').click();
const storedAfterReload = await page.evaluate(() => localStorage.getItem('tcm-lab-environment-v1'));
const tableAfterReload = await page.locator('.env-records').innerText();
assert(storedAfterReload === storedBeforeReload, '刷新后固定数据发生变化');
assert(tableAfterReload === tableBeforeReload, '刷新后表格显示发生变化');

await page.locator('[data-env-month]').fill('2026-09');
await page.locator('[data-env-month]').dispatchEvent('change');
assert(await page.locator('.env-empty').count() === 1, '切换到未生成月份时未显示空状态');
assert(await page.locator('[data-env-room-table]').count() === 0, '不同月份错误复用了旧数据');

await page.locator('[data-env-month]').fill('2026-08');
await page.locator('[data-env-month]').dispatchEvent('change');
page.once('dialog', dialog => dialog.dismiss());
await page.locator('[data-env-clear]').click();
assert(await page.locator('[data-env-room-table]').count() === 2, '取消清除后数据仍被删除');

await page.screenshot({ path: `${OUTPUT_DIR}/temperature-humidity.png`, fullPage: true });
assert(errors.length === 0, `页面脚本错误：${errors.join('; ')}`);

await browser.close();
console.log('PASS: 两间房整月生成、星期日跳过、范围校验、固定锁定与刷新持久化均正常');
