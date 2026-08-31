# GC Word-table final whole-branch review fix report

Date: 2026-08-31

Status: **DONE**

Reviewed base: `6c53157e64b32ece79a15a204619ddb407ee8cba`

Branch: `feature/gc-word-table-fidelity`

Commit: the local commit containing this report and the implementation; no merge or push was performed.

## Outcome

All five final-review findings were corrected without changing assay formulas, limits, standards, rounding, HPLC/custom/manual behavior, non-GC pages, the 33-template/28-record/66-table mapping, or the 1 CSS px strict threshold.

Fresh authoritative QA directory:

`output/gc-word-layout-audit/visual-qa-20260831-025550`

Final strict result:

```text
66/66 tables geometry matched; 0 border-run mismatches; 0 indent mismatches; 0 cell-wrap mismatches; 0 exact-content mismatches; warnings=0; unexpected dirs=0
```

The generated `summary.json` additionally records:

```text
tablesCompared=66
geometryMatched=66
shiftedBorders=0
indentMismatches=0
wrapMismatches=0
contentPresenceMismatches=0
exactContentMismatches=0
warningOnlyExclusions=0
missing=[]
unexpectedDirectories=[]
```

## Files changed

Production/runtime:

- `.gitignore`
- `assets/app.js`
- `assets/gc-record-table-layouts.js`
- `assets/gc-word-table-renderer.js`
- `assets/gc-word-table-visible-geometry.js`
- `assets/style.css`
- `index.html`

Extraction/build/QA tooling:

- `tools/build_gc_word_layouts.mjs`
- `tools/capture_gc_web_tables.mjs`
- `tools/compare_gc_table_images.py`
- `tools/derive_gc_word_visible_geometry.py`
- `tools/export_gc_word_reference_tables.ps1`
- `tools/extract_gc_word_tables.ps1`
- `tools/gc-word-embedded-object-semantics.json`
- `tools/gc-word-table-manifest.json`
- `tools/gc_word_open_recovery.ps1`

Tests:

- `tests/test_gc_templates.mjs`
- `tests/test_gc_word_asset_privacy.mjs`
- `tests/test_gc_word_embedded_objects.mjs`
- `tests/test_gc_word_layout_data.mjs`
- `tests/test_gc_word_ooxml_order.ps1`
- `tests/test_gc_word_recovery.ps1`
- `tests/test_gc_word_table_renderer.mjs`
- `tests/test_gc_word_visible_geometry.py`

Evidence/documentation:

- `.superpowers/sdd/2026-08-28-gc-word-table-fidelity/task-7a-report.md`
- `.superpowers/sdd/2026-08-28-gc-word-table-fidelity/final-fix-report.md`

## Design decisions

### 1. Legacy embedded math is explicit, reviewed and fail-closed

- The extractor now treats non-text Word run children as a closed set. Text controls and OfficeMath retain their existing paths; reviewed `w:object`, `w:pict`, `w:drawing` and `mc:AlternateContent` containers become source-object evidence; any other visible/non-text child throws.
- The reviewed registry contains exactly 95 stable entries keyed by source identity and object hash. It covers:
  - 29 external-reference barred-average symbols;
  - 29 external-sample barred-average symbols;
  - 33 sample mean symbols, including the four internal-standard samples;
  - 4 internal-reference correction-factor equations.
- Each registry entry points to a safe semantic AST. The only semantic nodes used for these objects are sequence/text, overline, fraction, subscript and superscript composition. No raw Word XML, OLE binary, VML preview, image, path or unrestricted HTML enters the public asset.
- Source object presence is independently counted in each current Word table and must equal the reviewed count. Floating overlines and embedded equations have distinct stable categories.
- The builder removes source-object placeholders, injects the approved AST into its reviewed target cell, consumes the adjacent plain `A` where the Word line represented an overline, and throws on an identity/hash mismatch.
- The four internal formula labels now render the fixed correction-factor fraction. Their right-hand result cells are explicitly bound to `assay.out.factor`; the duplicate factor output formerly shown outside the precise table was removed.
- The renderer escapes every text leaf, implements an explicit `overline` node, and still throws on unknown AST nodes.
- Strict QA compares all 95 `data-fixed-semantic` values exactly, including overlines, the nested correction-factor fraction and its S/R subscripts.

### 2. Border/grid QA is independent and internal tables use Word-visible geometry

