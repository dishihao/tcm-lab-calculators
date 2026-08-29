# 气相含量测定 Word 表格精确复刻实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 33 个气相成分模板的对照品表和供试品表按各自源 Word 记录的几何结构、合并关系、字体和边框精确复刻为可填写、可计算的固定宽度 HTML 表格。

**Architecture:** 使用人工核对的 33 条 `template.id → 源文件/表格编号` 清单驱动 Word COM 只读提取；生成 `assets/gc-record-table-layouts.js` 作为唯一气相精确布局资源。独立渲染器将结构化布局转换成固定磅值 HTML 表格并通过现有 `data-k`、输出 ID 和计算函数嵌入输入、输出；气相无布局时硬失败，液相和自定义模板继续使用现有通用表格。

**Tech Stack:** Windows PowerShell 7、Microsoft Word COM、Word OOXML、Node.js ES modules、原生 HTML/CSS/JavaScript、Playwright/Chrome、Python Pillow（视觉差异图）、GitHub Pages 静态资源。

**Spec:** `docs/superpowers/specs/2026-08-28-gc-word-table-fidelity-design.md`

## Global Constraints

- 只改气相含量测定的对照品表和供试品表；现有计算公式、标准规定、判定和修约逻辑不得改变。
- 28 份源记录、33 个气相成分模板和 66 张源表全部必须成功映射；不得使用相似品种或通用布局替代失败记录。
- 源 Word 文件只能只读打开；格式扩展名错误时只允许在系统临时目录创建恢复副本。
- 运行时布局以 `template.id` 为主键，不能只以 `recordKey` 或 `dry`/`mode` 推测。
- 手机端保持 Word 原宽度并横向滑动，不压缩、不重排、不隐藏列。
- 当前源记录的两张表按 A4 纵向表格宽度打印，不自动切换横向页面。
- 公开资源不得包含源 Word 二进制文件或内部视觉验证截图。
- 每个生产代码步骤先写失败测试并观察预期失败，再写最小实现。
- 任一结构、视觉、交互或全项目回归失败都阻止提交和推送。

---

## File Structure

- Create: `tools/gc-word-table-manifest.json` — 33 条人工核对的模板、源文件、表格编号清单。
- Create: `tools/extract_gc_word_tables.ps1` — Word COM 只读提取 OOXML、COM 几何和格式信息。
- Create: `tools/gc-word-table-extract.json` — 本地原始提取结果；加入 `.gitignore`，不提交。
- Create: `tools/build_gc_word_layouts.mjs` — 规范化、校验、字段映射并生成浏览器资源。
- Create: `assets/gc-record-table-layouts.js` — 33 个模板的结构化、可公开布局数据。
- Create: `assets/gc-word-table-renderer.js` — 纯布局渲染器，不包含计算逻辑。
- Modify: `assets/app.js` — 气相调用精确布局渲染器；液相保留旧路径。
- Modify: `assets/style.css` — Word 固定尺寸、输入/输出、手机滚动和打印规则。
- Modify: `index.html` — 在 `app.js` 前加载布局数据和渲染器，并更新缓存版本。
- Create: `tests/test_gc_word_layout_data.mjs` — 布局资源完整性、几何和映射测试。
- Create: `tests/test_gc_word_table_renderer.mjs` — 合并单元格、格式、输入和输出渲染测试。
- Modify: `tests/test_gc_templates.mjs` — 33 模板切换、HPLC 隔离、状态恢复和初始化测试。
- Create: `tools/export_gc_word_reference_tables.ps1` — 导出 66 张源 Word 表格的内部 QA 图像。
- Create: `tools/capture_gc_web_tables.mjs` — 选择 33 模板并截取网页表格。
- Create: `tools/compare_gc_table_images.py` — 统一 DPI，生成叠加图和差异报告。
- Modify: `.gitignore` — 忽略原始提取 JSON 和 `output/gc-word-layout-audit/`。
- Modify: `README.md` — 说明气相逐记录 Word 表格复刻、固定宽度和横向滑动。

---

### Task 1: 固化 33 个成分模板到源 Word 表格的映射

