#!/usr/bin/env python3
"""Strict semantic Word-table QA: source structure + live DOM + cropped pixels."""
from __future__ import annotations

import argparse, json, math, shutil, sys, tempfile
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageOps
import numpy as np
from derive_gc_word_visible_geometry import derive_runtime_and_provenance, extract_border_evidence

TOLERANCE = 1.0
PT_TO_CSS = 96.0 / 72.0
INK_LIMIT = 180
PLACEHOLDER_TEXT_VALUES = {'—', '–', '-', '―'}


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
        return None
    delta = actual - expected
    if abs(delta) > TOLERANCE:
        return {'metric': name, 'expected': round(expected, 3), 'actual': round(actual, 3), 'deltaPx': round(delta, 3), **identity}
    return None


def compare_border_evidence(expected: dict, actual: dict) -> list[dict]:
    """Compare independently derived Word PNG runs with browser DOM border runs."""
    mismatches: list[dict] = []
    def localize(evidence: dict, collection: str) -> list[dict]:
        outer = evidence.get('mainOuterPx') or {}
        left, top = float(outer.get('left', 0)), float(outer.get('top', 0))
        localized = []
        for item in evidence.get(collection, []):
            value = dict(item)
            if collection == 'verticalSegments':
                value['positionPx'] = float(value['positionPx']) - left
                value['startPx'] = float(value['startPx']) - top
                value['endPx'] = float(value['endPx']) - top
            else:
                value['positionPx'] = float(value['positionPx']) - top
                value['startPx'] = float(value['startPx']) - left
                value['endPx'] = float(value['endPx']) - left
            localized.append(value)
        return localized
    specs = (
        ('verticalSegments', ('rowStart', 'rowEnd'), 'vertical'),
        ('horizontalSegments', ('boundary',), 'horizontal'),
    )
    for collection, identity_keys, axis in specs:
        left = sorted(localize(expected, collection), key=lambda item: tuple(item.get(key) for key in identity_keys) + (item.get('positionPx', 0), item.get('startPx', 0)))
        right = sorted(localize(actual, collection), key=lambda item: tuple(item.get(key) for key in identity_keys) + (item.get('positionPx', 0), item.get('startPx', 0)))
        if len(left) != len(right):
            mismatches.append({'metric': f'{axis}BorderSegmentCount', 'expected': len(left), 'actual': len(right)})
        for index, (source, web) in enumerate(zip(left, right)):
            identity = {'axis': axis, 'segment': index, **{key: source.get(key) for key in identity_keys}}
            for key, metric_name in (
                ('positionPx', f'{axis}BorderPositionPx'),
                ('startPx', f'{axis}BorderStartPx'),
                ('endPx', f'{axis}BorderEndPx'),
                ('thicknessPx', f'{axis}BorderThicknessPx'),
            ):
                item = metric(metric_name, source.get(key), web.get(key), **identity)
                if item:
                    mismatches.append(item)
    return mismatches


def close_enough(left: object, right: object, tolerance: float = 0.000001) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return abs(float(left) - float(right)) <= tolerance
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(close_enough(a, b, tolerance) for a, b in zip(left, right))
    return left == right


def validate_visible_asset_entry(template_id: str, role: str, asset: dict, derived: dict) -> None:
    required_keys = [
        'sourceFile', 'sourceTableIndex', 'sourceSha256', 'imageDpi',
        'renderWidthPt', 'renderScale', 'renderGridPt', 'renderHeightPt',
        'sourceTextLineCounts',
    ]
    missing = [key for key in required_keys if key not in asset]
    if missing:
        raise ValueError(f'{template_id}/{role}: visible geometry asset missing {missing}')
    for key in required_keys:
        if not close_enough(asset.get(key), derived.get(key)):
            raise ValueError(f'{template_id}/{role}: visible geometry asset {key} differs from current Word sidecar')


def unavailable_warning(name: str, expected: float | None, actual: float | None, **identity: object) -> dict:
    """Record an unavailable metric without making it a strict comparison failure."""
    status = 'notApplicable' if expected is None else 'unavailable'
    return {'metric': name, 'expected': expected, 'actual': actual, 'status': status, **identity}


def border_style(value: str | None) -> str:
    return {'single': 'solid', 'double': 'double', 'nil': 'none', 'none': 'none'}.get(value or 'none', value or 'none')


def normalize_text(value: object | None) -> str:
    if value is None:
        return ''
    return ' '.join(str(value).replace('\xa0', ' ').split())


def text_state(value: object | None) -> str:
    text = normalize_text(value)
    if not text:
        return 'empty'
    if text in PLACEHOLDER_TEXT_VALUES:
        return 'placeholder'
    return 'content'


