#!/usr/bin/env python3
"""Derive Word's visible table grid geometry from trusted 144-DPI crop PNGs.

The OOXML row heights are Word's atLeast minima, so this utility treats the
rendered Word border locations as the source of screen/print geometry. It is
deterministic: only the source-sidecar image plus its parsed OOXML provenance
are read, and every detected boundary is validated before JSON is emitted.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

PT_TO_CSS = 4.0 / 3.0
CSS_TO_PT = 3.0 / 4.0


def dark_counts(image: Image.Image, axis: int) -> np.ndarray:
    pixels = np.asarray(image.convert('L'))
    return (pixels < 100).sum(axis=axis)


def grouped_boundaries(counts: np.ndarray, threshold: int, label: str) -> list[float]:
    indices = np.flatnonzero(counts >= threshold)
    if not len(indices):
        raise ValueError(f'{label}: no dark full-span grid lines')
    groups: list[list[int]] = [[int(indices[0])]]
    for index in indices[1:]:
        index = int(index)
        if index <= groups[-1][-1] + 2:
            groups[-1].append(index)
        else:
            groups.append([index])
    return [sum(group) / len(group) for group in groups]


def horizontal_boundaries(image: Image.Image, expected_rows: int, label: str) -> list[float]:
    width, _ = image.size
    # Each true horizontal border crosses virtually the complete table. Text and
    # short merged-cell rules cannot reach 70% of the crop width.
    lines = grouped_boundaries(dark_counts(image, axis=1), math.ceil(width * 0.70), label)
    if len(lines) != expected_rows + 1:
        raise ValueError(f'{label}: expected {expected_rows + 1} horizontal borders, detected {len(lines)} at {lines}')
    return lines


def vertical_outer_boundaries(image: Image.Image, label: str) -> tuple[float, float]:
    _, height = image.size
    lines = grouped_boundaries(dark_counts(image, axis=0), math.ceil(height * 0.70), label)
    if len(lines) < 2:
        raise ValueError(f'{label}: expected at least two vertical outer borders, detected {lines}')
    return lines[0], lines[-1]


def derive(word_json: Path) -> dict:
    meta = json.loads(word_json.read_text(encoding='utf-8'))
    structure = meta['sourceStructure']
    image_path = word_json.with_name(word_json.name.replace('-word.json', '-word.png'))
    image = Image.open(image_path)
    dpi = float(meta['dpi'])
    if dpi != 144:
        raise ValueError(f'{word_json}: expected 144 DPI source crop, got {dpi}')
    label = f"{word_json.parent.name}/{word_json.stem}"
    horizontal = horizontal_boundaries(image, len(structure['rows']), label)
    left, right = vertical_outer_boundaries(image, label)
    # The exporter crops to all visible table ink. Some Word tables deliberately
    # have borderless right-hand grid-gap regions, so their outer vertical rule
    # is not full-height; the crop width is therefore the authoritative visible
    # table width, while detected vertical rules remain audit diagnostics.
    visible_width_css = image.width * 96.0 / dpi
    source_width_css = sum(float(value) for value in structure['gridPt']) * PT_TO_CSS
    if source_width_css <= 0:
        raise ValueError(f'{label}: non-positive source grid width')
    render_scale = visible_width_css / source_width_css
    if not (0.5 <= render_scale <= 1.1):
        raise ValueError(f'{label}: implausible visible horizontal scale {render_scale}')
    row_height_pt = [round((horizontal[index + 1] - horizontal[index]) * 72.0 / dpi, 6)
                     for index in range(len(horizontal) - 1)]
    if any(value <= 0 for value in row_height_pt):
        raise ValueError(f'{label}: non-positive visible row height {row_height_pt}')
    source_grid = [float(value) for value in structure['gridPt']]
    role = word_json.name.removesuffix('-word.json')
    source_text_line_counts: dict[str, int] = {}
    for cell in structure['cells']:
        # Continued vertical-merge records have no separately rendered cell.
        if cell.get('verticalMerge') == 'continue':
            continue
        line_count = cell.get('textLineCount')
        if not isinstance(line_count, int) or line_count < 0:
            raise ValueError(f'{label}: invalid source textLineCount for r{cell.get("rowIndex")}c{cell.get("gridColumnIndex")}')
        source_text_line_counts[f'{role}-r{cell["rowIndex"]}c{cell["gridColumnIndex"]}'] = line_count
    return {
        'sourceFile': meta['sourceFile'],
        'sourceTableIndex': int(meta['sourceTableIndex']),
        'sourceSha256': meta['sourceSha256Before'],
        'imageDpi': int(dpi),
        'rowBoundariesPx144': [round(value, 3) for value in horizontal],
        'outerBoundariesPx144': [round(left, 3), round(right, 3)],
        'renderWidthPt': round(visible_width_css * CSS_TO_PT, 6),
        'renderScale': round(render_scale, 9),
        'renderGridPt': [round(value * render_scale, 6) for value in source_grid],
        'renderHeightPt': row_height_pt,
        # This is copied from the Word source sidecar, never from browser DOM
        # measurement. The renderer uses the explicit one-line policy only for
        # source text cells whose original Word line count is one.
        'sourceTextLineCounts': source_text_line_counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path, help='visual-qa run directory')
    parser.add_argument('--manifest', required=True, type=Path, help='GC Word manifest used for the run')
    parser.add_argument('--output', type=Path, help='write JSON output; omit to print')
    parser.add_argument('--javascript', action='store_true', help='emit the browser companion asset')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    result: dict[str, dict[str, dict]] = {}
    for entry in manifest['entries']:
        template_id = entry['templateId']
        result[template_id] = {}
        for role in ('reference', 'sample'):
            word_json = args.input / template_id / f'{role}-word.json'
            if not word_json.exists():
                raise FileNotFoundError(f'missing trusted Word sidecar: {word_json}')
            result[template_id][role] = derive(word_json)
    if len(result) != 33 or sum(len(roles) for roles in result.values()) != 66:
        raise ValueError(f'expected 33 templates / 66 tables, got {len(result)} / {sum(len(roles) for roles in result.values())}')
    payload = json.dumps(result, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    output = f'const GC_WORD_TABLE_VISIBLE_GEOMETRY = Object.freeze({payload});\n'
    if not args.javascript:
        output = payload
    if args.output:
        args.output.write_text(output + '\n', encoding='utf-8')
    else:
        print(output)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