**Files:**
- Create: `tools/gc-word-table-manifest.json`
- Create: `tests/test_gc_word_layout_data.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: JSON 数组 `entries`；每项包含 `templateId:string`、`recordKey:string`、`kind:"原料"|"成品"`、`root:string`、`sourceFile:string`、`referenceTableIndex:number`、`sampleTableIndex:number`。
- Consumes: 当前 `GC_TEMPLATES` 的 33 个唯一 `id` 和 28 个 `recordKey`。

- [ ] **Step 1: 写映射完整性的失败测试**

在 `tests/test_gc_word_layout_data.mjs` 中读取清单并断言 33 个模板、28 个记录、14 原料和 14 成品；测试使用以下固定 ID 清单，不能从待测清单自身生成期望值：

```js
const EXPECTED_TEMPLATE_IDS = [
  'patchouli-patchoulol','patchouli-patchoulol-finished',
  'mugwort-eucalyptol','mugwort-borneol',
  'mugwort-eucalyptol-finished','mugwort-borneol-finished',
  'star-anise-anethole','star-anise-anethole-finished',
  'mint-menthol','mint-menthol-finished',
  'clove-eugenol','clove-eugenol-finished',
  'cardamom-eucalyptol','cardamom-eucalyptol-finished',
  'dendrobium-dendrobine','homalomena-linalool','homalomena-linalool-finished',
  'amomum-bornyl-acetate','amomum-bornyl-acetate-finished-national',
  'amomum-bornyl-acetate-finished-shanghai','amomum-bornyl-acetate-finished-beijing',
  'fennel-anethole','fennel-anethole-finished','fennel-anethole-salted-finished',
  'brucea-oleic','brucea-oleic-finished',
  'flax-linoleic','flax-linolenic',
  'elsholtzia-thymol','elsholtzia-carvacrol',
  'elsholtzia-thymol-finished','elsholtzia-carvacrol-finished',
  'pine-alpha-pinene'
];
```

测试还要断言所有表格编号是正整数、`referenceTableIndex < sampleTableIndex`、文件扩展名为 `.doc` 或 `.docx`、模板 ID 无重复。

- [ ] **Step 2: 运行测试并确认因清单缺失而失败**

Run: `node tests/test_gc_word_layout_data.mjs`  
Expected: FAIL，错误明确包含 `ENOENT: gc-word-table-manifest.json`。

- [ ] **Step 3: 创建完整映射清单**

清单必须写入以下 33 条已核对表格对：

```json
[
  ["patchouli-patchoulol","patchouli-raw","原料","原料检验记录","015广藿香原料检验记录3.docx",10,11],
  ["patchouli-patchoulol-finished","patchouli-finished","成品","成品检验记录","01501广藿香成品检验记录3.doc",9,10],
  ["mugwort-eucalyptol","mugwort-raw","原料","原料检验记录","041艾叶原料检验记录1.doc",7,8],
  ["mugwort-borneol","mugwort-raw","原料","原料检验记录","041艾叶原料检验记录1.doc",9,10],
  ["mugwort-eucalyptol-finished","mugwort-finished","成品","成品检验记录","04101艾叶成品检验记录（第一增补本）2.doc",18,19],
  ["mugwort-borneol-finished","mugwort-finished","成品","成品检验记录","04101艾叶成品检验记录（第一增补本）2.doc",20,21],
  ["star-anise-anethole","star-anise-raw","原料","原料检验记录","043八角茴香原料检验记录1.docx",5,6],
  ["star-anise-anethole-finished","star-anise-finished","成品","成品检验记录","04301八角茴香成品检验记录1.doc",8,9],
  ["mint-menthol","mint-raw","原料","原料检验记录","064薄荷原料检验记录3.doc",9,10],
  ["mint-menthol-finished","mint-finished","成品","成品检验记录","06401薄荷成品检验记录3.doc",9,10],
  ["clove-eugenol","clove-raw","原料","原料检验记录","147丁香原料检验记录3.doc",6,7],
  ["clove-eugenol-finished","clove-finished","成品","成品检验记录","14701丁香成品检验记录（国炮）3.doc",6,7],
  ["cardamom-eucalyptol","cardamom-raw","原料","原料检验记录","151豆蔻原料检验记录3.doc",7,8],
  ["cardamom-eucalyptol-finished","cardamom-finished","成品","成品检验记录","15101豆蔻成品检验记录3.doc",7,8],
  ["dendrobium-dendrobine","dendrobium-raw","原料","原料检验记录","182石斛（金钗）原料检验记录.3doc.doc",5,6],
  ["homalomena-linalool","homalomena-raw","原料","原料检验记录","297千年健原料检验记录3.docx",7,8],
  ["homalomena-linalool-finished","homalomena-finished","成品","成品检验记录","29701千年健成品检验记录3.docx",8,9],
  ["amomum-bornyl-acetate","amomum-raw","原料","原料检验记录","316砂仁原料检验记录3.doc",7,8],
  ["amomum-bornyl-acetate-finished-national","amomum-finished-national","成品","成品检验记录","31601砂仁成品检验记录（国炮）.doc",7,8],
  ["amomum-bornyl-acetate-finished-shanghai","amomum-finished-shanghai","成品","成品检验记录","31602去壳砂仁成品检验记录（上海2018）3.doc",7,8],
  ["amomum-bornyl-acetate-finished-beijing","amomum-finished-beijing","成品","成品检验记录","31604砂仁米成品检验记录（北京2023年版）.doc",7,8],
  ["fennel-anethole","fennel-raw","原料","原料检验记录","429小茴香原料检验记录.docx",6,7],
  ["fennel-anethole-finished","fennel-finished","成品","成品检验记录","42901小茴香成品检验记录.doc",8,9],
  ["fennel-anethole-salted-finished","fennel-salted-finished","成品","成品检验记录","42902盐小茴香成品检验记录2.doc",7,8],
  ["brucea-oleic","brucea-raw","原料","原料检验记录","468鸦胆子原料检验记录.docx",6,7],
  ["brucea-oleic-finished","brucea-finished","成品","成品检验记录","46801鸦胆子成品检验记录.docx",6,7],
  ["flax-linoleic","flax-raw","原料","原料检验记录","496亚麻子原料检验记录.doc",3,4],
  ["flax-linolenic","flax-raw","原料","原料检验记录","496亚麻子原料检验记录.doc",5,6],
  ["elsholtzia-thymol","elsholtzia-raw","原料","原料检验记录","516香薷原料检验记录.doc",7,8],
  ["elsholtzia-carvacrol","elsholtzia-raw","原料","原料检验记录","516香薷原料检验记录.doc",9,10],
  ["elsholtzia-thymol-finished","elsholtzia-finished","成品","成品检验记录","51601香薷成品检验记录.doc",8,9],
  ["elsholtzia-carvacrol-finished","elsholtzia-finished","成品","成品检验记录","51601香薷成品检验记录.doc",10,11],
  ["pine-alpha-pinene","pine-raw","原料","原料检验记录","606油松节原料检验记录（第一增补本）.doc",4,5]
]
```

将每个数组转换为具名对象字段后保存。把 `tools/gc-word-table-extract.json` 和 `output/gc-word-layout-audit/` 加入 `.gitignore`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node tests/test_gc_word_layout_data.mjs`  
Expected: PASS，输出 `33 templates / 28 records / 66 tables`。

