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

const RSD_LIM_DEFAULT = '2.0';

/** 当前选用的色谱方法 */
function techOf(a){ return get(`assay.${a.key}.tech`) || a.tech || 'hplc'; }

/**
 * 理论板数的默认限度。成分自带的限度只在其本身的方法下成立，
 * 换了方法就回落到该方法的通用限度。
 * 渲染与判定共用此函数 —— 默认值不写进 store，store 里只放用户真正填过的值，
 * 否则换方法时旧默认值会被当成"用户已填"而不再跟随。
 */
function platesDefault(a){
  const t = techOf(a);
  const T = TECH[t] || TECH.hplc;
  return (t === (a.tech || 'hplc')) ? (a.plates || T.plates) : T.plates;
}

/* ---------------------------------------------------------------- 待测成分 */

/**
 * 含量测定的已知待测成分。限度值用字符串保存以保留末位零 ——
 * "0.050" 与 "0.05" 在药典里精度不同，按数字存会退化成同一个值，
 * 而平均值的修约位数正是由限度的位数决定的（见 calcDp）。
 */
const ANALYTES = [
  { key:'cenketone',   name:'梣酮',   formulaText:'C₁₄H₁₆O₃',   op:'≥', val:'0.050', tech:'hplc', plates:'3000'  },
  { key:'obakunone',   name:'黄柏酮', formulaText:'C₂₆H₃₄O₇',  op:'≥', val:'0.15',  tech:'hplc', plates:'3000'  },
  { key:'gardenoside', name:'栀子苷', formulaText:'C₁₇H₂₄O₁₀', op:'≥', val:'1.0',   tech:'hplc', plates:'2000'  },
  { key:'menthol',     name:'薄荷脑', formulaText:'C₁₀H₂₀O',   op:'≥', val:'0.13',  tech:'gc',   plates:'10000' },
  { key:'other',       name:'其他',   formulaText:'',           op:'≥', val:'',      tech:'hplc' }
];

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

const LS_KEY = 'tcm-lab-calc-v2';
let store = {};
let curTab = 'impurity';
let curAnalyte = 0;

function load(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (raw) store = JSON.parse(raw).store || {};
  }catch(e){ /* 忽略损坏的本地数据 */ }
}
function save(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({ store }));
  }catch(e){ /* 隐私模式下 localStorage 可能不可用 */ }
}

const get  = k => (store[k] === undefined ? '' : store[k]);
const getN = k => num(store[k]);
const set  = (k, v) => { store[k] = v; };

/** 药典修约规则固定为四舍六入五成双 */
const useHE = () => true;

/** 字符串里小数点后的位数；"3"→0，"3.0"→1，"0.050"→3 */
function decimalsOf(s){
  const m = /^\s*-?\d*\.(\d+)\s*$/.exec(String(s || ''));
  return m ? m[1].length : 0;
}

/**
 * 解析修约位数：用户手改 › 由限度推导 › 项目通用默认。
 *
 * 平均值一律修约到与标准限度相同的位数 —— 这是从原始记录反推出来的规律，
 * 也解释了同一个"杂质"项为什么会有两种写法：限度写"不得过 3%"（整数位）
 * 报告 1%，写"不得过 3.0%"（一位小数）报告 1.1%。所以限度栏一填，
 * 平均值的位数就定了，不需要再按品种维护一张表。
 * 单值的位数与限度无关（杂质无论限度几位都只报一位），故仍取各项默认值。
 */
function calcDp(c, which){
  const k = store[`${c.id}.dp.${which}`];
  if (k !== undefined && k !== '') return parseInt(k, 10);
  if (which === 'mean'){
    const lim = store[`${c.id}.limval`];
    if (lim !== undefined && String(lim).trim() !== '') return decimalsOf(lim);
  }
  return c.dp[which];
}

/**
 * 含量测定的修约位数，三者都挂在标准规定的位数上：
 *   平均含量 = 标准规定位数      （如限度 0.15% → 0.31%）
 *   含量 X   = 标准规定位数 + 1  （如限度 0.15% → 0.310%）
 *   相对偏差 = 标准规定位数 − 1  （如限度 0.15% → 1.0%），不小于 0
 * which: 'mean' | 'ind' | 'rd'
 */
