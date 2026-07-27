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

/** 含量测定的色谱方法 */
const TECH = {
  hplc: { label:'高效液相色谱法', gz:'0512', plates:'3000' },
  gc:   { label:'气相色谱法',     gz:'0521', plates:'10000' }
};

const RSD_LIM_DEFAULT = '2.0';
const AP = 'assay.';

/**
 * 气相含量测定模板。一个 recordKey 对应一份原料或成品检验记录；
 * 同名品种的原料、成品标准不得合并。standardText 保留记录中的标准规定原文。
 */
function gcRecord(meta, analytes){
  return analytes.map(analyte => ({ ...meta, ...analyte }));
}

const GC_TEMPLATES = [
  ...gcRecord({
    recordKey:'patchouli-raw', product:'广藿香', recordLabel:'原料', mode:'internal',
    internalName:'正十八烷', dry:true, plates:'50000',
    standardText:'本品按干燥品计算，含百秋李醇（C15H26O）不得少于0.22%。内控标准：不得少于0.25%'
  }, [{ id:'patchouli-patchoulol', name:'百秋李醇', formulaText:'C₁₅H₂₆O', limit:'0.22' }]),
  ...gcRecord({
    recordKey:'patchouli-finished', product:'广藿香', recordLabel:'成品', mode:'internal',
    internalName:'正十八烷', dry:true, plates:'50000',
    standardText:'本品按干燥品计算，含百秋李醇（C15H26O）不得少于0.20%。'
  }, [{ id:'patchouli-patchoulol-finished', name:'百秋李醇', formulaText:'C₁₅H₂₆O', limit:'0.20' }]),

  ...gcRecord({
    recordKey:'mugwort-raw', product:'艾叶', recordLabel:'原料', mode:'external',
    dry:true, plates:'50000'
  }, [
    { id:'mugwort-eucalyptol', name:'桉油精', formulaText:'C₁₀H₁₈O', limit:'0.050',
      standardText:'本品按干燥品计算，含桉油精（C10H18O）不得少于0.050%。内控标准：不得少于0.055%' },
    { id:'mugwort-borneol', name:'龙脑', formulaText:'C₁₀H₁₈O', limit:'0.020',
      standardText:'本品按干燥品计算，含龙脑（C10H18O）不得少于0.020%。内控标准：不得少于0.025%' }
  ]),
  ...gcRecord({
    recordKey:'mugwort-finished', product:'艾叶', recordLabel:'成品', mode:'external',
    dry:true, plates:'50000',
    standardText:'本品按干燥品计算，含桉油精（C10H18O）不得少于0.050%，含龙脑（C10H18O）不得少于0.020%。'
  }, [
    { id:'mugwort-eucalyptol-finished', name:'桉油精', formulaText:'C₁₀H₁₈O', limit:'0.050' },
    { id:'mugwort-borneol-finished', name:'龙脑', formulaText:'C₁₀H₁₈O', limit:'0.020' }
  ]),

  ...gcRecord({
    recordKey:'star-anise-raw', product:'八角茴香', recordLabel:'原料', mode:'external',
    dry:false, plates:'30000',
    standardText:'本品含反式茴香脑（C10H12O）不得少于4.0%。内控标准：不得少于4.5%。'
  }, [{ id:'star-anise-anethole', name:'反式茴香脑', formulaText:'C₁₀H₁₂O', limit:'4.0' }]),
  ...gcRecord({
    recordKey:'star-anise-finished', product:'八角茴香', recordLabel:'成品', mode:'external',
    dry:false, plates:'30000',
    standardText:'本品含反式茴香脑（C10H12O）不得少于4.0%。'
  }, [{ id:'star-anise-anethole-finished', name:'反式茴香脑', formulaText:'C₁₀H₁₂O', limit:'4.0' }]),

  ...gcRecord({
    recordKey:'mint-raw', product:'薄荷', recordLabel:'原料', mode:'external',
    dry:true, plates:'10000',
    standardText:'本品按干燥品计算，含薄荷脑（C10H20O）不得少于0.20%。内控标准：含薄荷脑（C10H20O）不得少于0.25%'
  }, [{ id:'mint-menthol', name:'薄荷脑', formulaText:'C₁₀H₂₀O', limit:'0.20' }]),
  ...gcRecord({
    recordKey:'mint-finished', product:'薄荷', recordLabel:'成品', mode:'external',
    dry:true, plates:'10000',
    standardText:'本品按干燥品计算，含薄荷脑（C10H20O）不得少于0.13%。'
  }, [{ id:'mint-menthol-finished', name:'薄荷脑', formulaText:'C₁₀H₂₀O', limit:'0.13' }]),

  ...gcRecord({
    recordKey:'clove-raw', product:'丁香', recordLabel:'原料', mode:'external',
    dry:false, plates:'1500',
    standardText:'本品含丁香酚（C10H12O2）不得少于11.0%。内控标准：不得少于11.5%'
  }, [{ id:'clove-eugenol', name:'丁香酚', formulaText:'C₁₀H₁₂O₂', limit:'11.0' }]),
  ...gcRecord({
    recordKey:'clove-finished', product:'丁香', recordLabel:'成品', mode:'external',
    dry:false, plates:'1500',
    standardText:'本品含丁香酚（C10H12O2）不得少于11.0%。'
  }, [{ id:'clove-eugenol-finished', name:'丁香酚', formulaText:'C₁₀H₁₂O₂', limit:'11.0' }]),

  ...gcRecord({
    recordKey:'cardamom-raw', product:'豆蔻', recordLabel:'原料', mode:'external',
    dry:true, plates:'1000',
    standardText:'本品按干燥品计算，豆蔻仁含桉油精（C10H18O）不得少于3.0%。内控标准：不得少于3.5%'
  }, [{ id:'cardamom-eucalyptol', name:'桉油精', formulaText:'C₁₀H₁₈O', limit:'3.0' }]),
  ...gcRecord({
    recordKey:'cardamom-finished', product:'豆蔻', recordLabel:'成品', mode:'external',
    dry:true, plates:'1000',
    standardText:'本品按干燥品计算，豆蔻仁含桉油精（C10H18O）不得少于3.0%。'
  }, [{ id:'cardamom-eucalyptol-finished', name:'桉油精', formulaText:'C₁₀H₁₈O', limit:'3.0' }]),

  ...gcRecord({
    recordKey:'dendrobium-raw', product:'金钗石斛', recordLabel:'原料', mode:'external',
    dry:false, plates:'10000',
    standardText:'本品按干燥品计算，含石斛碱（C16H25NO2）不得少于0.40%。'
  }, [{ id:'dendrobium-dendrobine', name:'石斛碱', formulaText:'C₁₆H₂₅NO₂', limit:'0.40' }]),

  ...gcRecord({
    recordKey:'homalomena-raw', product:'千年健', recordLabel:'原料', mode:'external',
    dry:true, plates:'20000',
    standardText:'本品按干燥品计算，含芳樟醇（C10H18O）不得少于0.20%。内控标准：不得少于0.25%'
  }, [{ id:'homalomena-linalool', name:'芳樟醇', formulaText:'C₁₀H₁₈O', limit:'0.20' }]),
  ...gcRecord({
    recordKey:'homalomena-finished', product:'千年健', recordLabel:'成品', mode:'external',
    dry:true, plates:'20000',
    standardText:'本品按干燥品计算，含芳樟醇（C10H18O）不得少于0.20%。'
  }, [{ id:'homalomena-linalool-finished', name:'芳樟醇', formulaText:'C₁₀H₁₈O', limit:'0.20' }]),

  ...gcRecord({
    recordKey:'amomum-raw', product:'砂仁', recordLabel:'原料', mode:'external',
    dry:true, plates:'10000',
    standardText:'本品按干燥品计算，含乙酸龙脑酯（C12H20O2）不得少于0.90%。内控标准：不得少于0.95%'
  }, [{ id:'amomum-bornyl-acetate', name:'乙酸龙脑酯', formulaText:'C₁₂H₂₀O₂', limit:'0.90' }]),
  ...gcRecord({
    recordKey:'amomum-finished-national', product:'砂仁', recordLabel:'成品（砂仁·国炮）', mode:'external',
    dry:true, plates:'10000',
    standardText:'本品按干燥品计算，含乙酸龙脑酯（C12H20O2）不得少于0.90%。'
  }, [{ id:'amomum-bornyl-acetate-finished-national', name:'乙酸龙脑酯', formulaText:'C₁₂H₂₀O₂', limit:'0.90' }]),
  ...gcRecord({
    recordKey:'amomum-finished-shanghai', product:'砂仁', recordLabel:'成品（去壳砂仁·上海2018）', mode:'external',
    dry:true, plates:'10000',
    standardText:'本品按干燥品计算，含乙酸龙脑酯（C12H20O2）不得少于0.90%。'
  }, [{ id:'amomum-bornyl-acetate-finished-shanghai', name:'乙酸龙脑酯', formulaText:'C₁₂H₂₀O₂', limit:'0.90' }]),
  ...gcRecord({
    recordKey:'amomum-finished-beijing', product:'砂仁', recordLabel:'成品（砂仁米·北京2023）', mode:'external',
    dry:true, plates:'10000',
    standardText:'本品按干燥品计算，含乙酸龙脑酯（C12H20O2）不得少于0.90%。'
  }, [{ id:'amomum-bornyl-acetate-finished-beijing', name:'乙酸龙脑酯', formulaText:'C₁₂H₂₀O₂', limit:'0.90' }]),

  ...gcRecord({
    recordKey:'fennel-raw', product:'小茴香', recordLabel:'原料', mode:'external',
    dry:false, plates:'5000',
    standardText:'本品含反式茴香脑（C10H12O）不得少于1.4%。'
  }, [{ id:'fennel-anethole', name:'反式茴香脑', formulaText:'C₁₀H₁₂O', limit:'1.4' }]),
  ...gcRecord({
    recordKey:'fennel-finished', product:'小茴香', recordLabel:'成品', mode:'external',
    dry:false, plates:'5000',
    standardText:'本品含反式茴香脑（C10H12O）不得少于1.4%。'
  }, [{ id:'fennel-anethole-finished', name:'反式茴香脑', formulaText:'C₁₀H₁₂O', limit:'1.4' }]),
  ...gcRecord({
    recordKey:'fennel-salted-finished', product:'小茴香', recordLabel:'成品（盐小茴香）', mode:'external',
    dry:false, plates:'5000',
    standardText:'本品含反式茴香脑（C10H12O）不得少于1.3%。'
  }, [{ id:'fennel-anethole-salted-finished', name:'反式茴香脑', formulaText:'C₁₀H₁₂O', limit:'1.3' }]),

  ...gcRecord({
    recordKey:'brucea-raw', product:'鸦胆子', recordLabel:'原料', mode:'internal',
    internalName:'苯甲酸苯酯', dry:true, plates:'5000',
    standardText:'本品按干燥品计算，含油酸（C18H34O2）不得少于8.0%。'
  }, [{ id:'brucea-oleic', name:'油酸', formulaText:'C₁₈H₃₄O₂', limit:'8.0' }]),
  ...gcRecord({
    recordKey:'brucea-finished', product:'鸦胆子', recordLabel:'成品', mode:'internal',
    internalName:'苯甲酸苯酯', dry:true, plates:'5000',
    standardText:'本品按干燥品计算，含油酸（C18H34O2）不得少于8.0%。'
  }, [{ id:'brucea-oleic-finished', name:'油酸', formulaText:'C₁₈H₃₄O₂', limit:'8.0' }]),

  ...gcRecord({
    recordKey:'flax-raw', product:'亚麻子', recordLabel:'原料', mode:'external',
    dry:true, plates:'20000',
    standardText:'本品按干燥品计算，含亚油酸（C18H32O2）和α-亚麻酸（C18H30O2）的总量不得少于13.0%。'
  }, [
    { id:'flax-linoleic', name:'亚油酸', formulaText:'C₁₈H₃₂O₂', limit:'13.0',
      totalLabel:'亚油酸与 α-亚麻酸的总量', partner:'α-亚麻酸' },
    { id:'flax-linolenic', name:'α-亚麻酸', formulaText:'C₁₈H₃₀O₂', limit:'13.0',
      totalLabel:'亚油酸与 α-亚麻酸的总量', partner:'亚油酸' }
  ]),

  ...gcRecord({
    recordKey:'elsholtzia-raw', product:'香薷', recordLabel:'原料', mode:'external',
    dry:true, plates:'1700',
    standardText:'本品按干燥品计算，含麝香草酚（C10H14O）与香荆芥酚（C10H14O）的总量不得少于0.16%。'
  }, [
    { id:'elsholtzia-thymol', name:'麝香草酚', formulaText:'C₁₀H₁₄O', limit:'0.16',
      totalLabel:'麝香草酚与香荆芥酚的总量', partner:'香荆芥酚' },
    { id:'elsholtzia-carvacrol', name:'香荆芥酚', formulaText:'C₁₀H₁₄O', limit:'0.16',
      totalLabel:'麝香草酚与香荆芥酚的总量', partner:'麝香草酚' }
  ]),
  ...gcRecord({
    recordKey:'elsholtzia-finished', product:'香薷', recordLabel:'成品', mode:'external',
    dry:true, plates:'1700',
    standardText:'本品按干燥品计算，含麝香草酚（C10H14O）与香荆芥酚（C10H14O）的总量不得少于0.16%。'
  }, [
    { id:'elsholtzia-thymol-finished', name:'麝香草酚', formulaText:'C₁₀H₁₄O', limit:'0.16',
      totalLabel:'麝香草酚与香荆芥酚的总量', partner:'香荆芥酚' },
    { id:'elsholtzia-carvacrol-finished', name:'香荆芥酚', formulaText:'C₁₀H₁₄O', limit:'0.16',
      totalLabel:'麝香草酚与香荆芥酚的总量', partner:'麝香草酚' }
  ]),

  ...gcRecord({
    recordKey:'pine-raw', product:'油松节', recordLabel:'原料', mode:'external',
    dry:true, plates:'25000',
    standardText:'本品按干燥品计算，含α-蒎烯（C10H16）不得少于0.10%。'
  }, [{ id:'pine-alpha-pinene', name:'α-蒎烯', formulaText:'C₁₀H₁₆', limit:'0.10' }])
];