- [ ] **Step 5: 提交映射与测试**

```bash
git add .gitignore tools/gc-word-table-manifest.json tests/test_gc_word_layout_data.mjs
git commit -m "添加气相Word源表映射清单"
```

---

### Task 2: 只读提取 66 张 Word 表的结构与格式

**Files:**
- Create: `tools/extract_gc_word_tables.ps1`
- Create locally: `tools/gc-word-table-extract.json`（ignored）
- Modify: `tests/test_gc_word_layout_data.mjs`

**Interfaces:**
- Consumes: `tools/gc-word-table-manifest.json`。
- Produces: `{generatedAt, templates:[{templateId, sourceFile, referenceTable, sampleTable}], errors:[]}`；每张表包含 `role`、`sourceTableIndex`、`widthPt`、`preferredWidth`、`preferredWidthType`、`indentPt`、`gridPt`、`rows`、`cells`、`sourceOoxmlHash`；公式 run 额外保留 `mathOoxml`。

- [ ] **Step 1: 扩展测试，要求真实提取结果存在且无错误**

新增断言：提取 JSON 有 33 个模板、66 张表、`errors.length === 0`；每张表 `gridPt.length > 0`、`cells.length > 0`、宽度和行高为有限正数；每个 `sourceOoxmlHash` 匹配 64 位 SHA-256。

- [ ] **Step 2: 运行测试并确认因提取结果缺失而失败**

Run: `node tests/test_gc_word_layout_data.mjs --require-extract`  
Expected: FAIL，错误包含 `gc-word-table-extract.json is required`。

- [ ] **Step 3: 实现 Word COM 只读打开和错误扩展名恢复**

PowerShell 脚本必须使用：

```powershell
$doc = $word.Documents.Open($file.FullName, $false, $true, $false)
```

打开失败时复制到 `$env:TEMP\tcm-gc-word-layout-<guid>.doc` 再只读打开。`finally` 中关闭文档、退出 Word、释放 COM 并删除精确临时路径。

- [ ] **Step 4: 从目标表范围提取 OOXML 和 COM 几何**

对 `Tables.Item(index)` 保存：

```powershell
[pscustomobject]@{
  preferredWidth = [double]$table.PreferredWidth
  preferredWidthType = [int]$table.PreferredWidthType
  indentPt = [double]$table.Rows.LeftIndent
  topPaddingPt = [double]$table.TopPadding
  bottomPaddingPt = [double]$table.BottomPadding
  leftPaddingPt = [double]$table.LeftPadding
  rightPaddingPt = [double]$table.RightPadding
  wordOpenXml = $table.Range.WordOpenXML
}
```

解析 OOXML 的 `w:tblGrid`、`w:trHeight`、`w:gridSpan`、`w:vMerge`、`w:tcW`、`w:tcMar`、`w:tcBorders`、段落和 run 属性；将 twip、half-point、eighth-point 统一转换为 `pt` 数值。`widthPt` 以 `tblGrid` 各列宽度之和为权威，`PreferredWidth` 仅作为交叉检查。不得通过 `table.Rows.Item()` 遍历纵向合并表格。遇到 `m:oMath`/`m:oMathPara` 时保存该公式节点的 OOXML，不得把公式丢成控制字符或空字符串。

- [ ] **Step 5: 运行提取器并审计源文件**

Run:

```powershell
pwsh -File tools/extract_gc_word_tables.ps1 `
  -WorkspaceRoot "C:\Users\37475\Desktop\含量计算\tcm-lab-calculators" `
  -OutputPath "tools\gc-word-table-extract.json"
```

Expected: `Extracted 33 templates / 66 tables; 0 errors`，源记录目录的文件数量、大小和修改时间前后完全一致。

