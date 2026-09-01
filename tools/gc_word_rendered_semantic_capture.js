(function attachRenderedSemanticCapture(window) {
  'use strict';

  function fail(message) { throw new Error(`rendered semantic capture: ${message}`); }
  function normalizeText(value) { return String(value ?? '').replace(/\s+/gu, ' ').trim(); }
  function text(value) { const normalized = normalizeText(value); return normalized ? { type: 'text', text: normalized } : null; }

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
    if (node.nodeType === Node.TEXT_NODE) return text(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      if (normalizeText(element.textContent)) fail('semantic ink is hidden');
      return null;
    }
    const classes = [...element.classList];
    if (classes.some(name => name.startsWith('word-math-'))
        && !classes.some(name => ['word-math-text','word-math-overline','word-math-fraction','word-math-numerator','word-math-denominator','word-math-delimiter'].includes(name))) {
      fail(`unknown math class ${classes.find(name => name.startsWith('word-math-'))}`);
    }
    if (element.classList.contains('word-math-text')) return text(element.textContent);
    if (element.classList.contains('word-math-overline')) {
      if (!String(style.textDecorationLine).split(/\s+/u).includes('overline')) fail('overline style is missing');
      return { type: 'overline', children: childrenOf(element) };
    }
    if (element.classList.contains('word-math-fraction')) {
      const direct = [...element.children];
      const numerators = direct.filter(child => child.classList.contains('word-math-numerator'));
      const denominators = direct.filter(child => child.classList.contains('word-math-denominator'));
      if (numerators.length !== 1) fail('fraction numerator is missing or duplicated');
      if (denominators.length !== 1 || direct.length !== 2) fail('fraction structure is invalid');
      const denominatorStyle = getComputedStyle(denominators[0]);
      if (denominatorStyle.borderTopStyle === 'none' || Number.parseFloat(denominatorStyle.borderTopWidth) <= 0) fail('fraction bar is missing');
      return { type: 'fraction', numerator: childrenOf(numerators[0]), denominator: childrenOf(denominators[0]) };
    }
    if (element.matches('sub')) return { type: 'subscript', children: childrenOf(element) };
    if (element.matches('sup')) return { type: 'superscript', children: childrenOf(element) };
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
