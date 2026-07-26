/* =========================================================================
   中药饮片化验室检验计算器
   公式依据：《中国药典》2020 年版四部
     通则 2301 杂质 / 0832 第二法 水分 / 2302 总灰分 / 2201 浸出物 / 0512 HPLC
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------------- 工具 */

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/** 解析数字，空/非法返回 NaN */
function num(v){
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === '') return NaN;
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

/** 四舍六入五成双（药典修约规则）；useHE=false 时用常规四舍五入 */
function roundTo(v, dp, useHE){
  if (!isFinite(v)) return NaN;
  const f = Math.pow(10, dp);
  // 先用 toPrecision 消除浮点误差（如 13.585*100 = 1358.4999999998）
  const x = parseFloat((v * f).toPrecision(12));
  const neg = x < 0;
  const a = Math.abs(x);
  const fl = Math.floor(a);
  const diff = a - fl;
  let r;
  if (Math.abs(diff - 0.5) < 1e-9){
    r = useHE ? ((fl % 2 === 0) ? fl : fl + 1) : fl + 1;
  } else {
    r = Math.round(a);
  }
  return (neg ? -r : r) / f;
}

/** 格式化为固定小数位字符串 */
function fmt(v, dp, useHE){
  if (!isFinite(v)) return '';
  return roundTo(v, dp, useHE).toFixed(dp);
}

/** 样本标准差（n-1） */
function sd(arr){
  const a = arr.filter(isFinite);
  if (a.length < 2) return NaN;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
  return Math.sqrt(v);
}