- [ ] **Step 6: 运行提取测试并确认通过**

Run: `node tests/test_gc_word_layout_data.mjs --require-extract`  
Expected: PASS。

- [ ] **Step 7: 提交提取器，不提交原始提取 JSON**

```bash
git add tools/extract_gc_word_tables.ps1 tests/test_gc_word_layout_data.mjs
git commit -m "提取气相Word表格结构与格式"
```

---

### Task 3: 生成并严格校验浏览器布局资源

**Files:**
- Create: `tools/build_gc_word_layouts.mjs`
- Create: `assets/gc-record-table-layouts.js`
- Modify: `tests/test_gc_word_layout_data.mjs`

**Interfaces:**
- Consumes: manifest + extract JSON。
- Produces: `const GC_WORD_TABLE_LAYOUTS = Object.freeze({...})`，键为 33 个 `template.id`；每项有 `referenceTable`、`sampleTable` 和显式 `bindings`。

- [ ] **Step 1: 写布局资源缺失的失败测试**

通过 `vm.runInNewContext()` 加载生成资源，断言 33 个键全部存在；每个模板两张表的网格宽度之和与总宽度差值不超过 `0.05pt`；所有单元格坐标、`rowSpan`、`colSpan` 无重叠或空洞。

- [ ] **Step 2: 运行测试并确认因资源缺失而失败**

Run: `node tests/test_gc_word_layout_data.mjs --require-asset`  
Expected: FAIL，错误包含 `assets/gc-record-table-layouts.js missing`。

- [ ] **Step 3: 实现规范化器和结构校验器**

实现并导出以下纯函数：

```js
export function normalizeWordTable(rawTable) {}
export function validateTableGeometry(table) {}
export function normalizeOfficeMath(mathOoxml) {}
export function buildBindings(table, tableRole, templateMeta) {}
export function emitBrowserAsset(layouts, outputPath) {}
```

`validateTableGeometry()` 必须在生成前抛出含 `templateId/tableRole/cellId` 的错误。`normalizeOfficeMath()` 将实际源表用到的分式、上下标、括号和普通数学 run 转成显式 AST；任何不支持的 OfficeMath 节点列入 `unresolved` 并阻止生成。`buildBindings()` 只能匹配清单中明确列出的固定标签，例如“对照品批号”“取样量W样（g）”“进样量V样（μl）”；匹配数量不是恰好一个时失败。内标记录使用具体“正十八烷/百秋李醇”和“苯甲酸苯酯/油酸”标签。多针字段按源单元格内“第N针”数量建立数组。

- [ ] **Step 4: 生成字段映射审核报告并人工逐项核对**

Run:

```bash
node tools/build_gc_word_layouts.mjs \
  --input tools/gc-word-table-extract.json \
  --manifest tools/gc-word-table-manifest.json \
  --audit-only output/gc-word-layout-audit/field-map-report.json
```

审核报告必须逐模板列出：源文件、两个表格编号、固定标签、输入字段、输出字段、针数和未映射空白单元格。若 `unresolved` 非空，依据报告中的确切源标签补充 `buildBindings()` 白名单规则并重新生成，直到 `unresolved` 为空。逐条与源表核对后，在报告对应模板上写入 `reviewed:true`；不得批量替换全部条目。

- [ ] **Step 5: 使用已审核报告生成公开资源**

Run:

```bash
node tools/build_gc_word_layouts.mjs \
  --input tools/gc-word-table-extract.json \
  --manifest tools/gc-word-table-manifest.json \
  --approved-audit output/gc-word-layout-audit/field-map-report.json \
  --output assets/gc-record-table-layouts.js
```

构建器必须确认 33 条均为 `reviewed:true`、`unresolved` 均为空且审核报告中的源 OOXML 哈希仍与当前提取结果相同，否则拒绝生成。

- [ ] **Step 6: 运行资源测试并确认通过**

Run: `node tests/test_gc_word_layout_data.mjs --require-extract --require-asset`  
Expected: PASS，输出 `33 precise layouts; 0 unresolved bindings`。

- [ ] **Step 7: 提交生成器和公开资源**

```bash
git add tools/build_gc_word_layouts.mjs assets/gc-record-table-layouts.js tests/test_gc_word_layout_data.mjs
git commit -m "生成气相Word精确表格布局"
```

---

### Task 4: 实现独立 Word 表格 HTML 渲染器

**Files:**
- Create: `assets/gc-word-table-renderer.js`
- Create: `tests/test_gc_word_table_renderer.mjs`
- Modify: `index.html`

**Interfaces:**
- Consumes: `GcWordTableRenderer.render(table, adapters)`。
- Produces: 固定磅值 `<table class="word-record-table">` 字符串。
- `adapters.input(binding):string`、`adapters.output(binding):string` 由 `app.js` 提供；渲染器不读取全局 store、不计算结果。

- [ ] **Step 1: 写纯渲染失败测试**

使用手写最小布局 fixture，包含 3 列、一个 `colSpan:2`、一个 `rowSpan:2`、不同四边边框、宋体 10.5pt、下标 run、一个分式 math AST 和一个 input binding。断言输出包含：