def content_presence_mismatches(source_cells: dict[str, dict], web_cells: dict[str, dict]) -> list[dict]:
    mismatches = []
    for key in sorted(set(source_cells) & set(web_cells)):
        source_text = source_cells[key].get('renderedSemanticExpected') or source_cells[key].get('text')
        actual_text = web_cells[key].get('text')
        source_state = text_state(source_text)
        actual_state = text_state(actual_text)
        if source_state == actual_state:
            continue
        if source_state == 'content' and actual_state == 'content':
            continue
        mismatches.append({'metric': 'contentPresenceMismatch', 'cellId': key, 'row': source_cells[key]['rowIndex'], 'column': source_cells[key]['gridColumnIndex'], 'expected': source_text, 'actual': actual_text, 'sourceState': source_state, 'actualState': actual_state})
    return mismatches


def exact_content_mismatches(source_cells: dict[str, dict], web_cells: dict[str, dict]) -> list[dict]:
    mismatches = []
    for key, source in sorted(source_cells.items()):
        expected = source.get('renderedSemanticExpected')
        if not expected:
            continue
        actual = (web_cells.get(key) or {}).get('renderedSemantic')
        if expected != actual:
            mismatches.append({'metric': 'exactRenderedSemanticContent', 'cellId': key,
                               'row': source['rowIndex'], 'column': source['gridColumnIndex'],
                               'expected': expected, 'actual': actual})
    return mismatches


def semantic_text_line_mismatches(source_cells: dict[str, dict], web_cells: dict[str, dict], blocked_keys: set[str] | None = None) -> list[dict]:
    """Gate only wrap differences for cells that contain substantive text on both sides."""
    mismatches = []
    blocked = blocked_keys or set()
    for key in sorted(set(source_cells) & set(web_cells)):
        if key in blocked:
            continue
        if text_state(source_cells[key].get('text')) != 'content' or text_state(web_cells[key].get('text')) != 'content':
            continue
        expected, actual = source_cells[key].get('textLineCount'), web_cells[key].get('textLineCount')
        if expected is not None and actual is not None and expected != actual:
            mismatches.append({'metric': 'textWrapMismatch', 'cellId': key, 'row': source_cells[key]['rowIndex'], 'column': source_cells[key]['gridColumnIndex'], 'expected': expected, 'actual': actual, 'deltaLines': actual - expected})
    return mismatches


def source_cells(structure: dict, visible_column_count: int | None = None) -> dict[str, dict]:
    raw = structure['cells']; by_position = {(c['rowIndex'], c['gridColumnIndex']): c for c in raw}
    result: dict[str, dict] = {}
    for cell in raw:
        if cell.get('verticalMerge') == 'continue':
            continue
        if visible_column_count is not None and cell['gridColumnIndex'] > visible_column_count:
            continue
        if visible_column_count is not None and cell['gridColumnIndex'] - 1 + cell['gridSpan'] > visible_column_count:
            raise ValueError(f'source cell r{cell["rowIndex"]}c{cell["gridColumnIndex"]} crosses visible column boundary')
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


def source_geometry(structure: dict, word_image: Image.Image, visible: dict | None = None) -> tuple[list[float], list[float], dict[str, tuple[float, float, float, float]]]:
    # OOXML heightPt is Word's atLeast minimum. The trusted Word PNG grid is
    # authoritative for visual QA and is recorded in the companion asset.
    grid_source = (visible or {}).get('renderGridPt') or structure['gridPt']
    rows_source = (visible or {}).get('renderHeightPt') or [row.get('heightPt') or 0 for row in structure['rows']]
    grid = [float(value) * PT_TO_CSS for value in grid_source]
    row_values = [float(value) * PT_TO_CSS for value in rows_source]
    # If a source row has no explicit height, only image-region text checking uses
    # a proportional fallback; structural row-height comparison is unavailable.
    x = cumulative(grid); y = cumulative(row_values)
    visible_count = (visible or {}).get('visibleColumnCount')
    source = source_cells(structure, visible_count); cell_rects = {}
    declared_width, declared_height = x[-1] or 1, y[-1] or 1
    for key, cell in source.items():
        r, c = cell['rowIndex'] - 1, cell['gridColumnIndex'] - 1
        cell_rects[key] = (x[c] / declared_width * word_image.width, y[r] / declared_height * word_image.height,
                           (x[c + cell['gridSpan']] - x[c]) / declared_width * word_image.width,
                           (y[r + cell['rowSpan']] - y[r]) / declared_height * word_image.height)
    return grid, row_values, cell_rects


