/* =========================================================================
   温湿度月度记录生成器
   - 标本室、普通仪器室一次生成
   - 星期日保留空白行
   - 公共记录按月份固定，对所有访问者一致
   - 本机自定义记录写入 localStorage 并锁定
   ========================================================================= */
'use strict';

(function initEnvironmentRecorder(){
  const STORAGE_KEY = 'tcm-lab-environment-v1';
  const PUBLIC_SEED_VERSION = 'environment-public-v1';
  const publicRecordCache = new Map();
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const ROOMS = [
    {
      id: 'specimen',
      name: '标本室',
      short: '标本室',
      stability: 0.76,
      temperatureOffset: -0.15,
      humidityOffset: 0.2,
      defaults: { temperatureMin: 18, temperatureMax: 26, humidityMin: 45, humidityMax: 65 }
    },
    {
      id: 'instrument',
      name: '普通仪器室',
      short: '仪器室',
      stability: 1,
      temperatureOffset: 0.15,
      humidityOffset: -0.2,
      defaults: { temperatureMin: 18, temperatureMax: 28, humidityMin: 40, humidityMax: 65 }
    }
  ];

  /*
   * 空调室内逐月模型：季节只轻度移动生成区间的中心，不改变用户设置的硬上下限。
   * afternoonTemperature / afternoonHumidity 表示“下午平均值 - 上午平均值”。
   * 夏季下午制冷通常使温度略低；冬季设备运行后则可能轻微回升。
   */
  const MONTH_PROFILES = {
    1:  { key:'winter', label:'冬季', glyph:'冬', temperatureBias:-0.10, humidityBias:-0.09, afternoonTemperature: 0.20, afternoonHumidity:-1.0 },
    2:  { key:'winter', label:'冬季', glyph:'冬', temperatureBias:-0.08, humidityBias:-0.08, afternoonTemperature: 0.15, afternoonHumidity:-0.8 },
    3:  { key:'spring', label:'春季', glyph:'春', temperatureBias:-0.05, humidityBias:-0.04, afternoonTemperature: 0.10, afternoonHumidity:-0.4 },
    4:  { key:'spring', label:'春季', glyph:'春', temperatureBias:-0.02, humidityBias: 0.00, afternoonTemperature: 0.00, afternoonHumidity: 0.0 },
    5:  { key:'spring', label:'春季', glyph:'春', temperatureBias: 0.05, humidityBias: 0.02, afternoonTemperature:-0.15, afternoonHumidity:-0.2 },
    6:  { key:'summer', label:'夏季', glyph:'夏', temperatureBias: 0.12, humidityBias: 0.04, afternoonTemperature:-0.40, afternoonHumidity:-0.6 },
    7:  { key:'summer', label:'夏季', glyph:'夏', temperatureBias: 0.16, humidityBias: 0.05, afternoonTemperature:-0.55, afternoonHumidity:-0.8 },
    8:  { key:'summer', label:'夏季', glyph:'夏', temperatureBias: 0.14, humidityBias: 0.05, afternoonTemperature:-0.50, afternoonHumidity:-0.7 },
    9:  { key:'autumn', label:'秋季', glyph:'秋', temperatureBias: 0.08, humidityBias: 0.025, afternoonTemperature:-0.25, afternoonHumidity:-0.4 },
    10: { key:'autumn', label:'秋季', glyph:'秋', temperatureBias: 0.02, humidityBias: 0.00, afternoonTemperature:-0.05, afternoonHumidity:-0.3 },
    11: { key:'autumn', label:'秋季', glyph:'秋', temperatureBias:-0.04, humidityBias:-0.04, afternoonTemperature: 0.10, afternoonHumidity:-0.7 },
    12: { key:'winter', label:'冬季', glyph:'冬', temperatureBias:-0.08, humidityBias:-0.08, afternoonTemperature: 0.18, afternoonHumidity:-0.9 }
  };
  const SEASON_DESCRIPTIONS = {
    spring: '春季接近设定范围中位，湿度随月份轻微回升。',
    summer: '夏季轻度偏暖，湿度仍以 48～58 %RH 为主；下午制冷后温度通常略低于上午。',
    autumn: '秋季温湿度逐步回落，仍保留空调室内的小幅日变化。',
    winter: '冬季轻度偏凉、偏干；下午受设备运行影响可能略回升。'
  };

  const pad = value => String(value).padStart(2, '0');
  const esc = value => String(value).replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);

  function currentMonth(){
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  }

  function defaultDraft(){
    return Object.fromEntries(ROOMS.map(room => [room.id, { ...room.defaults }]));
  }

  function emptyState(){
    return {
      viewMode: 'public',
      selectedMonth: currentMonth(),
      draft: defaultDraft(),
      months: {}
    };
  }

  function normalizeState(value){
    const next = emptyState();
    if (!value || typeof value !== 'object') return next;
    next.viewMode = value.viewMode === 'local' ? 'local' : 'public';
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value.selectedMonth || '')){
      next.selectedMonth = value.selectedMonth;
    }
    if (value.draft && typeof value.draft === 'object'){
      ROOMS.forEach(room => {
        const saved = value.draft[room.id];
        if (!saved || typeof saved !== 'object') return;
        Object.keys(room.defaults).forEach(key => {
          if (saved[key] !== undefined) next.draft[room.id][key] = saved[key];
        });
      });
    }
    if (value.months && typeof value.months === 'object') next.months = value.months;
    return next;
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : emptyState();
    }catch(error){
      return emptyState();
    }
  }

  let state = loadState();
  let flash = null;
  let storageFailed = false;

  function saveState(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageFailed = false;
      return true;
    }catch(error){
      storageFailed = true;
      return false;
    }
  }

  function parseMonth(month){
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ''));
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  function monthLabel(month){
    const parsed = parseMonth(month);
    return parsed ? `${parsed.year} 年 ${parsed.month} 月` : month;
  }

  function shiftMonth(month, offset){
    const parsed = parseMonth(month) || parseMonth(currentMonth());
    const date = new Date(parsed.year, parsed.month - 1 + offset, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function seasonProfileForMonth(month){
    const parsed = parseMonth(month) || parseMonth(currentMonth());
    const profile = MONTH_PROFILES[parsed.month];
    return {
      ...profile,
      monthNumber: parsed.month,
      description: SEASON_DESCRIPTIONS[profile.key],
      mode: 'air-conditioned-indoor'
    };
  }

  function displaySeason(record){
    const calendarSeason = seasonProfileForMonth(record ? record.month : state.selectedMonth);
    if (record && !record.season) return { ...calendarSeason, legacy: true };
    return { ...calendarSeason, ...(record && record.season ? record.season : {}), legacy: false };
  }

  function numericSettings(draft){
    return Object.fromEntries(ROOMS.map(room => {
      const source = draft[room.id] || {};
      const normalized = {};
      Object.keys(room.defaults).forEach(key => { normalized[key] = Number(source[key]); });
      return [room.id, normalized];
    }));
  }

  function validateDraft(){
    const errors = [];
    ROOMS.forEach(room => {
      const values = numericSettings(state.draft)[room.id];
      const label = room.name;
      if (Object.values(values).some(value => !Number.isFinite(value))){
        errors.push(`${label}的范围没有填写完整`);
        return;
      }
      if (values.temperatureMin < -20 || values.temperatureMax > 60 ||
          values.temperatureMax - values.temperatureMin < 1){
        errors.push(`${label}温度范围应在 -20～60 ℃内，且上下限至少相差 1 ℃`);
      }
      if (values.humidityMin < 0 || values.humidityMax > 100 ||
          values.humidityMax - values.humidityMin < 2){
        errors.push(`${label}湿度范围应在 0～100 %RH 内，且上下限至少相差 2 %RH`);
      }
    });
    return errors;
  }

  function randomUnit(){
    if (window.crypto && typeof window.crypto.getRandomValues === 'function'){
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] / 4294967296;
    }
    return Math.random();
  }

  function bellRandom(random = randomUnit){
    let sum = 0;
    for (let i = 0; i < 6; i += 1) sum += random();
    return sum - 3;
  }

  function hashSeed(text){
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1){
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed){
    let value = seed >>> 0;
    return function nextSeededValue(){
      value = (value + 0x6D2B79F5) >>> 0;
      let mixed = value;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, min, max){
    return Math.min(max, Math.max(min, value));
  }

  function roundedWithin(value, min, max, digits){
    const factor = Math.pow(10, digits);
    return clamp(Math.round(value * factor) / factor, min, max);
  }

  function roomReadings(settings, memory, shared, season, room, random = randomUnit){
    const tempSpan = settings.temperatureMax - settings.temperatureMin;
    const humiditySpan = settings.humidityMax - settings.humidityMin;
    const tempMiddle = (settings.temperatureMin + settings.temperatureMax) / 2;
    const humidityInset = Math.min(2, humiditySpan * 0.15);
    const preferredHumidityMiddle = clamp(
      53,
      settings.humidityMin + humidityInset,
      settings.humidityMax - humidityInset
    );
    const stability = room.stability || 1;

    const tempTarget = tempMiddle + tempSpan * season.temperatureBias + room.temperatureOffset +
      shared.temperature * tempSpan * 0.105 * stability +
      bellRandom(random) * tempSpan * 0.05 * stability +
      shared.temperatureEvent * tempSpan * 0.10 * stability;
    const tempBase = Number.isFinite(memory.temperature)
      ? memory.temperature * 0.45 + tempTarget * 0.55
      : tempTarget;
    const coolingPulse = season.key === 'summer' && random() < 0.18
      ? -(0.35 + random() * 0.85) * stability
      : 0;
    const afternoonTemperatureDelta = season.afternoonTemperature + coolingPulse;
    const morningTemperature = roundedWithin(
      tempBase - afternoonTemperatureDelta / 2 + bellRandom(random) * tempSpan * 0.035 * stability,
      settings.temperatureMin,
      settings.temperatureMax,
      1
    );
    const afternoonTemperature = roundedWithin(
      tempBase + afternoonTemperatureDelta / 2 + bellRandom(random) * tempSpan * 0.035 * stability,
      settings.temperatureMin,
      settings.temperatureMax,
      1
    );
    memory.temperature = (morningTemperature + afternoonTemperature) / 2;

    const temperatureEffect = (memory.temperature - tempMiddle) * 0.35;
    const humidityTarget = preferredHumidityMiddle + humiditySpan * season.humidityBias + room.humidityOffset +
      shared.humidity * humiditySpan * 0.12 * stability +
      bellRandom(random) * humiditySpan * 0.06 * stability +
      shared.humidityEvent * humiditySpan * 0.16 * stability - temperatureEffect;
    const humidityBase = Number.isFinite(memory.humidity)
      ? memory.humidity * 0.45 + humidityTarget * 0.55
      : humidityTarget;
    const afternoonHumidityDelta = season.afternoonHumidity +
      (coolingPulse < 0 ? -(0.3 + random() * 0.8) : 0);
    const morningHumidity = roundedWithin(
      humidityBase - afternoonHumidityDelta / 2 + bellRandom(random) * humiditySpan * 0.035 * stability,
      settings.humidityMin,
      settings.humidityMax,
      0
    );
    const afternoonHumidity = roundedWithin(
      humidityBase + afternoonHumidityDelta / 2 + bellRandom(random) * humiditySpan * 0.035 * stability,
      settings.humidityMin,
      settings.humidityMax,
      0
    );
    memory.humidity = (morningHumidity + afternoonHumidity) / 2;

    return {
      morning: { temperature: morningTemperature, humidity: morningHumidity },
      afternoon: { temperature: afternoonTemperature, humidity: afternoonHumidity }
    };
  }

  function generateMonth(month, settings, options = {}){
    const parsed = parseMonth(month);
    if (!parsed) throw new Error('月份格式不正确');
    const random = options.random || randomUnit;
    const season = seasonProfileForMonth(month);
    const days = new Date(parsed.year, parsed.month, 0).getDate();
    const entries = [];
    const restSundays = [];
    const memory = Object.fromEntries(ROOMS.map(room => [room.id, { temperature: NaN, humidity: NaN }]));

    for (let day = 1; day <= days; day += 1){
      const date = new Date(parsed.year, parsed.month - 1, day);
      const isoDate = `${parsed.year}-${pad(parsed.month)}-${pad(day)}`;
      if (date.getDay() === 0){
        restSundays.push(isoDate);
        entries.push({
          date: isoDate,
          day,
          weekday: WEEKDAYS[date.getDay()],
          isRestDay: true,
          readings: null
        });
        continue;
      }
      const shared = {
        temperature: bellRandom(random),
        humidity: bellRandom(random),
        temperatureEvent: random() < 0.10 ? random() * 2 - 1 : 0,
        humidityEvent: random() < 0.12 ? random() * 2 - 1 : 0
      };
      const readings = {};
      ROOMS.forEach(room => {
        readings[room.id] = roomReadings(settings[room.id], memory[room.id], shared, season, room, random);
      });
      entries.push({
        date: isoDate,
        day,
        weekday: WEEKDAYS[date.getDay()],
        readings
      });
    }

    return {
      version: options.visibility === 'public' ? 4 : 3,
      month,
      createdAt: options.createdAt || new Date().toISOString(),
      settings,
      season,
      entries,
      restSundays,
      ...(options.visibility ? { visibility: options.visibility } : {}),
      ...(options.seedVersion ? { seedVersion: options.seedVersion } : {})
    };
  }

  function publicRecordForMonth(month){
    if (!parseMonth(month)) return null;
    if (!publicRecordCache.has(month)){
      publicRecordCache.set(month, generateMonth(month, numericSettings(defaultDraft()), {
        random: seededRandom(hashSeed(`${PUBLIC_SEED_VERSION}:${month}`)),
        createdAt: `${month}-01T00:00:00.000Z`,
        visibility: 'public',
        seedVersion: PUBLIC_SEED_VERSION
      }));
    }
    return publicRecordCache.get(month);
  }

  function localRecordForMonth(month = state.selectedMonth){
    return state.months[month] || null;
  }

  function activeRecord(){
    return state.viewMode === 'local'
      ? localRecordForMonth()
      : publicRecordForMonth(state.selectedMonth);
  }

  function entriesForDisplay(record){
    const parsed = parseMonth(record && record.month);
    const savedEntries = record && Array.isArray(record.entries) ? record.entries : [];
    if (!parsed) return savedEntries;
    const entriesByDay = new Map(savedEntries
      .filter(entry => Number.isInteger(Number(entry && entry.day)))
      .map(entry => [Number(entry.day), entry]));
    const days = new Date(parsed.year, parsed.month, 0).getDate();
    const entries = [];

    for (let day = 1; day <= days; day += 1){
      const date = new Date(parsed.year, parsed.month - 1, day);
      const isoDate = `${parsed.year}-${pad(parsed.month)}-${pad(day)}`;
      const isRestDay = date.getDay() === 0;
      const saved = entriesByDay.get(day);
      entries.push({
        ...(saved || {}),
        date: isoDate,
        day,
        weekday: WEEKDAYS[date.getDay()],
        isRestDay,
        readings: isRestDay ? null : (saved && saved.readings ? saved.readings : null)
      });
    }
    return entries;
  }

  function sundayDates(record){
    if (record && Array.isArray(record.restSundays)) return record.restSundays;
    if (record && Array.isArray(record.skippedSundays)) return record.skippedSundays;
    return record ? entriesForDisplay(record).filter(entry => entry.isRestDay).map(entry => entry.date) : [];
  }

  function formatCreatedAt(value){
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function rangeText(settings){
    return `${settings.temperatureMin}～${settings.temperatureMax} ℃ · ${settings.humidityMin}～${settings.humidityMax} %RH`;
  }

  function rangeField(room, field, label, unit, step){
    const record = activeRecord();
    const source = record ? record.settings : state.draft;
    const value = source[room.id][field];
    return `
      <label class="env-range-field">
        <span>${label}</span>
        <span class="env-range-input">
          <input type="number" value="${esc(value)}" step="${step}" inputmode="decimal"
            data-env-room="${room.id}" data-env-field="${field}"${record ? ' disabled' : ''}>
          <small>${unit}</small>
        </span>
      </label>`;
  }

  function renderRoomConfig(room){
    const record = activeRecord();
    return `
      <div class="env-room-config${record ? ' locked' : ''}">
        <div class="env-room-config-title">
          <span class="env-room-dot ${room.id}"></span>
          <b>${room.name}</b>
          ${record ? '<span class="env-mini-lock">已锁定</span>' : ''}
        </div>
        <div class="env-range-grid">
          ${rangeField(room, 'temperatureMin', '温度下限', '℃', '0.1')}
          ${rangeField(room, 'temperatureMax', '温度上限', '℃', '0.1')}
          ${rangeField(room, 'humidityMin', '湿度下限', '%RH', '1')}
          ${rangeField(room, 'humidityMax', '湿度上限', '%RH', '1')}
        </div>
      </div>`;
  }

  function renderSeasonCard(record){
    const season = displaySeason(record);
    const title = season.legacy ? '旧版固定数据保持不变' : `${season.label}智能生成`;
    const description = season.legacy
      ? `${season.label}月份已在季节模型升级前固定，系统不会改写；清除后重新生成才会应用新模型。`
      : season.description;
    return `
      <div class="env-season-card ${season.key}${season.legacy ? ' legacy' : ''}" data-env-season="${season.key}">
        <span class="env-season-glyph" aria-hidden="true">${season.glyph}</span>
        <div>
          <b>${title}</b>
          <span>${description}</span>
        </div>
        <em>${season.legacy ? '不自动改写' : '空调室内 · 轻度季节修正'}</em>
      </div>`;
  }

  function renderRoomTable(room, record){
    const settings = record.settings[room.id];
    const season = displaySeason(record);
    const entries = entriesForDisplay(record);
    const rows = entries.map(entry => {
      const values = entry.readings && entry.readings[room.id];
      if (!values){
        return `
          <tr class="${entry.isRestDay ? 'env-rest-row' : 'env-missing-row'}" data-env-date="${entry.date}" data-env-weekday="${entry.weekday}"${entry.isRestDay ? ' data-env-rest="true"' : ''}>
            <td>${entry.day} 日</td>
            <td>星期${entry.weekday}</td>
            <td class="env-value"></td>
            <td class="env-value"></td>
            <td class="env-value"></td>
            <td class="env-value"></td>
          </tr>`;
      }
      return `
        <tr data-env-date="${entry.date}" data-env-weekday="${entry.weekday}">
          <td>${entry.day} 日</td>
          <td>星期${entry.weekday}</td>
          <td class="env-value">${values.morning.temperature.toFixed(1)}</td>
          <td class="env-value">${values.morning.humidity}</td>
          <td class="env-value">${values.afternoon.temperature.toFixed(1)}</td>
          <td class="env-value">${values.afternoon.humidity}</td>
        </tr>`;
    }).join('');
    const mobileRows = entries.map(entry => {
      const values = entry.readings && entry.readings[room.id];
      const mobileReading = reading => reading ? `
        <span><b>${reading.temperature.toFixed(1)}</b><small>℃</small></span>
        <span><b>${reading.humidity}</b><small>%RH</small></span>` : '';
      return `
        <div class="env-mobile-record-row${entry.isRestDay ? ' env-mobile-rest-row' : ''}"
          role="row" data-env-mobile-date="${entry.date}"${entry.isRestDay ? ' data-env-mobile-rest="true"' : ''}>
          <div class="env-mobile-date" role="cell"><b>${entry.day} 日</b><span>星期${entry.weekday}</span></div>
          <div class="env-mobile-reading" role="cell">${mobileReading(values && values.morning)}</div>
          <div class="env-mobile-reading" role="cell">${mobileReading(values && values.afternoon)}</div>
        </div>`;
    }).join('');
    const recordCaption = `${monthLabel(record.month)} · ${season.legacy ? '原固定数据' : `${season.label}空调室内微调`} · 星期日休息，数据格留空`;
    return `
      <article class="env-room-record" data-env-room-table="${room.id}">
        <div class="env-record-heading">
          <div>
            <span class="env-room-dot ${room.id}"></span>
            <h3>${room.name}温湿度记录</h3>
          </div>
          <span>${esc(rangeText(settings))}</span>
        </div>
        <div class="tscroll env-table-scroll">
          <table class="env-record-table">
            <caption>${esc(recordCaption)}</caption>
            <thead>
              <tr>
                <th rowspan="2">日期</th>
                <th rowspan="2">星期</th>
                <th colspan="2">上午</th>
                <th colspan="2">下午</th>
              </tr>
              <tr>
                <th>温度（℃）</th>
                <th>湿度（%RH）</th>
                <th>温度（℃）</th>
                <th>湿度（%RH）</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="env-mobile-record-table" role="table" aria-label="${esc(`${room.name}${monthLabel(record.month)}温湿度记录`)}">
          <div class="env-mobile-record-caption">${esc(recordCaption)}</div>
          <div class="env-mobile-record-row env-mobile-record-header" role="row">
            <div role="columnheader">日期</div>
            <div role="columnheader"><b>上午</b><span>温度 / 湿度</span></div>
            <div role="columnheader"><b>下午</b><span>温度 / 湿度</span></div>
          </div>
          ${mobileRows}
        </div>
      </article>`;
  }

  function renderEmpty(){
    const season = displaySeason(null);
    return `
      <div class="env-empty">
        <div class="env-empty-icon" aria-hidden="true">温</div>
        <h3>${esc(monthLabel(state.selectedMonth))}尚未生成</h3>
        <p>确认两间房的生成范围后，点击“生成整月并固定”。系统会按${season.label}空调室内特征生成上午、下午记录，并自动保留星期日空白行。</p>
      </div>`;
  }

  function renderAlert(){
    if (storageFailed){
      return state.viewMode === 'public'
        ? '<div class="env-alert error" role="alert">浏览器未能保存当前月份选择，但公共记录仍会保持一致。</div>'
        : '<div class="env-alert error" role="alert">浏览器未能保存数据，请检查是否禁用了本地存储。当前页面刷新后可能丢失。</div>';
    }
    if (!flash) return '';
    return `<div class="env-alert ${flash.type}" role="status">${esc(flash.message)}</div>`;
  }

  function render(){
    const isPublic = state.viewMode !== 'local';
    const localRecord = localRecordForMonth();
    const record = activeRecord();
    const season = displaySeason(record);
    const workdayCount = record
      ? entriesForDisplay(record).filter(entry => !entry.isRestDay && entry.readings).length
      : 0;
    const sundayCount = record ? sundayDates(record).length : 0;
    return `
      <section class="sheet environment-sheet" data-sheet="environment" data-env-visibility="${isPublic ? 'public' : 'local'}">
        <header class="env-hero">
          <div>
            <span class="env-eyebrow">ENVIRONMENT LOG</span>
            <h2>温湿度月度记录</h2>
            <p>标本室 + 普通仪器室 · 上午 / 下午各一次 · 星期日自动留空</p>
          </div>
          <span class="env-save-chip"><span aria-hidden="true">●</span> ${isPublic ? '所有访问者都能看到' : '本机记录'}</span>
        </header>

        <div class="env-panel no-print">
          <div class="env-month-bar">
            <div class="env-month-picker">
              <button type="button" data-env-month-shift="-1" aria-label="上一个月">‹</button>
              <label>
                <span>记录月份</span>
                <input type="month" value="${esc(state.selectedMonth)}" data-env-month>
              </label>
              <button type="button" data-env-month-shift="1" aria-label="下一个月">›</button>
              <button type="button" class="env-today-button" data-env-current-month>本月</button>
            </div>
            <div class="env-month-state ${record ? 'fixed' : 'draft'}">
              ${isPublic
                ? '<b>公共数据已固定</b><span>所有手机和电脑显示一致</span>'
                : record
                  ? `<b>本机数据已固定</b><span>生成于 ${esc(formatCreatedAt(record.createdAt))}</span>`
                  : '<b>等待本机生成</b><span>生成后本月数据将锁定</span>'}
            </div>
          </div>

          <div class="env-mode-notice ${isPublic ? 'public' : 'local'}" ${isPublic ? 'data-env-public-notice' : 'data-env-local-notice'}>
            <div>
              <b>${isPublic ? '正在查看公共固定记录' : '正在查看本机自定义记录'}</b>
              <span>${isPublic
                ? '同一月份由固定规则生成唯一数据，任何访问者打开都能直接看到完全相同的记录。'
                : '本机记录只保存在当前浏览器，不会改变所有访问者都能看到的公共记录。'}</span>
            </div>
            <button type="button" class="env-secondary" ${isPublic ? 'data-env-view-local' : 'data-env-view-public'}>
              ${isPublic ? (localRecord ? '查看本机固定记录' : '本机自定义生成') : '返回公共记录'}
            </button>
          </div>

          ${renderSeasonCard(record)}

          <div class="env-config-intro">
            <div><b>${isPublic ? '公共生成范围' : '本机生成范围'}</b><span>${isPublic ? '公共记录采用统一范围' : '请按现场要求调整；下列默认值不是标准限度'}</span></div>
            ${record
              ? `<span>${isPublic ? '所有访问者使用同一组固定范围' : '本月范围已随数据锁定'}</span>`
              : '<span>湿度优先集中在 48～58 %RH，并保留自然小幅波动</span>'}
          </div>
          <div class="env-room-configs">
            ${ROOMS.map(renderRoomConfig).join('')}
          </div>

          ${renderAlert()}
          <div class="env-actions">
            ${isPublic ? `
              <button type="button" class="env-primary fixed" disabled>✓ 公共数据已固定</button>
              <button type="button" class="env-secondary" data-env-export>导出 CSV</button>
              <button type="button" class="env-secondary" data-env-print>打印两间房记录</button>
              <span>无需登录或点击生成，换设备打开仍是同一份数据。</span>` : record ? `
              <button type="button" class="env-primary fixed" disabled>✓ 本机数据已生成并固定</button>
              <button type="button" class="env-secondary" data-env-export>导出 CSV</button>
              <button type="button" class="env-secondary" data-env-print>打印两间房记录</button>
              <button type="button" class="env-danger" data-env-clear>清除本月</button>` : `
              <button type="button" class="env-primary" data-env-generate>生成整月并固定</button>
              <span>会保存到当前浏览器；刷新、关闭后再打开都不会变化。</span>`}
          </div>
        </div>

        ${record ? `
          <div class="env-fixed-summary">
            <div><span>${esc(monthLabel(record.month))}</span><b>${workdayCount} 个记录日</b></div>
            <div><span>星期日留空</span><b>${sundayCount} 行</b></div>
            <div><span>生成模型</span><b>${season.legacy ? '旧版固定数据' : `${season.label} · 空调室内`}</b></div>
            <div><span>房间</span><b>2 间 × 每天 2 次</b></div>
            <div class="env-summary-lock"><span aria-hidden="true">◆</span><b>${isPublic ? '公共固定数据' : '本机固定数据'}</b></div>
          </div>
          <div class="env-records">
            ${ROOMS.map(room => renderRoomTable(room, record)).join('')}
          </div>
          <div class="note env-disclaimer">${isPublic ? '公共记录对所有访问者可见，且同一月份的数据固定一致。' : '本机自定义记录仅在当前浏览器可见。'}生成值用于记录整理辅助，不替代现场温湿度测量。用于受控记录前，请逐项核对真实测量值和本单位规定范围。</div>` : renderEmpty()}
      </section>`;
  }

  function refresh(){
    const current = document.querySelector('[data-sheet="environment"]');
    if (!current) return;
    const wasActive = current.classList.contains('active');
    const holder = document.createElement('div');
    holder.innerHTML = render().trim();
    const next = holder.firstElementChild;
    if (wasActive) next.classList.add('active');
    current.replaceWith(next);
  }

  function chooseMonth(month){
    if (!parseMonth(month)) return;
    state.selectedMonth = month;
    flash = null;
    saveState();
    refresh();
  }

  function csvCell(value){
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv(record){
    const header = [
      '日期', '星期',
      '标本室上午温度(℃)', '标本室上午湿度(%RH)', '标本室下午温度(℃)', '标本室下午湿度(%RH)',
      '普通仪器室上午温度(℃)', '普通仪器室上午湿度(%RH)', '普通仪器室下午温度(℃)', '普通仪器室下午湿度(%RH)'
    ];
    const lines = [header];
    entriesForDisplay(record).forEach(entry => {
      const specimen = entry.readings && entry.readings.specimen;
      const instrument = entry.readings && entry.readings.instrument;
      if (!specimen || !instrument){
        lines.push([entry.date, `星期${entry.weekday}`, '', '', '', '', '', '', '', '']);
        return;
      }
      lines.push([
        entry.date, `星期${entry.weekday}`,
        specimen.morning.temperature.toFixed(1), specimen.morning.humidity,
        specimen.afternoon.temperature.toFixed(1), specimen.afternoon.humidity,
        instrument.morning.temperature.toFixed(1), instrument.morning.humidity,
        instrument.afternoon.temperature.toFixed(1), instrument.afternoon.humidity
      ]);
    });
    const csv = '\ufeff' + lines.map(line => line.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${record.month}-标本室与普通仪器室温湿度记录.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  document.addEventListener('input', event => {
    const input = event.target.closest('[data-env-room][data-env-field]');
    if (!input || state.viewMode !== 'local' || localRecordForMonth()) return;
    const room = ROOMS.find(item => item.id === input.dataset.envRoom);
    const field = input.dataset.envField;
    if (!room || !(field in room.defaults)) return;
    state.draft[room.id][field] = input.value;
    flash = null;
    saveState();
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-env-month]')) chooseMonth(event.target.value);
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-env-view-local]')){
      state.viewMode = 'local';
      flash = null;
      saveState();
      refresh();
      return;
    }
    if (event.target.closest('[data-env-view-public]')){
      state.viewMode = 'public';
      flash = null;
      saveState();
      refresh();
      return;
    }
    const shift = event.target.closest('[data-env-month-shift]');
    if (shift){
      chooseMonth(shiftMonth(state.selectedMonth, Number(shift.dataset.envMonthShift)));
      return;
    }
    if (event.target.closest('[data-env-current-month]')){
      chooseMonth(currentMonth());
      return;
    }
    if (event.target.closest('[data-env-generate]')){
      if (state.viewMode !== 'local' || localRecordForMonth()) return;
      const errors = validateDraft();
      if (errors.length){
        flash = { type: 'error', message: errors[0] };
        refresh();
        return;
      }
      const settings = numericSettings(state.draft);
      state.months[state.selectedMonth] = generateMonth(state.selectedMonth, settings);
      const season = state.months[state.selectedMonth].season;
      flash = { type: 'success', message: `${monthLabel(state.selectedMonth)}已按${season.label}空调室内模型生成并固定保存。` };
      saveState();
      refresh();
      return;
    }
    if (event.target.closest('[data-env-clear]')){
      if (state.viewMode !== 'local' || !localRecordForMonth()) return;
      const label = monthLabel(state.selectedMonth);
      if (!window.confirm(`确定清除 ${label} 的固定温湿度数据吗？\n清除后可以重新设置范围并生成，原数据无法恢复。`)) return;
      delete state.months[state.selectedMonth];
      flash = { type: 'success', message: `${label}的数据已清除，现在可以重新生成。` };
      saveState();
      refresh();
      return;
    }
    if (event.target.closest('[data-env-export]')){
      const record = activeRecord();
      if (record) exportCsv(record);
      return;
    }
    if (event.target.closest('[data-env-print]')) window.print();
  });

  window.EnvironmentRecorder = {
    id: 'environment',
    tab: '温湿度记录',
    render,
    getState: () => JSON.parse(JSON.stringify(state)),
    getActiveRecord: () => JSON.parse(JSON.stringify(activeRecord())),
    getPublicRecord: month => JSON.parse(JSON.stringify(publicRecordForMonth(month))),
    storageKey: STORAGE_KEY
  };
})();
