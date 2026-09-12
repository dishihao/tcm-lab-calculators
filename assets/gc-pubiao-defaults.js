/* 蒲标网已核实的含量测定参数。只向现有记录的空白输入格回填。
 * 浓度为标准配液目标值，实际配制浓度不同时须按实际值修正。
 * 不填称样量、纯度、水分、批号、峰面积；不使用鉴别项配液参数。
 */
const GcPubiaoDefaults = (() => {
  const version = '20260910-1';
  const entries = {};
  function add(ids, docid, values, note) {
    const entry = Object.freeze({
      source: `https://db.ouryao.com/yaodian/v2025/view?docid=${docid}&id=1`,
      edition: '中国药典2025年版', note, values: Object.freeze(values)
    });
    for (const id of ids) entries[id] = entry;
  }
  const fields = (cref, volume, injection) => ({
    ...(cref === null ? {} : {'assay.Cref': cref}),
    'assay.f.1': volume, 'assay.f.2': volume,
    'assay.refInjection': injection,
    'assay.sampleInjection.1': injection, 'assay.sampleInjection.2': injection
  });
  add(['patchouli-patchoulol','patchouli-patchoulol-finished'], 49216,
    {...fields(null,'10','1'), 'assay.Cis':'1.5'},
    '广藿香：内标储备液15 mg/ml，取1 ml至10 ml，进样液内标浓度1.5 mg/ml；样品最终10 ml。百秋李醇浓度依实际精密称量填写，不把30 mg当作实测称量。');
  add(['mugwort-eucalyptol','mugwort-eucalyptol-finished'], 49284, fields('0.2','10','1'),
    '艾叶桉油精：配液目标0.2 mg/ml；提取液最终10 ml；原料与艾叶饮片同法。');
  add(['mugwort-borneol','mugwort-borneol-finished'], 49284, fields('0.1','10','1'),
    '艾叶龙脑：配液目标0.1 mg/ml；提取液最终10 ml；不套用醋艾炭。');
  add(['star-anise-anethole','star-anise-anethole-finished'], 49158, fields('0.4','25','2'),
    '八角茴香反式茴香脑：0.4 mg/ml，提取25 ml，各进样2 μl。');
  add(['mint-menthol','mint-menthol-finished'], 49756, fields('0.2','50','1'),
    '薄荷脑：0.2 mg/ml，提取50 ml，各进样1 μl；饮片同药材方法，限度不在本次改动范围。');
  add(['clove-eugenol','clove-eugenol-finished'], 49157, fields('2','20','1'),
    '丁香酚：0.3 g约取量不是实测值；0.3 g不回填。对照品2 mg/ml，提取20 ml，各进样1 μl。');
  add(['cardamom-eucalyptol','cardamom-eucalyptol-finished'], 49415, fields('25','5','1'),
    '豆蔻仁桉油精：25 mg/ml，收集提取液至5 ml，各进样1 μl。');
  add(['homalomena-linalool','homalomena-linalool-finished'], 49200, fields('0.1','20','1'),
    '千年健芳樟醇：0.1 mg/ml，提取20 ml，各进样1 μl；饮片含量测定同药材。');
  add(['amomum-bornyl-acetate','amomum-bornyl-acetate-finished-national'], 49550, fields('0.3','25','1'),
    '砂仁乙酸龙脑酯：0.3 mg/ml，提取25 ml，各进样1 μl；地方标准去壳砂仁、砂仁米不自动套用。');
  add(['fennel-anethole','fennel-anethole-finished','fennel-anethole-salted-finished'], 49220, fields('0.4','25','2'),
    '小茴香反式茴香脑：0.4 mg/ml，提取25 ml，各进样2 μl；小茴香饮片及盐小茴香含量方法同药材。');
  add(['brucea-oleic','brucea-oleic-finished'], 49553,
    {...fields('3.75','66.66666666666667','1'), 'assay.Cis':'4'},
    '鸦胆子：油酸当量进样浓度=3×5÷2÷2=3.75 mg/ml；内标进样浓度=8÷2=4 mg/ml；样品等效体积=50÷3×2×2=200/3 ml，不能重复再乘50。按实际配液浓度修正。');
  add(['flax-linoleic','flax-linolenic'], 49350,
    {'assay.refInjection':'1','assay.sampleInjection.1':'1','assay.sampleInjection.2':'1'},
    '亚麻子：只补各进样1 μl；标准品150 mg须实际精密称量，浓度不填；提取总油量及所取油重影响换算，样品稀释倍数不填。');
  add(['elsholtzia-thymol','elsholtzia-carvacrol','elsholtzia-thymol-finished','elsholtzia-carvacrol-finished'], 49562,
    fields('0.3','20','2'), '香薷麝香草酚、香荆芥酚分别0.3 mg/ml，提取20 ml，各进样2 μl；不是鉴别项1 mg/ml。');
  add(['pine-alpha-pinene'], 49507, fields('0.2','20','1'),
    '油松节α-蒎烯：对照品0.2 mg/ml，提取20 ml，各进样1 μl。');

  function fill(id, state, layout) {
    const entry = entries[id];
    if (!entry || layout?.templateId !== id) return 0;
    const inputs = new Set((layout.bindings || []).filter(b => b.role === 'input').map(b => b.field));
    let count = 0;
    for (const [key, value] of Object.entries(entry.values)) {
      if (inputs.has(key) && (state[key] == null || String(state[key]).trim() === '')) {
        state[key] = value;
        count++;
      }
    }
    return count;
  }
  return Object.freeze({version, entries: Object.freeze(entries), fill});
})();