function gcTemplate(id){ return GC_TEMPLATES.find(t => t.id === id); }
function templatesForProduct(name){ return GC_TEMPLATES.filter(t => t.product === name); }
function templatesForRecord(key){ return GC_TEMPLATES.filter(t => t.recordKey === key); }
function recordsForProduct(name){
  const records = [];
  templatesForProduct(name).forEach(t => {
    if (!records.some(r => r.recordKey === t.recordKey)) records.push(t);
  });
  return records;
}
function templateChoiceLabel(t){
  return `${t.product}（${t.recordLabel}）—${t.name}`;
}
const GC_TEMPLATE_CHOICES = GC_TEMPLATES.map(t => ({
  id:t.id, label:templateChoiceLabel(t)
}));

/** 当前选用的色谱方法 */
function techOf(){ return get('assay.tech') || 'hplc'; }
function assayMode(){ return get(AP + 'mode') || 'external'; }
function dryBasisOf(){
  return store[AP + 'dryBasis'] === undefined ? true : get(AP + 'dryBasis') === '1';
}

/**
 * 理论板数的默认限度，随色谱方法走（液相 3000 / 气相 10000）。
 * 渲染与判定共用此函数 —— 默认值不写进 store，store 里只放用户真正填过的值，
 * 否则换方法时旧默认值会被当成"用户已填"而不再跟随。
 */