```html
<col style="width:120pt">
<td rowspan="2" colspan="2">
<span style="font-family:SimSun;font-size:10.5pt">
```

并断言固定文字经过 HTML 转义。

- [ ] **Step 2: 运行测试并确认因渲染器缺失而失败**

Run: `node tests/test_gc_word_table_renderer.mjs`  
Expected: FAIL，错误包含 `GcWordTableRenderer is not defined`。

- [ ] **Step 3: 实现纯函数渲染器**

浏览器模块暴露：

```js
window.GcWordTableRenderer = Object.freeze({
  render(table, adapters),
  validate(table)
});
```

`render()` 生成 `<colgroup>`、行、单元格、段落和 run；根表输出 `data-word-table-role` 和 `data-source-table-index`；使用 CSS `pt`；只允许白名单样式值；所有文字调用内部 `escapeHtml()`；binding 单元格通过 adapter 注入控件或输出。
公式 AST 只渲染构建器已批准的 `text`、`fraction`、`subscript`、`superscript`、`subsup` 和 `delimiter` 节点；未知节点抛出含模板和单元格 ID 的错误，不能静默忽略。

- [ ] **Step 4: 运行渲染测试并确认通过**

Run: `node tests/test_gc_word_table_renderer.mjs`  
Expected: PASS。

- [ ] **Step 5: 在 index.html 中加载模块但暂不切换生产页面**

在 `app.js` 前按顺序加载：

```html
<script src="assets/gc-record-table-layouts.js?v=20260828-word-layout"></script>
<script src="assets/gc-word-table-renderer.js?v=20260828-word-layout"></script>
```

- [ ] **Step 6: 提交渲染器**

```bash
git add assets/gc-word-table-renderer.js tests/test_gc_word_table_renderer.mjs index.html
git commit -m "添加Word表格精确渲染器"
```

---

### Task 5: 将气相页面切换到精确布局，保持液相旧路径

**Files:**
- Modify: `assets/app.js`
- Modify: `tests/test_gc_templates.mjs`

**Interfaces:**
- Consumes: `GC_WORD_TABLE_LAYOUTS[template.id]` 和 `GcWordTableRenderer.render()`。
- Produces: `renderAssayReferenceTable(tpl)`、`renderAssaySampleTable(tpl)`；气相模板无精确布局时抛错。

- [ ] **Step 1: 写浏览器失败测试**

新增行为断言：

- 丁香原料和成品表的 `data-source-table-index` 分别来自 6/7；成品供试品有水分行、原料没有；
- 艾叶桉油精显示源表 7/8，龙脑显示 9/10；
- 亚麻子两个成分分别显示 3/4 和 5/6；
- 广藿香内标表保留“正十八烷”和“百秋李醇”的源标签；
- 33 个气相模板均有 `.word-record-table` 两张且没有 `.generic-assay-table`；
- HPLC 模板仍使用原 `table.form` 通用布局且没有 `.word-record-table`。

- [ ] **Step 2: 运行测试并确认当前三类通用布局失败**

Run: `node tests/test_gc_templates.mjs`  
Expected: FAIL，第一处错误为缺少 `data-source-table-index` 或气相仍使用通用表格。

- [ ] **Step 3: 提取气相和通用表格渲染入口**

在 `app.js` 中建立：

```js
function preciseGcLayout(tpl){
  if (!tpl || tpl.tech !== 'gc') return null;
  const layout = GC_WORD_TABLE_LAYOUTS[tpl.id];
  if (!layout) throw new Error(`气相模板 ${tpl.id} 缺少Word精确布局`);
  return layout;
}
```

`renderAssaySheet()` 仅在 `tpl.tech === 'gc'` 时调用精确渲染；HPLC、自定义或手动改变方法时继续使用现有 `legacyRefRows` 和 `legacySampleRows`，并给旧表添加 `.generic-assay-table` 供隔离测试定位。

- [ ] **Step 4: 实现 adapter 绑定现有状态和输出**

输入 adapter 将相对字段名加 `assay.` 前缀并复用 `get()`/`data-k`；输出 adapter 复用 `outCell('assay.out.*')`。峰面积组继续使用现有 `peaks()`，数量来自 layout binding，不再固定猜测。

- [ ] **Step 5: 删除气相三类近似表格路径**

删除 `GC_TABLE_LAYOUT_BY_RECORD`、`tableLayout` 和 `internalRecordRefRows/externalRecordRefRows/internalRecordSampleRows/externalRecordSampleRows`；保留通用行只供 HPLC和自定义模板。禁止精确气相模板回退。

- [ ] **Step 6: 运行气相/液相测试并确认通过**

Run: `node tests/test_gc_templates.mjs`  
Expected: PASS，输出保留 `1037 个液相模板/603 条记录，33 个气相模板`。

- [ ] **Step 7: 提交页面集成**

```bash
git add assets/app.js tests/test_gc_templates.mjs
git commit -m "按气相成分加载Word精确表格"
```

---

