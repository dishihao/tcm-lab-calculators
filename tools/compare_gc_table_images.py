#!/usr/bin/env python3
"""Strict semantic Word-table QA: source structure + live DOM + cropped pixels."""
from __future__ import annotations

import argparse, json, shutil, sys, tempfile
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
import numpy as np

TOLERANCE = 1.0
PT_TO_CSS = 96.0 / 72.0
INK_LIMIT = 180


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8-sig'))


def read_dpi(sidecar: dict, fallback: float = 96) -> float:
    return float(sidecar.get('dpi', fallback))


def normalize(image: Image.Image, dpi: float) -> Image.Image:
    scale = 96.0 / dpi
    if abs(scale - 1) < 0.001:
        return image.convert('RGB')
    return image.convert('RGB').resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def read_normalized(path: Path, sidecar: dict) -> Image.Image:
    with Image.open(path) as image:
        return normalize(image, read_dpi(sidecar))


def mask(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert('L'), dtype=np.uint8) < INK_LIMIT


def line_count(image: Image.Image, rect: tuple[float, float, float, float]) -> int:
    """Count text ink bands inside one semantic cell, never across a whole table."""
    x, y, width, height = [round(value) for value in rect]
    inset = 2
    left, top = max(0, x + inset), max(0, y + inset)
    right, bottom = min(image.width, x + width - inset), min(image.height, y + height - inset)
    if right <= left or bottom <= top:
        return 0
    pixels = mask(image)[top:bottom, left:right]
    rows = pixels.sum(axis=1)
    # Cell borders are excluded by the inset. A text band has at least one ink pixel.
    bands, active = 0, False
    for amount in rows:
        if amount and not active:
            bands += 1; active = True
        elif not amount:
            active = False
    return bands


def metric(name: str, expected: float | None, actual: float | None, **identity: object) -> dict | None:
    if expected is None or actual is None:
        return {'metric': name, 'expected': expected, 'actual': actual, 'status': 'unavailable', **identity}
    delta = actual - expected
    if abs(delta) > TOLERANCE:
        return {'metric': name, 'expected': round(expected, 3), 'actual': round(actual, 3), 'deltaPx': round(delta, 3), **identity}
    return None


def border_style(value: str | None) -> str:
    return {'single': 'solid', 'double': 'double', 'nil': 'none', 'none': 'none'}.get(value or 'none', value or 'none')


def source_cells(structure: dict) -> dict[str, dict]:
    raw = structure['cells']; by_position = {(c['rowIndex'], c['gridColumnIndex']): c for c in raw}
    result: dict[str, dict] = {}
    for cell in raw:
        if cell.get('verticalMerge') == 'continue':
            continue
        row, column, span = cell['rowIndex'], cell['gridColumnIndex'], cell['gridSpan']
        row_span, next_row = 1, row + 1
        while (next_cell := by_position.get((next_row, column))) and next_cell.get('verticalMerge') == 'continue' and next_cell['gridSpan'] == span:
            row_span += 1; next_row += 1
        result[f'r{row}c{column}'] = {**cell, 'rowSpan': row_span}
    return result


def cumulative(values: list[float]) -> list[float]:
    result = [0.0]
    for value in values:
        result.append(result[-1] + value)
    return result


def source_geometry(structure: dict, word_image: Image.Image) -> tuple[list[float], list[float], dict[str, tuple[float, float, float, float]]]:
    grid = [float(value) * PT_TO_CSS for value in structure['gridPt']]
    row_values = [float(row.get('heightPt') or 0) * PT_TO_CSS for row in structure['rows']]
    # If a source row has no explicit height, only image-region text checking uses
    # a proportional fallback; structural row-height comparison is unavailable.
    x = cumulative(grid); y = cumulative(row_values)
    source = source_cells(structure); cell_rects = {}
    declared_width, declared_height = x[-1] or 1, y[-1] or 1
    for key, cell in source.items():
        r, c = cell['rowIndex'] - 1, cell['gridColumnIndex'] - 1
        cell_rects[key] = (x[c] / declared_width * word_image.width, y[r] / declared_height * word_image.height,
                           (x[c + cell['gridSpan']] - x[c]) / declared_width * word_image.width,
                           (y[r + cell['rowSpan']] - y[r]) / declared_height * word_image.height)
    return grid, row_values, cell_rects