def compare_semantic_table(source_meta: dict, web: dict, word_image: Image.Image, web_image: Image.Image,
                           visible: dict, provenance: dict) -> dict:
    structure = source_meta['sourceStructure']
    grid, rows, word_cell_rects = source_geometry(structure, word_image, visible)
    geometry: list[dict] = []
    web_outer = web.get('outer') or {}
    actual_crop_width = web_outer.get('width', web_image.width)
    actual_crop_height = web_outer.get('height', web_image.height)
    for item in (
        metric('normalizedTableCropWidthPx', word_image.width, actual_crop_width),
        metric('normalizedTableCropHeightPx', word_image.height, actual_crop_height),
        metric('tableIndentInContainerPx', float(visible['renderIndentPt']) * PT_TO_CSS,
               (web.get('placement') or {}).get('tableLeftInContainerPx')),
    ):
        if item:
            geometry.append(item)

    for index, expected in enumerate(grid, 1):
        actual = next((column['widthPx'] for column in web['columns'] if column['index'] == index), None)
        item = metric('columnWidthPx', expected, actual, column=index)
        if item:
            geometry.append(item)
    x_positions, y_positions = cumulative(grid), cumulative(rows)
    for index, expected in enumerate(rows, 1):
        web_row = next((row for row in web['rows'] if row['index'] == index), None)
        for item in (
            metric('rowHeightPx', expected, web_row['heightPx'] if web_row else None, row=index),
            metric('rowTopPx', y_positions[index - 1], web_row['y'] if web_row else None, row=index),
        ):
            if item:
                geometry.append(item)

    source = source_cells(structure, visible['visibleColumnCount'])
    web_cells = {cell['id']: cell for cell in web['cells']}
    for key in sorted(set(source) | set(web_cells)):
        left, right = source.get(key), web_cells.get(key)
        if not left or not right:
            geometry.append({'metric': 'cellPresence', 'cellId': key,
                             'expected': bool(left), 'actual': bool(right)})
            continue
        row, column = left['rowIndex'] - 1, left['gridColumnIndex'] - 1
        expected_rect = {
            'x': x_positions[column], 'y': y_positions[row],
            'width': x_positions[column + left['gridSpan']] - x_positions[column],
            'height': y_positions[row + left['rowSpan']] - y_positions[row],
        }
        for name, expected_value in expected_rect.items():
            item = metric(f'cell{name[0].upper()}{name[1:]}Px', expected_value, right[name],
                          cellId=key, row=left['rowIndex'], column=left['gridColumnIndex'])
            if item:
                geometry.append(item)
        if left['rowSpan'] != right['rowSpan'] or left['gridSpan'] != right['gridSpan']:
            geometry.append({'metric': 'cellSpan', 'cellId': key,
                             'expected': {'rowSpan': left['rowSpan'], 'gridSpan': left['gridSpan']},
                             'actual': {'rowSpan': right['rowSpan'], 'gridSpan': right['gridSpan']}})

    web_border_evidence = extract_border_evidence(web_image, 96.0, len(rows), 'web-capture')
    borders = compare_border_evidence(provenance['borderEvidence'], web_border_evidence)
    presence = content_presence_mismatches(source, web_cells)
    exact = exact_content_mismatches(source, web_cells)
    blocked = {item['cellId'] for item in presence}
    text = semantic_text_line_mismatches(source, web_cells, blocked)
    image_wrap_diagnostics = []
    for key in sorted(set(source) & set(web_cells)):
        if key not in word_cell_rects:
            continue
        right = web_cells[key]
        image_wrap_diagnostics.append({
            'metric': 'imageTextLineCount', 'cellId': key,
            'word': line_count(word_image, word_cell_rects[key]),
            'web': line_count(web_image, (right['x'], right['y'], right['width'], right['height'])),
        })
    return {
        'tableCrop': {'wordCssPx': {'width': word_image.width, 'height': word_image.height},
                      'webCssPx': {'width': actual_crop_width, 'height': actual_crop_height},
                      'webScreenshotCssPx': {'width': web_image.width, 'height': web_image.height}},
        'geometryMismatches': geometry, 'borderMismatches': borders,
        'contentPresenceMismatches': presence, 'textWrapMismatches': text,
        'exactContentMismatches': exact, 'imageWrapDiagnostics': image_wrap_diagnostics,
        'warnings': [], 'sourceCellCount': len(source), 'webCellCount': len(web_cells),
    }


