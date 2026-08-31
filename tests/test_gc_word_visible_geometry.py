#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from derive_gc_word_visible_geometry import derive_runtime_and_provenance  # noqa: E402
from compare_gc_table_images import compare_border_evidence  # noqa: E402


def make_fixture(root: Path) -> Path:
    image = Image.new('RGB', (91, 62), 'white')
    draw = ImageDraw.Draw(image)
    # Main visible table: 3 x 3 cells at 144 DPI. The middle row has a clipped
    # Word-only horizontal overhang to x=90, independent of the main outer rule.
    for x in (0, 20, 40, 60):
        draw.line((x, 0, x, 60), fill='black', width=2)
    for y in (0, 20, 40, 60):
        draw.line((0, y, 60, y), fill='black', width=2)
    draw.line((60, 20, 90, 20), fill='black', width=2)
    draw.line((60, 40, 90, 40), fill='black', width=2)
    image_path = root / 'sample-word.png'
    image.save(image_path, dpi=(144, 144))
    meta = {
        'dpi': 144,
        'sourceFile': r'C:\private\known.docx',
        'sourceTableIndex': 7,
        'sourceSha256Before': 'a' * 64,
        'usedTempRecovery': False,
        'recoveryReason': None,
        'temporarySuffix': None,
        'pageLeftMarginPt': 55,
        'crop': {
            'originPx144': {'x': 120, 'y': 200},
            'cropPx144': {'width': 91, 'height': 62},
        },
        'sourceStructure': {
            'gridPt': [10, 10, 10, 20],
            'rows': [{'heightPt': 10}, {'heightPt': 10}, {'heightPt': 10}],
            'indentPt': 9999999,
            'cells': [
                {'rowIndex': row, 'cellIndex': col, 'gridColumnIndex': col, 'gridSpan': 1,
                 'verticalMerge': None, 'textLineCount': 0, 'text': '', 'borders': {}}
                for row in (1, 2, 3) for col in (1, 2, 3)
            ],
        },
    }
    json_path = root / 'sample-word.json'
    json_path.write_text(json.dumps(meta), encoding='utf-8')
    return json_path


with tempfile.TemporaryDirectory(prefix='gc-visible-geometry-test-') as tmp:
    word_json = make_fixture(Path(tmp))
    runtime, provenance = derive_runtime_and_provenance(word_json)
    assert runtime['visibleColumnCount'] == 3
    assert all(abs(value - expected) < 0.01 for value, expected in zip(runtime['renderGridPt'], [10.0, 10.0, 10.25])), runtime['renderGridPt']
    assert abs(runtime['renderWidthPt'] - 30.25) < 0.01
    assert runtime['renderIndentPt'] == 5.0
    assert all(abs(value - 10.0) < 0.001 for value in runtime['renderHeightPt']), runtime['renderHeightPt']
    assert provenance['borderEvidence']['horizontalSegments'], 'Word-visible clipped overhang must remain private QA evidence'
    assert 'sourceFile' not in runtime and 'sourceSha256' not in runtime and 'imageDpi' not in runtime
    assert provenance['sourceFile'].startswith('C:\\private')
    assert provenance['sourceSha256'] == 'a' * 64
    assert provenance['borderEvidence']['verticalSegments']
    assert provenance['borderEvidence']['horizontalSegments']

    matching = provenance['borderEvidence']
    assert compare_border_evidence(matching, matching) == []
    shifted = json.loads(json.dumps(matching))
    shifted['verticalSegments'][0]['positionPx'] += 2.01
    mismatches = compare_border_evidence(matching, shifted)
    assert any(item['metric'] == 'verticalBorderPositionPx' for item in mismatches)

    invalid = json.loads(word_json.read_text(encoding='utf-8'))
    del invalid['crop']['originPx144']
    invalid_path = Path(tmp) / 'invalid-word.json'
    invalid_path.write_text(json.dumps(invalid), encoding='utf-8')
    shutil.copy2(Path(tmp) / 'sample-word.png', Path(tmp) / 'invalid-word.png')
    try:
        derive_runtime_and_provenance(invalid_path)
    except ValueError as exc:
        assert 'render indent evidence' in str(exc)
    else:
        raise AssertionError('missing/sentinel indent evidence was accepted')

print('PASS: visible geometry derives independent grid/border/indent evidence and splits public/private data')