function platesDefault(){
  return (TECH[techOf()] || TECH.hplc).plates;
}

/** 标准规定留空时平均含量的兜底位数（填了限度就按限度的位数走） */
const ASSAY_FALLBACK_MEAN_DP = 2;

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
  refShots: 5,   // 对照品连续进样针数
  smpShots: 2,   // 每份供试品进样针数
  formula(){
    const q = dryBasisOf() ? ' × (1 − Q)' : '';
    if (assayMode() === 'internal'){
      return `f = ${frac(
        '<span style="text-decoration:overline">A</span><sub>内</sub> × C<sub>对</sub>',
        '<span style="text-decoration:overline">A</span><sub>对</sub> × C<sub>内</sub>')}
       　　X = ${frac(
        'f × <span style="text-decoration:overline">A</span><sub>样</sub> × C<sub>内</sub> × V',
        '<span style="text-decoration:overline">A</span><sub>样内</sub> × W<sub>样</sub>' + q + ' × 1000')} × 100%`;
    }
    return `X = ${frac(
      '<span style="text-decoration:overline">A</span> × C<sub>对</sub> × f<sub>样</sub>',
      '<span style="text-decoration:overline">A</span><sub>对</sub> × W<sub>样</sub>' + q + ' × 1000')} × 100%`;
  }
};

