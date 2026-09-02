(function attachRenderedSemanticCapture(window) {
  'use strict';

  function fail(message) { throw new Error(`rendered semantic capture: ${message}`); }
  function normalizeText(value) { return String(value ?? '').replace(/\s+/gu, ' ').trim(); }
  function text(value) { const normalized = normalizeText(value); return normalized ? { type: 'text', text: normalized } : null; }

  function colorAlpha(value) {
    const color = String(value ?? '').trim().toLowerCase();
    if (!color || color === 'transparent') return 0;
    const rgba = color.match(/^rgba?\([^)]*[,/]\s*([0-9.]+)\s*\)$/u);
    if (rgba && color.startsWith('rgba')) return Number.parseFloat(rgba[1]);
    const slash = color.match(/\/\s*([0-9.]+)%?\s*\)$/u);
    if (slash) {
      const amount = Number.parseFloat(slash[1]);
      return color.includes('%') ? amount / 100 : amount;
    }
    return 1;
  }

  function filterOpacity(filter) {
    let opacity = 1;
    for (const match of String(filter ?? '').matchAll(/opacity\(([^)]+)\)/gu)) {
      const value = match[1].trim();
      const amount = Number.parseFloat(value);
      opacity *= value.endsWith('%') ? amount / 100 : amount;
    }
    return opacity;
  }

  function assertVisibleChain(element, label) {
    let opacity = 1;
    for (let current = element; current instanceof Element; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none') fail(`${label} has display:none on element or ancestor`);
      if (style.visibility === 'hidden' || style.visibility === 'collapse') fail(`${label} has hidden visibility on element or ancestor`);
      if (style.contentVisibility === 'hidden') fail(`${label} has hidden content visibility on element or ancestor`);
      opacity *= Number.parseFloat(style.opacity || '1') * filterOpacity(style.filter);
      if (!Number.isFinite(opacity) || opacity <= 0.001) fail(`${label} has zero effective opacity on element or ancestor`);
    }
  }

  function intersectAxis(start, end, clipStart, clipEnd) {
    return [Math.max(start, clipStart), Math.min(end, clipEnd)];
  }

  function isRectVisible(rect, element) {
    let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
    if (!(right - left > 0.05 && bottom - top > 0.05)) return false;
    for (let ancestor = element.parentElement; ancestor instanceof Element; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.clipPath && style.clipPath !== 'none') fail('semantic ink uses unsupported clip-path');
      if (style.clip && style.clip !== 'auto') fail('semantic ink uses unsupported CSS clip');
      const ancestorRect = ancestor.getBoundingClientRect();
      const clipLeft = ancestorRect.left + ancestor.clientLeft;
      const clipTop = ancestorRect.top + ancestor.clientTop;
      const clipRight = clipLeft + ancestor.clientWidth;
      const clipBottom = clipTop + ancestor.clientHeight;
      if (/^(?:hidden|clip|scroll|auto)$/u.test(style.overflowX)) [left, right] = intersectAxis(left, right, clipLeft, clipRight);
      if (/^(?:hidden|clip|scroll|auto)$/u.test(style.overflowY)) [top, bottom] = intersectAxis(top, bottom, clipTop, clipBottom);
      if (!(right - left > 0.05 && bottom - top > 0.05)) return false;
    }
    return true;
  }

  function assertVisibleRects(rects, element, label) {
    if (![...rects].some(rect => isRectVisible(rect, element))) fail(`${label} has zero-size or fully clipped visible ink geometry`);
  }

  function assertVisibleElement(element, label) {
    assertVisibleChain(element, label);
    assertVisibleRects(element.getClientRects(), element, label);
  }

  function assertVisibleText(node, label) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    assertVisibleChain(element, label);
    const style = getComputedStyle(element);
    if (colorAlpha(style.color) <= 0.001) fail(`${label} has transparent text color`);
    const range = document.createRange();
    range.selectNodeContents(node);
    assertVisibleRects(range.getClientRects(), element, label);
  }

  function mergeText(nodes) {
    const merged = [];
    for (const node of nodes.filter(Boolean)) {
      if (node.type === 'sequence') {
        for (const child of node.children) {
          const previous = merged.at(-1);
          if (previous?.type === 'text' && child.type === 'text') previous.text += child.text;
          else merged.push(child);
        }
        continue;
      }
      const previous = merged.at(-1);
      if (previous?.type === 'text' && node.type === 'text') previous.text += node.text;
      else merged.push(node);
    }
    return merged;
  }

  function childrenOf(element) {
    return mergeText([...element.childNodes].map(parseNode));
  }

  function parseNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const result = text(node.nodeValue);
      if (result) assertVisibleText(node, 'semantic text');
      return result;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node;
    const style = getComputedStyle(element);
    if (normalizeText(element.textContent)) assertVisibleChain(element, 'semantic ink');
    const classes = [...element.classList];
    if (classes.some(name => name.startsWith('word-math-'))
        && !classes.some(name => ['word-math-text','word-math-overline','word-math-fraction','word-math-numerator','word-math-denominator','word-math-delimiter'].includes(name))) {
      fail(`unknown math class ${classes.find(name => name.startsWith('word-math-'))}`);
    }
    if (element.classList.contains('word-math-text')) {
      assertVisibleText(element, 'semantic text');
      return text(element.textContent);
    }
    if (element.classList.contains('word-math-overline')) {
      assertVisibleElement(element, 'overline');
      if (!String(style.textDecorationLine).split(/\s+/u).includes('overline')) fail('overline style is missing');
      if (colorAlpha(style.textDecorationColor) <= 0.001) fail('overline color is transparent');
      return { type: 'overline', children: childrenOf(element) };
    }
    if (element.classList.contains('word-math-fraction')) {
      assertVisibleElement(element, 'fraction');
      const direct = [...element.children];
      const numerators = direct.filter(child => child.classList.contains('word-math-numerator'));
      const denominators = direct.filter(child => child.classList.contains('word-math-denominator'));
      if (numerators.length !== 1) fail('fraction numerator is missing or duplicated');
      if (denominators.length !== 1 || direct.length !== 2) fail('fraction structure is invalid');
      const denominatorStyle = getComputedStyle(denominators[0]);
      if (denominatorStyle.borderTopStyle === 'none' || Number.parseFloat(denominatorStyle.borderTopWidth) <= 0) fail('fraction bar is missing');
      if (colorAlpha(denominatorStyle.borderTopColor) <= 0.001) fail('fraction bar color is transparent');
      const denominatorRect = denominators[0].getBoundingClientRect();
      const borderWidth = Number.parseFloat(denominatorStyle.borderTopWidth);
      assertVisibleRects([{ left: denominatorRect.left, right: denominatorRect.right,
        top: denominatorRect.top, bottom: denominatorRect.top + borderWidth }], denominators[0], 'fraction bar');
      return { type: 'fraction', numerator: childrenOf(numerators[0]), denominator: childrenOf(denominators[0]) };
    }
    if (element.matches('sub')) { assertVisibleElement(element, 'subscript'); return { type: 'subscript', children: childrenOf(element) }; }
    if (element.matches('sup')) { assertVisibleElement(element, 'superscript'); return { type: 'superscript', children: childrenOf(element) }; }
    if (element.classList.contains('word-math-numerator') || element.classList.contains('word-math-denominator')) {
      fail('fraction component appeared outside a fraction');
    }
    return { type: 'sequence', children: childrenOf(element) };
  }

  function serializeSequence(nodes) { return mergeText(nodes).map(serialize).join('|'); }
  function serialize(node) {
    switch (node.type) {
      case 'text': return `text(${JSON.stringify(node.text)})`;
      case 'overline': return `overline(${serializeSequence(node.children)})`;
      case 'fraction': return `fraction(${serializeSequence(node.numerator)},${serializeSequence(node.denominator)})`;
      case 'subscript': return `subscript(${serializeSequence(node.children)})`;
      case 'superscript': return `superscript(${serializeSequence(node.children)})`;
      default: fail(`unknown semantic node ${String(node.type)}`);
    }
  }

  function parseCell(cell) {
    if (!(cell instanceof Element)) fail('cell must be an Element');
    return serializeSequence(childrenOf(cell));
  }

  window.GcWordRenderedSemanticCapture = Object.freeze({ parseCell });
}(window));
