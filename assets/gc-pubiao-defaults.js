/* 标准或原检验记录确定的进样量与样品稀释倍数。表格里这三个量是不需要检验人员修改或
 * 填写的固定文字（黑体），每次渲染都以本表的值同步；未收录的品种仍按可填格处理。
 * 对照品浓度、内标浓度由本批次实际称量与配液决定，一律不填。
 * 不填称样量、纯度、水分、批号、峰面积；不使用鉴别项配液参数。
 */
const GcPubiaoDefaults = (() => {
  const version = '20260912-3';
  const entries = {};
  // 20260910-1 曾把标准配液目标浓度写进空白格。本次不再写入；
  // 升级时只撤掉那些“仍是我们写进去的值”的格子，检验人员自己填过的值不动。
  const retired = {};
  const retiredVersions = ['20260910-1'];
  function add(ids, docid, values, note) {
    const entry = Object.freeze({
      source: `https://db.ouryao.com/yaodian/v2025/view?docid=${docid}&id=1`,
      edition: '中国药典2025年版', note, values: Object.freeze(values)
    });
    for (const id of ids) entries[id] = entry;
  }
  function retire(ids, values) {
    for (const id of ids) retired[id] = Object.freeze({...values});
  }
  function addRecord(ids, file, values, note) {
    const entry = Object.freeze({
      source: `本单位检验记录：${file}`, edition: '本单位检验记录',
      note, values: Object.freeze(values)
    });
    for (const id of ids) entries[id] = entry;
  }
  const fields = (volume, injection) => ({
    'assay.f.1': volume, 'assay.f.2': volume,
    'assay.refInjection': injection,
    'assay.sampleInjection.1': injection, 'assay.sampleInjection.2': injection
  });
  retire(['patchouli-patchoulol','patchouli-patchoulol-finished'], {'assay.Cis':'1.5'});
  add(['patchouli-patchoulol','patchouli-patchoulol-finished'], 49216, fields('10','1'),
    '广藿香：残渣转移至10 ml量瓶、精密加入内标溶液1 ml，样品等效体积10 ml；两份样品各进样1 μl。百秋李醇与内标浓度按实际称量填写。');
  retire(['mugwort-eucalyptol','mugwort-eucalyptol-finished'], {'assay.Cref':'0.2'});
  add(['mugwort-eucalyptol','mugwort-eucalyptol-finished'], 49284, fields('10','1'),
    '艾叶桉油精：提取液转移至10 ml量瓶，样品等效体积10 ml；各进样1 μl。原料与艾叶饮片同法。');
  retire(['mugwort-borneol','mugwort-borneol-finished'], {'assay.Cref':'0.1'});
  add(['mugwort-borneol','mugwort-borneol-finished'], 49284, fields('10','1'),
    '艾叶龙脑：提取液转移至10 ml量瓶，样品等效体积10 ml；各进样1 μl。不套用醋艾炭。');
  retire(['star-anise-anethole','star-anise-anethole-finished'], {'assay.Cref':'0.4'});
  add(['star-anise-anethole','star-anise-anethole-finished'], 49158, fields('25','2'),
    '八角茴香反式茴香脑：精密加入乙醇25 ml，样品等效体积25 ml；各进样2 μl。');
  retire(['mint-menthol','mint-menthol-finished'], {'assay.Cref':'0.2'});
  add(['mint-menthol','mint-menthol-finished'], 49756, fields('50','1'),
    '薄荷脑：精密加入无水乙醇50 ml，样品等效体积50 ml；各进样1 μl。饮片同药材方法。');
  retire(['clove-eugenol','clove-eugenol-finished'], {'assay.Cref':'2'});
  add(['clove-eugenol','clove-eugenol-finished'], 49157, fields('20','1'),
    '丁香酚：精密加入正己烷20 ml，样品等效体积20 ml；各进样1 μl。0.3 g为约取量，不预填。');
  retire(['cardamom-eucalyptol','cardamom-eucalyptol-finished'], {'assay.Cref':'25'});
  add(['cardamom-eucalyptol','cardamom-eucalyptol-finished'], 49415, fields('5','1'),
    '豆蔻仁桉油精：提取液收集至5 ml量瓶，样品等效体积5 ml；各进样1 μl。');
  retire(['homalomena-linalool','homalomena-linalool-finished'], {'assay.Cref':'0.1'});
  add(['homalomena-linalool','homalomena-linalool-finished'], 49200, fields('20','1'),
    '千年健芳樟醇：精密加入乙酸乙酯20 ml，样品等效体积20 ml；各进样1 μl。饮片含量测定同药材。');
  retire(['amomum-bornyl-acetate','amomum-bornyl-acetate-finished-national'], {'assay.Cref':'0.3'});
  add(['amomum-bornyl-acetate','amomum-bornyl-acetate-finished-national'], 49550, fields('25','1'),
    '砂仁乙酸龙脑酯：精密加入无水乙醇25 ml，样品等效体积25 ml；各进样1 μl。地方标准去壳砂仁、砂仁米不自动套用。');
  retire(['fennel-anethole','fennel-anethole-finished','fennel-anethole-salted-finished'], {'assay.Cref':'0.4'});
  add(['fennel-anethole','fennel-anethole-finished','fennel-anethole-salted-finished'], 49220, fields('25','2'),
    '小茴香反式茴香脑：精密加入乙酸乙酯25 ml，样品等效体积25 ml；各进样2 μl。饮片及盐小茴香含量方法同药材。');
  retire(['brucea-oleic','brucea-oleic-finished'], {'assay.Cref':'3.75','assay.Cis':'4'});
  add(['brucea-oleic','brucea-oleic-finished'], 49553, fields('66.66666666666667','1'),
    '鸦胆子：样品等效体积=50÷3×2×2=200/3 ml，不能重复再乘50；两份样品各进样1 μl。油酸当量浓度与内标浓度按实际配液填写。');
  add(['flax-linoleic','flax-linolenic'], 49350,
    {'assay.refInjection':'1','assay.sampleInjection.1':'1','assay.sampleInjection.2':'1'},
    '亚麻子：只补各进样1 μl；标准品150 mg须实际精密称量，浓度不填；提取总油量及所取油重影响换算，样品稀释倍数不填。');
  retire(['elsholtzia-thymol','elsholtzia-carvacrol','elsholtzia-thymol-finished','elsholtzia-carvacrol-finished'], {'assay.Cref':'0.3'});
  add(['elsholtzia-thymol','elsholtzia-carvacrol','elsholtzia-thymol-finished','elsholtzia-carvacrol-finished'], 49562,
    fields('20','2'), '香薷麝香草酚、香荆芥酚：精密加入无水乙醇20 ml，样品等效体积20 ml；各进样2 μl。不是鉴别项。');
  retire(['pine-alpha-pinene'], {'assay.Cref':'0.2'});
  add(['pine-alpha-pinene'], 49507, fields('20','1'),
    '油松节α-蒎烯：精密加入乙醇20 ml，样品等效体积20 ml；各进样1 μl。');
  // 以下三个模板没有蒲标网可核实的对应版本，参数直接取自各自的原检验记录。
  addRecord(['dendrobium-dendrobine'], '182石斛（金钗）原料检验记录.doc',
    fields('62.5','1'),
    '金钗石斛：取粉末约0.25 g加0.05%甲酸甲醇25 ml回流，取续滤液2 ml置5 ml量瓶并加内标1 ml，等效样品体积25×5÷2=62.5 ml；各进样1 μl。该记录的方法正文为萘内标法、原表却是外标表，本次不改表不改方法，只补进样量与稀释倍数。');
  addRecord(['amomum-bornyl-acetate-finished-shanghai'], '31602去壳砂仁成品检验记录（上海2018）',
    {'assay.f.1':'25','assay.f.2':'25'},
    '去壳砂仁（上海2018）：取粉末约1 g，精密加入无水乙醇25 ml，等效样品体积25 ml。该记录测定法未写进样量，不猜补。');
  addRecord(['amomum-bornyl-acetate-finished-beijing'], '31604砂仁米成品检验记录（北京2023年版）',
    {'assay.f.1':'25','assay.f.2':'25'},
    '砂仁米（北京2023）：取粉末约1 g，精密加入无水乙醇25 ml，等效样品体积25 ml。该记录测定法未写进样量，不猜补。');

  function fill(id, state, layout, fromVersion) {
    const entry = entries[id];
    if (!entry || layout?.templateId !== id) return 0;
    const inputs = new Set((layout.bindings || []).filter(b => b.role === 'input').map(b => b.field));
    let count = 0;
    const gone = retired[id];
    if (gone && retiredVersions.includes(fromVersion)) {
      for (const [key, value] of Object.entries(gone)) {
        if (inputs.has(key) && String(state[key] ?? '').trim() === value) { delete state[key]; count++; }
      }
    }
    for (const [key, value] of Object.entries(entry.values)) {
      // 这些格子已改为不可编辑的固定文字，标准值始终为准。
      if (inputs.has(key) && state[key] !== value) {
        state[key] = value;
        count++;
      }
    }
    return count;
  }
  return Object.freeze({version, entries: Object.freeze(entries), fill});
})();