def compare_semantic_table(source_meta: dict, web: dict, word_image: Image.Image, web_image: Image.Image) -> dict:
    structure = source_meta['sourceStructure']; grid, rows, word_cell_rects = source_geometry(structure, word_image)
    geometry: list[dict] = []; borders: list[dict] = []; text: list[dict] = []
    geometry.extend(item for item in [metric('normalizedTableCropWidthPx', word_image.width, web_image.width), metric('normalizedTableCropHeightPx', word_image.height, web_image.height)] if item)
    source_indent = structure.get('indentPt'); source_indent = float(source_indent) * PT_TO_CSS if source_indent is not None and abs(float(source_indent)) <= 1584 else None
    geometry.extend(item for item in [metric('tableIndentInContainerPx', source_indent, web['placement'].get('tableLeftInContainerPx'), origin='source.indentPt', target='web.placement.tableLeftInContainerPx')] if item)
    for index, expected in enumerate(grid, 1):
        actual = next((column['widthPx'] for column in web['columns'] if column['index'] == index), None)
        item = metric('columnWidthPx', expected, actual, column=index)
        if item: geometry.append(item)
    positions = cumulative(grid)
    for index, expected in enumerate(rows, 1):
        web_row = next((row for row in web['rows'] if row['index'] == index), None)
        item = metric('rowHeightPx', expected if expected else None, web_row['heightPx'] if web_row else None, row=index)
        if item: geometry.append(item)
        if expected and web_row:
            item = metric('rowTopPx', positions[index - 1] if False else cumulative(rows)[index - 1], web_row['y'], row=index)
            if item: geometry.append(item)
    source = source_cells(structure); web_cells = {cell['id']: cell for cell in web['cells']}
    for key in sorted(set(source) | set(web_cells)):
        left, right = source.get(key), web_cells.get(key)
        if not left or not right:
            geometry.append({'metric': 'cellPresence', 'cellId': key, 'expected': bool(left), 'actual': bool(right)}); continue
        r, c = left['rowIndex'] - 1, left['gridColumnIndex'] - 1
        expected = {'x': positions[c], 'y': cumulative(rows)[r], 'width': positions[c + left['gridSpan']] - positions[c], 'height': cumulative(rows)[r + left['rowSpan']] - cumulative(rows)[r]}
        for name, expected_value in expected.items():
            item = metric(f'cell{name[0].upper()}{name[1:]}Px', expected_value, right[name], cellId=key, row=left['rowIndex'], column=left['gridColumnIndex'])
            if item: geometry.append(item)
        if left['rowSpan'] != right['rowSpan'] or left['gridSpan'] != right['gridSpan']:
            geometry.append({'metric': 'cellSpan', 'cellId': key, 'expected': {'rowSpan': left['rowSpan'], 'gridSpan': left['gridSpan']}, 'actual': {'rowSpan': right['rowSpan'], 'gridSpan': right['gridSpan']}})
        for side in ('top', 'right', 'bottom', 'left'):
            expected_border = (left.get('borders') or {}).get(side) or {}
            actual_border = right['borders'][side]
            width_item = metric('borderWidthPx', (expected_border.get('sizePt') or 0) * PT_TO_CSS, actual_border['widthPx'], cellId=key, side=side)
            if width_item: borders.append(width_item)
            expected_style = border_style(expected_border.get('value'))
            if expected_style != actual_border['style']:
                borders.append({'metric': 'borderStyle', 'cellId': key, 'side': side, 'expected': expected_style, 'actual': actual_border['style']})
        word_lines = line_count(word_image, word_cell_rects[key]); web_lines = line_count(web_image, (right['x'], right['y'], right['width'], right['height']))
        if word_lines != web_lines:
            text.append({'metric': 'cellTextLineCount', 'cellId': key, 'row': left['rowIndex'], 'column': left['gridColumnIndex'], 'expected': word_lines, 'actual': web_lines, 'deltaLines': web_lines - word_lines})
    return {'tableCrop': {'wordCssPx': {'width': word_image.width, 'height': word_image.height}, 'webCssPx': {'width': web_image.width, 'height': web_image.height}}, 'geometryMismatches': geometry, 'borderMismatches': borders, 'textWrapMismatches': text, 'sourceCellCount': len(source), 'webCellCount': len(web_cells)}


def write_artifacts(word: Image.Image, web: Image.Image, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True); width, height = max(word.width, web.width), max(word.height, web.height)
    overlay = Image.new('RGBA', (width, height), 'white'); overlay.alpha_composite(word.convert('RGBA')); red = web.convert('RGBA'); red.putalpha(120); overlay.alpha_composite(red); overlay.save(output / 'overlay.png')
    left, right = Image.new('L', (width, height)), Image.new('L', (width, height)); left.paste(Image.fromarray((mask(word) * 255).astype(np.uint8))); right.paste(Image.fromarray((mask(web) * 255).astype(np.uint8))); ImageChops.difference(left, right).save(output / 'diff.png')