### Task 6: 固定 Word 尺寸、手机横向滚动与打印样式

**Files:**
- Modify: `assets/style.css`
- Modify: `tests/test_gc_templates.mjs`
- Modify: `index.html`

**Interfaces:**
- Produces: `.word-table-scroll`、`.word-record-table`、`.word-cell-input`、`.word-cell-output` 样式契约。

- [ ] **Step 1: 写响应式和打印失败测试**

在 1440px 和 390px viewport 分别选择丁香成品，断言：

```js
table.scrollWidth === desktopTable.scrollWidth
mobileScroller.scrollWidth > mobileScroller.clientWidth
getComputedStyle(table).tableLayout === 'fixed'
```

断言移动端列宽 computed value 与桌面端误差不超过 0.1px；模拟 print media 后表格宽度不变、滚动容器 `overflow` 为 `visible`。

- [ ] **Step 2: 运行测试并确认因精确样式缺失而失败**

Run: `node tests/test_gc_templates.mjs`  
Expected: FAIL，错误包含移动端表格宽度改变或缺少横向滚动。

- [ ] **Step 3: 实现固定尺寸和控件样式**

添加核心规则：

```css
.word-table-scroll{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
.word-record-table{table-layout:fixed;border-collapse:collapse;max-width:none;min-width:0}
.word-cell-input{width:100%;box-sizing:border-box;border:0;background:transparent;font:inherit;text-align:inherit}
.word-cell-output{display:block;width:100%;color:var(--ink);font:inherit;text-align:inherit}
@media print{
  .word-table-scroll{overflow:visible}
  .word-record-table{max-width:none!important;min-width:0!important}
  .word-cell-input{outline:0}
}
```

移除任何会作用于 `.word-record-table` 的移动端统一字号、统一 padding 或 `min-width:520px` 规则。

- [ ] **Step 4: 更新缓存版本并运行测试**

更新 `style.css`、布局资源、渲染器和 `app.js` 查询版本为 `20260828-word-layout`。

Run: `node tests/test_gc_templates.mjs`  
Expected: PASS。

- [ ] **Step 5: 提交样式**

```bash
git add assets/style.css index.html tests/test_gc_templates.mjs
git commit -m "保持气相Word表格固定宽度与打印排版"
```

---

### Task 7A: 修复源 Word 可见几何并消除精确表空白占位符

**Files:**
- Modify: `assets/gc-word-table-renderer.js`
- Modify: `assets/gc-record-table-layouts.js`（仅在源可见宽度确实经过 Word 页面缩放时增加审核后的 `renderScale`/`renderWidthPt`）
- Modify: `assets/app.js`
- Modify: `assets/style.css`
- Modify: `tests/test_gc_templates.mjs`
- Test against: `output/gc-word-layout-audit/visual-qa-20260829-154521/summary.json`（本地忽略 QA 证据）

**Interfaces:**
- Consumes: `GC_WORD_TABLE_LAYOUTS[template.id]` 的源表 `widthPt`、`gridPt`、`rows`、`cells` 和最新 QA 的源可见裁切尺寸。
- Produces: 精确 GC 表的可见宽度、列位置、行高、单元格 Y 位置和空白结果与 Word 源表一致；`render()` 仍只接收布局和 adapters。

- [ ] **Step 1: 写生产几何差异的失败测试**

在 `tests/test_gc_templates.mjs` 中读取最新 QA 的独立期望值，至少固定以下不变量：

```js
const expectedWordGeometry = {
  'amomum-bornyl-acetate:reference': { widthPx: 660, heightPx: 237 },
  'amomum-bornyl-acetate:sample': { widthPx: 660, heightPx: 333 },
  'patchouli-patchoulol:reference': { widthPx: 661, heightPx: 361 },
  'patchouli-patchoulol:sample': { widthPx: 661, heightPx: 397 },
  'brucea-oleic:sample': { widthPx: 718, heightPx: 397 }
};
```

选择这些模板后断言：

- 网页表格的源宽度/缩放属性与对应 Word 可见尺寸一致；
- 每个源行 `heightPt` 转换后的实际行高误差不超过 1 CSS px；
- 第一行之外的累计 `rowTopPx` 误差不超过 1 CSS px；
- 未填写的精确 GC 输出单元格为空字符串，不显示 `—`；
- 普通 HPLC/自定义通用表仍可显示原有 `—` 占位符。

测试必须在修改生产代码前因当前 0/66 几何匹配和空白占位符差异失败。

- [ ] **Step 2: 运行测试确认失败来自真实几何差异**

Run: `node tests/test_gc_templates.mjs`  
Expected: FAIL，错误包含源行高/累计 Y 位置或精确输出空白不一致，不得改动 QA 阈值使其通过。

- [ ] **Step 3: 修正 Word 行高的 content-box 计算**

当前 renderer 将整行 `heightPt` 作为每个单元格内部 wrapper 的 `min-height`，而单元格边框、内边距和 line box 又会额外增加高度。按源 Word 行高重建时：