/* ---------------------------------------------------------------- 状态 */

const LS_KEY = 'tcm-lab-calc-v2';
let store = {};
let curTab = 'impurity';

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
function assayDp(which){
  const own = store[AP + 'dp.' + which];
  if (own !== undefined && own !== '') return parseInt(own, 10);

  // 平均值位数：用户手改过就用手改的，否则取标准规定的小数位
  const mOwn = store[AP + 'dp.mean'];
  let meanDp;
  if (mOwn !== undefined && mOwn !== ''){
    meanDp = parseInt(mOwn, 10);
  } else {
    const lim = store[AP + 'limval'];
    meanDp = (lim !== undefined && String(lim).trim() !== '')
      ? decimalsOf(lim) : ASSAY_FALLBACK_MEAN_DP;
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
  const pre = AP;
  const tpl = gcTemplate(get(pre + 'template'));
  const mode = assayMode();
  const dry = dryBasisOf();

  const peaks = (key, count) => Array.from({length: count}, (_, i) =>
    `<input type="text" inputmode="decimal" autocomplete="off" data-k="${pre}${key}.${i}"
       value="${esc(get(`${pre}${key}.${i}`))}" placeholder="第${i+1}针">`).join('');
  const refPeaks = key => peaks(key, ASSAY.refShots);
  const smpPeaks = (key, s) => peaks(`${key}.${s}`, ASSAY.smpShots);

  const ii = (k, def, cls) => inlineInput(pre + k, def, cls);
  const ic = k => `<input class="cell" type="text" inputmode="decimal" autocomplete="off"
                      data-k="${esc(pre + k)}" value="${esc(get(pre + k))}">`;

  const dpSel = k => {
    const v = assayDp(k);
    let o = '';
    for (let i = 0; i <= 5; i++) o += `<option value="${i}"${v === i ? ' selected' : ''}>${i}</option>`;
    return `<select class="dpsel" data-k="${pre}dp.${k}">${o}</select>`;
  };

  const tech = techOf();
  const T = TECH[tech] || TECH.hplc;
  const platesDef = platesDefault();
  const productName = tpl ? tpl.product : get(pre + 'productName');
  const productRecords = recordsForProduct(productName);
  const recordTemplates = tpl ? templatesForRecord(tpl.recordKey) : [];
  const productPicker = `
    <input class="product-combo" type="text" list="gcProductList" data-assay-product
      value="${esc(tpl ? templateChoiceLabel(tpl) : productName)}" placeholder="输入品种或选择原料/成品记录" autocomplete="off">
    <datalist id="gcProductList">
      ${GC_TEMPLATE_CHOICES.map(choice =>
        `<option value="${esc(choice.label)}"></option>`
      ).join('')}
    </datalist>
    <button type="button" class="apply-product" data-apply-assay-product>套用</button>`;
  const recordSel = productRecords.length > 1 ? `
    <span>记录：</span>
    <select class="dpsel" data-assay-record>
      ${productRecords.map(t =>
        `<option value="${t.recordKey}"${tpl && t.recordKey === tpl.recordKey ? ' selected' : ''}>${esc(t.recordLabel)}</option>`
      ).join('')}
    </select>` : '';
  const componentSel = recordTemplates.length > 1 ? `
    <span>待测成分：</span>
    <select class="dpsel" data-assay-component>
      ${recordTemplates.map(t =>
        `<option value="${t.id}"${t.id === get(pre + 'template') ? ' selected' : ''}>${esc(t.name)}</option>`
      ).join('')}
    </select>` : '';
  const techSel = `<select class="dpsel" data-k="${pre}tech">` +
    Object.keys(TECH).map(k =>
      `<option value="${k}"${k === tech ? ' selected' : ''}>${TECH[k].label}（通则 ${TECH[k].gz}）</option>`
    ).join('') + `</select>`;
  const modeSel = `<select class="dpsel" data-k="${pre}mode">
      <option value="external"${mode === 'external' ? ' selected' : ''}>外标法</option>
      <option value="internal"${mode === 'internal' ? ' selected' : ''}>内标法</option>
    </select>`;

  const refRows = mode === 'internal' ? `
      <tr><th class="rowlab" style="width:38%">内标物名称</th>
          <td colspan="2"><input class="inline w180" type="text" autocomplete="off"
            data-k="${pre}internalName" value="${esc(get(pre + 'internalName'))}" placeholder="内标物名称"></td></tr>
      <tr><th class="rowlab">内标物浓度 C<sub>内</sub>（mg/ml）</th><td colspan="2">${ic('Cis')}</td></tr>
      <tr><th class="rowlab">对照品浓度 C<sub>对</sub>（mg/ml）</th><td colspan="2">${ic('Cref')}</td></tr>
      <tr><th class="rowlab">纯度 S（%）</th><td colspan="2">${ic('refPurity')}</td></tr>
      <tr><th class="rowlab">内标物峰面积 A<sub>内</sub></th>
          <td colspan="2"><div class="peaks">${refPeaks('refIS')}</div></td></tr>
      <tr><th class="rowlab">内标物平均峰面积 <span style="text-decoration:overline">A</span><sub>内</sub></th>
          <td colspan="2">${outCell('assay.out.ISref')}</td></tr>
      <tr><th class="rowlab">对照品峰面积 A<sub>对</sub></th>
          <td colspan="2"><div class="peaks">${refPeaks('refA')}</div></td></tr>
      <tr><th class="rowlab">对照品平均峰面积 <span style="text-decoration:overline">A</span><sub>对</sub></th>
          <td colspan="2">${outCell('assay.out.Aref')}</td></tr>
      <tr><th class="rowlab">校正因子 f</th><td colspan="2">${outCell('assay.out.factor')}</td></tr>`
    : `
      <tr><th class="rowlab" style="width:38%">对照品浓度 C<sub>对</sub>（mg/ml）</th>
          <td colspan="2">${ic('Cref')}</td></tr>
      <tr><th class="rowlab">纯度 S（%）</th><td colspan="2">${ic('refPurity')}</td></tr>
      <tr><th class="rowlab">对照品峰面积 A<sub>对</sub></th>
          <td colspan="2"><div class="peaks">${refPeaks('refA')}</div></td></tr>
      <tr><th class="rowlab">对照品平均峰面积 <span style="text-decoration:overline">A</span><sub>对</sub></th>
          <td colspan="2">${outCell('assay.out.Aref')}</td></tr>`;

  const samplePeakRows = mode === 'internal' ? `
      <tr><th class="rowlab">样品稀释体积 V（ml）</th><td>${ic('f.1')}</td><td>${ic('f.2')}</td></tr>
      <tr><th class="rowlab">${esc(get(pre + 'internalName') || '内标物')}峰面积 A<sub>样内</sub></th>
          <td><div class="peaks">${smpPeaks('smpIS', 1)}</div></td>
          <td><div class="peaks">${smpPeaks('smpIS', 2)}</div></td></tr>
      <tr><th class="rowlab">${esc(get(pre + 'internalName') || '内标物')}平均峰面积
          <span style="text-decoration:overline">A</span><sub>样内</sub></th>
          <td>${outCell('assay.out.IS.1')}</td><td>${outCell('assay.out.IS.2')}</td></tr>
      <tr><th class="rowlab">待测成分峰面积 A<sub>样</sub></th>
          <td><div class="peaks">${smpPeaks('smpA', 1)}</div></td>
          <td><div class="peaks">${smpPeaks('smpA', 2)}</div></td></tr>`
    : `
      <tr><th class="rowlab">样品稀释倍数 f<sub>样</sub></th><td>${ic('f.1')}</td><td>${ic('f.2')}</td></tr>
      <tr><th class="rowlab">样品峰面积 A<sub>样</sub></th>
          <td><div class="peaks">${smpPeaks('smpA', 1)}</div></td>
          <td><div class="peaks">${smpPeaks('smpA', 2)}</div></td></tr>`;

  const totalRows = tpl && tpl.totalLabel ? `
      <tr><th class="rowlab">${esc(tpl.partner)}平均含量（%）<span class="lim">录入另一成分的计算结果</span></th>
          <td class="spanall" colspan="2">${ic('partnerMean')}</td></tr>
      <tr><th class="rowlab">${esc(tpl.totalLabel)}（%）</th>
          <td class="spanall" colspan="2">${outCell('assay.out.TOTAL')}</td></tr>` : '';
  const standardTarget = tpl && tpl.totalLabel
    ? esc(tpl.totalLabel)
    : `含 <b id="assay.nameEcho"></b>${get(pre + 'formulaText') ? `（${esc(get(pre + 'formulaText'))}）` : ''}`;

  return `
  <section class="sheet" data-sheet="assay">
    <h2 class="sec">【含量测定】</h2>
    <div class="method">照${T.label}（通则 ${T.gz}）测定，${mode === 'internal' ? '内标法' : '外标法'}。</div>

    <div class="analyte-bar no-print">
      <span>品种/记录：</span>${productPicker}${recordSel}${componentSel}
      <span>方法：</span>${techSel}${modeSel}
      <label class="tb-chk" style="color:#333">
        <input type="checkbox" data-k="${pre}dryBasis" ${dry ? 'checked' : ''}>
        按干燥品计算
      </label>
    </div>

    <div class="subhead">对照品：<input class="inline w180" type="text" autocomplete="off"
        data-k="${pre}name" value="${esc(get(pre + 'name'))}" placeholder="成分名称"></div>
    <div class="tscroll"><table class="form">
      ${refRows}
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
      ${dry ? `<tr><th class="rowlab">水分 Q（%）</th><td class="spanall" colspan="2">${ic('Q')}</td></tr>` : ''}
      <tr><th class="rowlab">取样量 W<sub>样</sub>（g）</th><td>${ic('Ws.1')}</td><td>${ic('Ws.2')}</td></tr>
      ${samplePeakRows}
      <tr><th class="rowlab">样品平均峰面积 <span style="text-decoration:overline">A</span></th>
          <td>${outCell('assay.out.A.1')}</td><td>${outCell('assay.out.A.2')}</td></tr>
      <tr><th class="rowlab">含量 X（%）</th>
          <td>${outCell('assay.out.X.1')}</td><td>${outCell('assay.out.X.2')}</td></tr>
      <tr><th class="rowlab">相对偏差(%)</th><td class="spanall" colspan="2">${outCell('assay.out.RD')}</td></tr>
      <tr><th class="rowlab">平均含量 <span style="text-decoration:overline">X</span>（%）</th>
          <td class="spanall" colspan="2">${outCell('assay.out.MEAN')}</td></tr>
      ${totalRows}
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
      ${tpl && tpl.standardText
        ? `<div class="standard-quote"><b>标准规定：</b>${esc(tpl.standardText)}</div>
           <div class="sec-num">判定限度：`
        : `<div class="sec-num">标准规定：本品${dry ? '按干燥品计算，' : ''}${standardTarget}`}
        <span class="limit-edit">
          <select data-k="${pre}limop" class="dpsel">
            <option value="ge">不得少于</option>
            <option value="le">不得过</option>
          </select>
          ${ii('limval', '', 'w120')} %
        </span>
        <span class="judge none" id="assay.judge">待计算</span>
      </div>
    </div>

    <div class="note">
      ${tpl ? `当前模板：${esc(tpl.product)}（${esc(tpl.recordLabel)}）—${esc(tpl.name)}；标准规定原文与判定限度均按该条原料或成品记录预填。` : '当前为自定义模板。'}
      ${dry ? 'Q 为水分，按百分数填写（例：13.6 表示 13.6%），公式内自动换算。' : '本模板不按干燥品折算，公式不扣除水分。'}
      C<sub>对</sub> 单位 mg/ml，W<sub>样</sub> 单位 g，分母乘 1000 完成 mg→g 的单位换算。
      药典所载公式未含纯度 S，故默认不折算；如贵司 SOP 要求按纯度校正，请勾选上方选项。
      ${mode === 'internal' ? '内标法先由对照品与内标物的峰面积、浓度计算校正因子，再计算供试品含量。' : '气相（0521）与液相（0512）外标法公式一致。'}
      ${tpl && tpl.totalLabel ? `<br><b>${esc(tpl.totalLabel)}</b>按合计值判定：先计算当前成分，再把另一成分的平均含量填入表格。` : ''}
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
  const pre = AP;
  const he = useHE();
  const mode = assayMode();
  const dry = dryBasisOf();
  const tpl = gcTemplate(get(pre + 'template'));
  const indDp  = assayDp('ind');
  const meanDp = assayDp('mean');
  const rdDp   = assayDp('rd');

  // 标准规定那一行里的成分名，跟着上方"对照品"输入框走
  const echo = document.getElementById('assay.nameEcho');
  if (echo) echo.textContent = get(pre + 'name') || '待测成分';

  /* 对照品 */
  const refA = Array.from({length: ASSAY.refShots}, (_, i) => getN(`${pre}refA.${i}`)).filter(isFinite);
  const Aref = mean(refA);
  const rsd  = refA.length >= 2 ? sd(refA) / Aref * 100 : NaN;
  setOut('assay.out.Aref', fmtArea(Aref));
  setOut('assay.out.RSD',  isFinite(rsd)  ? fmt(rsd, 1, he) : '');

  const refIS = mode === 'internal'
    ? Array.from({length: ASSAY.refShots}, (_, i) => getN(`${pre}refIS.${i}`)).filter(isFinite)
    : [];
  const ISref = mean(refIS);
  setOut('assay.out.ISref', fmtArea(ISref));

  // 限度栏留空时按默认限度判定（默认值只渲染在输入框里，不写入 store）
  const rsdLim    = isFinite(getN(pre + 'rsdLim'))    ? getN(pre + 'rsdLim')    : num(RSD_LIM_DEFAULT);
  const platesLim = isFinite(getN(pre + 'platesLim')) ? getN(pre + 'platesLim') : num(platesDefault());
  judge('assay.rsdJudge', isFinite(rsd) ? roundTo(rsd, 1, he) : NaN, 'le', rsdLim);
  judge('assay.platesJudge', getN(pre + 'plates'), 'ge', platesLim);

  /* 供试品 */
  let Cref = getN(pre + 'Cref');
  if (get(pre + 'useS') === '1'){
    const S = getN(pre + 'refPurity');
    if (isFinite(S)) Cref = Cref * S / 100;
  }
  const Q = getN(pre + 'Q');
  const qFactor = dry ? (isFinite(Q) ? 1 - Q/100 : NaN) : 1;
  const Cis = getN(pre + 'Cis');
  const factor = mode === 'internal' && [ISref, Cref, Aref, Cis].every(isFinite) && Aref !== 0 && Cis !== 0
    ? ISref * Cref / (Aref * Cis) : NaN;
  setOut('assay.out.factor', isFinite(factor) ? factor.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '');

  const A = [1,2].map(s => {
    const shots = Array.from({length: ASSAY.smpShots}, (_, i) => getN(`${pre}smpA.${s}.${i}`)).filter(isFinite);
    return shots.length ? mean(shots) : NaN;
  });
  [1,2].forEach(s => setOut(`assay.out.A.${s}`, fmtArea(A[s-1])));
  const AIS = mode === 'internal' ? [1,2].map(s => {
    const shots = Array.from({length: ASSAY.smpShots}, (_, i) => getN(`${pre}smpIS.${s}.${i}`)).filter(isFinite);
    return shots.length ? mean(shots) : NaN;
  }) : [NaN, NaN];
  [1,2].forEach(s => setOut(`assay.out.IS.${s}`, fmtArea(AIS[s-1])));

  const xRaw = [1,2].map(s => {
    const Ws = getN(`${pre}Ws.${s}`), f = getN(`${pre}f.${s}`), Ai = A[s-1];
    if (mode === 'internal'){
      const ISi = AIS[s-1];
      if (![factor, Ai, Cis, f, ISi, Ws, qFactor].every(isFinite)) return NaN;
      const den = ISi * Ws * qFactor * 1000;
      return den === 0 ? NaN : (factor * Ai * Cis * f) / den * 100;
    }
    if (![Ai, Cref, f, Aref, Ws, qFactor].every(isFinite)) return NaN;
    const den = Aref * Ws * qFactor * 1000;
    return den === 0 ? NaN : (Ai * Cref * f) / den * 100;
  });
  const { x, mean: mn, rd } = summarize(xRaw, indDp, he);

  [1,2].forEach(s => setOut(`assay.out.X.${s}`, isFinite(x[s-1]) ? x[s-1].toFixed(indDp) : ''));
  setOut('assay.out.RD',   isFinite(rd) ? fmt(rd, rdDp, he)   : '');
  setOut('assay.out.MEAN', isFinite(mn) ? fmt(mn, meanDp, he) : '');

  /* 代入过程 */
  const lines = [1,2].map(s => {
    const Ws = getN(`${pre}Ws.${s}`), f = getN(`${pre}f.${s}`), Ai = A[s-1];
    const qText = dry ? ` × (1 − ${Q}%)` : '';
    if (mode === 'internal'){
      const ISi = AIS[s-1];
      if (![factor, Ai, Cis, f, ISi, Ws, qFactor].every(isFinite)) return '';
      return `X<sub>${s}</sub> = ${frac(
          `${factor.toFixed(6)} × ${fmtArea(Ai)} × ${Cis} × ${f}`,
          `${fmtArea(ISi)} × ${Ws}${qText} × 1000`)} × 100% = `
        + `<span class="sx">${x[s-1].toFixed(indDp)}%</span>`;
    }
    if (![Ai, Cref, f, Aref, Ws, qFactor].every(isFinite)) return '';
    return `X<sub>${s}</sub> = ${frac(
        `${fmtArea(Ai)} × ${Cref} × ${f}`,
        `${fmtArea(Aref)} × ${Ws}${qText} × 1000`)} × 100% = `
      + `<span class="sx">${x[s-1].toFixed(indDp)}%</span>`;
  }).filter(Boolean);

  const se = document.getElementById('assay.subst');
  if (se){
    se.innerHTML = lines.join('<br>') + (isFinite(mn)
      ? `<br><span style="text-decoration:overline">X</span> = <span class="sx">${fmt(mn, meanDp, he)}%</span>
         　　　相对偏差 = <span class="sx">${isFinite(rd) ? fmt(rd, rdDp, he) : '—'}%</span>` : '');
  }

  const partnerMean = getN(pre + 'partnerMean');
  const total = tpl && tpl.totalLabel && isFinite(mn) && isFinite(partnerMean) ? mn + partnerMean : NaN;
  setOut('assay.out.TOTAL', isFinite(total) ? fmt(total, meanDp, he) : '');
  const verdictValue = tpl && tpl.totalLabel ? total : mn;
  judge('assay.judge', isFinite(verdictValue) ? roundTo(verdictValue, meanDp, he) : NaN,
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
  ['ind', 'mean', 'rd'].forEach(w => put(AP + 'dp.' + w, assayDp(w)));
}

function recompute(){
  CALCS.forEach(computeCalc);
  computeAssay();
  syncDpSelects();
  save();
}

/* ---------------------------------------------------------------- 挂载 */

/** 在不同品种模板之间切换时分别保存已填数据，避免互相覆盖。 */
function assaySnapshot(){
  const snap = {};
  Object.keys(store).forEach(k => {
    if (k.startsWith(AP) && k !== AP + 'template') snap[k] = store[k];
  });
  return snap;
}

function applyAssayTemplate(id, customProductName){
  const states = store.__assayTemplateStates && typeof store.__assayTemplateStates === 'object'
    ? store.__assayTemplateStates : {};
  const oldId = get(AP + 'template') || 'custom';
  const newId = id || 'custom';
  const t = gcTemplate(id);
  if (oldId === newId){
    store[AP + 'productName'] = t ? t.product : (customProductName || '');
    build();
    showTab('assay');
    return;
  }

  states[oldId] = assaySnapshot();
  Object.keys(store).forEach(k => {
    if (k.startsWith(AP)) delete store[k];
  });

  const restored = states[newId];
  if (restored) Object.assign(store, restored);
  if (t && !restored){
    store[AP + 'tech'] = 'gc';
    store[AP + 'mode'] = t.mode;
    store[AP + 'dryBasis'] = t.dry ? '1' : '0';
    store[AP + 'name'] = t.name;
    store[AP + 'formulaText'] = t.formulaText;
    store[AP + 'internalName'] = t.internalName || '';
    store[AP + 'platesLim'] = t.plates;
    store[AP + 'rsdLim'] = RSD_LIM_DEFAULT;
    store[AP + 'limop'] = 'ge';
    store[AP + 'limval'] = t.limit;
  }
  store[AP + 'productName'] = t ? t.product : (customProductName || '');
  store[AP + 'template'] = id || '';
  store.__assayTemplateStates = states;
  build();
  showTab('assay');
}

function applyAssayProduct(value){
  const name = String(value || '').trim();
  const selected = GC_TEMPLATES.find(t => templateChoiceLabel(t) === name);
  if (selected){
    applyAssayTemplate(selected.id);
    return;
  }
  const choices = templatesForProduct(name);
  if (!choices.length){
    applyAssayTemplate('', name);
    return;
  }
  const current = gcTemplate(get(AP + 'template'));
  const target = current && current.product === name ? current : choices[0];
  applyAssayTemplate(target.id);
}

function applyAssayRecord(recordKey){
  const choices = templatesForRecord(recordKey);
  if (!choices.length) return;
  const current = gcTemplate(get(AP + 'template'));
  const target = choices.find(t => current && t.name === current.name) || choices[0];
  applyAssayTemplate(target.id);
}

/** 判定方向：浸出物与含量测定是"不得少于"，其余是"不得过" */
function seedDefaults(){
  CALCS.forEach(c => {
    const ko = `${c.id}.limop`;
    if (store[ko] === undefined) store[ko] = (c.id === 'extract' ? 'ge' : 'le');
  });
  if (store[AP + 'limop'] === undefined) store[AP + 'limop'] = 'ge';
  if (store[AP + 'mode'] === undefined) store[AP + 'mode'] = 'external';
  if (store[AP + 'dryBasis'] === undefined) store[AP + 'dryBasis'] = '1';
}

function build(){
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
  if (t.matches('[data-assay-product]')){
    applyAssayProduct(t.value);
    return;
  }
  if (t.matches('[data-assay-record]')){
    applyAssayRecord(t.value);
    return;
  }
  if (t.matches('[data-assay-component]')){
    applyAssayTemplate(t.value);
    return;
  }
  if (!t.dataset || !t.dataset.k) return;
  const k = t.dataset.k;
  set(k, t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value);
  if (k.endsWith('.tech') || k.endsWith('.mode') || k.endsWith('.dryBasis')){
    // 切换色谱方法、定量方法或干燥品口径要重绘相应字段与公式
    build(); showTab('assay');
    return;
  }
  recompute();
});

document.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (tab){ showTab(tab.dataset.tab); return; }
  if (e.target.closest('[data-apply-assay-product]')){
    const input = document.querySelector('[data-assay-product]');
    if (input) applyAssayProduct(input.value);
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('[data-assay-product]')) return;
  e.preventDefault();
  applyAssayProduct(e.target.value);
});


/* ---------------------------------------------------------------- 启动 */

load();
build();
