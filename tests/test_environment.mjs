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
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const averageReading = (record, roomId, metric, period = null) => {
  const periods = period ? [period] : ['morning', 'afternoon'];
  return average(record.entries.filter(entry => entry.readings && entry.readings[roomId]).flatMap(entry =>
    periods.map(name => entry.readings[roomId][name][metric])
  ));
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
assert(await page.locator('[data-env-room-table="specimen"] tbody tr').count() === 31,
  '标本室 2026 年 8 月应完整保留 31 行');
assert(await page.locator('[data-env-room-table="instrument"] tbody tr').count() === 31,
  '普通仪器室 2026 年 8 月应完整保留 31 行');
assert(await page.locator('[data-env-room-table="specimen"] [data-env-rest="true"]').count() === 5,
  '标本室 2026 年 8 月应保留 5 个星期日空行');
assert(await page.locator('[data-env-room-table="instrument"] [data-env-rest="true"]').count() === 5,
  '普通仪器室 2026 年 8 月应保留 5 个星期日空行');
const sundayValueCells = await page.locator('[data-env-rest="true"] .env-value').allTextContents();
assert(sundayValueCells.length === 40 && sundayValueCells.every(value => value.trim() === ''),
  '星期日的上午、下午温湿度格没有全部留空');
assert(await page.locator('[data-env-generate]').count() === 0, '生成后仍可直接重复生成');
assert(await page.locator('.env-primary.fixed:disabled').count() === 1, '生成后没有锁定按钮');

const generated = await page.evaluate(() => window.EnvironmentRecorder.getState());
const august = generated.months['2026-08'];
assert(Boolean(august), '固定月份没有写入本地状态');
assert(august.entries.length === 31, '生成数据没有保留整月全部日期');
assert(august.restSundays.length === 5, '2026 年 8 月应保留 5 个星期日空行');
assert(august.entries.filter(entry => entry.readings).length === 26, '非星期日记录日数量错误');
assert(august.entries.filter(entry => entry.isRestDay).every(entry =>
  new Date(`${entry.date}T12:00:00`).getDay() === 0 && entry.readings === null
), '星期日没有作为空白休息日保存');
assert(august.version === 3, '新生成月份没有使用星期日空行模型版本');
assert(august.season.key === 'summer', '8 月没有识别为夏季');
assert(august.season.mode === 'air-conditioned-indoor', '没有使用空调室内季节模型');
assert(await page.locator('[data-env-season="summer"]').count() === 1, '页面未显示夏季智能生成提示');

for (const entry of august.entries){
  if (!entry.readings) continue;
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

await page.locator('[data-env-month]').fill('2027-01');
await page.locator('[data-env-month]').dispatchEvent('change');
assert(await page.locator('[data-env-season="winter"]').count() === 1, '1 月没有显示冬季模型');
await page.locator('[data-env-generate]').click();

await page.locator('[data-env-month]').fill('2027-07');
await page.locator('[data-env-month]').dispatchEvent('change');
assert(await page.locator('[data-env-season="summer"]').count() === 1, '7 月没有显示夏季模型');
await page.locator('[data-env-generate]').click();

const seasonalState = await page.evaluate(() => window.EnvironmentRecorder.getState());
const january = seasonalState.months['2027-01'];
const july = seasonalState.months['2027-07'];
assert(january.season.key === 'winter' && july.season.key === 'summer', '冬夏月份模型保存错误');
const januaryTemperature = averageReading(january, 'instrument', 'temperature');
const julyTemperature = averageReading(july, 'instrument', 'temperature');
const januaryHumidity = averageReading(january, 'instrument', 'humidity');
const julyHumidity = averageReading(july, 'instrument', 'humidity');
assert(julyTemperature > januaryTemperature + 1.2, '夏季平均温度没有适度高于冬季');
assert(julyTemperature < januaryTemperature + 5, '空调室内的冬夏温差过大');
assert(julyHumidity > januaryHumidity + 1.2,
  `夏季平均湿度没有适度高于冬季：冬季 ${januaryHumidity.toFixed(2)}，夏季 ${julyHumidity.toFixed(2)}`);
assert(julyHumidity < januaryHumidity + 8,
  `空调室内的冬夏湿度差过大：冬季 ${januaryHumidity.toFixed(2)}，夏季 ${julyHumidity.toFixed(2)}`);
assert(
  averageReading(july, 'instrument', 'temperature', 'afternoon') <
    averageReading(july, 'instrument', 'temperature', 'morning') - 0.2,
  '夏季下午制冷特征没有体现'
);
const julyTemperatures = july.entries.flatMap(entry => [
  entry.readings && entry.readings.instrument.morning.temperature,
  entry.readings && entry.readings.instrument.afternoon.temperature
]).filter(Number.isFinite);
assert(Math.max(...julyTemperatures) - Math.min(...julyTemperatures) >= 2,
  '普通仪器室夏季数据过于平直，缺少自然日变化');
const humidityValues = [january, july].flatMap(record => record.entries
  .filter(entry => entry.readings)
  .flatMap(entry => ['specimen', 'instrument'].flatMap(roomId => [
    entry.readings[roomId].morning.humidity,
    entry.readings[roomId].afternoon.humidity
  ])));
const preferredHumidityRatio = humidityValues.filter(value => value >= 48 && value <= 58).length /
  humidityValues.length;
assert(preferredHumidityRatio >= 0.80,
  `湿度集中度不足：仅 ${(preferredHumidityRatio * 100).toFixed(1)}% 落在 48～58 %RH`);

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

await page.evaluate(() => {
  const state = window.EnvironmentRecorder.getState();
  const legacy = JSON.parse(JSON.stringify(state.months['2026-08']));
  legacy.version = 1;
  legacy.month = '2025-08';
  delete legacy.season;
  delete legacy.restSundays;
  const fallbackReadings = legacy.entries.find(entry => entry.readings).readings;
  legacy.entries = legacy.entries.map(entry => {
    const date = new Date(2025, 7, entry.day);
    return {
      date: `2025-08-${String(entry.day).padStart(2, '0')}`,
      day: entry.day,
      weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      readings: entry.readings || JSON.parse(JSON.stringify(fallbackReadings))
    };
  }).filter(entry => new Date(`${entry.date}T12:00:00`).getDay() !== 0);
  legacy.skippedSundays = [3, 10, 17, 24, 31].map(day =>
    `2025-08-${String(day).padStart(2, '0')}`
  );
  state.selectedMonth = '2025-08';
  state.months['2025-08'] = legacy;
  localStorage.setItem(window.EnvironmentRecorder.storageKey, JSON.stringify(state));
});
const legacyStoredBeforeReload = await page.evaluate(() =>
  localStorage.getItem(window.EnvironmentRecorder.storageKey)
);
await page.reload();
await page.waitForLoadState('networkidle');
await page.locator('[data-tab="environment"]').click();
assert(await page.locator('.env-season-card.legacy').count() === 1, '旧版固定月份没有显示保留提示');
assert((await page.locator('.env-season-card.legacy').innerText()).includes('不自动改写'),
  '旧版固定月份没有明确说明不自动改写');
assert(await page.locator('[data-env-room-table="specimen"] tbody tr').count() === 31,
  '旧版固定月份没有补出整月日期行');
assert(await page.locator('[data-env-room-table="specimen"] [data-env-rest="true"]').count() === 5,
  '旧版固定月份没有补出星期日空行');
assert((await page.locator('[data-env-room-table="specimen"] [data-env-rest="true"] .env-value').allTextContents())
  .every(value => value.trim() === ''), '旧版固定月份补出的星期日数据格不为空');
const legacyAfterReload = await page.evaluate(() => window.EnvironmentRecorder.getState().months['2025-08']);
const legacyStoredAfterReload = await page.evaluate(() =>
  localStorage.getItem(window.EnvironmentRecorder.storageKey)
);
assert(legacyAfterReload.version === 1 && legacyAfterReload.season === undefined,
  '加载页面时旧版固定月份被静默重算');
assert(legacyAfterReload.entries.length === 26 && legacyAfterReload.skippedSundays.length === 5,
  '为旧版固定月份补空行时改写了原始数据');
assert(legacyStoredAfterReload === legacyStoredBeforeReload,
  '显示旧版星期日空行时改写了本地固定数据');
assert(errors.length === 0, `页面脚本错误：${errors.join('; ')}`);

await browser.close();
console.log('PASS: 星期日空行、48～58 湿度集中、季节智能、旧数据锁定及刷新持久化均正常');
