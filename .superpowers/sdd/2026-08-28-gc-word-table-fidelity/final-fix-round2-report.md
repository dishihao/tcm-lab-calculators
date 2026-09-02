# GC Word-table user-authorized final fix wave 2 report

Date: 2026-09-01

Status: **DONE**

Fix base: `6c9836eff1e76eb42d16e0a3024cec010413064b`

Branch: `feature/gc-word-table-fidelity`

Commit: the local commit containing this report and the round-two implementation; no merge or push was performed.

## Outcome

The three authorized residual findings are corrected without changing the previously accepted border/indent/recovery behavior, assay calculations, state keys, standards, limits, rounding, HPLC/custom/manual paths, non-GC pages, the 33-template/28-record/66-table mapping, or the strict 1 CSS px threshold.

Fresh authoritative QA directory:

`output/gc-word-layout-audit/visual-qa-20260901-072039`

Final strict output:

```text
66/66 tables geometry matched; 0 border-run mismatches; 0 indent mismatches; 0 cell-wrap mismatches; 0 exact-content mismatches; warnings=0; unexpected dirs=0
```

`summary.json` additionally records:

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

Runtime/public:

- `assets/gc-record-table-layouts.js`
- `assets/gc-word-table-renderer.js`
- `index.html`

Extraction/build/private QA:

- `tools/extract_gc_word_tables.ps1`
- `tools/gc-word-embedded-object-semantics.json`
- `tools/build_gc_word_layouts.mjs`
- `tools/export_gc_word_reference_tables.ps1`
- `tools/gc_word_rendered_semantic_capture.js`
- `tools/capture_gc_web_tables.mjs`
- `tools/compare_gc_table_images.py`

Tests:

- `tests/test_gc_word_source_object_auth.ps1`
- `tests/test_gc_word_rendered_semantics.mjs`
- `tests/test_gc_word_embedded_objects.mjs`
- `tests/test_gc_word_asset_privacy.mjs`
- `tests/test_gc_word_layout_data.mjs`
- `tests/test_gc_word_table_renderer.mjs`
- `tests/test_gc_templates.mjs`
- `tests/test_initialize.mjs`

Reports:

- `.superpowers/sdd/2026-08-28-gc-word-table-fidelity/final-fix-report.md`
- `.superpowers/sdd/2026-08-28-gc-word-table-fidelity/final-fix-round2-report.md`

## Residual 1A — actual source-derived object authentication

### Root cause confirmed

The prior approval loop recomputed `objectHash` from registry-controlled identity/type labels. The table canonicalizer replaced every visible object with the same token and candidate object payload/anchor evidence was not compared to the registry. A replacement in the same broad category could therefore pass.

### Corrected design

Each actual source object now produces private evidence containing:

- template ID;
- table role;
- private source table index;
- actual source cell ID;
- actual source identity including cell and object ordinal;
- exact container category (`embedded-equation` or `floating-overline`);
- actual container type;
- stable source-derived digest;
- linked payload digests retained only in ignored extraction/audit evidence.

The source digest is computed from:

1. canonical actual object metadata/XML;
2. every linked relationship payload resolved from current `document.xml.rels`;
3. SHA-256 of linked OLE binary and preview/image bytes;
4. the container category.

Only demonstrably volatile identifiers are removed from canonical metadata: namespace declarations, relationship references and Word-generated object/shape/anchor/edit identifiers (`id`, `spid`, `ShapeID`, `ObjectID`, `embed`, `link`, `anchorId`, `editId`). Relationship IDs are not merely deleted: they are resolved first and the linked payload bytes are authenticated by digest.

The table structural hash may collapse a visible object only because object payloads are now authenticated separately by exact source evidence; the old `E(reviewed-visible-object)` token and the registry-derived `gc-word-visible-object-v1` hash path were removed.

The reviewed registry contains exactly 95 entries with:

```text
95 unique sourceIdentity values
66 embedded-equation objects
29 floating-overline objects
12 distinct sourceDigest values (identical source objects legitimately share payload/metadata digests)
```