- Source border expectations are derived from the current 144-DPI Word PNG, not from the browser asset. For every source row, the private sidecar records vertical segment position/span/thickness; it also records each horizontal boundary segment, including clipped Brucea overhangs.
- The public nonuniform grid is derived by mapping current Word border centres back to the source grid and interpolating only boundaries that are structurally merged and therefore not directly visible.
- The four internal-standard sample tables now render the six columns visible within the Word page frame, rather than uniformly shrinking the stale eight-column OOXML grid. This reproduces the actual full-height Word runs around:
  - patchouli: `x≈0/172/419/659 CSS px`;
  - Brucea: `x≈0/189/427/666 CSS px`.
- Source columns 7/8 are not discarded. The two required off-page analyte inputs remain at their original unscaled source coordinates and widths, are horizontally reachable through the existing scroll container, retain their `assay.smpA.2.*` state bindings, and do not alter calculation counts. The Word-visible QA frame remains fixed to the current page crop, so the independent comparison is not hidden by expanding the screenshot.
- Brucea's source-visible clipped horizontal overhangs are reproduced from the original off-page cell borders and clipped at the independently derived rightmost Word ink boundary.
- The comparator re-derives Word and web pixel border evidence separately and compares localized positions, spans and thickness at the unchanged `TOLERANCE = 1.0` gate. Missing, extra or shifted segments over one CSS pixel fail.

### 3. Indent is strict visible evidence

- Export sidecars now record the full-page crop origin and page left margin.
- Derivation publishes only a validated `renderIndentPt` measured from those current Word values. Mixed-row sentinel `9999999`, missing values and implausible values cannot be converted to zero.
- Negative Word-visible origin is supported where Word places the outer table rule left of the text boundary. A padded logical canvas preserves the negative indent without ancestor overflow clipping.
- Comparator placement uses the real frame position relative to that logical text boundary. Final QA has `indentMismatches=0` and no warning/not-applicable exclusions.

### 4. Public runtime data and private provenance are separated

- `assets/gc-word-table-visible-geometry.js` now contains only browser-required values: render/canvas/ink widths, row heights, nonuniform grid, visible column count, validated indent and source text-line policy.
- `assets/gc-record-table-layouts.js` no longer publishes source file names, source OOXML hashes, embedded-object hashes, recovery fields or raw XML.
- The ignored run-local `visible-geometry-private.json` owns absolute paths, source hashes, DPI, crop coordinates, border diagnostics, recovery facts and source-grid provenance.
- The comparator validates the private sidecar against a fresh derivation from every current Word PNG/JSON pair and separately verifies that the public runtime projection matches the same derivation. It never uses the public runtime asset as the expected source border evidence.
- Privacy tests recursively reject drive-qualified paths, `visual-qa/` or `output/` paths, raw Word/OLE/VML markers, binary signatures and QA-only keys in both browser-loaded GC Word data assets.

### 5. Temporary `.doc` recovery is narrowly gated

- Only these reviewed manifest entries permit recovery:
  - `homalomena-linalool-finished` / `29701千年健成品检验记录3.docx`;
  - `brucea-oleic-finished` / `46801鸦胆子成品检验记录.docx`.
- Recovery additionally requires the `.docx` extension plus the verified OLE compound-file signature `D0 CF 11 E0 A1 B1 1A E1` and the exact reviewed reason/suffix (`ole-compound-doc-with-docx-extension`, `.doc`).
- A direct open is always attempted first. Permission, corruption, transient COM and ordinary `.docx` failures are re-thrown unchanged and create no copy.
- Extraction and export report `usedTempRecovery`, `recoveryReason` and `temporarySuffix` privately. Exact temp paths are cleaned in `finally` blocks.

## TDD RED/GREEN evidence

The first focused RED run was:

```powershell
node tests/test_gc_word_embedded_objects.mjs
node tests/test_gc_word_asset_privacy.mjs
pwsh -NoProfile -File tests/test_gc_word_recovery.ps1
python tests/test_gc_word_visible_geometry.py
node tests/test_gc_word_layout_data.mjs --require-asset --require-builder
node tests/test_gc_word_table_renderer.mjs
```

Observed RED causes, before implementation:

```text
reviewed embedded-object semantic registry is required
GC_WORD_TABLE_LAYOUTS.patchouli-patchoulol.sourceFile: QA-only key leaked
gc_word_open_recovery.ps1 is required
ImportError: cannot import name 'derive_runtime_and_provenance'
manifest recovery entries: expected 2, actual 0
unsupported math node overline
```

The current extractor was also directly audited before the fix:

```text
95 source-visible w:object/w:pict/w:drawing runs existed but were serialized as empty text runs.
```

The original false-green strict comparator was reproduced; after the independent comparator replaced it, the initial honest RED was:

```text
0/66 tables geometry matched; 66 border-run mismatches
```

The internal-grid regression then correctly failed because the first six-column implementation had removed two required fields:

