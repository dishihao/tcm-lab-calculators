# Task 7A - GC Word-table geometry/content repair report

Status: verified and ready to commit. The strict gate now passes on a fresh 66-table Word export and browser capture without relaxing the 1 CSS px threshold.

## Baseline

Trusted baseline: `output/gc-word-layout-audit/visual-qa-20260829-154521/summary.json`.

- 66 expected and paired tables; 0 geometry matches.
- 0 border mismatches and 0 true-wrap mismatches.
- 66 content-presence mismatches because Word-empty exact-GC outputs were rendered as `—`.

Representative crop metrics before changes:

| template / role | Word CSS px | Web CSS px |
| --- | ---: | ---: |
| amomum-bornyl-acetate / reference | 660 x 237 | 660 x 201 |
| amomum-bornyl-acetate / sample | 660 x 333 | 659 x 318 |
| patchouli-patchoulol / reference | 661 x 361 | 660 x 317 |
| patchouli-patchoulol / sample | 661 x 397 | 892 x 383 |
| brucea-oleic / sample | 718 x 397 | 899 x 383 |

## RED Evidence

Initial Task 7A RED, before production changes:

```text
node tests/test_gc_templates.mjs
Error: amomum-bornyl-acetate:reference: Word 可见表高错误 199.6875 != 237
```

Finalizer RED checks added for the remaining review findings:

```text
node tests/test_gc_templates.mjs
Error: amomum-bornyl-acetate:reference 缺少 Word 源单元格行数策略
```

```text
python tools/compare_gc_table_images.py --self-test
NameError: name 'validate_visible_asset_entry' is not defined
```

```text
python tools/compare_gc_table_images.py --self-test
AssertionError: screenshot pixel rounding was used instead of DOM outer geometry
```

## Fix Summary

- Renderer now uses source table/cell padding, source paragraph/default-run styles for bound controls, source-visible row heights, and content-box row minima that subtract vertical padding/border contribution once, including row-spanning cells.
- Exact preset GC output cells start blank when uncomputed; generic HPLC and custom GC still use `—`.
- The companion visible-geometry asset now includes 33 templates / 66 roles with `sourceFile`, `sourceTableIndex`, `sourceSha256`, `renderWidthPt`, `renderScale`, `renderGridPt`, `renderHeightPt`, and `sourceTextLineCounts`.
- The derivation tool copies source text line counts from the Word sidecar so source-authoritative one-line cells such as `对照品浓度C对（mg/ml）` and `对照品进样量V对（μl）` stay unwrapped, while genuine Word wraps are preserved.
- The browser capture keeps structural `isGridGap` cells in the HTML table for occupancy, but excludes them from semantic source-data-cell presence matching; the cells remain empty, borderless, and `aria-hidden`.
- The strict comparator now rederives visible geometry from the current Word PNG/sidecar on every run, validates the companion asset against source file/index/hash and render geometry, then compares with the independently derived geometry. This removes renderer-asset circular expectations.
- Table crop geometry uses the captured DOM outer rectangle for the browser side because Playwright element screenshots round fractional CSS boxes to integer PNG dimensions; row, column, cell, border, wrap, and content checks still use the strict 1 CSS px comparator path.

## GREEN Evidence

Focused and existing suites:

```text
node tests/test_gc_templates.mjs
PASS: 1037 个液相模板/603 条记录，33 个气相模板，方法分离、标准原文及计算

node tests/test_gc_word_table_renderer.mjs
PASS: pure GC Word-table renderer: geometry, runs, math, bindings, escaping, and fail-closed styles

node tests/test_gc_word_layout_data.mjs --require-asset --require-builder
33 precise layouts; 0 unresolved bindings

node tests/test_initialize.mjs
PASS: 九个项目初始化按钮均能清空检验数据并保留当前模板标准

node tests/test_environment.mjs
PASS: 公共跨设备一致、手机电脑可见、星期日空行、季节智能及本机记录保留均正常

node tests/test_identification_projects.mjs
PASS: 2177 条显微/薄层/理化模板、搜索选择、原料成品分离及填写状态

node tests/test_quality_search.mjs
PASS: 3893 条质量项目模板、先选品名再选模板、标准原文及水分方法分支

node tests/test_sulfur_dioxide.mjs
PASS: 1545 个二氧化硫模板、滴定校正、计算、判定及初始化

pwsh -NoProfile -File tests/test_gc_word_ooxml_order.ps1
PASS: synthetic OOXML preserves text-math-text order in paragraphs and cells

node tools/capture_gc_web_tables.mjs --self-test
SELF-TEST GREEN: fixed-Chrome sub/sup counted once; empty double-bordered cell counted 0; genuine two-line wrap counted 2

python tools/compare_gc_table_images.py --self-test
SELF-TEST GREEN: 144-DPI Lanczos normalized fixture matches; 2 CSS-px border shift; one-line/double-border, empty-cell, and two-line semantic text fixtures verified; unavailable metric is warning-only
```

Fresh full Word/export/capture/strict run:

```text
pwsh -NoProfile -File tools/export_gc_word_reference_tables.ps1 -Manifest tools/gc-word-table-manifest.json -OutputDir output/gc-word-layout-audit
Exported 66/66 Word tables to C:\Users\37475\Desktop\含量计算\tcm-lab-calculators\.worktrees\gc-word-table-fidelity\output\gc-word-layout-audit\visual-qa-20260830-015500; errors=0

python tools/derive_gc_word_visible_geometry.py --input output/gc-word-layout-audit/visual-qa-20260830-015500 --manifest tools/gc-word-table-manifest.json --output assets/gc-word-table-visible-geometry.js --javascript

node tools/capture_gc_web_tables.mjs --output output/gc-word-layout-audit
Captured 33 templates / 66 tables in C:\Users\37475\Desktop\含量计算\tcm-lab-calculators\.worktrees\gc-word-table-fidelity\output\gc-word-layout-audit\visual-qa-20260830-015500

python tools/compare_gc_table_images.py --input output/gc-word-layout-audit --strict
66/66 tables geometry matched; 0 border-run mismatches; 0 cell-wrap mismatches; 0 content-presence mismatches; unexpected dirs=0
```

Strict summary for `visual-qa-20260830-015500`:

- `tablesExpected`: 66
- `tablesCompared`: 66
- `geometryMatched`: 66
- `shiftedBorders`: 0
- `wrapMismatches`: 0
- `contentPresenceMismatches`: 0
- `missing`: []
- `unexpectedDirectories`: []

## Visual Artifacts

- 66 overlay images and 66 diff images were produced by strict compare.
- Generated and inspected `overlay-contact-sheet.png` and `diff-contact-sheet.png` under `output/gc-word-layout-audit/visual-qa-20260830-015500`.
- Contact-sheet inspection found all captures present, with no blank table capture or visible whole-table offset pattern. The strict JSON summary remains the authoritative pass/fail result.

## Notes

- The first fresh export attempt, `visual-qa-20260830-015051`, reached 65/66 and failed on `clove-eugenol/reference` during Word COM sidecar extraction after writing `reference-word.png`. A clean rerun completed 66/66 with source read-only and temp cleanup true; no source mutation occurred.
- No tolerance relaxation was introduced. The comparator threshold remains `TOLERANCE = 1.0`.

## Fix Round 1 - Font metrics

Review finding: `renderScale` is horizontal-only and must not scale source Word font size or vertical line boxes in the four page-scaled internal-standard sample tables.

RED:

```text
node tests/test_gc_templates.mjs
Error: patchouli-patchoulol: 样品表源标签字号不能按 renderScale 缩小 10.3855
```

Follow-up RED after removing font-size scaling exposed the paragraph line-box issue:

```text
node tests/test_gc_templates.mjs
Error: patchouli-patchoulol: 样品表源标签行高必须保持 Word 10.5pt x 1.5 22.5
```

Fix:

- Removed `font-size * table.renderScale`; source run font size is emitted unchanged.
- Applied default run metrics to the source paragraph container so `line-height` resolves against the source Word font size, not the app body font.
- Kept horizontal `renderScale` for width/grid/indent; existing character spacing scaling remains isolated to horizontal spacing.
- Restored the strict full-table crop gate to compare independent Word PNG crop geometry against captured DOM outer geometry, while row/column/cell geometry continues to use source-derived visible grid data.

GREEN:

```text
node tests/test_gc_templates.mjs
PASS: 1037 个液相模板/603 条记录，33 个气相模板，方法分离、标准原文及计算

node tests/test_gc_word_table_renderer.mjs
PASS: pure GC Word-table renderer: geometry, runs, math, bindings, escaping, and fail-closed styles

node tests/test_gc_word_layout_data.mjs --require-asset --require-builder
33 precise layouts; 0 unresolved bindings

pwsh -NoProfile -File tools/export_gc_word_reference_tables.ps1 -Manifest tools/gc-word-table-manifest.json -OutputDir output/gc-word-layout-audit
Exported 66/66 Word tables to C:\Users\37475\Desktop\含量计算\tcm-lab-calculators\.worktrees\gc-word-table-fidelity\output\gc-word-layout-audit\visual-qa-20260830-021229; errors=0

python tools/derive_gc_word_visible_geometry.py --input output/gc-word-layout-audit/visual-qa-20260830-021229 --manifest tools/gc-word-table-manifest.json --output assets/gc-word-table-visible-geometry.js --javascript

node tools/capture_gc_web_tables.mjs --output output/gc-word-layout-audit
Captured 33 templates / 66 tables in C:\Users\37475\Desktop\含量计算\tcm-lab-calculators\.worktrees\gc-word-table-fidelity\output\gc-word-layout-audit\visual-qa-20260830-021229

python tools/compare_gc_table_images.py --input output/gc-word-layout-audit --strict
66/66 tables geometry matched; 0 border-run mismatches; 0 cell-wrap mismatches; 0 content-presence mismatches; unexpected dirs=0
```
