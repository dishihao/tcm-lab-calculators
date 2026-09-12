# 表格显示：数据居中、未选品种不出表格、去掉显微薄层理化

整理日期：2026-09-12。

## 1. 表格数据居中

原记录表格的填写值与计算结果原来继承源 Word 段落的对齐方式（同一张表里有的靠左、有的靠右），
看起来参差不齐。现在 `.word-record-table .word-cell-input` 与 `.word-cell-output` 统一 `text-align:center`，
每个数据格的内容都与列中心对齐（`tests/test_table_display.mjs` 逐个量测数据格与单元格的中心偏差 < 2px）。

源记录里的固定文字、行标签仍按原表对齐，不改动。

数据同时加粗并放大 6%（`font-size:1.06em; font-weight:700`），按现有配色区分来源：
**手写蓝 #12369e = 本批填写值**、**结果红 #b3271e = 网页计算结果**、**黑体 = 标准或原记录固定值**。
通用计算表的填写格也一并加粗放大（17px）。打印时仍统一转黑，不受影响。

## 2. 未选品种不出表格

杂质、水分、总灰分、浸出物、二氧化硫、含量测定六个项目：没有选择品种（成分模板）时不再渲染
任何数据表，只显示一句提示“请先选择品名和原料/成品模板……”。选定品种后才出现该品种原记录的
填写与计算表格、公式、修约位数和判定。

含量测定页的“套用自定义品种”仍算选定品种（会显示通用表），只有既没有模板也没有自定义品种名时才不出表。

## 3. 去掉显微、薄层、理化

三个鉴别项目的页签、页面和初始化按钮全部去掉，`index.html` 也不再加载
`identification-templates.js`（2.6 MB）与 `identification-record-tables.js`。
`assets/app.js` 保留这部分的模板与渲染代码，用 `IDENTIFICATION_TABS_ENABLED = false` 控制；
恢复时改成 `true` 并加回两个脚本即可。模板数据（2177 条）仍在仓库里，由
`tests/test_identification_removed.mjs` 离线校验完整。

## 验证

`tests/test_table_display.mjs`（未选品种不出表格、选定后出表格、数据居中）、
`tests/test_identification_removed.mjs`（页签与资产已去掉、模板数据完整）、
`tests/test_initialize.mjs`（初始化按钮覆盖当前六个项目）连同其余测试全部通过。
