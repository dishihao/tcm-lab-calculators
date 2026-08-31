#!/usr/bin/env python3
"""Derive minimal runtime geometry and private QA provenance from current Word PNGs."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

CSS_DPI = 96.0
WORD_DPI = 144.0
PT_PER_INCH = 72.0
INK_LIMIT = 100


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8-sig'))


def dark_mask(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert('L')) < INK_LIMIT


def group_indices(indices: np.ndarray | list[int], max_gap: int = 2) -> list[list[int]]:
    values = [int(value) for value in indices]
    if not values:
        return []
    groups = [[values[0]]]
    for value in values[1:]:
        if value <= groups[-1][-1] + max_gap:
            groups[-1].append(value)
        else:
            groups.append([value])
    return groups


def centers(groups: list[list[int]]) -> list[float]:
    return [sum(group) / len(group) for group in groups]


def full_height_vertical_groups(mask: np.ndarray, label: str) -> list[list[int]]:
    height = mask.shape[0]
    groups = group_indices(np.flatnonzero(mask.sum(axis=0) >= math.ceil(height * 0.70)), 2)
    if len(groups) < 2:
        raise ValueError(f'{label}: expected at least two full-height vertical borders, got {centers(groups)}')
    return groups


def horizontal_groups(mask: np.ndarray, left: int, right: int, expected_rows: int, label: str) -> list[list[int]]:
    main = mask[:, max(0, left):min(mask.shape[1], right + 1)]
    width = main.shape[1]
    groups = group_indices(np.flatnonzero(main.sum(axis=1) >= math.ceil(width * 0.70)), 2)
    if len(groups) != expected_rows + 1:
        raise ValueError(f'{label}: expected {expected_rows + 1} horizontal borders, got {centers(groups)}')
    return groups


def _segment(axis: str, position: float, start: float, end: float, thickness: float, dpi: float) -> dict:
    scale = CSS_DPI / dpi
    return {
        'axis': axis,
        'positionPx': round(position * scale, 3),
        'startPx': round(start * scale, 3),
        'endPx': round(end * scale, 3),
        'thicknessPx': round(thickness * scale, 3),
    }


def extract_border_evidence(image: Image.Image, dpi: float, expected_rows: int, label: str) -> dict:
    mask = dark_mask(image)
    vertical_full = full_height_vertical_groups(mask, label)
    left_group, right_group = vertical_full[0], vertical_full[-1]
    left, right = centers([left_group, right_group])
    horizontal = horizontal_groups(mask, round(left), round(right), expected_rows, label)
    horizontal_centers = centers(horizontal)

    vertical_segments: list[dict] = []
    for row_index in range(expected_rows):
        top = max(horizontal[row_index]) + 1
        bottom = min(horizontal[row_index + 1]) - 1
        if bottom <= top:
            continue
        band = mask[top:bottom + 1, :]
        candidates = np.flatnonzero(band.sum(axis=0) >= math.ceil(band.shape[0] * 0.70))
        for group in group_indices(candidates, 2):
            vertical_segments.append({
                **_segment('vertical', sum(group) / len(group), horizontal_centers[row_index], horizontal_centers[row_index + 1], len(group), dpi),
                'rowStart': row_index + 1,
                'rowEnd': row_index + 1,
            })

    horizontal_segments: list[dict] = []
    for boundary_index, group in enumerate(horizontal):
        band = mask[min(group):max(group) + 1, :]
        candidates = np.flatnonzero(band.any(axis=0))
        for run in group_indices(candidates, 2):
            if len(run) < 5:
                continue
            horizontal_segments.append({
                **_segment('horizontal', sum(group) / len(group), min(run), max(run), len(group), dpi),
                'boundary': boundary_index,
            })

    return {
        'mainOuterPx': {
            'left': round(left * CSS_DPI / dpi, 3),
            'right': round(right * CSS_DPI / dpi, 3),
            'top': round(horizontal_centers[0] * CSS_DPI / dpi, 3),
            'bottom': round(horizontal_centers[-1] * CSS_DPI / dpi, 3),
        },
        'verticalSegments': vertical_segments,
        'horizontalSegments': horizontal_segments,
        'verticalFullHeightCentersPx': [round(value * CSS_DPI / dpi, 3) for value in centers(vertical_full)],
        'horizontalBoundaryCentersPx': [round(value * CSS_DPI / dpi, 3) for value in horizontal_centers],
    }


def visible_prefix(grid_pt: list[float], main_width_pt: float, label: str) -> int:
    cumulative = 0.0
    candidates: list[tuple[float, int]] = []
    for index, width in enumerate(grid_pt, 1):
        cumulative += width
        candidates.append((abs(cumulative - main_width_pt), index))
    delta, count = min(candidates)
    # Word border centres exclude roughly half of each outer rule. A 2.5 pt
    # allowance is strict enough to reject scaling while accommodating doubles.
    if delta > 2.5:
        raise ValueError(f'{label}: no source-grid prefix matches Word outer borders; best delta={delta:.3f}pt')
    return count


def border_derived_grid(source_grid: list[float], count: int, evidence: dict, label: str) -> list[float]:
    outer = evidence['mainOuterPx']
    left, right = float(outer['left']), float(outer['right'])
    raw_boundaries = [0.0]
    for width in source_grid[:count]:
        raw_boundaries.append(raw_boundaries[-1] + width)
    observed_px = sorted({round(float(segment['positionPx']), 3)
                          for segment in evidence['verticalSegments']
                          if left - 1 <= float(segment['positionPx']) <= right + 1})
    mapped: dict[int, list[float]] = {0: [0.0], count: [(right - left) * PT_PER_INCH / CSS_DPI]}
    for position in observed_px:
        relative_pt = (position - left) * PT_PER_INCH / CSS_DPI
        index = min(range(count + 1), key=lambda candidate: abs(raw_boundaries[candidate] - relative_pt))
        if abs(raw_boundaries[index] - relative_pt) <= 4.0:
            mapped.setdefault(index, []).append(relative_pt)
    boundaries: list[float | None] = [None] * (count + 1)
    for index, values in mapped.items():
        boundaries[index] = float(np.median(values))
    known = [index for index, value in enumerate(boundaries) if value is not None]
    for index in range(count + 1):
        if boundaries[index] is not None:
            continue
        lower = max(value for value in known if value < index)
        upper = min(value for value in known if value > index)
        raw_span = raw_boundaries[upper] - raw_boundaries[lower]
        if raw_span <= 0:
            raise ValueError(f'{label}: invalid raw grid interpolation span')
        ratio = (raw_boundaries[index] - raw_boundaries[lower]) / raw_span
        boundaries[index] = boundaries[lower] + ratio * (boundaries[upper] - boundaries[lower])
    values = [float(value) for value in boundaries]
    if any(values[index + 1] <= values[index] for index in range(count)):
        raise ValueError(f'{label}: non-increasing border-derived grid {values}')
    return [round(values[index + 1] - values[index], 6) for index in range(count)]


def derive_runtime_and_provenance(word_json: Path) -> tuple[dict, dict]:
    meta = load_json(word_json)
    structure = meta['sourceStructure']
    image_path = word_json.with_name(word_json.name.replace('-word.json', '-word.png'))
    with Image.open(image_path) as opened:
        image = opened.convert('RGB')
    dpi = float(meta['dpi'])
    if abs(dpi - WORD_DPI) > 0.001:
        raise ValueError(f'{word_json}: expected 144 DPI Word image, got {dpi}')
    label = f'{word_json.parent.name}/{word_json.stem}'
    evidence = extract_border_evidence(image, dpi, len(structure['rows']), label)
    outer = evidence['mainOuterPx']
    main_width_pt = (outer['right'] - outer['left']) * PT_PER_INCH / CSS_DPI
    source_grid = [float(value) for value in structure['gridPt']]
    count = visible_prefix(source_grid, main_width_pt, label)
    render_grid = border_derived_grid(source_grid, count, evidence, label)
    main_line_ends = [float(segment['endPx']) for segment in evidence['horizontalSegments']
                      if float(segment['endPx']) <= float(evidence['mainOuterPx']['right']) + 2]
    if not main_line_ends:
        raise ValueError(f'{label}: no main horizontal border span')
    edge_width_pt = (float(np.median(main_line_ends)) - float(evidence['mainOuterPx']['left'])) * PT_PER_INCH / CSS_DPI
    render_grid[-1] = round(render_grid[-1] + edge_width_pt - sum(render_grid), 6)
    render_width = sum(render_grid)

    row_boundaries = evidence['horizontalBoundaryCentersPx']
    render_heights = [round((row_boundaries[index + 1] - row_boundaries[index]) * PT_PER_INCH / CSS_DPI, 6)
                      for index in range(len(row_boundaries) - 1)]
    if any(value <= 0 for value in render_heights):
        raise ValueError(f'{label}: non-positive Word-visible row height')

    origin = (meta.get('crop') or {}).get('originPx144')
    left_margin = meta.get('pageLeftMarginPt')
    if not isinstance(origin, dict) or not math.isfinite(float(origin.get('x', math.nan))) \
            or left_margin is None or not math.isfinite(float(left_margin)):
        raise ValueError(f'{label}: validated render indent evidence is required')
    # The crop starts at the first visible outer-border pixel. Indent is an edge
    # placement measurement, not a border-centre measurement.
    table_left_page_pt = float(origin['x']) * PT_PER_INCH / dpi
    render_indent = table_left_page_pt - float(left_margin)
    if not math.isfinite(render_indent) or render_indent < -12 or render_indent > 72:
        raise ValueError(f'{label}: implausible render indent evidence {render_indent}pt')

    role = word_json.name.removesuffix('-word.json')
    source_line_counts: dict[str, int] = {}
    for cell in structure['cells']:
        if cell.get('verticalMerge') == 'continue':
            continue
        line_count = cell.get('textLineCount')
        if not isinstance(line_count, int) or line_count < 0:
            raise ValueError(f'{label}: invalid source text line count')
        source_line_counts[f'{role}-r{cell["rowIndex"]}c{cell["gridColumnIndex"]}'] = line_count

    overhangs = []
    main_right = outer['right']
    for segment in evidence['horizontalSegments']:
        if segment['endPx'] > main_right + 1:
            overhangs.append({
                'axis': 'horizontal',
                'positionPt': round((segment['positionPx'] - outer['top']) * PT_PER_INCH / CSS_DPI, 6),
                'startPt': round((max(segment['startPx'], main_right) - outer['left']) * PT_PER_INCH / CSS_DPI, 6),
                'endPt': round((segment['endPx'] - outer['left']) * PT_PER_INCH / CSS_DPI, 6),
                'thicknessPt': round(segment['thicknessPx'] * PT_PER_INCH / CSS_DPI, 6),
            })

    runtime = {
        'renderWidthPt': round(render_width, 6),
        'renderCanvasWidthPt': round(image.width * PT_PER_INCH / dpi, 6),
        'renderCanvasHeightPt': round(image.height * PT_PER_INCH / dpi, 6),
        'renderInkWidthPt': round(max(segment['endPx'] for segment in evidence['horizontalSegments']) * PT_PER_INCH / CSS_DPI, 6),
        'renderGridPt': [round(value, 6) for value in render_grid],
        'visibleColumnCount': count,
        'renderHeightPt': render_heights,
        'renderIndentPt': round(render_indent, 6),
        'sourceTextLineCounts': source_line_counts,
    }
    provenance = {
        'sourceFile': meta['sourceFile'],
        'sourceTableIndex': int(meta['sourceTableIndex']),
        'sourceSha256': meta['sourceSha256Before'],
        'sourceSha256After': meta.get('sourceSha256After'),
        'sourceReadOnly': meta.get('sourceReadOnly'),
        'usedTempRecovery': meta.get('usedTempRecovery', False),
        'recoveryReason': meta.get('recoveryReason'),
        'temporarySuffix': meta.get('temporarySuffix'),
        'imageDpi': int(dpi),
        'crop': meta.get('crop'),
        'pageLeftMarginPt': left_margin,
        'sourceIndentPt': structure.get('indentPt'),
        'sourceGridPt': source_grid,
        'visibleColumnCount': count,
        'borderEvidence': evidence,
        'runtime': runtime,
    }
    return runtime, provenance


def derive(word_json: Path) -> dict:
    """Compatibility helper for callers that need only trusted runtime geometry."""
    return derive_runtime_and_provenance(word_json)[0]


def build_all(run: Path, manifest_path: Path) -> tuple[dict, dict]:
    manifest = load_json(manifest_path)
    runtime: dict[str, dict] = {}
    private: dict[str, dict] = {}
    for entry in manifest['entries']:
        template_id = entry['templateId']
        runtime[template_id] = {}
        private[template_id] = {}
        for role in ('reference', 'sample'):
            word_json = run / template_id / f'{role}-word.json'
            if not word_json.exists():
                raise FileNotFoundError(f'missing trusted Word sidecar: {word_json}')
            runtime[template_id][role], private[template_id][role] = derive_runtime_and_provenance(word_json)
    if len(runtime) != 33 or sum(map(len, runtime.values())) != 66:
        raise ValueError('expected 33 templates / 66 tables')
    return runtime, private


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--public-output', type=Path)
    parser.add_argument('--private-output', type=Path)
    # Deprecated aliases retained only so stale local commands fail clearly if
    # they try to make a provenance-bearing browser asset.
    parser.add_argument('--output', type=Path)
    parser.add_argument('--javascript', action='store_true')
    args = parser.parse_args()
    if args.output or args.javascript:
        raise ValueError('use --public-output and --private-output; combined provenance output is forbidden')
    if not args.public_output or not args.private_output:
        parser.error('--public-output and --private-output are both required')
    runtime, private = build_all(args.input.resolve(), args.manifest.resolve())
    public_source = f'const GC_WORD_TABLE_VISIBLE_GEOMETRY = Object.freeze({json.dumps(runtime, ensure_ascii=False, separators=(",", ":"), sort_keys=True)});\n'
    args.public_output.write_text(public_source, encoding='utf-8')
    args.private_output.write_text(json.dumps(private, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Derived 33 templates / 66 tables; public={args.public_output}; private={args.private_output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