function assayDp(a, which){
  const pre = `assay.${a.key}.`;
  const own = store[pre + 'dp.' + which];
  if (own !== undefined && own !== '') return parseInt(own, 10);

  // 平均值位数：用户手改过就用手改的，否则取标准规定的小数位
  const mOwn = store[pre + 'dp.mean'];
  let meanDp;
  if (mOwn !== undefined && mOwn !== ''){
    meanDp = parseInt(mOwn, 10);
  } else {
    const lim = store[pre + 'limval'];
    meanDp = (lim !== undefined && String(lim).trim() !== '') ? decimalsOf(lim) : decimalsOf(a.val);
  }

  if (which === 'mean') return meanDp;
  if (which === 'ind')  return meanDp + 1;
  return Math.max(0, meanDp - 1);          // rd
}

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
  const sel = k => {
    const v = calcDp(c, k);
    let o = '';
    for (let i = 0; i <= 4; i++) o += `<option value="${i}"${v === i ? ' selected' : ''}>${i}</option>`;
    return `<select class="dpsel" data-k="${c.id}.dp.${k}">${o}</select>`;
  };
  return `<div class="analyte-bar">
    <span>修约位数：单值 ${sel('ind')} 位小数，平均值 ${sel('mean')} 位小数</span>
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
function renderAssaySheet(){
  const a = ANALYTES[curAnalyte] || ANALYTES[0];
  const pre = `assay.${a.key}.`;
  const bar = ANALYTES.map((x, i) =>
    `<button data-analyte="${i}" class="${i === curAnalyte ? 'on' : ''}">${esc(x.name)}</button>`
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

  const dpSel = k => {
    const v = assayDp(a, k);
    let o = '';
    for (let i = 0; i <= 5; i++) o += `<option value="${i}"${v === i ? ' selected' : ''}>${i}</option>`;
    return `<select class="dpsel" data-k="${pre}dp.${k}">${o}</select>`;
  };

  const tech = techOf(a);
  const T = TECH[tech] || TECH.hplc;
  const platesDef = platesDefault(a);
  const techSel = `<select class="dpsel" data-k="${pre}tech">` +
    Object.keys(TECH).map(k =>
      `<option value="${k}"${k === tech ? ' selected' : ''}>${TECH[k].label}（通则 ${TECH[k].gz}）</option>`
    ).join('') + `</select>`;

  return `
  <section class="sheet" data-sheet="assay">
    <h2 class="sec">【含量测定】</h2>
    <div class="method">照${T.label}（通则 ${T.gz}）测定，外标法。</div>

    <div class="analyte-bar no-print">
      ${bar}
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
      <tr><th class="rowlab">RSD（%）<span class="lim">应不大于 ${ii('rsdLim', RSD_LIM_DEFAULT, 'w40')}%</span></th>
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
      <span>修约位数：含量 X ${dpSel('ind')} 位，平均含量 ${dpSel('mean')} 位，相对偏差 ${dpSel('rd')} 位</span>
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
          ${ii('limval', a.val || '', 'w120')} %
        </span>
        <span class="judge none" id="assay.judge">待计算</span>
      </div>
    </div>

    <div class="note">
      Q 为水分，按百分数填写（例：13.6 表示 13.6%），公式内自动换算。
      C<sub>对</sub> 单位 mg/ml，W<sub>样</sub> 单位 g，分母乘 1000 完成 mg→g 的单位换算。
      药典所载公式未含纯度 S，故默认不折算；如贵司 SOP 要求按纯度校正，请勾选上方选项。
      气相（0521）与液相（0512）外标法公式一致，切换方法只改变通则号与理论板数限度。
      <br>三个修约位数默认都跟着下方标准规定走：<b>平均含量</b>与标准规定同位，
      <b>含量 X</b> 多一位，<b>相对偏差</b> 少一位。任一项手动改过后即固定，不再跟随。
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
  const indDp  = calcDp(c, 'ind');
  const meanDp = calcDp(c, 'mean');

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