```text
locator.fill: waiting for [data-k="assay.smpA.2.1"]
```

That drove the source-faithful off-page continuation described above. Intermediate strict passes progressed from `8/66`, to `62/66`, to `64/66`, to `65/66`, then to `66/66`; no tolerance was changed.

Final GREEN focused commands/output:

```text
pwsh -NoProfile -File tests/test_gc_word_recovery.ps1
PASS: temp .doc recovery is manifest- and signature-gated; unrelated failures rethrow unchanged

pwsh -NoProfile -File tests/test_gc_word_ooxml_order.ps1
PASS: synthetic OOXML preserves text-math-text order in paragraphs and cells

node tests/test_gc_word_embedded_objects.mjs
PASS: 95 reviewed legacy Word objects convert to safe semantic AST and unknown objects fail closed

node tests/test_gc_word_asset_privacy.mjs
PASS: browser-loaded GC Word assets contain runtime data only

python tests/test_gc_word_visible_geometry.py
PASS: visible geometry derives independent grid/border/indent evidence and splits public/private data

python tools/compare_gc_table_images.py --self-test
SELF-TEST GREEN: normalized pixels, exact semantic content, and independent 1px border evidence are strict

node tests/test_gc_word_layout_data.mjs --require-extract --require-asset --require-builder
33 precise layouts; 0 unresolved bindings

node tests/test_gc_word_table_renderer.mjs
PASS: pure GC Word-table renderer: geometry, runs, math, bindings, escaping, and fail-closed styles

node tests/test_gc_templates.mjs
PASS: 1037 个液相模板/603 条记录，33 个气相模板，方法分离、标准原文及计算

node tests/test_initialize.mjs
PASS: 九个项目初始化按钮均能清空检验数据并保留当前模板标准
```

## Fresh extraction/build/export/QA evidence

Extraction:

```powershell
pwsh -NoProfile -File tools/extract_gc_word_tables.ps1 `
  -WorkspaceRoot "C:\Users\37475\Desktop\含量计算\tcm-lab-calculators\.worktrees\gc-word-table-fidelity" `
  -OutputPath "tools\gc-word-table-extract.json"
```

```text
Extracted 33 templates / 66 tables; 0 errors
embedded objects=95
temp recoveries=2 reviewed templates
```

The table structural hash is canonicalized over the current table structure, with reviewed visible-object containers represented by a stable token. The 95 source-object hashes are separately derived from their reviewed source identity, semantic category and container category; raw volatile Word relationship/object IDs cannot invalidate a clean repeat extraction.

Build audit:

```text
AUDIT: 33 templates; 0 reviewed; 0 unresolved
reviewed 33 unresolved 0
EMITTED: 33 layouts; 33 reviewed; 0 unresolved
```

Word export:

```powershell
pwsh -NoProfile -File tools/export_gc_word_reference_tables.ps1 `
  -Manifest tools/gc-word-table-manifest.json `
  -OutputDir output/gc-word-layout-audit
```

```text
Exported 66/66 Word tables to ...\visual-qa-20260831-025550; errors=0
```

Derivation and private/public split:

```powershell
python tools/derive_gc_word_visible_geometry.py `
  --input output/gc-word-layout-audit/visual-qa-20260831-025550 `
  --manifest tools/gc-word-table-manifest.json `
  --public-output assets/gc-word-table-visible-geometry.js `
  --private-output output/gc-word-layout-audit/visual-qa-20260831-025550/visible-geometry-private.json
```

```text
Derived 33 templates / 66 tables
```

Final browser capture and strict comparison:

```powershell
node tools/capture_gc_web_tables.mjs --output output/gc-word-layout-audit
python tools/compare_gc_table_images.py --input output/gc-word-layout-audit --strict
```

```text
Captured 33 templates / 66 tables in ...\visual-qa-20260831-025550
66/66 tables geometry matched; 0 border-run mismatches; 0 indent mismatches; 0 cell-wrap mismatches; 0 exact-content mismatches; warnings=0; unexpected dirs=0
```

## Source read-only, hash and recovery evidence

All 66 Word sidecars and all 28 unique source files were checked:

```text
tables=66
uniqueSources=28
sourceSha256Before == sourceSha256After: true for 66/66
current source hash == exported pre-open hash: true for 28/28
sourceReadOnly=true: 66/66
exactOneTable=true and visibleOutsideTable=false: 66/66
```

Exactly four table exports used recovery, corresponding to two tables in each of the two reviewed mislabeled sources:

```text
29701千年健成品检验记录3.docx tables 8/9
46801鸦胆子成品检验记录.docx tables 6/7
reason=ole-compound-doc-with-docx-extension
temporarySuffix=.doc
```