For normal extraction, `Assert-ReviewedSourceObjects` requires exact count and one-to-one identity matching, then compares template, role, private table index, source cell, category and digest before emitting any approved semantic object. Duplicate/lost/moved/replaced/unknown evidence hard-fails extraction.

An explicit `-ObjectEvidenceAuditPath` mode emits ignored private evidence for registry review and never emits a normal approved extract. Normal extraction cannot bypass registry authentication.

### RED/GREEN evidence

Initial RED:

```text
pwsh -NoProfile -File tests/test_gc_word_source_object_auth.ps1
Get-SourceObjectEvidence: The term 'Get-SourceObjectEvidence' is not recognized
```

Final GREEN:

```text
PASS: source-derived embedded-object digests authenticate payload, identity, cell, table and role; mutations/moves/duplicates/loss fail closed
```

Negative fixtures prove failure for:

- changed OLE binary payload;
- replaced object dimensions/metadata;
- changed floating-line geometry;
- moved object/source cell identity;
- duplicate object;
- lost object;
- unknown digest;
- wrong template;
- wrong role;
- wrong private table index.

They also prove that changing only a relationship ID, OLE ObjectID or VML line ID does not change the stable digest.

Current source audit/extraction:

```text
Audited 95 source objects; 0 errors
Extracted 33 templates / 66 tables; 0 errors
```

Two separate audited opens plus repeated normal extractions authenticated the same registry. Modern DrawingML `anchorId`/`editId` variance was reproduced and removed only after confirming it was Word-generated identity noise; actual line geometry remains in the digest.

## Residual 1B — render-derived exact semantic QA

### Root cause confirmed

The prior chain was circular:

```text
builder cell.semanticContent
→ renderer data-fixed-semantic
→ capture fixedSemantic
→ comparator source declaration
```

A broken fraction, overline, subscript or DOM order could pass while the declaration remained correct.

### Corrected design

- `semanticContent` is private builder state and is stripped from the public asset.
- The renderer no longer emits `data-fixed-semantic` or any equivalent declaration.
- `tools/gc_word_rendered_semantic_capture.js` is a QA-only closed DOM parser injected by the capture tool; it is not browser-loaded in production.
- The parser walks actual visible DOM nodes in order and derives canonical semantics from:
  - visible text leaves;
  - computed `text-decoration-line: overline`;
  - exact fraction numerator/denominator child structure;
  - a visible denominator border rule;
  - native `<sub>` structure;
  - native `<sup>` structure;
  - nesting and order.
- Hidden semantic ink, an unknown `word-math-*` class, a fraction component outside a fraction, a missing/duplicated numerator/denominator, or a missing fraction bar throws during capture.
- Capture records `renderedSemantic` derived from the actual DOM. It never reads a semantic declaration attribute.
- The source Word sidecar records `renderedSemanticExpected` for exactly 95 reviewed source objects, derived privately from the reviewed registry/current extraction.
- Comparator compares only `renderedSemanticExpected` against actual `renderedSemantic` and hard-fails absence, text mutation, node mutation, order mutation or structural mutation.

The actual final capture contains no `fixedSemantic` field. Ninety-five source cells have private rendered-semantic expectations; the parser also observes ordinary source sub/sup formatting in other cells, but only the reviewed 95 objects are exact-object acceptance targets.

### RED/GREEN evidence

Initial RED:

```text
node tests/test_gc_word_rendered_semantics.mjs
AssertionError: render-derived semantic capture parser is required
```

Unit GREEN:

```text
PASS: semantic QA derives overline/fraction/subscript/superscript/text/order from rendered DOM and ignores stale declarations
```

The negative browser fixture deliberately retains a correct-looking stale `data-fixed-semantic` while independently breaking:

- overline style;
- overline node presence;
- fraction numerator/structure;
- fraction bar;
- subscript node;
- superscript node;
- node order;
- visible text leaf.