function computeAssay(){
  const a = ANALYTES[curAnalyte] || ANALYTES[0];
  const pre = `assay.${a.key}.`;
  const he = useHE();
  const indDp  = assayDp(a, 'ind');
  const meanDp = assayDp(a, 'mean');
  const rdDp   = assayDp(a, 'rd');

  /* 对照品 */
  const refA = Array.from({length: ASSAY.refShots}, (_, i) => getN(`${pre}refA.${i}`)).filter(isFinite);
  const Aref = mean(refA);
  const rsd  = refA.length >= 2 ? sd(refA) / Aref * 100 : NaN;
  setOut('assay.out.Aref', fmtArea(Aref));
  setOut('assay.out.RSD',  isFinite(rsd)  ? fmt(rsd, 1, he) : '');

  // 限度栏留空时按默认限度判定（默认值只渲染在输入框里，不写入 store）
  const rsdLim    = isFinite(getN(pre + 'rsdLim'))    ? getN(pre + 'rsdLim')    : num(RSD_LIM_DEFAULT);
  const platesLim = isFinite(getN(pre + 'platesLim')) ? getN(pre + 'platesLim') : num(platesDefault(a));
  judge('assay.rsdJudge', isFinite(rsd) ? roundTo(rsd, 1, he) : NaN, 'le', rsdLim);
  judge('assay.platesJudge', getN(pre + 'plates'), 'ge', platesLim);

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
  setOut('assay.out.RD',   isFinite(rd) ? fmt(rd, rdDp, he)   : '');
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
         　　　相对偏差 = <span class="sx">${isFinite(rd) ? fmt(rd, rdDp, he) : '—'}%</span>` : '');
  }

  judge('assay.judge', isFinite(mn) ? roundTo(mn, meanDp, he) : NaN,
        get(pre + 'limop') || 'ge', getN(pre + 'limval'));
}

/**
 * 平均值的修约位数是从限度推导的，用户改限度时要让位数选择器跟着走。
 * 只在用户没有手动指定位数时同步 —— 手改过的不动，且不整页重绘（否则输入框会丢焦点）。
 */
function syncDpSelects(){
  const put = (key, val) => {
    if (store[key] !== undefined && store[key] !== '') return;   // 用户手改过
    const s = document.querySelector(`select[data-k="${CSS.escape(key)}"]`);
    if (s) s.value = String(val);
  };
  CALCS.forEach(c => put(`${c.id}.dp.mean`, calcDp(c, 'mean')));
  // 含量测定的三个位数都跟着标准规定走，改限度时三个下拉一起更新
  const a = ANALYTES[curAnalyte] || ANALYTES[0];
  ['ind', 'mean', 'rd'].forEach(w => put(`assay.${a.key}.dp.${w}`, assayDp(a, w)));
}

function recompute(){
  CALCS.forEach(computeCalc);
  computeAssay();
  syncDpSelects();
  save();
}

/* ---------------------------------------------------------------- 挂载 */

/** 各检查项的判定方向：浸出物是"不得少于"，其余是"不得过" */
function seedDefaults(){
  CALCS.forEach(c => {
    const ko = `${c.id}.limop`;
    if (store[ko] === undefined) store[ko] = (c.id === 'extract' ? 'ge' : 'le');
  });
  ANALYTES.forEach(a => {
    const kv = `assay.${a.key}.limval`, ko = `assay.${a.key}.limop`;
    if (store[kv] === undefined) store[kv] = a.val || '';
    if (store[ko] === undefined) store[ko] = (a.op === '≥' ? 'ge' : 'le');
  });
}

function build(){
  if (curAnalyte >= ANALYTES.length) curAnalyte = 0;
  seedDefaults();

  const tabs = CALCS.map(c => ({ id:c.id, tab:c.tab }))
    .concat([{ id:'assay', tab:ASSAY.tab }]);
  if (!tabs.some(t => t.id === curTab)) curTab = tabs[0].id;

  $('#tabs').innerHTML = tabs.map(t =>
    `<div class="tab${t.id === curTab ? ' active' : ''}" data-tab="${t.id}">${t.tab}</div>`
  ).join('');

  $('#sheets').innerHTML =
      CALCS.map(c => renderSheet(c)).join('')
    + renderAssaySheet();

  /* 恢复 select 值 */
  $$('select[data-k]').forEach(s => {
    const v = store[s.dataset.k];
    if (v !== undefined && v !== '') s.value = v;
  });

  showTab(curTab);
  recompute();
}

function showTab(id){
  curTab = id;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  $$('.sheet').forEach(s => s.classList.toggle('active', s.dataset.sheet === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------------------------------------------- 事件 */

document.addEventListener('input', e => {
  const t = e.target;
  if (!t.dataset || !t.dataset.k) return;
  set(t.dataset.k, t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value);
  recompute();
});

document.addEventListener('change', e => {
  const t = e.target;
  if (!t.dataset || !t.dataset.k) return;
  const k = t.dataset.k;
  set(k, t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value);
  if (k.endsWith('.tech')){
    // 切换色谱方法要重绘（通则号、理论板数限度随之变化）
    build(); showTab('assay');
    return;
  }
  recompute();
});

document.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (tab){ showTab(tab.dataset.tab); return; }

  const an = e.target.closest('[data-analyte]');
  if (an){
    curAnalyte = parseInt(an.dataset.analyte, 10);
    build(); showTab('assay');
  }
});


/* ---------------------------------------------------------------- 启动 */

load();
build();