All other sources opened directly read-only. The negative recovery tests proved that an unrelated open failure and a `.docx` with the ordinary ZIP signature perform one open, zero copies and re-throw the original message unchanged.

## Public-asset privacy evidence

```text
node tests/test_gc_word_asset_privacy.mjs
PASS: browser-loaded GC Word assets contain runtime data only
```

Additional direct scans found no drive-qualified path, source filename/hash, `visual-qa`/`output` path, raw Word XML, OLE/VML marker or embedded binary marker in either browser-loaded GC data asset.

## Manual visual inspection

Generated and opened:

- `overlay-contact-sheet.png` — 66 labeled tiles, all source/web captures present, no blank tile and no whole-table offset pattern;
- `diff-contact-sheet.png` — 66 labeled tiles, expected font-raster/antialias ink remains visible, with no missing row/column frame or shifted-grid pattern;
- representative original-resolution overlays for:
  - `patchouli-patchoulol/reference` — correction-factor fraction, S/R subscripts and result cell present;
  - `patchouli-patchoulol/sample` — six-column Word-visible frame plus sample mean overline present;
  - `brucea-oleic/sample` — nonuniform main grid and clipped row-8 overhangs present;
  - `mugwort-eucalyptol/reference` — barred `A` with `对` subscript present;
  - `mugwort-eucalyptol/sample` — barred sample average and barred mean present.

The contact sheets were manually inspected after the final strict run. The JSON strict result remains the authoritative quantitative gate; visual inspection confirmed there was no missing source-visible semantic object or structural border pattern hidden by the aggregate counts.

## Full repository regression

Final fresh run:

```text
node tests/test_environment.mjs
PASS: 公共跨设备一致、手机电脑可见、星期日空行、季节智能及本机记录保留均正常

node tests/test_gc_word_layout_data.mjs --require-extract --require-asset --require-builder
33 precise layouts; 0 unresolved bindings

node tests/test_gc_word_table_renderer.mjs
PASS: pure GC Word-table renderer: geometry, runs, math, bindings, escaping, and fail-closed styles

node tests/test_gc_templates.mjs
PASS: 1037 个液相模板/603 条记录，33 个气相模板，方法分离、标准原文及计算

node tests/test_identification_projects.mjs
PASS: 2177 条显微/薄层/理化模板、搜索选择、原料成品分离及填写状态

node tests/test_initialize.mjs
PASS: 九个项目初始化按钮均能清空检验数据并保留当前模板标准

node tests/test_quality_search.mjs
PASS: 3893 条质量项目模板、先选品名再选模板、标准原文及水分方法分支

node tests/test_sulfur_dioxide.mjs
PASS: 1545 个二氧化硫模板、滴定校正、计算、判定及初始化
```

`git diff --check` completed with no whitespace errors. The CRLF notices emitted by Git are repository line-ending conversion notices, not diff-check failures.

## Self-review

- Scope: only GC precise Word tables, their extraction/build/runtime/QA paths and focused tests changed. The calculation expressions in `computeAssay()` were not changed.
- Mapping: still 33 templates, 28 records and 66 tables; manifest table indices are unchanged.
- Business fields: existing `assay.*` keys remain the sole state mechanism; source injection counts remain unchanged, including internal sample analyte 3+3 and internal-standard 2+2.
- Formula result: `assay.out.factor` moved from the duplicate external system-control output into the reviewed source table cell; calculation and formatting are unchanged.
- Failure behavior: unknown run children, unknown object identity/hash, unknown AST node, missing/sentinel indent evidence, stale private provenance and source/web mismatches all stop generation or strict acceptance.
- Privacy: no source-private path/hash/recovery/binary/XML data is browser-loaded.
- Recovery: manifest and binary signature must both match; unrelated open errors are not retried.
- Source safety: 28/28 source hashes are unchanged and source documents were opened read-only.
- Threshold: `TOLERANCE` remains exactly `1.0`; no mismatch was converted to a warning.
- QA independence: source border expectations are current Word PNG evidence held privately; browser runtime data is validated separately and never serves as its own expected comparator input.
- Artifacts: source Word files were not modified, saved, renamed or overwritten; ignored QA artifacts remain under the fresh run directory; transient `tools/__pycache__` was removed and `__pycache__/` is ignored.
- Delivery: no merge, rebase, push or remote mutation was performed.

## Remaining concerns

None blocking. Font rasterization and antialiasing remain visibly different between Word and Chromium, as permitted by the design. Geometry, border segments, indent, wrapping, content presence and exact fixed semantic content are all independently strict and green.