def write_artifacts(word: Image.Image, web: Image.Image, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True); width, height = max(word.width, web.width), max(word.height, web.height)
    overlay = Image.new('RGBA', (width, height), 'white'); overlay.alpha_composite(word.convert('RGBA')); red = web.convert('RGBA'); red.putalpha(120); overlay.alpha_composite(red); overlay.save(output / 'overlay.png')
    left, right = Image.new('L', (width, height)), Image.new('L', (width, height)); left.paste(Image.fromarray((mask(word) * 255).astype(np.uint8))); right.paste(Image.fromarray((mask(web) * 255).astype(np.uint8))); ImageChops.difference(left, right).save(output / 'diff.png')


def write_contact_sheet(run: Path, artifact: str, output_name: str) -> None:
    files = sorted(run.glob(f'*/*/{artifact}.png'))
    if len(files) != 66:
        raise ValueError(f'{artifact} contact sheet expected 66 images, got {len(files)}')
    columns, tile_width, tile_height, label_height = 6, 240, 180, 18
    rows = math.ceil(len(files) / columns)
    sheet = Image.new('RGB', (columns * tile_width, rows * tile_height), 'white')
    draw = ImageDraw.Draw(sheet)
    for index, filename in enumerate(files):
        with Image.open(filename) as opened:
            thumb = ImageOps.contain(opened.convert('RGB'), (tile_width - 4, tile_height - label_height - 4))
        x, y = (index % columns) * tile_width, (index // columns) * tile_height
        label = f'{filename.parents[1].name}/{filename.parent.name}'
        draw.text((x + 2, y + 2), label, fill='black')
        sheet.paste(thumb, (x + 2, y + label_height))
    sheet.save(run / output_name)


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
        expected_semantic = 'text("x")|overline(text("A"))|fraction(text("B")|subscript(text("s")),text("C")|superscript(text("2")))'
        source = {'r1c1': {'rowIndex': 1, 'gridColumnIndex': 1, 'textLineCount': 1,
                           'text': '', 'renderedSemanticExpected': expected_semantic}}
        dom = {'r1c1': {'textLineCount': 1, 'text': 'xABC2', 'renderedSemantic': expected_semantic,
                        'fixedSemantic': expected_semantic}}
        if semantic_text_line_mismatches(source, dom): raise AssertionError('semantic text fixtures unexpectedly mismatched')
        if exact_content_mismatches(source, dom): raise AssertionError('matching fixed semantic content failed')
        mutations = [
            expected_semantic.replace('overline(', 'text("A")|ignored('),
            expected_semantic.replace('fraction(', 'sequence('),
            expected_semantic.replace('subscript(', 'text('),
            expected_semantic.replace('superscript(', 'text('),
            expected_semantic.replace('text("x")|overline', 'overline') + '|text("x")',
            expected_semantic.replace('text("B")', 'text("D")'),
            '',
        ]
        for mutation in mutations:
            dom['r1c1']['renderedSemantic'] = mutation
            dom['r1c1']['fixedSemantic'] = expected_semantic  # stale declaration must be irrelevant
            if len(exact_content_mismatches(source, dom)) != 1: raise AssertionError(f'rendered semantic mutation passed: {mutation}')
        border = {'verticalSegments': [{'rowStart': 1, 'rowEnd': 1, 'positionPx': 0, 'startPx': 0, 'endPx': 20, 'thicknessPx': 1}], 'horizontalSegments': []}
        shifted_border = json.loads(json.dumps(border)); shifted_border['verticalSegments'][0]['positionPx'] = 2.01
        if compare_border_evidence(border, border): raise AssertionError('identical border evidence failed')
        if not compare_border_evidence(border, shifted_border): raise AssertionError('2px border shift passed')
        print('SELF-TEST GREEN: normalized pixels, exact semantic content, and independent 1px border evidence are strict')
        return 0
    finally: shutil.rmtree(root, ignore_errors=True)


def audit(root: Path, strict: bool) -> int:
    runs = sorted(path for path in root.glob('visual-qa-*') if path.is_dir())
    if not runs: raise FileNotFoundError(f'no visual-qa-* run under {root}')
    run = runs[-1]; manifest = load_json(Path(__file__).with_name('gc-word-table-manifest.json')); expected_ids = [entry['templateId'] for entry in manifest['entries']]
    manifest_by_id = {entry['templateId']: entry for entry in manifest['entries']}
    asset_path = Path(__file__).resolve().parents[1] / 'assets' / 'gc-word-table-visible-geometry.js'
    asset_source = asset_path.read_text(encoding='utf-8')
    asset_prefix = 'const GC_WORD_TABLE_VISIBLE_GEOMETRY = Object.freeze('
    if not asset_source.startswith(asset_prefix) or not asset_source.rstrip().endswith(');'):
        raise ValueError(f'invalid visible geometry asset: {asset_path}')
    visible_asset = json.loads(asset_source[len(asset_prefix):].strip()[:-2])
    if set(visible_asset) != set(expected_ids):
        raise ValueError('visible geometry asset template coverage differs from manifest')
    private_path = run / 'visible-geometry-private.json'
    if not private_path.exists():
        raise FileNotFoundError(f'missing private provenance sidecar: {private_path}')
    private_asset = load_json(private_path)
    directories = {path.name: path for path in run.iterdir() if path.is_dir()}; unexpected = sorted(set(directories) - set(expected_ids)); missing, tables = [], []
    for template_id in expected_ids:
        folder = directories.get(template_id)
        for role in ('reference', 'sample'):
            required = [folder / f'{role}-word.png', folder / f'{role}-word.json', folder / f'{role}-web.png', folder / f'{role}-web.json'] if folder else []
            if not folder or not all(path.exists() for path in required): missing.append(f'{template_id}/{role}'); continue
            source_meta, web = load_json(required[1]), load_json(required[3]); word, web_image = read_normalized(required[0], source_meta), read_normalized(required[2], web)
            expected_source_index = manifest_by_id[template_id][f'{role}TableIndex']
            if int(source_meta.get('sourceTableIndex', -1)) != int(expected_source_index):
                raise ValueError(f'{template_id}/{role}: private source-table join differs from manifest')
            visible = visible_asset.get(template_id, {}).get(role)
            private = private_asset.get(template_id, {}).get(role)
            if not visible or not private:
                raise ValueError(f'missing visible geometry for {template_id}/{role}')
            derived_visible, derived_private = derive_runtime_and_provenance(required[1])
            if not close_enough(visible, derived_visible):
                raise ValueError(f'{template_id}/{role}: public runtime geometry differs from current Word evidence')
            if not close_enough(private, derived_private):
                raise ValueError(f'{template_id}/{role}: private provenance differs from current Word evidence')
            semantic = compare_semantic_table(source_meta, web, word, web_image, derived_visible, derived_private); write_artifacts(word, web_image, folder / role)
            tables.append({'templateId': template_id, 'role': role, **semantic,
                           'geometryMismatch': bool(semantic['geometryMismatches'] or semantic['borderMismatches']),
                           'wrapMismatch': bool(semantic['textWrapMismatches']),
                           'contentPresenceMismatch': bool(semantic['contentPresenceMismatches']),
                           'exactContentMismatch': bool(semantic['exactContentMismatches'])})
    failures = [item for item in tables if item['geometryMismatch'] or item['wrapMismatch'] or item['contentPresenceMismatch'] or item['exactContentMismatch'] or item['warnings']]
    write_contact_sheet(run, 'overlay', 'overlay-contact-sheet.png')
    write_contact_sheet(run, 'diff', 'diff-contact-sheet.png')
    summary = {'run': str(run), 'strict': strict, 'tablesExpected': 66, 'tablesCompared': len(tables), 'geometryMatched': sum(not x['geometryMismatch'] for x in tables), 'shiftedBorders': sum(bool(x['borderMismatches']) for x in tables), 'indentMismatches': sum(any(m.get('metric') == 'tableIndentInContainerPx' for m in x['geometryMismatches']) for x in tables), 'wrapMismatches': sum(bool(x['wrapMismatch']) for x in tables), 'contentPresenceMismatches': sum(bool(x['contentPresenceMismatch']) for x in tables), 'exactContentMismatches': sum(bool(x['exactContentMismatch']) for x in tables), 'warningOnlyExclusions': sum(bool(x['warnings']) for x in tables), 'missing': missing, 'unexpectedDirectories': unexpected, 'mismatches': failures, 'tables': tables}
    (run/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"{summary['geometryMatched']}/66 tables geometry matched; {summary['shiftedBorders']} border-run mismatches; {summary['indentMismatches']} indent mismatches; {summary['wrapMismatches']} cell-wrap mismatches; {summary['exactContentMismatches']} exact-content mismatches; warnings={summary['warningOnlyExclusions']}; unexpected dirs={len(unexpected)}")
    return 1 if strict and (len(tables) != 66 or missing or failures) else 0


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument('--self-test', action='store_true'); parser.add_argument('--input', type=Path); parser.add_argument('--strict', action='store_true'); args = parser.parse_args()
    if args.self_test: return self_test()
    if not args.input: parser.error('--input is required unless --self-test is used')
    return audit(args.input.resolve(), args.strict)


if __name__ == '__main__': raise SystemExit(main())
