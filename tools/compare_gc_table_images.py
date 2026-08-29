#!/usr/bin/env python3
"""Strict, reusable visual geometry audit for exported Word and live web tables.

The tool deliberately compares geometry rather than RGB pixels: Word and Chromium
use different font rasterisers, so antialias shades must not hide a moved rule.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
import numpy as np

INK_LIMIT = 180
LINE_TOLERANCE_PX = 1
SIZE_TOLERANCE_PX = 1


@dataclass
class Geometry:
    size: tuple[int, int]
    bbox: tuple[int, int, int, int]
    vertical: list[int]
    horizontal: list[int]
    text_lines: list[int]


def read_dpi(path: Path) -> float:
    sidecar = path.with_suffix('.json')
    if sidecar.exists():
        try:
            return float(json.loads(sidecar.read_text(encoding='utf-8')).get('dpi', 96))
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    with Image.open(path) as image:
        dpi = image.info.get('dpi')
    return float(dpi[0]) if dpi else 96.0


def normalize_dpi(image: Image.Image, source_dpi: float) -> Image.Image:
    """Return a 96-DPI image; geometry is then directly comparable to CSS pixels."""
    scale = 96.0 / source_dpi
    if abs(scale - 1) < 0.001:
        return image.convert('RGB')
    return image.convert('RGB').resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )


def ink_mask(image: Image.Image) -> Image.Image:
    gray = image.convert('L')
    return gray.point(lambda value: 255 if value < INK_LIMIT else 0, mode='1')


def content_bbox(mask: Image.Image) -> tuple[int, int, int, int]:
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError('no table ink detected')
    return bbox


def local_positions(values: list[int], threshold: int) -> list[int]:
    """Turn adjacent high projection pixels into one rule position."""
    chosen = [index for index, value in enumerate(values) if value >= threshold]
    groups: list[list[int]] = []
    for value in chosen:
        if not groups or value > groups[-1][-1] + 1:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [round(sum(group) / len(group)) for group in groups]


def text_line_positions(mask: Image.Image, bbox: tuple[int, int, int, int], horizontal: list[int]) -> list[int]:
    """Find text baselines as ink bands that are not full-width horizontal rules."""
    crop = mask.crop(bbox)
    width, height = crop.size
    rows = np.asarray(crop, dtype=np.uint8).astype(bool).sum(axis=1).tolist()
    rule_rows = {position - bbox[1] for position in horizontal}
    candidates = [index for index, amount in enumerate(rows)
                  if 1 <= amount < max(2, round(width * 0.65)) and index not in rule_rows]
    groups: list[list[int]] = []
    for value in candidates:
        if not groups or value > groups[-1][-1] + 1:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [round(sum(group) / len(group)) + bbox[1] for group in groups if len(group) >= 1]


def inspect(image: Image.Image) -> Geometry:
    mask = ink_mask(image)
    bbox = content_bbox(mask)
    crop = mask.crop(bbox)
    width, height = crop.size
    pixels = np.asarray(crop, dtype=np.uint8).astype(bool)
    columns = pixels.sum(axis=0).tolist()
    rows = pixels.sum(axis=1).tolist()
    vertical = [value + bbox[0] for value in local_positions(columns, max(1, round(height * 0.72)))]
    horizontal = [value + bbox[1] for value in local_positions(rows, max(1, round(width * 0.72)))]
    return Geometry(image.size, bbox, vertical, horizontal, text_line_positions(mask, bbox, horizontal))


def relative(items: list[int], origin: int) -> list[int]:
    return [value - origin for value in items]


def deltas(expected: list[int], actual: list[int]) -> list[dict]:
    result: list[dict] = []
    if len(expected) != len(actual):
        result.append({'expectedCount': len(expected), 'actualCount': len(actual), 'deltaPx': None})
    for index, (left, right) in enumerate(zip(expected, actual)):
        delta = right - left
        if abs(delta) > LINE_TOLERANCE_PX:
            result.append({'index': index, 'expectedPx': left, 'actualPx': right, 'deltaPx': delta})
    return result


def compare_images(word_path: Path, web_path: Path, output_dir: Path | None = None) -> dict:
    with Image.open(word_path) as word_source, Image.open(web_path) as web_source:
        word = normalize_dpi(word_source, read_dpi(word_path))
        web = normalize_dpi(web_source, read_dpi(web_path))
    word_geo, web_geo = inspect(word), inspect(web)
    word_width = word_geo.bbox[2] - word_geo.bbox[0]
    word_height = word_geo.bbox[3] - word_geo.bbox[1]
    web_width = web_geo.bbox[2] - web_geo.bbox[0]
    web_height = web_geo.bbox[3] - web_geo.bbox[1]
    size_delta = {'widthPx': web_width - word_width, 'heightPx': web_height - word_height}
    vertical_delta = deltas(relative(word_geo.vertical, word_geo.bbox[0]), relative(web_geo.vertical, web_geo.bbox[0]))
    horizontal_delta = deltas(relative(word_geo.horizontal, word_geo.bbox[1]), relative(web_geo.horizontal, web_geo.bbox[1]))
    wrap_delta = deltas(relative(word_geo.text_lines, word_geo.bbox[1]), relative(web_geo.text_lines, web_geo.bbox[1]))
    geometry_mismatch = (abs(size_delta['widthPx']) > SIZE_TOLERANCE_PX
                         or abs(size_delta['heightPx']) > SIZE_TOLERANCE_PX
                         or bool(vertical_delta) or bool(horizontal_delta))
    wrap_mismatch = bool(wrap_delta)
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        canvas_width, canvas_height = max(word_width, web_width), max(word_height, web_height)
        left = word.crop(word_geo.bbox).convert('RGBA')
        right = web.crop(web_geo.bbox).convert('RGBA')
        overlay = Image.new('RGBA', (canvas_width, canvas_height), 'white')
        overlay.alpha_composite(left, (0, 0))
        red = right.copy(); red.putalpha(120)
        overlay.alpha_composite(red, (0, 0))
        overlay.save(output_dir / 'overlay.png')
        # Difference is deliberately structural: only thresholded rule/text ink is shown.
        left_mask = ink_mask(left).convert('L')
        right_mask = ink_mask(right).convert('L')
        padded_left = Image.new('L', (canvas_width, canvas_height)); padded_left.paste(left_mask)
        padded_right = Image.new('L', (canvas_width, canvas_height)); padded_right.paste(right_mask)
        diff = ImageChops.difference(padded_left, padded_right)
        diff.save(output_dir / 'diff.png')
    return {
        'word': {'path': str(word_path), 'dpi': read_dpi(word_path), 'geometry': word_geo.__dict__},
        'web': {'path': str(web_path), 'dpi': read_dpi(web_path), 'geometry': web_geo.__dict__},
        'sizeDeltaPx': size_delta,
        'verticalLineDeltas': vertical_delta,
        'horizontalLineDeltas': horizontal_delta,
        'wrapDeltas': wrap_delta,
        'geometryMismatch': geometry_mismatch,
        'wrapMismatch': wrap_mismatch,
    }


def write_png(path: Path, shifted: bool = False) -> None:
    image = Image.new('RGB', (200, 100), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 190, 90), outline='black', width=1)
    x = 100 + (2 if shifted else 0)
    draw.line((x, 10, x, 90), fill='black', width=1)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, dpi=(96, 96))


def self_test() -> int:
    fixture_root = Path(tempfile.mkdtemp(prefix='gc-table-compare-self-test-'))
    try:
        word = fixture_root / 'word.png'; identical = fixture_root / 'identical.png'; shifted = fixture_root / 'shifted.png'
        write_png(word); write_png(identical); write_png(shifted, shifted=True)
        equal = compare_images(word, identical)
        moved = compare_images(word, shifted)
        if equal['geometryMismatch'] or equal['wrapMismatch']:
            raise AssertionError(f'identical fixture unexpectedly failed: {equal}')
        if not moved['geometryMismatch']:
            raise AssertionError(f'2px line-shift fixture unexpectedly passed: {moved}')
        print('SELF-TEST GREEN: identical geometry matched; 2px vertical line shift detected')
        return 0
    finally:
        shutil.rmtree(fixture_root, ignore_errors=True)


def find_run(root: Path) -> Path:
    candidates = sorted(path for path in root.glob('visual-qa-*') if path.is_dir())
    if not candidates:
        raise FileNotFoundError(f'no visual-qa-* run under {root}')
    return candidates[-1]


def audit(root: Path, strict: bool) -> int:
    run = find_run(root)
    table_results: list[dict] = []
    missing: list[str] = []
    template_dirs = sorted(path for path in run.iterdir() if path.is_dir())
    for template_dir in template_dirs:
        for role in ('reference', 'sample'):
            word, web = template_dir / f'{role}-word.png', template_dir / f'{role}-web.png'
            if not word.exists() or not web.exists():
                missing.append(f'{template_dir.name}/{role}: word={word.exists()} web={web.exists()}')
                continue
            result = compare_images(word, web, template_dir / role)
            result.update({'templateId': template_dir.name, 'role': role})
            table_results.append(result)
    failures = [item for item in table_results if item['geometryMismatch'] or item['wrapMismatch']]
    summary = {
        'run': str(run), 'strict': strict, 'tablesCompared': len(table_results), 'tablesExpected': 66,
        'geometryMatched': len([item for item in table_results if not item['geometryMismatch']]),
        'shiftedBorders': sum(bool(item['verticalLineDeltas'] or item['horizontalLineDeltas']) for item in table_results),
        'wrapMismatches': sum(bool(item['wrapMismatch']) for item in table_results),
        'missing': missing, 'mismatches': failures, 'tables': table_results,
    }
    (run / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"{summary['geometryMatched']}/{summary['tablesExpected']} tables geometry matched; "
          f"{summary['shiftedBorders']} shifted borders; {summary['wrapMismatches']} wrap mismatches")
    if missing:
        print('MISSING: ' + '; '.join(missing), file=sys.stderr)
    return 1 if strict and (len(table_results) != 66 or missing or failures) else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--input', type=Path)
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.input:
        parser.error('--input is required unless --self-test is used')
    return audit(args.input.resolve(), args.strict)


if __name__ == '__main__':
    raise SystemExit(main())