1. 计算单元格垂直内边距和上下边框占用；
2. 将 wrapper 的最小高度设为 `max(0, row.heightPt - verticalPadding - verticalBorder)`；
3. 对 `rowSpan > 1` 使用所有跨行高度之和减去一次跨行单元格的垂直边距/边框；
4. 源 `heightRule:null` 继续按 `atLeast`，不能丢弃 `heightPt`；
5. 表格、单元格、段落和输入控件不能引入 UA 默认 margin、padding 或 line-height；
6. 保留明确的 `exact`、`atLeast`、`auto` 语义和现有跨行不裁切规则。

不得通过统一增减一个全局像素值掩盖不同源行的差异；修正必须由布局中的行、单元格和 run 格式计算得到。

- [ ] **Step 4: 修正 Word 页面缩放后的可见表格宽度**

用最新 Word 导出 sidecar 的 `cropCssPx.width` 与布局 `widthPt × 96 / 72` 比较。仅对源记录明确经过页面缩放的表格增加经审核的 `renderScale`/`renderWidthPt`；普通表格保持原始宽度。尤其核对：

- `patchouli-patchoulol` 和其成品版供试品表；
- `brucea-oleic` 和其成品版供试品表；
- 四个内标供试品表的八列网格及 `isGridGap` 区域。

渲染时同时缩放 `<colgroup>`、单元格 `widthPt`、表格总宽度、左侧缩进和跨行高度相关的水平位置，不能只缩放外层表格。布局资源中没有经 QA 证明的表格不得自行增加缩放值。

- [ ] **Step 5: 精确 GC 空白输出保持空白**

新增只供精确 GC 使用的输出 adapter：当 `assay.out.*` 没有计算值时返回空字符串；有值时按源单元格格式返回结果。不得修改通用 `outCell()` 的既有 `—` 行为，不得把 RSD/理论板数/no-print 控件填入源表的八个未绑定空白格。

- [ ] **Step 6: 运行针对性测试确认通过**

Run:

```powershell
node tests/test_gc_templates.mjs
node tests/test_gc_word_table_renderer.mjs
node tests/test_gc_word_layout_data.mjs --require-asset --require-builder
```

Expected: 精确 GC 几何代表值、源空白结果、33 个模板和 HPLC/通用隔离全部 PASS。

- [ ] **Step 7: 重新运行 66 张源/网页表格 QA**

Run:

```powershell
pwsh -NoProfile -File tools/export_gc_word_reference_tables.ps1 -Manifest tools/gc-word-table-manifest.json -OutputDir output/gc-word-layout-audit
node tools/capture_gc_web_tables.mjs --output output/gc-word-layout-audit
python tools/compare_gc_table_images.py --input output/gc-word-layout-audit --strict
```

Expected：

- `66/66` paired tables;
- `missing=[]`、`unexpectedDirectories=[]`；
- `shiftedBorders=0`；
- `wrapMismatches=0`；
- `contentPresenceMismatches=0`；
- `geometryMatched=66`。

如果仍有差异，报告必须按 `templateId/role/row/cellId/metric` 列出，不能降低 1 CSS px 阈值或把差异标为 warning。

- [ ] **Step 8: 提交生产几何修复**

```bash
git add assets/gc-word-table-renderer.js assets/gc-record-table-layouts.js assets/app.js assets/style.css tests/test_gc_templates.mjs
git commit -m "修正气相Word表格源记录几何"
```

---

### Task 7: 建立 66 张源表与网页表的视觉差异验收

**Files:**
- Create: `tools/export_gc_word_reference_tables.ps1`
- Create: `tools/capture_gc_web_tables.mjs`
- Create: `tools/compare_gc_table_images.py`
- Create locally: `output/gc-word-layout-audit/**`（ignored）

**Interfaces:**
- Produces: 每个 `templateId` 的 `reference-word.png`、`reference-web.png`、`sample-word.png`、`sample-web.png`、overlay/diff 图和 `summary.json`。

- [ ] **Step 1: 写差异工具的失败自测**

创建两个 200×100 fixture：一个完全相同，一个将竖线平移 2px。运行比较器，断言相同图 `geometryMismatch=false`，平移图 `geometryMismatch=true`。

- [ ] **Step 2: 运行自测并确认比较器缺失而失败**

Run: `python tools/compare_gc_table_images.py --self-test`  
Expected: FAIL，文件或入口不存在。

- [ ] **Step 3: 实现源 Word 表导出**

PowerShell 按 manifest 将每张目标表的 `Range.FormattedText` 复制到独立临时文档，保留页面宽度和表格缩进，经 Word `ExportAsFixedFormat` 输出 PDF，再使用工作区依赖中的 Poppler 转 PNG。输出文件名固定为 `<templateId>-reference-word.png` 和 `<templateId>-sample-word.png`。

- [ ] **Step 4: 实现网页表逐模板截图**

Playwright 脚本使用固定 Chrome、1440×1200 viewport、100% zoom，逐个选择 33 个模板并按 `[data-word-table-role="reference"]`、`[data-word-table-role="sample"]` 元素截图；同时记录 DOM 边框坐标、列宽、行高和字体 computed style。

