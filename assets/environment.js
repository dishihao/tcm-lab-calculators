/* =========================================================================
   温湿度月度记录生成器
   - 标本室、普通仪器室一次生成
   - 自动跳过星期日
   - 每个月生成后写入 localStorage 并锁定
   ========================================================================= */
'use strict';

(function initEnvironmentRecorder(){
  const STORAGE_KEY = 'tcm-lab-environment-v1';
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const ROOMS = [
    {
      id: 'specimen',
      name: '标本室',
      short: '标本室',
      defaults: { temperatureMin: 18, temperatureMax: 26, humidityMin: 45, humidityMax: 65 }
    },
    {
      id: 'instrument',
      name: '普通仪器室',
      short: '仪器室',
      defaults: { temperatureMin: 18, temperatureMax: 28, humidityMin: 40, humidityMax: 65 }
    }
  ];

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
      selectedMonth: currentMonth(),
      draft: defaultDraft(),
      months: {}
    };
  }

  function normalizeState(value){
    const next = emptyState();
    if (!value || typeof value !== 'object') return next;
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

  function bellRandom(){
    let sum = 0;
    for (let i = 0; i < 6; i += 1) sum += randomUnit();
    return sum - 3;
  }

  function clamp(value, min, max){
    return Math.min(max, Math.max(min, value));
  }

  function roundedWithin(value, min, max, digits){
    const factor = Math.pow(10, digits);
    return clamp(Math.round(value * factor) / factor, min, max);
  }

  function roomReadings(settings, memory, shared){
    const tempSpan = settings.temperatureMax - settings.temperatureMin;
    const humiditySpan = settings.humidityMax - settings.humidityMin;
    const tempMiddle = (settings.temperatureMin + settings.temperatureMax) / 2;
    const humidityMiddle = (settings.humidityMin + settings.humidityMax) / 2;

    const tempTarget = tempMiddle + shared.temperature * tempSpan * 0.07 + bellRandom() * tempSpan * 0.035;
    const tempBase = Number.isFinite(memory.temperature)
      ? memory.temperature * 0.68 + tempTarget * 0.32
      : tempTarget;
    const morningTemperature = roundedWithin(
      tempBase - Math.min(0.35, tempSpan * 0.04) + bellRandom() * tempSpan * 0.025,
      settings.temperatureMin,
      settings.temperatureMax,
      1
    );
    const afternoonTemperature = roundedWithin(
      tempBase + Math.min(0.45, tempSpan * 0.05) + bellRandom() * tempSpan * 0.025,
      settings.temperatureMin,
      settings.temperatureMax,
      1
    );
    memory.temperature = (morningTemperature + afternoonTemperature) / 2;

    const temperatureEffect = (memory.temperature - tempMiddle) * 0.9;
    const humidityTarget = humidityMiddle + shared.humidity * humiditySpan * 0.08 -
      temperatureEffect + bellRandom() * humiditySpan * 0.045;
    const humidityBase = Number.isFinite(memory.humidity)
      ? memory.humidity * 0.64 + humidityTarget * 0.36
      : humidityTarget;
    const morningHumidity = roundedWithin(
      humidityBase + Math.min(1.5, humiditySpan * 0.07) + bellRandom() * humiditySpan * 0.035,
      settings.humidityMin,
      settings.humidityMax,
      0
    );
    const afternoonHumidity = roundedWithin(
      humidityBase - Math.min(1.2, humiditySpan * 0.06) + bellRandom() * humiditySpan * 0.035,
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

  function generateMonth(month, settings){
    const parsed = parseMonth(month);
    if (!parsed) throw new Error('月份格式不正确');
    const days = new Date(parsed.year, parsed.month, 0).getDate();
    const entries = [];
    const skippedSundays = [];
    const memory = Object.fromEntries(ROOMS.map(room => [room.id, { temperature: NaN, humidity: NaN }]));

    for (let day = 1; day <= days; day += 1){
      const date = new Date(parsed.year, parsed.month - 1, day);
      const isoDate = `${parsed.year}-${pad(parsed.month)}-${pad(day)}`;
      if (date.getDay() === 0){
        skippedSundays.push(isoDate);
        continue;
      }
      const shared = { temperature: bellRandom(), humidity: bellRandom() };
      const readings = {};
      ROOMS.forEach(room => {
        readings[room.id] = roomReadings(settings[room.id], memory[room.id], shared);
      });
      entries.push({
        date: isoDate,
        day,
        weekday: WEEKDAYS[date.getDay()],
        readings
      });
    }

    return {
      version: 1,
      month,
      createdAt: new Date().toISOString(),
      settings,
      entries,
      skippedSundays
    };
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
    const record = state.months[state.selectedMonth];
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
    const record = state.months[state.selectedMonth];
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

  function renderRoomTable(room, record){
    const settings = record.settings[room.id];
    const rows = record.entries.map(entry => {
      const values = entry.readings[room.id];
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
            <caption>${esc(monthLabel(record.month))} · 星期日休息，不记录</caption>
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
      </article>`;
  }

  function renderEmpty(){
    return `
      <div class="env-empty">
        <div class="env-empty-icon" aria-hidden="true">温</div>
        <h3>${esc(monthLabel(state.selectedMonth))}尚未生成</h3>
        <p>确认两间房的生成范围后，点击“生成整月并固定”。系统会同时生成上午、下午记录，并自动跳过全部星期日。</p>
      </div>`;
  }

  function renderAlert(){
    if (storageFailed){
      return '<div class="env-alert error" role="alert">浏览器未能保存数据，请检查是否禁用了本地存储。当前页面刷新后可能丢失。</div>';
    }
    if (!flash) return '';
    return `<div class="env-alert ${flash.type}" role="status">${esc(flash.message)}</div>`;
  }

  function render(){
    const record = state.months[state.selectedMonth];
    const workdayCount = record ? record.entries.length : 0;
    const sundayCount = record ? record.skippedSundays.length : 0;
    return `
      <section class="sheet environment-sheet" data-sheet="environment">
        <header class="env-hero">
          <div>
            <span class="env-eyebrow">ENVIRONMENT LOG</span>
            <h2>温湿度月度记录</h2>
            <p>标本室 + 普通仪器室 · 上午 / 下午各一次 · 星期日自动跳过</p>
          </div>
          <span class="env-save-chip"><span aria-hidden="true">●</span> 刷新不丢失</span>
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
              ${record
                ? `<b>数据已固定</b><span>生成于 ${esc(formatCreatedAt(record.createdAt))}</span>`
                : '<b>等待生成</b><span>生成后本月数据将锁定</span>'}
            </div>
          </div>

          <div class="env-config-intro">
            <div><b>生成范围</b><span>请按现场要求调整；下列默认值不是标准限度</span></div>
            ${record ? '<span>本月范围已随数据锁定</span>' : '<span>每天自动生成自然小幅波动</span>'}
          </div>
          <div class="env-room-configs">
            ${ROOMS.map(renderRoomConfig).join('')}
          </div>

          ${renderAlert()}
          <div class="env-actions">
            ${record ? `
              <button type="button" class="env-primary fixed" disabled>✓ 已生成并固定</button>
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
            <div><span>已跳过</span><b>${sundayCount} 个星期日</b></div>
            <div><span>房间</span><b>2 间 × 每天 2 次</b></div>
            <div class="env-summary-lock"><span aria-hidden="true">◆</span><b>只读固定数据</b></div>
          </div>
          <div class="env-records">
            ${ROOMS.map(room => renderRoomTable(room, record)).join('')}
          </div>
          <div class="note env-disclaimer">生成值用于记录整理辅助，不替代现场温湿度测量。用于受控记录前，请逐项核对真实测量值和本单位规定范围。</div>` : renderEmpty()}
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
    record.entries.forEach(entry => {
      const specimen = entry.readings.specimen;
      const instrument = entry.readings.instrument;
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
    if (!input || state.months[state.selectedMonth]) return;
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
      if (state.months[state.selectedMonth]) return;
      const errors = validateDraft();
      if (errors.length){
        flash = { type: 'error', message: errors[0] };
        refresh();
        return;
      }
      const settings = numericSettings(state.draft);
      state.months[state.selectedMonth] = generateMonth(state.selectedMonth, settings);
      flash = { type: 'success', message: `${monthLabel(state.selectedMonth)}已生成并固定保存。` };
      saveState();
      refresh();
      return;
    }
    if (event.target.closest('[data-env-clear]')){
      const label = monthLabel(state.selectedMonth);
      if (!window.confirm(`确定清除 ${label} 的固定温湿度数据吗？\n清除后可以重新设置范围并生成，原数据无法恢复。`)) return;
      delete state.months[state.selectedMonth];
      flash = { type: 'success', message: `${label}的数据已清除，现在可以重新生成。` };
      saveState();
      refresh();
      return;
    }
    if (event.target.closest('[data-env-export]')){
      const record = state.months[state.selectedMonth];
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
    storageKey: STORAGE_KEY
  };
})();
