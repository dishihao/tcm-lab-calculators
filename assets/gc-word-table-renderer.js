/*
 * A deliberately dependency-free renderer for the approved GC Word-table
 * layout asset.  Application code owns controls and calculation state; this
 * module only turns an already-bound table shape into safe, fixed-point HTML.
 */
(function attachGcWordTableRenderer(window) {
  'use strict';

  const FONT_FAMILIES = Object.freeze({
    '宋体': 'SimSun',
    SimSun: 'SimSun',
    'Times New Roman': 'Times New Roman',
  });
  const BORDER_STYLES = Object.freeze({ single: 'solid', double: 'double', dotted: 'dotted', dashed: 'dashed' });
  const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify', 'distribute']);
  const VERTICAL_ALIGNS = new Set(['top', 'center', 'bottom']);
  const RUN_VERTICAL_ALIGNS = new Set(['subscript', 'superscript', 'baseline']);
  const LINE_RULES = new Set(['auto', 'exact', 'atLeast']);
  const DELIMITER_CHARACTERS = new Set(['(', ')', '[', ']', '{', '}', '|', '‖', '〈', '〉']);

  function contextOf(table, cellId = 'table') {
    return `templateId=${table?.templateId ?? 'unknown'} tableRole=${table?.tableRole ?? 'unknown'} cellId=${cellId}`;
  }

  function fail(table, cellId, message) {
    throw new Error(`${contextOf(table, cellId)} ${message}`);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function finiteNumber(value, table, cellId, property, { nonNegative = false } = {}) {
    if (!Number.isFinite(value) || (nonNegative && value < 0)) {
      fail(table, cellId, `invalid ${property}`);
    }
    return value;
  }

  function pt(value, table, cellId, property, options) {
    return `${finiteNumber(value, table, cellId, property, options)}pt`;
  }

  function integer(value, table, cellId, property, { positive = false } = {}) {
    if (!Number.isInteger(value) || (positive && value < 1)) fail(table, cellId, `invalid ${property}`);
    return value;
  }

  function ensureKnownObjectKeys(value, keys, table, cellId, property) {
    if (value == null) return;
    if (typeof value !== 'object' || Array.isArray(value)) fail(table, cellId, `invalid ${property}`);
    for (const key of Object.keys(value)) {
      if (!keys.has(key)) fail(table, cellId, `unsupported ${property}.${key}`);
    }
  }

  function cssColor(value, table, cellId, property) {
    if (value == null || value === 'auto') return '#000000';
    if (typeof value === 'string' && /^[0-9A-F]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
    fail(table, cellId, `unsupported ${property}`);
  }

  function renderBorder(border, side, table, cellId) {
    if (border == null) return '';
    ensureKnownObjectKeys(border, new Set(['value', 'sizePt', 'spacePt', 'color', 'themeColor', 'shadow', 'frame']), table, cellId, `border.${side}`);
    if (border.value === 'nil' || border.value === 'none') return `border-${side}:0`;
    const cssStyle = BORDER_STYLES[border.value];
    if (!cssStyle) fail(table, cellId, `unsupported border.${side} style`);
    const width = pt(border.sizePt ?? 0.5, table, cellId, `border.${side}.sizePt`, { nonNegative: true });
    return `border-${side}:${width} ${cssStyle} ${cssColor(border.color, table, cellId, `border.${side}.color`)}`;
  }

  function renderCellStyle(cell, table) {
    const styles = [];
    ensureKnownObjectKeys(cell.margins, new Set(['top', 'right', 'bottom', 'left']), table, cell.id, 'margins');
    if (cell.margins) {
      styles.push(`padding:${pt(cell.margins.top ?? 0, table, cell.id, 'margins.top', { nonNegative: true })} ${pt(cell.margins.right ?? 0, table, cell.id, 'margins.right', { nonNegative: true })} ${pt(cell.margins.bottom ?? 0, table, cell.id, 'margins.bottom', { nonNegative: true })} ${pt(cell.margins.left ?? 0, table, cell.id, 'margins.left', { nonNegative: true })}`);
    }
    ensureKnownObjectKeys(cell.borders, new Set(['top', 'right', 'bottom', 'left']), table, cell.id, 'borders');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const border = renderBorder(cell.borders?.[side], side, table, cell.id);
      if (border) styles.push(border);
    }
    if (cell.shading != null) {
      ensureKnownObjectKeys(cell.shading, new Set(['value', 'color', 'fill', 'themeColor', 'themeFill']), table, cell.id, 'shading');
      if (cell.shading.value !== 'clear' && cell.shading.value !== 'solid') fail(table, cell.id, 'unsupported shading value');
      styles.push(`background-color:${cssColor(cell.shading.fill, table, cell.id, 'shading.fill')}`);
    }
    if (cell.verticalAlign != null) {
      if (!VERTICAL_ALIGNS.has(cell.verticalAlign)) fail(table, cell.id, 'unsupported vertical alignment');
      styles.push(`vertical-align:${cell.verticalAlign}`);
    }
    if (cell.textDirection != null) fail(table, cell.id, 'unsupported text direction');
    if (cell.noWrap != null) {
      if (typeof cell.noWrap !== 'boolean') fail(table, cell.id, 'invalid noWrap');
      if (cell.noWrap) styles.push('white-space:nowrap');
    }
    if (cell.fitText != null && typeof cell.fitText !== 'boolean') fail(table, cell.id, 'invalid fitText');
    return styles.join(';');
  }

  function renderParagraphStyle(properties, table, cellId) {
    if (!properties) return 'margin:0';
    ensureKnownObjectKeys(properties, new Set([
      'styleId', 'alignment', 'keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'bidirectional',
      'indentation', 'spacing', 'tabs', 'borders', 'shading', 'defaultRunProperties',
    ]), table, cellId, 'paragraph properties');
    const styles = ['margin:0'];
    if (properties.styleId != null && typeof properties.styleId !== 'string') fail(table, cellId, 'invalid paragraph styleId');
    if (properties.alignment != null) {
      if (!ALIGNMENTS.has(properties.alignment)) fail(table, cellId, 'unsupported paragraph alignment');
      styles.push(`text-align:${properties.alignment}`);
    }
    ensureKnownObjectKeys(properties.spacing, new Set(['beforePt', 'afterPt', 'line', 'lineRule']), table, cellId, 'paragraph spacing');
    if (properties.spacing) {
      const { beforePt, afterPt, line, lineRule } = properties.spacing;
      if (beforePt != null) styles.push(`margin-top:${pt(beforePt, table, cellId, 'paragraph spacing.beforePt', { nonNegative: true })}`);
      if (afterPt != null) styles.push(`margin-bottom:${pt(afterPt, table, cellId, 'paragraph spacing.afterPt', { nonNegative: true })}`);
      if (line != null) {
        if (!/^[0-9]+$/.test(String(line)) || !LINE_RULES.has(lineRule ?? 'auto')) fail(table, cellId, 'unsupported paragraph line spacing');
        styles.push(`line-height:${Number(line) / 240}`);
      }
    }
    for (const property of ['keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'bidirectional']) {
      if (properties[property] != null && typeof properties[property] !== 'boolean') fail(table, cellId, `invalid paragraph ${property}`);
    }
    ensureKnownObjectKeys(properties.indentation, new Set(['leftPt', 'rightPt', 'startPt', 'endPt', 'firstLinePt', 'hangingPt']), table, cellId, 'paragraph indentation');
    if (properties.indentation) {
      const indentation = properties.indentation;
      if (indentation.leftPt != null) styles.push(`margin-left:${pt(indentation.leftPt, table, cellId, 'paragraph indentation.leftPt')}`);
      if (indentation.rightPt != null) styles.push(`margin-right:${pt(indentation.rightPt, table, cellId, 'paragraph indentation.rightPt')}`);
      if (indentation.startPt != null) styles.push(`margin-inline-start:${pt(indentation.startPt, table, cellId, 'paragraph indentation.startPt')}`);
      if (indentation.endPt != null) styles.push(`margin-inline-end:${pt(indentation.endPt, table, cellId, 'paragraph indentation.endPt')}`);
      if (indentation.firstLinePt != null) styles.push(`text-indent:${pt(indentation.firstLinePt, table, cellId, 'paragraph indentation.firstLinePt')}`);
      if (indentation.hangingPt != null) styles.push(`text-indent:${pt(-indentation.hangingPt, table, cellId, 'paragraph indentation.hangingPt')}`);
    }
    if (properties.tabs != null) {
      if (!Array.isArray(properties.tabs)) fail(table, cellId, 'invalid paragraph tabs');
      for (const tab of properties.tabs) {
        ensureKnownObjectKeys(tab, new Set(['value', 'positionPt', 'leader']), table, cellId, 'paragraph tab');
        if (!['left', 'center', 'right', 'decimal', 'bar'].includes(tab.value) || tab.leader != null || !Number.isFinite(tab.positionPt)) {
          fail(table, cellId, 'unsupported paragraph tab');
        }
      }
    }
    if (properties.borders != null || properties.shading != null) fail(table, cellId, 'unsupported paragraph formatting');
    return styles.join(';');
  }

  function renderRunStyle(properties, table, cellId) {
    if (!properties) return '';
    ensureKnownObjectKeys(properties, new Set([
      'styleId', 'bold', 'boldComplexScript', 'italic', 'italicComplexScript', 'strike', 'doubleStrike',
      'caps', 'smallCaps', 'vanish', 'underline', 'fonts', 'fontSizePt', 'complexScriptFontSizePt',
      'color', 'highlight', 'verticalAlign', 'characterSpacingPt', 'positionPt', 'language', 'border', 'shading',
    ]), table, cellId, 'run properties');
    const styles = [];
    if (properties.styleId != null && typeof properties.styleId !== 'string') fail(table, cellId, 'invalid run styleId');
    for (const property of ['bold', 'boldComplexScript', 'italic', 'italicComplexScript', 'strike', 'doubleStrike', 'caps', 'smallCaps', 'vanish']) {
      if (properties[property] != null && typeof properties[property] !== 'boolean') fail(table, cellId, `invalid run ${property}`);
    }
    if (properties.bold || properties.boldComplexScript) styles.push('font-weight:bold');
    if (properties.italic || properties.italicComplexScript) styles.push('font-style:italic');
    if (properties.strike || properties.doubleStrike) styles.push('text-decoration:line-through');
    if (properties.caps) styles.push('text-transform:uppercase');
    if (properties.smallCaps) styles.push('font-variant:small-caps');
    if (properties.vanish) styles.push('visibility:hidden');
    if (properties.underline != null) {
      if (!['single', 'double', 'words', 'none'].includes(properties.underline)) fail(table, cellId, 'unsupported underline');
      if (properties.underline !== 'none') styles.push('text-decoration:underline');
    }
    ensureKnownObjectKeys(properties.fonts, new Set(['ascii', 'highAnsi', 'eastAsia', 'complexScript', 'asciiTheme', 'highAnsiTheme', 'eastAsiaTheme', 'complexScriptTheme']), table, cellId, 'run fonts');
    if (properties.fonts) {
      const requestedFonts = ['eastAsia', 'highAnsi', 'ascii', 'complexScript'].map(key => properties.fonts[key]).filter(value => value != null);
      if (requestedFonts.length) {
        if (requestedFonts.some(font => !FONT_FAMILIES[font])) fail(table, cellId, 'unsupported font family');
        const family = FONT_FAMILIES[requestedFonts[0]];
        styles.push(`font-family:${family}`);
      }
      for (const themeKey of ['asciiTheme', 'highAnsiTheme', 'eastAsiaTheme', 'complexScriptTheme']) {
        if (properties.fonts[themeKey] != null) fail(table, cellId, 'unsupported font theme');
      }
    }
    const size = properties.fontSizePt ?? properties.complexScriptFontSizePt;
    if (size != null) styles.push(`font-size:${pt(size, table, cellId, 'run fontSizePt', { nonNegative: true })}`);
    if (properties.color != null) {
      ensureKnownObjectKeys(properties.color, new Set(['value', 'themeColor', 'themeTint', 'themeShade']), table, cellId, 'run color');
      styles.push(`color:${cssColor(properties.color.value, table, cellId, 'run color')}`);
    }
    if (properties.highlight != null) fail(table, cellId, 'unsupported highlight');
    if (properties.verticalAlign != null && !RUN_VERTICAL_ALIGNS.has(properties.verticalAlign)) fail(table, cellId, 'unsupported run vertical alignment');
    if (properties.characterSpacingPt != null) styles.push(`letter-spacing:${pt(properties.characterSpacingPt, table, cellId, 'run characterSpacingPt')}`);
    if (properties.positionPt != null) styles.push(`position:relative;top:${pt(-properties.positionPt, table, cellId, 'run positionPt')}`);
    if (properties.language != null) {
      ensureKnownObjectKeys(properties.language, new Set(['latin', 'eastAsia', 'bidirectional']), table, cellId, 'run language');
      for (const value of Object.values(properties.language)) {
        if (value != null && (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,24}$/.test(value))) fail(table, cellId, 'unsupported run language');
      }
      if (properties.language.bidirectional != null) styles.push('direction:rtl');
    }
    if (properties.shading != null) {
      ensureKnownObjectKeys(properties.shading, new Set(['value', 'color', 'fill', 'themeColor', 'themeFill']), table, cellId, 'run shading');
      if (!['clear', 'solid'].includes(properties.shading.value)) fail(table, cellId, 'unsupported run shading value');
      styles.push(`background-color:${cssColor(properties.shading.fill, table, cellId, 'run shading.fill')}`);
    }
    if (properties.border != null) fail(table, cellId, 'unsupported run border');
    return styles.join(';');
  }

  function renderTextRun(run, table, cellId) {
    const style = renderRunStyle(run.properties, table, cellId);
    const content = escapeHtml(run.text);
    const span = style ? `<span style="${style}">${content}</span>` : content;
    if (run.properties?.verticalAlign === 'subscript') return `<sub>${span}</sub>`;
    if (run.properties?.verticalAlign === 'superscript') return `<sup>${span}</sup>`;
    return span;
  }

  function mergeRunProperties(defaults, overrides) {
    const merged = {};
    const defaultProperties = defaults && typeof defaults === 'object' ? defaults : {};
    const overrideProperties = overrides && typeof overrides === 'object' ? overrides : {};
    const nestedProperties = new Set(['fonts', 'color', 'language', 'border', 'shading']);
    for (const key of new Set([...Object.keys(defaultProperties), ...Object.keys(overrideProperties)])) {
      const defaultValue = defaultProperties[key];
      const overrideValue = overrideProperties[key];
      if (nestedProperties.has(key) && defaultValue && overrideValue && typeof defaultValue === 'object' && typeof overrideValue === 'object') {
        merged[key] = {};
        for (const nestedKey of new Set([...Object.keys(defaultValue), ...Object.keys(overrideValue)])) {
          merged[key][nestedKey] = overrideValue[nestedKey] ?? defaultValue[nestedKey];
        }
      } else {
        merged[key] = overrideValue ?? defaultValue;
      }
    }
    return merged;
  }

  function renderMath(node, table, cellId) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail(table, cellId, 'invalid math node');
    switch (node.type) {
      case 'sequence':
        if (!Array.isArray(node.children)) fail(table, cellId, 'invalid math sequence');
        return node.children.map(child => renderMath(child, table, cellId)).join('');
      case 'run':
      case 'text':
        if (typeof node.text !== 'string') fail(table, cellId, 'invalid math text');
        return `<span class="word-math-text">${escapeHtml(node.text)}</span>`;
      case 'fraction':
        return `<span class="word-math-fraction" style="display:inline-flex;flex-direction:column;vertical-align:middle;line-height:1;text-align:center"><span class="word-math-numerator" style="display:block;padding:0 0.15em">${renderMath(node.numerator, table, cellId)}</span><span class="word-math-denominator" style="display:block;border-top:1px solid currentColor;padding:0 0.15em">${renderMath(node.denominator, table, cellId)}</span></span>`;
      case 'subscript':
        return `${renderMath(node.base, table, cellId)}<sub>${renderMath(node.subscript, table, cellId)}</sub>`;
      case 'superscript':
        return `${renderMath(node.base, table, cellId)}<sup>${renderMath(node.superscript, table, cellId)}</sup>`;
      case 'subsup':
        return `${renderMath(node.base, table, cellId)}<sub>${renderMath(node.subscript, table, cellId)}</sub><sup>${renderMath(node.superscript, table, cellId)}</sup>`;
      case 'delimiter':
        if (!DELIMITER_CHARACTERS.has(node.beginning) || !DELIMITER_CHARACTERS.has(node.ending)) fail(table, cellId, 'unsupported math delimiter');
        return `<span class="word-math-delimiter">${escapeHtml(node.beginning)}${renderMath(node.content, table, cellId)}${escapeHtml(node.ending)}</span>`;
      default:
        fail(table, cellId, `unsupported math node ${String(node.type)}`);
    }
  }

  function renderParagraph(paragraph, table, cellId) {
    if (!paragraph || typeof paragraph !== 'object' || Array.isArray(paragraph)) fail(table, cellId, 'invalid paragraph');
    if (!Array.isArray(paragraph.runs)) fail(table, cellId, 'paragraph runs must be an array');
    const style = renderParagraphStyle(paragraph.properties, table, cellId);
    const defaultRunProperties = paragraph.properties?.defaultRunProperties;
    if (defaultRunProperties != null) renderRunStyle(defaultRunProperties, table, cellId);
    const content = paragraph.runs.map(run => {
      if (!run || typeof run !== 'object') fail(table, cellId, 'invalid paragraph run');
      if (run.kind === 'text') return renderTextRun({ ...run,
        properties: mergeRunProperties(defaultRunProperties, run.properties) }, table, cellId);
      if (run.kind === 'math') return renderMath(run.math, table, cellId);
      fail(table, cellId, `unsupported run kind ${String(run.kind)}`);
    }).join('');
    return `<p style="${style}">${content}</p>`;
  }

  function effectiveHeightRule(row) {
    if (row.heightRule != null) return row.heightRule;
    return row.heightPt == null ? 'auto' : 'atLeast';
  }

  function renderRowContentStyle(row, table, rowIndex, cell) {
    const heightRule = effectiveHeightRule(row);
    if (heightRule === 'auto' || row.heightPt == null) return '';
    const height = pt(row.heightPt, table, `row-${rowIndex + 1}`, 'heightPt', { nonNegative: true });
    if (cell.rowSpan > 1) {
      const spannedRows = table.rows.slice(rowIndex, rowIndex + cell.rowSpan);
      if (spannedRows.every(spannedRow => Number.isFinite(spannedRow.heightPt))) {
        const combinedHeight = spannedRows.reduce((total, spannedRow) => total + spannedRow.heightPt, 0);
        return `min-height:${pt(combinedHeight, table, cell.id, 'spanned row height', { nonNegative: true })};box-sizing:border-box`;
      }
      return `min-height:${height};box-sizing:border-box`;
    }
    if (heightRule === 'exact') return `height:${height};max-height:${height};overflow:hidden;box-sizing:border-box`;
    return `min-height:${height};box-sizing:border-box`;
  }

  function validate(table) {
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error('templateId=unknown tableRole=unknown cellId=table invalid table');
    if (typeof table.templateId !== 'string' || !table.templateId) fail(table, 'table', 'invalid templateId');
    if (typeof table.tableRole !== 'string' || !table.tableRole) fail(table, 'table', 'invalid tableRole');
    integer(table.sourceTableIndex, table, 'table', 'sourceTableIndex', { positive: true });
    finiteNumber(table.widthPt, table, 'table', 'widthPt', { nonNegative: true });
    if (!Array.isArray(table.gridPt) || !table.gridPt.length) fail(table, 'table', 'gridPt must be a non-empty array');
    if (!Array.isArray(table.rows) || !Array.isArray(table.cells)) fail(table, 'table', 'rows and cells must be arrays');
    integer(table.rowCount, table, 'table', 'rowCount', { positive: true });
    integer(table.columnCount, table, 'table', 'columnCount', { positive: true });
    if (table.gridPt.length !== table.columnCount) fail(table, 'table', 'grid column count differs from columnCount');
    if (table.rows.length !== table.rowCount) fail(table, 'table', 'row count differs from rowCount');
    const gridWidth = table.gridPt.reduce((total, width) => total + finiteNumber(width, table, 'table', 'gridPt item', { nonNegative: true }), 0);
    if (Math.abs(gridWidth - table.widthPt) > 0.05) fail(table, 'table', 'grid width differs from widthPt');
    const occupied = Array.from({ length: table.rowCount }, () => Array(table.columnCount).fill(null));
    const ids = new Set();
    for (const cell of table.cells) {
      if (!cell || typeof cell !== 'object' || Array.isArray(cell) || typeof cell.id !== 'string' || !cell.id) fail(table, cell?.id ?? 'unknown', 'invalid cell');
      if (ids.has(cell.id)) fail(table, cell.id, 'duplicate cell id');
      ids.add(cell.id);
      integer(cell.row, table, cell.id, 'row'); integer(cell.column, table, cell.id, 'column');
      integer(cell.rowSpan, table, cell.id, 'rowSpan', { positive: true }); integer(cell.colSpan, table, cell.id, 'colSpan', { positive: true });
      if (cell.row < 0 || cell.column < 0 || cell.row + cell.rowSpan > table.rowCount || cell.column + cell.colSpan > table.columnCount) fail(table, cell.id, 'cell exceeds table bounds');
      for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) for (let column = cell.column; column < cell.column + cell.colSpan; column += 1) {
        if (occupied[row][column]) fail(table, cell.id, `overlap with ${occupied[row][column]} at row=${row} column=${column}`);
        occupied[row][column] = cell.id;
      }
    }
    for (let row = 0; row < table.rowCount; row += 1) for (let column = 0; column < table.columnCount; column += 1) {
      if (!occupied[row][column]) fail(table, 'none', `hole at row=${row} column=${column}`);
    }
    for (const [index, row] of table.rows.entries()) {
      if (!row || typeof row !== 'object') fail(table, `row-${index + 1}`, 'invalid row');
      if (row.heightPt != null) finiteNumber(row.heightPt, table, `row-${index + 1}`, 'heightPt', { nonNegative: true });
      if (row.heightRule != null && !['exact', 'atLeast', 'auto'].includes(row.heightRule)) fail(table, `row-${index + 1}`, 'unsupported heightRule');
    }
    if (table.bindings != null) {
      if (!Array.isArray(table.bindings)) fail(table, 'table', 'bindings must be an array');
      const bindingCells = new Set();
      for (const binding of table.bindings) {
        if (!binding || typeof binding !== 'object' || !ids.has(binding.cellId)) fail(table, binding?.cellId ?? 'binding', 'binding references an unknown cell');
        if (bindingCells.has(binding.cellId)) fail(table, binding.cellId, 'multiple bindings for cell');
        bindingCells.add(binding.cellId);
        if (!['input', 'output'].includes(binding.role) || typeof binding.field !== 'string' || !binding.field) fail(table, binding.cellId, 'invalid binding');
        const boundCell = table.cells.find(cell => cell.id === binding.cellId);
        if (boundCell.isGridGap) fail(table, binding.cellId, 'binding targets a grid gap');
      }
    }
    return true;
  }

  function render(table, adapters) {
    validate(table);
    if (!adapters || typeof adapters !== 'object') fail(table, 'table', 'adapters must be an object');
    const bindings = new Map((table.bindings ?? []).map(binding => [binding.cellId, binding]));
    const tableStyle = [
      `width:${pt(table.widthPt, table, 'table', 'widthPt', { nonNegative: true })}`,
      'table-layout:fixed', 'border-collapse:collapse',
      table.indentPt ? `margin-left:${pt(table.indentPt, table, 'table', 'indentPt')}` : '',
    ].filter(Boolean).join(';');
    const colgroup = `<colgroup>${table.gridPt.map(width => `<col style="width:${pt(width, table, 'table', 'gridPt item', { nonNegative: true })}">`).join('')}</colgroup>`;
    const rows = table.rows.map((row, rowIndex) => {
      const heightRule = effectiveHeightRule(row);
      const cells = table.cells.filter(cell => cell.row === rowIndex).map(cell => {
        if (cell.isGridGap) {
          return `<td class="word-grid-gap"${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''} style="border:0;padding:0;background:transparent" aria-hidden="true"></td>`;
        }
        const binding = bindings.get(cell.id);
        let content;
        if (binding) {
          const adapter = adapters[binding.role];
          if (typeof adapter !== 'function') fail(table, cell.id, `missing ${binding.role} adapter`);
          content = adapter(binding);
          if (typeof content !== 'string') fail(table, cell.id, `${binding.role} adapter must return HTML string`);
        } else {
          content = (cell.paragraphs ?? []).map(paragraph => renderParagraph(paragraph, table, cell.id)).join('');
        }
        const rowContentStyle = renderRowContentStyle(row, table, rowIndex, cell);
        if (rowContentStyle) content = `<div class="word-row-content" style="${rowContentStyle}">${content}</div>`;
        const style = renderCellStyle(cell, table);
        return `<td${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}${style ? ` style="${style}"` : ''}>${content}</td>`;
      }).join('');
      return `<tr data-word-row-height-rule="${heightRule}">${cells}</tr>`;
    }).join('');
    return `<table class="word-record-table" data-word-table-role="${escapeHtml(table.tableRole)}" data-source-table-index="${table.sourceTableIndex}" style="${tableStyle}">${colgroup}<tbody>${rows}</tbody></table>`;
  }

  window.GcWordTableRenderer = Object.freeze({ render, validate });
}(window));