- [ ] **Step 5: 实现 Pillow 对齐、叠加和几何差异检测**

比较器统一 DPI，先按表格外边框裁切和对齐，再检测水平/垂直线投影位置、文字包围盒和总尺寸；字体抗锯齿颜色差异不记为几何失败。每个不一致项写入 `summary.json`，包含模板、表格角色、行列和像素/磅值差异。

- [ ] **Step 6: 运行 33 模板视觉验收并逐图检查**

Run:

```powershell
pwsh -File tools/export_gc_word_reference_tables.ps1 -Manifest tools/gc-word-table-manifest.json -OutputDir output/gc-word-layout-audit
node tools/capture_gc_web_tables.mjs --output output/gc-word-layout-audit
python tools/compare_gc_table_images.py --input output/gc-word-layout-audit --strict
```

Expected: `66/66 tables geometry matched; 0 shifted borders; 0 wrap mismatches`。使用 `view_image` 检查所有 overlay/diff 图；任一非抗锯齿差异回到 Task 2/3/6 修正后重新生成全套结果。

- [ ] **Step 7: 提交验证工具，不提交 QA 图片**

```bash
git add tools/export_gc_word_reference_tables.ps1 tools/capture_gc_web_tables.mjs tools/compare_gc_table_images.py
git commit -m "添加气相Word与网页表格视觉验收"
```

---

### Task 8: 完善状态、初始化和全项目回归

**Files:**
- Modify: `tests/test_gc_templates.mjs`
- Modify: `tests/test_initialize.mjs`
- Modify: `README.md`

**Interfaces:**
- Verifies: 新布局仍使用现有 `assay.*` store、`__assayTemplateStates`、`initializeAssayProject()` 和 `computeAssay()`。

- [ ] **Step 1: 写新增字段状态与初始化失败测试**

选择广藿香原料，填写批号、来源、两份进样量和峰面积；切换鸦胆子后填写不同值；切回广藿香断言全部恢复。点击初始化后断言输入值和输出值清空，但 `template.id`、源固定文字、表格编号和布局仍保留。

- [ ] **Step 2: 运行测试并确认任何遗漏先失败**

Run: `node tests/test_gc_templates.mjs && node tests/test_initialize.mjs`  
Expected: 如果 binding 未使用 `data-k` 或初始化未清空新字段则 FAIL；修复只能复用现有状态机制，不能创建第二套 localStorage。

- [ ] **Step 3: 补足最小状态接线并再次通过**

新输入全部使用 `assay.<field>`；`assaySnapshot()` 已按前缀保存，`initializeAssayProject()` 已按前缀删除。只修正没有使用该约定的 binding，不改变快照结构。

- [ ] **Step 4: 更新 README**

明确：33 个气相成分模板逐条关联源 Word 表；对照品/供试品表保留原列宽、合并、字体和边框；手机横向滑动；源文件只读；布局不改变计算公式。

- [ ] **Step 5: 运行全部测试**

Run:

```powershell
node tests/test_environment.mjs
node tests/test_gc_word_layout_data.mjs --require-extract --require-asset
node tests/test_gc_word_table_renderer.mjs
node tests/test_gc_templates.mjs
node tests/test_identification_projects.mjs
node tests/test_initialize.mjs
node tests/test_quality_search.mjs
node tests/test_sulfur_dioxide.mjs
git diff --check
```

Expected: 全部 PASS，`git diff --check` 无输出。

- [ ] **Step 6: 提交状态测试与文档**

```bash
git add tests/test_gc_templates.mjs tests/test_initialize.mjs README.md
git commit -m "验证气相精确表格状态与初始化"
```

---

### Task 9: 独立审查、最终验证和 main 推送

**Files:**
- Review: 本计划涉及的全部已提交文件

**Interfaces:**
- Produces: 审查无 Critical/Important、最新全套测试证据、同步的 `origin/main`。

- [ ] **Step 1: 使用 `superpowers:requesting-code-review` 独立审查**

审查范围从设计提交的父提交到当前 HEAD；要求检查源表映射、无回退约束、OOXML 合并处理、HTML 转义、状态隔离、HPLC 隔离、视觉验收可信度和测试覆盖。修复全部 Critical/Important 后重新审查。

- [ ] **Step 2: 使用 `superpowers:verification-before-completion` 重新运行完整验收**

重新运行 Task 7 的 66 张视觉比较和 Task 8 的全部命令；不能引用较早运行结果。确认 `git status --short` 为空。

- [ ] **Step 3: 获取远端并安全整合**

```bash
git fetch origin main
git status --short --branch
git log --oneline --left-right --cherry-pick HEAD...origin/main
```

若远端前进，使用 `git rebase origin/main`，解决冲突后重新执行 Task 8 全套测试和 Task 7 视觉验收；禁止 force push。

- [ ] **Step 4: 推送 main 并验证同步**

```bash
git push origin main
git status --short --branch
git log -1 --oneline --decorate
```

Expected: `main...origin/main` 无 ahead/behind，HEAD、`origin/main`、`origin/HEAD` 指向同一提交。