function mean(arr){
  const a = arr.filter(isFinite);
  if (!a.length) return NaN;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

/**
 * 峰面积均值的显示精度。
 * 液相峰面积动辄十万量级，1 位小数足够；气相 FID 峰面积只有几百，
 * 固定 1 位会把有效数字抹掉（787.944 → 787.9），故小值保留 3 位再去尾零。
 */
function fmtArea(v){
  if (!isFinite(v)) return '';
  if (Math.abs(v) >= 10000) return v.toFixed(1);
  return v.toFixed(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** 相对偏差 = |X1-X2| / (X1+X2) × 100%  （中药检验惯用式） */
function relDev(x1, x2){
  if (!isFinite(x1) || !isFinite(x2)) return NaN;
  const s = x1 + x2;
  if (s === 0) return NaN;
  return Math.abs(x1 - x2) / s * 100;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const frac = (n, d) => `<span class="frac"><span class="num">${n}</span><span class="den">${d}</span></span>`;

/**
 * 由两份平行样的单值汇总出平均值与相对偏差。
 * 关键：先把单值按报告修约位数修约，再求平均与偏差 —— 这与化验员在纸质
 * 记录上的算法一致（表上填的是修约后的 X₁、X₂，平均与偏差由它们得出），
 * 否则会出现"表上写 0、程序算 0.5"这类对不上的情况。
 */
function summarize(xRaw, indDp, he){
  const x = xRaw.map(v => isFinite(v) ? roundTo(v, indDp, he) : NaN);
  return { x, mean: mean(x), rd: relDev(x[0], x[1]) };
}

/* ---------------------------------------------------------------- 色谱方法 */

/** 含量测定的色谱方法：公式一致，差别在通则号与理论板数限度 */
const TECH = {
  hplc: { label:'高效液相色谱法', gz:'0512', plates:'3000' },
  gc:   { label:'气相色谱法',     gz:'0521', plates:'10000' }
};

/* ---------------------------------------------------------------- 品种预设 */

const PRODUCTS = {
  baixianpi: {
    name: '白鲜皮',
    spec: '切制',
    grade: '精选',
    origin: '黑龙江黑河',
    basis: '《中国药典》2020年版一部及四部、《国家中药饮片炮制规范》、药品检验补充检验方法和检验项目批准件2010002',
    docBase: 'TS-45-XXXXX-a',
    limits: {
      impurity: { op: '≤', val: 3,    text: '不得过 3%'    },
      moisture: { op: '≤', val: 14.0, text: '不得过 14.0%' },
      ash:      null,
      extract:  { op: '≥', val: 20.0, text: '不得少于 20.0%' }
    },
    hplc: { column:'C18', colTemp:'30', wavelength:'236', mobile:'甲醇-水（60:40）', flow:'1.0' },
    analytes: [
      { key:'cenketone',  name:'梣酮',   formulaText:'C₁₄H₁₆O₃',  op:'≥', val:0.050, indDp:4, meanDp:3, tech:'hplc', plates:'3000' },
      { key:'obakunone',  name:'黄柏酮', formulaText:'C₂₆H₃₄O₇', op:'≥', val:0.15,  indDp:3, meanDp:2, tech:'hplc', plates:'3000' }
    ]
  },
  jiaozhizi: {
    name: '焦栀子',
    spec: '清炒',
    grade: '选',
    origin: '江西吉安',
    basis: '《中国药典》2020年版一部及四部',
    docBase: 'TS-45-XXXXX-a',
    limits: {
      impurity: { op:'≤', val:3.0, text:'不得过 3.0%' },
      moisture: { op:'≤', val:8.5, text:'不得过 8.5%' },
      ash:      { op:'≤', val:6.0, text:'不得过 6.0%' },
      extract:  null
    },
    hplc: { column:'C18', colTemp:'30', wavelength:'238', mobile:'乙腈-水（15:85）', flow:'1.0' },
    analytes: [
      { key:'gardenoside', name:'栀子苷', formulaText:'C₁₇H₂₄O₁₀', op:'≥', val:1.0, indDp:2, meanDp:1, tech:'hplc', plates:'2000' }
    ]
  },
  /* 薄荷：含量测定为气相色谱法（通则 0521），薄荷脑外标法 */
  mint: {
    name: '薄荷',
    spec: '切制',
    grade: '',
    origin: '',
    basis: '《中国药典》2025年版一部及四部',
    docBase: 'TS-45-XXXXX-a',
    limits: { impurity:null, moisture:null, ash:null, extract:null },
    hplc: { column:'聚乙二醇毛细管柱 30m×0.32mm×0.25μm', colTemp:'程序升温', wavelength:'', mobile:'', flow:'' },
    analytes: [
      { key:'menthol', name:'薄荷脑', formulaText:'C₁₀H₂₀O', op:'≥', val:0.13, indDp:3, meanDp:2, tech:'gc', plates:'10000' }
    ]
  },
  custom: {
    name: '', spec:'', grade:'', origin:'', basis:'《中国药典》2020年版一部及四部',
    docBase: 'TS-45-XXXXX-a',
    limits: { impurity:null, moisture:null, ash:null, extract:null },
    hplc: { column:'C18', colTemp:'30', wavelength:'', mobile:'', flow:'1.0' },
    analytes: [ { key:'a1', name:'待测成分', formulaText:'', op:'≥', val:NaN, indDp:3, meanDp:2, tech:'hplc' } ]
  }
};

/* ---------------------------------------------------------------- 计算器定义 */

const CALCS = [
  /* ---------------- 1. 杂质 ---------------- */
  {
    id: 'impurity',
    tab: '杂质',
    section: '【检查】杂质',
    method: '照杂质测定法（通则 2301）测定。',
    dp: { ind:1, mean:1 },
    rows: [
      { t:'in',      k:'M',    lab:'样品重量 M<sub>总</sub>（g）' },
      { t:'in',      k:'M1',   lab:'杂质重量 M<sub>1</sub>（g）' },
      { t:'out',     k:'X',    lab:'杂质含量 X（%）' },
      { t:'spanOut', k:'RD',   lab:'相对偏差(%)' },
      { t:'spanOut', k:'MEAN', lab:'杂质平均含量 <span style="text-decoration:overline">X</span>（%）' }
    ],
    formula: () => `X = ${frac('M<sub>1</sub>', 'M<sub>总</sub>')} × 100%`,
    compute(g){
      const x = [1,2].map(i => {
        const M = g('M', i), M1 = g('M1', i);
        return (isFinite(M) && isFinite(M1) && M !== 0) ? M1 / M * 100 : NaN;
      });
      return { x };   // 汇总（修约→平均→偏差）统一交给 summarize()
    },
    subst(g, dp, he){
      return [1,2].map(i => {
        const M = g('M', i), M1 = g('M1', i);
        if (!isFinite(M) || !isFinite(M1) || M === 0) return '';
        return `X<sub>${i}</sub> = ${frac(M1, M)} × 100% = <span class="sx">${fmt(M1/M*100, dp, he)}%</span>`;
      });
    }
  },

  /* ---------------- 2. 水分 ---------------- */
  {
    id: 'moisture',
    tab: '水分',
    section: '【检查】水分',
    method: '照水分测定法（通则 0832 第二法）测定。',
    dp: { ind:2, mean:1 },
    rows: [
      { t:'in', k:'W0a', lab:'瓶重 W<sub>0</sub>(g)', params:[
          {k:'t1', d:'105', u:'℃', w:'w40'}, {k:'h1', d:'5', u:'小时', w:'w40'} ] },
      { t:'in', k:'W0b', lab:'瓶重 W<sub>0</sub>(g)', hz:'W0a', params:[
          {k:'t2', d:'105', u:'℃', w:'w40'}, {k:'h2', d:'1', u:'小时', w:'w40'} ] },
      { t:'in', k:'Ws',  lab:'称样量 W<sub>样</sub>（g）' },
      { t:'in', k:'W1a', lab:'瓶+样 W<sub>1</sub>(g)', params:[
          {k:'t3', d:'105', u:'℃', w:'w40'}, {k:'h3', d:'5', u:'小时', w:'w40'} ] },
      { t:'in', k:'W1b', lab:'瓶+样 W<sub>1</sub>(g)', hz:'W1a', params:[
          {k:'t4', d:'105', u:'℃', w:'w40'}, {k:'h4', d:'1', u:'小时', w:'w40'} ] },
      { t:'out',     k:'X',    lab:'水分 X（%）' },
      { t:'spanOut', k:'RD',   lab:'相对偏差(%)' },
      { t:'spanOut', k:'MEAN', lab:'平均值 <span style="text-decoration:overline">X</span>（%）' }
    ],
    formula: () => `X = ${frac('W<sub>0</sub> + W<sub>样</sub> − W<sub>1</sub>', 'W<sub>样</sub>')} × 100%`,
    compute(g){
      const x = [1,2].map(i => {
        const W0 = g('W0b', i), Ws = g('Ws', i), W1 = g('W1b', i);
        return (isFinite(W0) && isFinite(Ws) && isFinite(W1) && Ws !== 0)
          ? (W0 + Ws - W1) / Ws * 100 : NaN;
      });
      return { x };   // 汇总（修约→平均→偏差）统一交给 summarize()
    },
    subst(g, dp, he){
      return [1,2].map(i => {
        const W0 = g('W0b', i), Ws = g('Ws', i), W1 = g('W1b', i);
        if (!isFinite(W0) || !isFinite(Ws) || !isFinite(W1) || Ws === 0) return '';
        return `X<sub>${i}</sub> = ${frac(`${W0} + ${Ws} − ${W1}`, Ws)} × 100% = `
             + `<span class="sx">${fmt((W0+Ws-W1)/Ws*100, dp, he)}%</span>`;
      });
    },
    note: '计算取“恒重”后（第二次干燥，即 1 小时行）的称量值。药典规定连续两次干燥后称重差异应在 0.3&nbsp;mg 以下，本表在对应行自动提示恒重差值。'
  },

  /* ---------------- 3. 总灰分 ---------------- */
  {
    id: 'ash',
    tab: '总灰分',
    section: '【检查】总灰分',
    method: '照总灰分测定法（通则 2302）测定。',
    dp: { ind:2, mean:1 },
    rows: [
      { t:'in', k:'W0a', lab:'坩埚重 W<sub>0</sub>(g)', params:[
          {k:'t1', d:'500', u:'℃', w:'w40'}, {k:'h1', d:'3', u:'小时', w:'w40'} ] },
      { t:'in', k:'W0b', lab:'坩埚重 W<sub>0</sub>(g)', hz:'W0a', params:[
          {k:'t2', d:'500', u:'℃', w:'w40'}, {k:'h2', d:'1', u:'小时', w:'w40'} ] },
      { t:'in', k:'Ws',  lab:'称样量 W<sub>样</sub>（g）' },
      { t:'in', k:'W1a', lab:'坩埚+残渣重 W<sub>1</sub>(g)', params:[
          {k:'t3', d:'500', u:'℃', w:'w40'}, {k:'h3', d:'2', u:'小时', w:'w40'} ] },
      { t:'in', k:'W1b', lab:'坩埚+残渣重 W<sub>1</sub>(g)', hz:'W1a', params:[
          {k:'t4', d:'500', u:'℃', w:'w40'}, {k:'h4', d:'1', u:'小时', w:'w40'} ] },
      { t:'out',     k:'X',    lab:'总灰分 X（%）' },
      { t:'spanOut', k:'RD',   lab:'相对偏差(%)' },
      { t:'spanOut', k:'MEAN', lab:'平均值 <span style="text-decoration:overline">X</span>（%）' }
    ],
    formula: () => `X = ${frac('W<sub>1</sub> − W<sub>0</sub>', 'W<sub>样</sub>')} × 100%`,
    compute(g){
      const x = [1,2].map(i => {
        const W0 = g('W0b', i), Ws = g('Ws', i), W1 = g('W1b', i);
        return (isFinite(W0) && isFinite(Ws) && isFinite(W1) && Ws !== 0)
          ? (W1 - W0) / Ws * 100 : NaN;
      });
      return { x };   // 汇总（修约→平均→偏差）统一交给 summarize()
    },
    subst(g, dp, he){
      return [1,2].map(i => {
        const W0 = g('W0b', i), Ws = g('Ws', i), W1 = g('W1b', i);
        if (!isFinite(W0) || !isFinite(Ws) || !isFinite(W1) || Ws === 0) return '';
        return `X<sub>${i}</sub> = ${frac(`${W1} − ${W0}`, Ws)} × 100% = `
             + `<span class="sx">${fmt((W1-W0)/Ws*100, dp, he)}%</span>`;
      });
    },
    note: '灼烧温度默认填 500℃，请按实际炉温修改。计算同样取恒重后（1 小时行）的称量值。'
  },

  /* ---------------- 4. 浸出物 ---------------- */
  {
    id: 'extract',
    tab: '浸出物',
    section: '【浸出物】',
    method: '照水溶性浸出物测定法（通则 2201）项下的冷浸法测定。',
    dp: { ind:2, mean:1 },
    rows: [
      { t:'spanIn', k:'Q',   lab:'水分（由水分项目得）（%）' },
      { t:'in', k:'W0a', lab:'蒸发皿 W<sub>0</sub>(g)', params:[
          {k:'t1', d:'105', u:'℃', w:'w40'}, {k:'h1', d:'5', u:'小时', w:'w40'} ] },
      { t:'in', k:'W0b', lab:'蒸发皿 W<sub>0</sub>(g)', hz:'W0a', params:[
          {k:'t2', d:'105', u:'℃', w:'w40'}, {k:'h2', d:'1', u:'小时', w:'w40'} ] },
      { t:'in', k:'Ws',  lab:'称样量 W<sub>样</sub>（g）' },
      { t:'in', k:'V',   lab:'溶剂体积 V（ml）' },
      { t:'in', k:'Vs',  lab:'取滤液体积 V<sub>样</sub>（ml）' },
      { t:'in', k:'W1',  lab:'蒸发皿+残渣 W<sub>1</sub>(g)', params:[
          {k:'t3', d:'105', u:'℃', w:'w40'}, {k:'h3', d:'2', u:'小时', w:'w40'} ] },
      { t:'out',     k:'X',    lab:'浸出物 X（%）' },
      { t:'spanOut', k:'RD',   lab:'相对偏差(%)' },
      { t:'spanOut', k:'MEAN', lab:'平均值 <span style="text-decoration:overline">X</span>（%）' }
    ],
    formula: () => `X = ${frac('(W<sub>1</sub> − W<sub>0</sub>) × V', 'W<sub>样</sub> × (1 − 水分) × V<sub>样</sub>')} × 100%`,
    compute(g, gs){
      const Q = gs('Q');
      const x = [1,2].map(i => {
        const W0 = g('W0b', i), Ws = g('Ws', i), W1 = g('W1', i), V = g('V', i), Vs = g('Vs', i);
        if (![W0, Ws, W1, V, Vs, Q].every(isFinite)) return NaN;
        const den = Ws * (1 - Q/100) * Vs;
        return den === 0 ? NaN : (W1 - W0) * V / den * 100;
      });
      return { x };   // 汇总（修约→平均→偏差）统一交给 summarize()
    },
    subst(g, dp, he, gs){
      const Q = gs('Q');
      return [1,2].map(i => {
        const W0 = g('W0b', i), Ws = g('Ws', i), W1 = g('W1', i), V = g('V', i), Vs = g('Vs', i);
        if (![W0, Ws, W1, V, Vs, Q].every(isFinite)) return '';
        const den = Ws * (1 - Q/100) * Vs;
        if (den === 0) return '';
        return `X<sub>${i}</sub> = ${frac(`(${W1} − ${W0}) × ${V}`, `${Ws} × (1 − ${Q}%) × ${Vs}`)} × 100% = `
             + `<span class="sx">${fmt((W1-W0)*V/den*100, dp, he)}%</span>`;
      });
    },
    note: '“水分”按百分数填写（例：13.6 表示 13.6%），公式内部自动换算为小数参与 (1 − 水分) 的计算。'
  }
];

/* ---------------- 5. 含量测定（HPLC 外标法）单独渲染 ---------------- */
const ASSAY = {
  id: 'assay',
  tab: '含量测定',
  section: '【含量测定】',
  method: '照高效液相色谱法（通则 0512）测定。',
  refShots: 5,   // 对照品连续进样针数
  smpShots: 2,   // 每份供试品进样针数
  formula: () => `X = ${frac(
      '<span style="text-decoration:overline">A</span> × C<sub>对</sub> × f<sub>样</sub>',
      '<span style="text-decoration:overline">A</span><sub>对</sub> × W<sub>样</sub> × (1 − Q) × 1000')} × 100%`
};

/* ---------------------------------------------------------------- 状态 */

const LS_KEY = 'tcm-lab-calc-v1';
let store = {};
let curProduct = 'baixianpi';
let curTab = 'header';
let curAnalyte = 0;

function load(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (raw){
      const o = JSON.parse(raw);
      store = o.store || {};
      curProduct = o.product || 'baixianpi';
    }
  }catch(e){ /* 忽略损坏的本地数据 */ }
}
function save(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({ product: curProduct, store }));
  }catch(e){ /* 隐私模式下 localStorage 可能不可用 */ }
}

const get  = k => (store[k] === undefined ? '' : store[k]);
const getN = k => num(store[k]);
const set  = (k, v) => { store[k] = v; };

function useHE(){ const el = $('#roundHalfEven'); return el ? el.checked : true; }

/* ---------------------------------------------------------------- 渲染片段 */

function inputCell(name, ph){
  return `<input class="cell" type="text" inputmode="decimal" autocomplete="off"
            data-k="${esc(name)}" value="${esc(get(name))}" placeholder="${ph ? esc(ph) : ''}">`;
}
function inlineInput(name, def, cls){
  const v = store[name] !== undefined ? store[name] : (def || '');
  return `<input class="inline ${cls || ''}" type="text" autocomplete="off"
            data-k="${esc(name)}" value="${esc(v)}">`;
}
function outCell(id){
  return `<div class="out empty" id="${esc(id)}">—</div>`;
}

/** 结果与计算表 */
function renderTable(c){
  const rows = c.rows.map(r => {
    let lab = r.lab;
    if (r.params){
      lab += '（' + r.params.map(pm =>
        inlineInput(c.id + '.' + pm.k, pm.d, pm.w) + pm.u
      ).join('；') + '）';
    }
    if (r.t === 'in'){
      return `<tr><th class="rowlab">${lab}</th>
        <td>${inputCell(c.id + '.' + r.k + '.1')}${r.hz ? `<span class="hz" id="${c.id}.hz.${r.k}.1"></span>` : ''}</td>
        <td>${inputCell(c.id + '.' + r.k + '.2')}${r.hz ? `<span class="hz" id="${c.id}.hz.${r.k}.2"></span>` : ''}</td></tr>`;
    }
    if (r.t === 'out'){
      return `<tr><th class="rowlab">${lab}</th>
        <td>${outCell(c.id + '.out.' + r.k + '.1')}</td>
        <td>${outCell(c.id + '.out.' + r.k + '.2')}</td></tr>`;
    }
    if (r.t === 'spanIn'){
      return `<tr><th class="rowlab">${lab}</th>
        <td class="spanall" colspan="2">${inputCell(c.id + '.' + r.k)}</td></tr>`;
    }
    // spanOut
    return `<tr><th class="rowlab">${lab}</th>
      <td class="spanall" colspan="2">${outCell(c.id + '.out.' + r.k)}</td></tr>`;
  }).join('');

  return `<div class="tscroll"><table class="form">
    <tr><th class="rowlab" style="width:38%">样品编号</th><th style="width:31%">1</th><th style="width:31%">2</th></tr>
    ${rows}
  </table></div>`;
}

/** 修约位数选择器 */
function renderDp(c){
  const sel = (k, def) => {
    const v = store[c.id + '.dp.' + k] !== undefined ? store[c.id + '.dp.' + k] : def;
    let o = '';
    for (let i = 0; i <= 4; i++) o += `<option value="${i}"${String(v) === String(i) ? ' selected' : ''}>${i}</option>`;
    return `<select class="dpsel" data-k="${c.id}.dp.${k}">${o}</select>`;
  };
  return `<div class="analyte-bar">
    <span>修约位数：单值 ${sel('ind', c.dp.ind)} 位小数，平均值 ${sel('mean', c.dp.mean)} 位小数</span>
  </div>`;
}

/** 标准规定 + 符合性判定 */
function renderVerdict(c){
  return `
  <div class="verdict">
    <div class="sec-num">标准规定：
      <span class="limit-edit">
        <select data-k="${c.id}.limop" class="dpsel">
          <option value="le">不得过</option>
          <option value="ge">不得少于</option>
        </select>
        ${inlineInput(c.id + '.limval', '', 'w120')} %
      </span>
      <span class="judge none" id="${c.id}.judge">待计算</span>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- 渲染整页 */

function renderSheet(c){
  return `
  <section class="sheet" data-sheet="${c.id}">
    <h2 class="sec">${c.section}</h2>
    <div class="method">${c.method}</div>
    ${renderTable(c)}
    ${renderDp(c)}
    <div class="formula-wrap">
      <div class="formula">${c.formula()}</div>
      <div class="subst" id="${c.id}.subst"></div>
    </div>
    ${renderVerdict(c)}
    ${c.note ? `<div class="note">${c.note}</div>` : ''}
  </section>`;
}

/** 含量测定页 */
function renderAssaySheet(p){
  const a = p.analytes[curAnalyte] || p.analytes[0];
  const pre = `assay.${a.key}.`;
  const bar = p.analytes.map((x, i) =>
    `<button data-analyte="${i}" class="${i === curAnalyte ? 'on' : ''}">${esc(x.name || ('成分' + (i+1)))}</button>`
  ).join('');

  const refPeaks = Array.from({length: ASSAY.refShots}, (_, i) =>
    `<input type="text" inputmode="decimal" autocomplete="off" data-k="${pre}refA.${i}"
       value="${esc(get(pre + 'refA.' + i))}" placeholder="第${i+1}针">`).join('');

  const smpPeaks = s => Array.from({length: ASSAY.smpShots}, (_, i) =>
    `<input type="text" inputmode="decimal" autocomplete="off" data-k="${pre}smpA.${s}.${i}"
       value="${esc(get(`${pre}smpA.${s}.${i}`))}" placeholder="第${i+1}针">`).join('');

  const ii = (k, def, cls) => inlineInput(pre + k, def, cls);
  const ic = k => `<input class="cell" type="text" inputmode="decimal" autocomplete="off"
                      data-k="${esc(pre + k)}" value="${esc(get(pre + k))}">`;

  const dpSel = (k, def) => {
    const v = store[pre + 'dp.' + k] !== undefined ? store[pre + 'dp.' + k] : def;
    let o = '';
    for (let i = 0; i <= 5; i++) o += `<option value="${i}"${String(v) === String(i) ? ' selected' : ''}>${i}</option>`;
    return `<select class="dpsel" data-k="${pre}dp.${k}">${o}</select>`;
  };

  const tech = get(pre + 'tech') || a.tech || 'hplc';
  const T = TECH[tech] || TECH.hplc;
  // analyte 自带的板数限度只在其本身的方法下成立；换了方法就回落到该方法的通用限度
  const platesDef = (tech === (a.tech || 'hplc')) ? (a.plates || T.plates) : T.plates;
  const techSel = `<select class="dpsel" data-k="${pre}tech">` +
    Object.keys(TECH).map(k =>
      `<option value="${k}"${k === tech ? ' selected' : ''}>${TECH[k].label}（通则 ${TECH[k].gz}）</option>`
    ).join('') + `</select>`;

  return `
  <section class="sheet" data-sheet="assay">
    <h2 class="sec">【含量测定】</h2>
    <div class="method">照${T.label}（通则 ${T.gz}）测定，外标法。</div>

    <div class="analyte-bar no-print">
      <span>待测成分：</span>${bar}
      <span style="margin-left:12px">方法：</span>${techSel}
    </div>

    <div class="subhead">对照品：${esc(a.name)}</div>
    <div class="tscroll"><table class="form">
      <tr><th class="rowlab" style="width:38%">对照品浓度 C<sub>对</sub>（mg/ml）</th>
          <td colspan="2">${ic('Cref')}</td></tr>
      <tr><th class="rowlab">纯度 S（%）</th><td colspan="2">${ic('refPurity')}</td></tr>
      <tr><th class="rowlab">对照品峰面积 A<sub>对</sub></th><td colspan="2"><div class="peaks">${refPeaks}</div></td></tr>
      <tr><th class="rowlab">对照品平均峰面积 <span style="text-decoration:overline">A</span><sub>对</sub></th>
          <td colspan="2">${outCell('assay.out.Aref')}</td></tr>
      <tr><th class="rowlab">RSD（%）<span class="lim">应不大于 ${ii('rsdLim', '2.0', 'w40')}%</span></th>
          <td colspan="2">${outCell('assay.out.RSD')}
              <span class="judge none" id="assay.rsdJudge">—</span></td></tr>
      <tr><th class="rowlab">理论板数<span class="lim">应不低于 ${ii('platesLim', platesDef, 'w120')}</span></th>
          <td colspan="2">${ic('plates')}
              <span class="judge none" id="assay.platesJudge">—</span></td></tr>
    </table></div>

    <div class="subhead">供试品测量</div>
    <div class="tscroll"><table class="form">
      <tr><th class="rowlab" style="width:38%">样品编号</th><th style="width:31%">1</th><th style="width:31%">2</th></tr>
      <tr><th class="rowlab">水分 Q（%）</th><td class="spanall" colspan="2">${ic('Q')}</td></tr>
      <tr><th class="rowlab">取样量 W<sub>样</sub>（g）</th><td>${ic('Ws.1')}</td><td>${ic('Ws.2')}</td></tr>
      <tr><th class="rowlab">样品稀释倍数 f<sub>样</sub></th><td>${ic('f.1')}</td><td>${ic('f.2')}</td></tr>
      <tr><th class="rowlab">样品峰面积 A<sub>样</sub></th>
          <td><div class="peaks">${smpPeaks(1)}</div></td>
          <td><div class="peaks">${smpPeaks(2)}</div></td></tr>
      <tr><th class="rowlab">样品平均峰面积 <span style="text-decoration:overline">A</span></th>
          <td>${outCell('assay.out.A.1')}</td><td>${outCell('assay.out.A.2')}</td></tr>
      <tr><th class="rowlab">含量 X（%）</th>
          <td>${outCell('assay.out.X.1')}</td><td>${outCell('assay.out.X.2')}</td></tr>
      <tr><th class="rowlab">相对偏差(%)</th><td class="spanall" colspan="2">${outCell('assay.out.RD')}</td></tr>
      <tr><th class="rowlab">平均含量 <span style="text-decoration:overline">X</span>（%）</th>
          <td class="spanall" colspan="2">${outCell('assay.out.MEAN')}</td></tr>
    </table></div>

    <div class="analyte-bar">
      <span>修约位数：单值 ${dpSel('ind', a.indDp)} 位小数，平均值 ${dpSel('mean', a.meanDp)} 位小数</span>
      <label class="tb-chk" style="color:#333">
        <input type="checkbox" data-k="${pre}useS" ${get(pre + 'useS') === '1' ? 'checked' : ''}>
        按纯度 S 折算 C<sub>对</sub>
      </label>
    </div>

    <div class="formula-wrap">
      <div class="formula">${ASSAY.formula()}</div>
      <div class="subst" id="assay.subst"></div>
    </div>

    <div class="verdict">
      <div class="sec-num">标准规定：按干燥品计算，含 ${esc(a.name)}
        ${a.formulaText ? `（${esc(a.formulaText)}）` : ''}
        <span class="limit-edit">
          <select data-k="${pre}limop" class="dpsel">
            <option value="ge">不得少于</option>
            <option value="le">不得过</option>
          </select>
          ${ii('limval', isFinite(a.val) ? String(a.val) : '', 'w120')} %
        </span>
        <span class="judge none" id="assay.judge">待计算</span>
      </div>
    </div>

    <div class="note">
      Q 为水分，按百分数填写（例：13.6 表示 13.6%），公式内自动换算。
      C<sub>对</sub> 单位 mg/ml，W<sub>样</sub> 单位 g，分母乘 1000 完成 mg→g 的单位换算。
      药典所载公式未含纯度 S，故默认不折算；如贵司 SOP 要求按纯度校正，请勾选上方选项。
      气相（0521）与液相（0512）外标法公式一致，切换方法只改变通则号与理论板数限度。
      ${curProduct === 'mint' ? '<br><b>薄荷示例说明：</b>原始记录中对照品五针与样品四针峰面积均已录入，' +
        '但<b>取样量 W<sub>样</sub> 与水分 Q 在该份记录上为空白</b>，需按实际填写后才会算出含量。' +
        '稀释倍数按供试品制备（约 2g 加无水乙醇 50ml，不再稀释）预置为 50。' : ''}
    </div>
  </section>`;
}

/* ---------------------------------------------------------------- 计算 */

function judge(el, val, op, lim){
  const j = document.getElementById(el);
  if (!j) return;
  if (!isFinite(val) || !isFinite(lim)){
    j.className = 'judge none'; j.textContent = '待计算';
    return;
  }
  const pass = op === 'le' ? (val <= lim) : (val >= lim);
  j.className = 'judge ' + (pass ? 'pass' : 'fail');
  j.textContent = pass ? '符合规定' : '不符合规定';
}

function setOut(id, txt){
  const el = document.getElementById(id);
  if (!el) return;
  if (txt === '' || txt === null || txt === undefined){
    el.textContent = '—'; el.classList.add('empty');
  } else {
    el.innerHTML = txt; el.classList.remove('empty');
  }
}

/** 恒重差提示 */
function hzHint(c){
  (c.rows || []).forEach(r => {
    if (!r.hz) return;
    [1,2].forEach(i => {
      const el = document.getElementById(`${c.id}.hz.${r.k}.${i}`);
      if (!el) return;
      const a = getN(`${c.id}.${r.hz}.${i}`), b = getN(`${c.id}.${r.k}.${i}`);
      if (!isFinite(a) || !isFinite(b)){ el.textContent = ''; el.className = 'hz'; return; }
      const d = Math.abs(a - b);
      const ok = d <= 0.0003 + 1e-12;
      el.textContent = `恒重差 ${d.toFixed(4)} g ${ok ? '✓' : '⚠ >0.3mg'}`;
      el.className = 'hz ' + (ok ? 'good' : 'warn');
    });
  });
}

function computeCalc(c){
  const g  = (k, i) => getN(`${c.id}.${k}.${i}`);
  const gs = k => getN(`${c.id}.${k}`);
  const he = useHE();
  const indDp  = parseInt(get(`${c.id}.dp.ind`)  || c.dp.ind, 10);
  const meanDp = parseInt(get(`${c.id}.dp.mean`) || c.dp.mean, 10);

  const r = summarize(c.compute(g, gs).x, indDp, he);

  [1,2].forEach(i => setOut(`${c.id}.out.X.${i}`,
    isFinite(r.x[i-1]) ? r.x[i-1].toFixed(indDp) : ''));
  setOut(`${c.id}.out.RD`,   isFinite(r.rd)   ? fmt(r.rd, 1, he)        : '');
  setOut(`${c.id}.out.MEAN`, isFinite(r.mean) ? fmt(r.mean, meanDp, he) : '');

  const sub = c.subst(g, indDp, he, gs).filter(Boolean).join('<br>');
  const se = document.getElementById(`${c.id}.subst`);
  if (se){
    se.innerHTML = sub + (isFinite(r.mean)
      ? `<br><span style="text-decoration:overline">X</span> = <span class="sx">${fmt(r.mean, meanDp, he)}%</span>
         　　　相对偏差 = <span class="sx">${isFinite(r.rd) ? fmt(r.rd, 1, he) : '—'}%</span>` : '');
  }

  hzHint(c);

  const op  = get(`${c.id}.limop`) || (c.id === 'extract' ? 'ge' : 'le');
  const lim = getN(`${c.id}.limval`);
  judge(`${c.id}.judge`, isFinite(r.mean) ? roundTo(r.mean, meanDp, he) : NaN, op, lim);
}

function computeAssay(p){
  const a = p.analytes[curAnalyte] || p.analytes[0];
  const pre = `assay.${a.key}.`;
  const he = useHE();
  const indDp  = parseInt(get(pre + 'dp.ind')  || a.indDp,  10);
  const meanDp = parseInt(get(pre + 'dp.mean') || a.meanDp, 10);

  /* 对照品 */
  const refA = Array.from({length: ASSAY.refShots}, (_, i) => getN(`${pre}refA.${i}`)).filter(isFinite);
  const Aref = mean(refA);
  const rsd  = refA.length >= 2 ? sd(refA) / Aref * 100 : NaN;
  setOut('assay.out.Aref', fmtArea(Aref));
  setOut('assay.out.RSD',  isFinite(rsd)  ? fmt(rsd, 1, he) : '');

  judge('assay.rsdJudge', isFinite(rsd) ? roundTo(rsd, 1, he) : NaN, 'le', getN(pre + 'rsdLim'));
  judge('assay.platesJudge', getN(pre + 'plates'), 'ge', getN(pre + 'platesLim'));

  /* 供试品 */
  let Cref = getN(pre + 'Cref');
  if (get(pre + 'useS') === '1'){
    const S = getN(pre + 'refPurity');
    if (isFinite(S)) Cref = Cref * S / 100;
  }
  const Q = getN(pre + 'Q');

  const A = [1,2].map(s => {
    const shots = Array.from({length: ASSAY.smpShots}, (_, i) => getN(`${pre}smpA.${s}.${i}`)).filter(isFinite);
    return shots.length ? mean(shots) : NaN;
  });
  [1,2].forEach(s => setOut(`assay.out.A.${s}`, fmtArea(A[s-1])));

  const xRaw = [1,2].map(s => {
    const Ws = getN(`${pre}Ws.${s}`), f = getN(`${pre}f.${s}`), Ai = A[s-1];
    if (![Ai, Cref, f, Aref, Ws, Q].every(isFinite)) return NaN;
    const den = Aref * Ws * (1 - Q/100) * 1000;
    return den === 0 ? NaN : (Ai * Cref * f) / den * 100;
  });
  const { x, mean: mn, rd } = summarize(xRaw, indDp, he);

  [1,2].forEach(s => setOut(`assay.out.X.${s}`, isFinite(x[s-1]) ? x[s-1].toFixed(indDp) : ''));
  setOut('assay.out.RD',   isFinite(rd) ? fmt(rd, 1, he)      : '');
  setOut('assay.out.MEAN', isFinite(mn) ? fmt(mn, meanDp, he) : '');

  /* 代入过程 */
  const lines = [1,2].map(s => {
    const Ws = getN(`${pre}Ws.${s}`), f = getN(`${pre}f.${s}`), Ai = A[s-1];
    if (![Ai, Cref, f, Aref, Ws, Q].every(isFinite)) return '';
    return `X<sub>${s}</sub> = ${frac(
        `${fmtArea(Ai)} × ${Cref} × ${f}`,
        `${fmtArea(Aref)} × ${Ws} × (1 − ${Q}%) × 1000`)} × 100% = `
      + `<span class="sx">${x[s-1].toFixed(indDp)}%</span>`;
  }).filter(Boolean);

  const se = document.getElementById('assay.subst');
  if (se){
    se.innerHTML = lines.join('<br>') + (isFinite(mn)
      ? `<br><span style="text-decoration:overline">X</span> = <span class="sx">${fmt(mn, meanDp, he)}%</span>
         　　　相对偏差 = <span class="sx">${isFinite(rd) ? fmt(rd, 1, he) : '—'}%</span>` : '');
  }

  judge('assay.judge', isFinite(mn) ? roundTo(mn, meanDp, he) : NaN,
        get(pre + 'limop') || 'ge', getN(pre + 'limval'));
}

function recompute(){
  const p = PRODUCTS[curProduct];
  CALCS.forEach(computeCalc);
  computeAssay(p);
  save();
}

/* ---------------------------------------------------------------- 挂载 */

function applyLimitDefaults(p, force){
  CALCS.forEach(c => {
    const L = p.limits[c.id];
    const kv = `${c.id}.limval`, ko = `${c.id}.limop`;
    if (force || store[kv] === undefined || store[kv] === ''){
      store[kv] = L ? String(L.val) : '';
      store[ko] = L ? (L.op === '≤' ? 'le' : 'ge') : (c.id === 'extract' ? 'ge' : 'le');
    }
  });
  p.analytes.forEach(a => {
    const kv = `assay.${a.key}.limval`;
    if (force || store[kv] === undefined || store[kv] === ''){
      store[kv] = isFinite(a.val) ? String(a.val) : '';
      store[`assay.${a.key}.limop`] = a.op === '≥' ? 'ge' : 'le';
    }
  });
}

function build(){
  const p = PRODUCTS[curProduct];
  if (curAnalyte >= p.analytes.length) curAnalyte = 0;
  applyLimitDefaults(p, false);

  /* 选项卡 */
  const tabs = [{ id:'header', tab:'结果汇总' }]
    .concat(CALCS.map(c => ({ id:c.id, tab:c.tab })))
    .concat([{ id:'assay', tab:ASSAY.tab }]);
  $('#tabs').innerHTML = tabs.map(t =>
    `<div class="tab${t.id === curTab ? ' active' : ''}" data-tab="${t.id}">${t.tab}</div>`
  ).join('');

  /* 纸张 */
  $('#sheets').innerHTML =
      renderReport(p)
    + CALCS.map(c => renderSheet(c)).join('')
    + renderAssaySheet(p);

  /* 恢复 select 值 */
  $$('select[data-k]').forEach(s => {
    const v = store[s.dataset.k];
    if (v !== undefined && v !== '') s.value = v;
  });

  showTab(curTab);
  recompute();
}

/** 结果汇总页 */
function renderReport(p){
  const rows = CALCS.map(c => `
    <tr>
      <th class="rowlab">${c.tab}</th>
      <td id="rpt.std.${c.id}" style="text-align:left;padding-left:12px">—</td>
      <td id="rpt.res.${c.id}">—</td>
    </tr>`).join('');
  const arows = p.analytes.map(a => `
    <tr>
      <th class="rowlab">含量测定·${esc(a.name)}</th>
      <td id="rpt.std.assay.${a.key}" style="text-align:left;padding-left:12px">—</td>
      <td id="rpt.res.assay.${a.key}">—</td>
    </tr>`).join('');

  return `
  <section class="sheet" data-sheet="header">
    <h2 class="sec">结果汇总</h2>
    <div class="tscroll"><table class="form">
      <tr><th class="rowlab" style="width:26%">检测项目</th>
          <th style="width:44%">标准规定</th><th style="width:30%">检测结果</th></tr>
      ${rows}${arows}
    </table></div>
    <div class="verdict">
      <div class="sec-num">总体判定：<b id="rpt.verdict" style="color:var(--calc)">—</b>规定</div>
    </div>
    <div class="note">
      本页汇总各项计算结果，随其余各页填写实时更新。
      二氧化硫残留量、铝盐/镁盐、鉴别等项无独立计算过程，未设计算器。
    </div>
  </section>`;
}

/** 汇总页数据回填 */
function fillReport(){
  const p = PRODUCTS[curProduct];
  const he = useHE();
  let allPass = true, anyVal = false;

  const opTxt = o => o === 'le' ? '不得过' : '不得少于';

  CALCS.forEach(c => {
    const indDp  = parseInt(get(`${c.id}.dp.ind`)  || c.dp.ind,  10);
    const meanDp = parseInt(get(`${c.id}.dp.mean`) || c.dp.mean, 10);
    const g  = (k, i) => getN(`${c.id}.${k}.${i}`);
    const gs = k => getN(`${c.id}.${k}`);
    const r = summarize(c.compute(g, gs).x, indDp, he);
    const lim = getN(`${c.id}.limval`);
    const op  = get(`${c.id}.limop`) || (c.id === 'extract' ? 'ge' : 'le');

    const se = document.getElementById(`rpt.std.${c.id}`);
    if (se) se.textContent = isFinite(lim) ? `${opTxt(op)} ${lim}%` : '—';

    const re = document.getElementById(`rpt.res.${c.id}`);
    if (re){
      if (isFinite(r.mean)){
        const v = roundTo(r.mean, meanDp, he);
        re.textContent = v.toFixed(meanDp) + '%';
        anyVal = true;
        if (isFinite(lim)){
          const ok = op === 'le' ? v <= lim : v >= lim;
          re.style.color = ok ? 'var(--ok)' : 'var(--bad)';
          if (!ok) allPass = false;
        } else re.style.color = '';
      } else { re.textContent = '—'; re.style.color = ''; }
    }
  });

  p.analytes.forEach(a => {
    const pre = `assay.${a.key}.`;
    const indDp  = parseInt(get(pre + 'dp.ind')  || a.indDp,  10);
    const meanDp = parseInt(get(pre + 'dp.mean') || a.meanDp, 10);
    const lim = getN(pre + 'limval');
    const op  = get(pre + 'limop') || 'ge';

    const se = document.getElementById(`rpt.std.assay.${a.key}`);
    if (se) se.textContent = isFinite(lim)
      ? `本品按干燥品计算，含${a.name}${a.formulaText ? `（${a.formulaText}）` : ''}${opTxt(op)} ${lim}%`
      : '—';

    /* 重算该成分（不依赖当前选中的 analyte） */
    const refA = Array.from({length: ASSAY.refShots}, (_, i) => getN(`${pre}refA.${i}`)).filter(isFinite);
    const Aref = mean(refA);
    let Cref = getN(pre + 'Cref');
    if (get(pre + 'useS') === '1'){
      const S = getN(pre + 'refPurity');
      if (isFinite(S)) Cref = Cref * S / 100;
    }
    const Q = getN(pre + 'Q');
    const xs = [1,2].map(s => {
      const shots = Array.from({length: ASSAY.smpShots}, (_, i) => getN(`${pre}smpA.${s}.${i}`)).filter(isFinite);
      const Ai = shots.length ? mean(shots) : NaN;
      const Ws = getN(`${pre}Ws.${s}`), f = getN(`${pre}f.${s}`);
      if (![Ai, Cref, f, Aref, Ws, Q].every(isFinite)) return NaN;
      const den = Aref * Ws * (1 - Q/100) * 1000;
      return den === 0 ? NaN : (Ai * Cref * f) / den * 100;
    });
    const mn = summarize(xs, indDp, he).mean;

    const re = document.getElementById(`rpt.res.assay.${a.key}`);
    if (re){
      if (isFinite(mn)){
        const v = roundTo(mn, meanDp, he);
        re.textContent = v.toFixed(meanDp) + '%';
        anyVal = true;
        if (isFinite(lim)){
          const ok = op === 'le' ? v <= lim : v >= lim;
          re.style.color = ok ? 'var(--ok)' : 'var(--bad)';
          if (!ok) allPass = false;
        } else re.style.color = '';
      } else { re.textContent = '—'; re.style.color = ''; }
    }
  });

  const v = document.getElementById('rpt.verdict');
  if (v){
    v.textContent = anyVal ? (allPass ? '符合' : '不符合') : '—';
    v.style.color = anyVal ? (allPass ? 'var(--ok)' : 'var(--bad)') : '';
  }
}

function showTab(id){
  curTab = id;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  $$('.sheet').forEach(s => s.classList.toggle('active', s.dataset.sheet === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------------------------------------------- 事件 */

/** 同一字段在多页出现时（如单位名称），让其余输入框跟着更新 */
function syncPeers(t, k, v){
  $$(`[data-k="${CSS.escape(k)}"]`).forEach(el => {
    if (el !== t && el.value !== v) el.value = v;
  });
}

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset && t.dataset.k){
    const v = t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value;
    set(t.dataset.k, v);
    if (t.type !== 'checkbox') syncPeers(t, t.dataset.k, v);
    recompute();
    fillReport();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (!t.dataset || !t.dataset.k) return;
  const k = t.dataset.k;
  set(k, t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value);
  if (k.endsWith('.tech')){
    // 切换色谱方法要重绘（通则号、理论板数限度随之变化）
    build(); fillReport(); showTab('assay');
    return;
  }
  recompute();
  fillReport();
});

document.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (tab){ showTab(tab.dataset.tab); return; }

  const an = e.target.closest('[data-analyte]');
  if (an){
    curAnalyte = parseInt(an.dataset.analyte, 10);
    build(); fillReport(); showTab('assay');
  }
});

$('#productSelect').addEventListener('change', e => {
  curProduct = e.target.value;
  curAnalyte = 0;
  applyLimitDefaults(PRODUCTS[curProduct], true);
  build(); fillReport();
});

$('#roundHalfEven').addEventListener('change', () => { recompute(); fillReport(); });

$('#btnPrint').addEventListener('click', () => window.print());

$('#btnClear').addEventListener('click', () => {
  if (!confirm('确定清空当前所有已填数据？此操作不可撤销。')) return;
  store = {};
  applyLimitDefaults(PRODUCTS[curProduct], true);
  build(); fillReport();
});

$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ product: curProduct, store }, null, 2)],
                        { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `检验记录_${get('rpt.name') || PRODUCTS[curProduct].name || '未命名'}_${get('rpt.batch') || ''}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#btnImport').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try{
      const o = JSON.parse(r.result);
      store = o.store || {};
      curProduct = o.product || curProduct;
      $('#productSelect').value = curProduct;
      build(); fillReport();
    }catch(err){ alert('导入失败：文件不是有效的记录 JSON。'); }
  };
  r.readAsText(f);
  e.target.value = '';
});