def render_fixture(path: Path, size: tuple[int, int], dpi: int, rule_x: int) -> None:
    image = Image.new('RGB', size, 'white'); draw = ImageDraw.Draw(image); scale = size[0] / 200
    draw.rectangle((10 * scale, 10 * scale, 190 * scale, 90 * scale), outline='black', width=max(1, round(2 * scale)))
    draw.line((rule_x * scale, 10 * scale, rule_x * scale, 90 * scale), fill='black', width=max(1, round(2 * scale)))
    draw.rectangle((70 * scale, 35 * scale, 88 * scale, 39 * scale), fill='black')  # text-adjacent ink
    image.save(path, dpi=(dpi, dpi))


def self_test() -> int:
    root = Path(tempfile.mkdtemp(prefix='gc-semantic-self-test-'))
    try:
        word_path, web_path, shifted_path = root/'word-144.png', root/'web-96.png', root/'web-shifted-96.png'
        render_fixture(word_path, (300, 150), 144, 100); render_fixture(web_path, (200, 100), 96, 100); render_fixture(shifted_path, (200, 100), 96, 102)
        word = read_normalized(word_path, {'dpi': 144}); web = read_normalized(web_path, {'dpi': 96}); shifted = read_normalized(shifted_path, {'dpi': 96})
        if word.size != (200, 100): raise AssertionError(f'144 DPI Lanczos normalization failed: {word.size}')
        central = lambda image: round(np.where(mask(image)[10:90, 90:115].sum(axis=0) >= 60)[0].mean() + 90, 2)
        if abs(central(shifted) - central(web)) <= TOLERANCE: raise AssertionError('2 CSS-px rule shift passed after 144-to-96 normalization')
        if abs(central(word) - central(web)) > TOLERANCE: raise AssertionError('identical normalized fixture failed')
        print('SELF-TEST GREEN: 144-DPI Lanczos normalized fixture matches; realistic 2 CSS-px rule shift detected')
        return 0
    finally: shutil.rmtree(root, ignore_errors=True)


def audit(root: Path, strict: bool) -> int:
    runs = sorted(path for path in root.glob('visual-qa-*') if path.is_dir())
    if not runs: raise FileNotFoundError(f'no visual-qa-* run under {root}')
    run = runs[-1]; manifest = load_json(Path(__file__).with_name('gc-word-table-manifest.json')); expected_ids = [entry['templateId'] for entry in manifest['entries']]
    directories = {path.name: path for path in run.iterdir() if path.is_dir()}; unexpected = sorted(set(directories) - set(expected_ids)); missing, tables = [], []
    for template_id in expected_ids:
        folder = directories.get(template_id)
        for role in ('reference', 'sample'):
            required = [folder / f'{role}-word.png', folder / f'{role}-word.json', folder / f'{role}-web.png', folder / f'{role}-web.json'] if folder else []
            if not folder or not all(path.exists() for path in required): missing.append(f'{template_id}/{role}'); continue
            source_meta, web = load_json(required[1]), load_json(required[3]); word, web_image = read_normalized(required[0], source_meta), read_normalized(required[2], web)
            semantic = compare_semantic_table(source_meta, web, word, web_image); write_artifacts(word, web_image, folder / role)
            tables.append({'templateId': template_id, 'role': role, **semantic, 'geometryMismatch': bool(semantic['geometryMismatches'] or semantic['borderMismatches']), 'wrapMismatch': bool(semantic['textWrapMismatches'])})
    failures = [item for item in tables if item['geometryMismatch'] or item['wrapMismatch']]
    summary = {'run': str(run), 'strict': strict, 'tablesExpected': 66, 'tablesCompared': len(tables), 'geometryMatched': sum(not x['geometryMismatch'] for x in tables), 'shiftedBorders': sum(bool(x['borderMismatches']) for x in tables), 'wrapMismatches': sum(bool(x['wrapMismatch']) for x in tables), 'missing': missing, 'unexpectedDirectories': unexpected, 'mismatches': failures, 'tables': tables}
    (run/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"{summary['geometryMatched']}/66 tables geometry matched; {summary['shiftedBorders']} border-run mismatches; {summary['wrapMismatches']} cell-wrap mismatches; unexpected dirs={len(unexpected)}")
    return 1 if strict and (len(tables) != 66 or missing or failures) else 0


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument('--self-test', action='store_true'); parser.add_argument('--input', type=Path); parser.add_argument('--strict', action='store_true'); args = parser.parse_args()
    if args.self_test: return self_test()
    if not args.input: parser.error('--input is required unless --self-test is used')
    return audit(args.input.resolve(), args.strict)


if __name__ == '__main__': raise SystemExit(main())