All cases fail capture or canonical comparison. Comparator self-tests additionally mutate every node category, order and object presence while retaining the stale declaration field and require exactly one hard mismatch.

The new gate found a real integration error on its first fresh run:

```text
66/66 geometry matched; 4 exact-content mismatches
```

The four amomum sample-mean cells split `（`, `%`, `）` into separate Word runs. The builder's old insertion search did not recognize the split suffix, so the rendered overline appeared after the percent suffix. A new asset-level regression was watched RED, insertion was corrected to place the math node before the first opening-parenthesis run, and the final render-derived strict gate returned zero mismatches. This demonstrates that the new gate is inspecting real DOM order rather than trusting a declaration.

## Residual 4 — source table provenance removed from public data and DOM

### Root cause confirmed

`sourceTableIndex` was present in the browser layout and `data-source-table-index` was emitted and asserted by browser tests.

### Corrected design

- Public asset emission strips `sourceTableIndex`, `sourceTableNumber`, `sourceTableId` equivalents and all object/source digest fields.
- The renderer no longer requires a source table index and emits no `data-source-table-*` attribute.
- Runtime tables expose only public-safe routing keys:
  - `data-word-template-id`;
  - `data-word-table-role`.
- Template switching, initialization and browser routing tests now assert template ID plus role and explicitly reject a source-index DOM attribute.
- Private joins remain in:
  - `tools/gc-word-table-manifest.json`;
  - ignored extraction JSON;
  - ignored Word export JSON;
  - ignored private geometry/provenance JSON.
- Layout data tests compare the private extract indices to the manifest for all 33 templates/66 tables.
- Comparator checks every current Word sidecar's private source index against the manifest before comparison.

### RED/GREEN evidence

Initial RED:

```text
node tests/test_gc_word_asset_privacy.mjs
GC_WORD_TABLE_LAYOUTS.patchouli-patchoulol.referenceTable.sourceTableIndex: QA-only key leaked
```

Final GREEN:

```text
PASS: browser-loaded GC Word assets contain runtime data only
```

Direct scans of both browser-loaded GC data assets and the renderer find none of:

```text
sourceTableIndex
sourceTableNumber
sourceTableId
sourceIdentity
sourceDigest
sourceCellId
payloadDigests
data-source-table-index
data-fixed-semantic
```

## Fresh extraction/build/export/strict evidence

### Extraction and reviewed build

```powershell
pwsh -NoProfile -File tools/extract_gc_word_tables.ps1 `
  -WorkspaceRoot "C:\Users\37475\Desktop\含量计算\tcm-lab-calculators\.worktrees\gc-word-table-fidelity" `
  -OutputPath tools\gc-word-table-extract.json
```

```text
Extracted 33 templates / 66 tables; 0 errors
```

```text
AUDIT: 33 templates; 0 reviewed; 0 unresolved
EMITTED: 33 layouts; 33 reviewed; 0 unresolved
```

### Fresh Word export

```text
Exported 66/66 Word tables to ...\visual-qa-20260901-072039; errors=0
```

### Public/private geometry derivation

```text
Derived 33 templates / 66 tables
public=assets/gc-word-table-visible-geometry.js
private=...\visual-qa-20260901-072039\visible-geometry-private.json
```

### Final capture and strict comparison

```text
Captured 33 templates / 66 tables in ...\visual-qa-20260901-072039
66/66 tables geometry matched; 0 border-run mismatches; 0 indent mismatches; 0 cell-wrap mismatches; 0 exact-content mismatches; warnings=0; unexpected dirs=0
```

No threshold was changed and no mismatch became a warning.

## Source safety and recovery evidence

Fresh sidecar/current-file audit:

```text
tables=66
unique source files=28
sourceSha256Before == sourceSha256After: true for 66/66
current source hash == pre-open source hash: true for 28/28
sourceReadOnly=true: 66/66
exact intended table boundary: 66/66
temporary recoveries=4 table exports from exactly 2 reviewed mislabeled files
```

The accepted recovery implementation and its tests were not loosened. The two reviewed files remain:

- `29701千年健成品检验记录3.docx`, tables 8/9;
- `46801鸦胆子成品检验记录.docx`, tables 6/7.

All other sources opened directly read-only.

## Manual visual inspection

Opened and inspected after the final strict run:

- `overlay-contact-sheet.png`: all 66 labeled tiles present, no blank capture or whole-table offset pattern;
- `patchouli-patchoulol/reference/overlay.png`: correction-factor fraction and S/R subscripts present;
- `mugwort-eucalyptol/reference/overlay.png`: barred reference `A` plus `对` subscript present;
- `mugwort-eucalyptol/sample/overlay.png`: barred sample average and barred mean present;
- `amomum-bornyl-acetate/sample/overlay.png`: barred mean is now before the percent suffix;
- Brucea/internal-table tiles retain the previously accepted nonuniform grid, clipped border overhang and reachable off-page source cells.

Font raster/antialias differences remain permitted; no structural or semantic omission was observed.

## Final focused and full regression outputs

```text
pwsh -NoProfile -File tests/test_gc_word_source_object_auth.ps1
PASS: source-derived embedded-object digests authenticate payload, identity, cell, table and role; mutations/moves/duplicates/loss fail closed

pwsh -NoProfile -File tests/test_gc_word_recovery.ps1
PASS: temp .doc recovery is manifest- and signature-gated; unrelated failures rethrow unchanged

pwsh -NoProfile -File tests/test_gc_word_ooxml_order.ps1
PASS: synthetic OOXML preserves text-math-text order in paragraphs and cells

node tests/test_gc_word_rendered_semantics.mjs
PASS: semantic QA derives overline/fraction/subscript/superscript/text/order from rendered DOM and ignores stale declarations

node tests/test_gc_word_embedded_objects.mjs
PASS: 95 reviewed legacy Word objects convert to safe semantic AST and unknown objects fail closed

node tests/test_gc_word_asset_privacy.mjs
PASS: browser-loaded GC Word assets contain runtime data only

python tests/test_gc_word_visible_geometry.py
PASS: visible geometry derives independent grid/border/indent evidence and splits public/private data

python tools/compare_gc_table_images.py --self-test
SELF-TEST GREEN: normalized pixels, exact semantic content, and independent 1px border evidence are strict

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

`git diff --check` completed without whitespace errors. Git's CRLF conversion notices are not diff-check failures.

## Self-review

- Scope is limited to the three authorized residuals plus regenerated public assets/evidence.
- Previously accepted border, indent, off-page input, recovery and source-read-only implementations were preserved.
- No calculation expression, field count, `assay.*` state key, standard, limit or rounding rule changed.
- All 95 objects authenticate actual source evidence before semantic AST publication.
- Raw OOXML, OLE/VML/drawing data, relationship IDs, payload digests, source digests, source identities, source cells, file paths and source table indices remain private.
- The semantic comparator uses real rendered DOM/style, not a builder/renderer declaration.
- Unknown source objects, unknown AST nodes, unknown DOM math classes and malformed fractions fail closed.
- Runtime/public joins use template ID plus role; private tooling retains source indices and checks them against the manifest.
- Public assets and DOM contain no source table index or equivalent.
- Strict `TOLERANCE` remains `1.0`; zero warning-only exclusions remain.
- 28/28 current source files retain their pre-export hashes.
- No merge, rebase, push or remote mutation was performed.

## Remaining concerns

None blocking. Identical source equations/line objects legitimately share one of 12 source-derived payload/metadata digests, while their 95 source identities/cells/table roles provide the required one-to-one location binding. Font rasterization differences remain within the design's permitted visual exception; exact rendered semantic structure and all table geometry are strict and green.

## Authorized visibility-continuation repair — 2026-09-02

Continuation base: `d3a84c00ae2fa6473c65d1d25afece99ab2c21d1`

### Reproduced defect

The round-two DOM parser authenticated semantic node type/order and direct `display`/`visibility`, but structurally correct nodes could still self-certify without visible ink when hidden through:

- element or ancestor `opacity:0`;
- CSS `filter:opacity(0)`;
- transparent effective text color;
- transparent overline decoration color;
- transparent fraction-border color;
- hidden/display-none/content-hidden ancestor;
- zero-size geometry;
- full clipping by an overflow ancestor.

Initial live-Chrome RED:

```text
AssertionError: Missing expected rejection: opacity 0 semantic element self-certified with a stale declaration
```

Every negative fixture retained the stale `data-fixed-semantic` declaration so a declaration-based fallback could not satisfy the test.

### Focused fix

Only the QA-only parser and its live-browser test changed. Production rendering, assets, calculation/state code, extraction, source authentication, public privacy, border/indent geometry and recovery were untouched.

The parser now fails closed unless semantic ink has all of the following:

- every element and ancestor has visible `display`, `visibility` and `content-visibility`;
- multiplied element/ancestor opacity and `filter:opacity()` remain greater than zero;
- effective text color has nonzero alpha;
- overline `text-decoration-color` has nonzero alpha;
- fraction border style/width/color describe a visible rule;
- text, overline, fraction, subscript and superscript nodes have measurable nonzero client/range rectangles;
- at least part of each semantic ink/rule rectangle survives every ancestor `overflow-x`/`overflow-y` clipping intersection;
- unsupported `clip-path` or legacy CSS `clip` fails closed rather than being guessed.

Viewport position itself is not treated as invisibility because the production tables are intentionally scrollable; CSS clipping ancestors are authoritative.

Live Chromium negative cases now cover:

- semantic-element opacity zero;
- transparent semantic text;
- transparent overline rule;
- transparent fraction bar;
- transparent ancestor;
- display-none ancestor;
- visibility-hidden ancestor;
- filter-opacity-zero ancestor;
- transparent inherited text ancestor;
- zero-size semantic ink;
- semantic ink positioned fully outside an overflow-hidden ancestor.

The existing overline/fraction/subscript/superscript/text/order/nesting/omission cases remain.

Focused GREEN:

```text
PASS: semantic QA derives visible overline/fraction/subscript/superscript/text/order ink from rendered DOM and rejects transparent/hidden/zero/clipped ink despite stale declarations
```

Capture/comparator self-tests:

```text
SELF-TEST GREEN: fixed-Chrome sub/sup counted once; empty double-bordered cell counted 0; genuine two-line wrap counted 2
SELF-TEST GREEN: normalized pixels, exact semantic content, and independent 1px border evidence are strict
```

### Fresh authoritative capture/strict evidence

The existing fresh Word export and private source sidecars under `visual-qa-20260901-072039` were unchanged. A new browser capture was generated with the hardened parser and compared strictly:

```text
Captured 33 templates / 66 tables in ...\visual-qa-20260901-072039
66/66 tables geometry matched; 0 border-run mismatches; 0 indent mismatches; 0 cell-wrap mismatches; 0 exact-content mismatches; warnings=0; unexpected dirs=0
```

`summary.json` remains:

```text
tablesCompared=66
geometryMatched=66
shiftedBorders=0
indentMismatches=0
wrapMismatches=0
contentPresenceMismatches=0
exactContentMismatches=0
warningOnlyExclusions=0
```

All focused GC Word tests and the existing environment, GC/HPLC, identification, initialization, quality-search and sulfur-dioxide regression suites passed. `git diff --check` remained clean.

### Continuation self-review and concerns

- The change is confined to `tools/gc_word_rendered_semantic_capture.js`, `tests/test_gc_word_rendered_semantics.mjs` and this report.
- Antialiasing differences remain permitted; the parser gates existence/visibility/structure of ink, not raster color similarity.
- Partially clipped but still measurable ink remains valid; fully clipped or zero-area ink fails.
- Stale declaration attributes are never read by the capture path.
- No source file, public asset, runtime renderer, calculation, manifest mapping, threshold or recovery behavior changed.
- No merge or push was performed.

Remaining concerns: none.