/* ---------------------------------------------------------------- 示例数据 */

const DEMO = {
  baixianpi: {
    'impurity.M.1':'51.47','impurity.M1.1':'0.67',
    'impurity.M.2':'50.17','impurity.M1.2':'0.66',

    'moisture.W0a.1':'27.2431','moisture.W0b.1':'27.2429','moisture.Ws.1':'2.6801',
    'moisture.W1a.1':'29.5597','moisture.W1b.1':'29.5587',
    'moisture.W0a.2':'27.2462','moisture.W0b.2':'27.2461','moisture.Ws.2':'2.5815',
    'moisture.W1a.2':'29.4758','moisture.W1b.2':'29.4748',

    'extract.Q':'13.6',
    'extract.W0a.1':'110.6085','extract.W0b.1':'110.6084','extract.Ws.1':'4.9867',
    'extract.V.1':'100','extract.Vs.1':'20','extract.W1.1':'110.8147',
    'extract.W0a.2':'116.0736','extract.W0b.2':'116.0735','extract.Ws.2':'4.8804',
    'extract.V.2':'100','extract.Vs.2':'20','extract.W1.2':'116.2791',

    'assay.cenketone.refPurity':'99.6','assay.cenketone.Cref':'0.06064',
    'assay.cenketone.refA.0':'444228','assay.cenketone.refA.1':'442483','assay.cenketone.refA.2':'438787',
    'assay.cenketone.refA.3':'442183','assay.cenketone.refA.4':'441028',
    'assay.cenketone.Q':'13.6',
    'assay.cenketone.Ws.1':'1.0623','assay.cenketone.f.1':'25',
    'assay.cenketone.smpA.1.0':'598185','assay.cenketone.smpA.1.1':'615092',
    'assay.cenketone.Ws.2':'1.0785','assay.cenketone.f.2':'25',
    'assay.cenketone.smpA.2.0':'616565','assay.cenketone.smpA.2.1':'626566',
    'assay.cenketone.platesLim':'3000','assay.cenketone.rsdLim':'2.0',

    'assay.obakunone.refPurity':'99.7','assay.obakunone.Cref':'0.1017',
    'assay.obakunone.refA.0':'1335090','assay.obakunone.refA.1':'1326881','assay.obakunone.refA.2':'1285858',
    'assay.obakunone.refA.3':'1320591','assay.obakunone.refA.4':'1318831',
    'assay.obakunone.Q':'13.6',
    'assay.obakunone.Ws.1':'1.0623','assay.obakunone.f.1':'25',
    'assay.obakunone.smpA.1.0':'1465965','assay.obakunone.smpA.1.1':'1478213',
    'assay.obakunone.Ws.2':'1.0785','assay.obakunone.f.2':'25',
    'assay.obakunone.smpA.2.0':'1516477','assay.obakunone.smpA.2.1':'1530228',
    'assay.obakunone.platesLim':'3000','assay.obakunone.rsdLim':'2.0'
  },
  jiaozhizi: {
    'impurity.M.1':'51.45','impurity.M1.1':'0.57',
    'impurity.M.2':'50.37','impurity.M1.2':'0.56',

    'moisture.W0a.1':'33.1692','moisture.W0b.1':'33.1691','moisture.Ws.1':'2.1424',
    'moisture.W1a.1':'35.2887','moisture.W1b.1':'35.2877',
    'moisture.W0a.2':'27.7042','moisture.W0b.2':'27.7039','moisture.Ws.2':'2.3548',
    'moisture.W1a.2':'30.0330','moisture.W1b.2':'30.0320',

    'ash.W0a.1':'39.8926','ash.W0b.1':'39.8925','ash.Ws.1':'2.1105',
    'ash.W1a.1':'40.0032','ash.W1b.1':'40.0031',
    'ash.W0a.2':'41.5270','ash.W0b.2':'41.5269','ash.Ws.2':'2.9915',
    'ash.W1a.2':'41.6822','ash.W1b.2':'41.6821',

    'assay.gardenoside.refPurity':'97.1','assay.gardenoside.Cref':'0.03136',
    'assay.gardenoside.refA.0':'435726','assay.gardenoside.refA.1':'435419','assay.gardenoside.refA.2':'436698',
    'assay.gardenoside.refA.3':'437133','assay.gardenoside.refA.4':'436985',
    'assay.gardenoside.Q':'1.1',
    'assay.gardenoside.Ws.1':'0.1091','assay.gardenoside.f.1':'62.5',
    'assay.gardenoside.smpA.1.0':'1070511','assay.gardenoside.smpA.1.1':'1062932',
    'assay.gardenoside.Ws.2':'0.1095','assay.gardenoside.f.2':'62.5',
    'assay.gardenoside.smpA.2.0':'1065845','assay.gardenoside.smpA.2.1':'1070760',
    'assay.gardenoside.plates':'6525.4','assay.gardenoside.platesLim':'2000','assay.gardenoside.rsdLim':'2.0'
  },
  /* 薄荷 GC：原始记录中对照品部分已完成，供试品的取样量与水分未填写，
     故示例只预置对照品五针、样品四针峰面积与稀释倍数，W样/Q 需自行录入。 */
  mint: {
    'assay.menthol.tech':'gc',
    'assay.menthol.Cref':'0.215','assay.menthol.refPurity':'',
    'assay.menthol.refA.0':'799.00','assay.menthol.refA.1':'782.62','assay.menthol.refA.2':'785.28',
    'assay.menthol.refA.3':'789.51','assay.menthol.refA.4':'783.31',
    'assay.menthol.f.1':'50','assay.menthol.f.2':'50',
    'assay.menthol.smpA.1.0':'486.53','assay.menthol.smpA.1.1':'466.19',
    'assay.menthol.smpA.2.0':'471.25','assay.menthol.smpA.2.1':'463.59',
    'assay.menthol.plates':'210883.1958','assay.menthol.platesLim':'10000','assay.menthol.rsdLim':'2.0'
  }
};

$('#btnDemo').addEventListener('click', () => {
  const d = DEMO[curProduct];
  if (!d){ alert('自定义品种没有示例数据。'); return; }
  Object.assign(store, d);
  applyLimitDefaults(PRODUCTS[curProduct], true);
  build(); fillReport();
});

/* ---------------------------------------------------------------- 启动 */

load();
$('#productSelect').value = curProduct;
build();
fillReport();
