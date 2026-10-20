"""Prevent unsafe answer matching and loss of real Word underline fields."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_physicochemical_answers import match_answers, standard_identity, split_runs, resolve_block


class AnswerMappingTests(unittest.TestCase):
    def test_word_underlined_spaces_and_literal_underscores_are_fields(self):
        runs = split_runs([('初显', False), ('    ', True), ('色，再变____。', False)])
        self.assertEqual([r['text'] for r in runs if r.get('blank')], ['    ', '____'])
        self.assertEqual(''.join(r['text'] for r in runs), '初显    色，再变____。')

    def test_complete_context_maps_only_unique_standard_answers(self):
        runs = split_runs([('取本品粉末少量，加硫酸1滴，显', False), ('   ', True),
                           ('，渐变', False), ('   ', True), ('，后转', False),
                           ('   ', True), ('。', False)])
        self.assertEqual(match_answers(runs, ['取本品粉末少量，加硫酸1滴，显红色，渐变紫色，后转褐色。']),
                         ['红色', '紫色', '褐色'])
        self.assertEqual(match_answers(runs, [
            '取本品粉末少量，加硫酸1滴，显红色，渐变紫色，后转褐色。',
            '取本品粉末少量，加硫酸1滴，显黄色，渐变紫色，后转褐色。']), ['', '', ''])

    def test_local_reaction_context_can_fill_when_record_has_extra_batch_mass(self):
        runs = split_runs([('取本品粉末1g（____g），加水10ml。取滤液1ml，加试液，即显', False),
                           ('    ', True), ('色。', False)])
        self.assertEqual(match_answers(runs, ['取本品粉末1g，加水10ml。取滤液1ml，加试液，即显红色。']), ['', '红'])

    def test_equipment_and_actual_mass_never_become_standard_answers(self):
        for text, standard in [
            ('分析天平型号：____；编号：____。', '分析天平型号：ABC；编号：123。'),
            ('取本品粉末（____）g，加水10ml。', '取本品粉末（2）g，加水10ml。'),
        ]:
            runs = split_runs([(text, False)])
            self.assertTrue(all(not v for v in match_answers(runs, [standard])))

    def test_nearby_unrelated_and_cross_paragraph_text_cannot_supply_an_answer(self):
        runs = split_runs([('加硫酸，即显', False), ('____', True), ('色。', False)])
        self.assertEqual(match_answers(runs, ['加盐酸，即显红色。']), [''])
        self.assertEqual(match_answers(runs, ['加硫酸，即显', '红色。']), [''])

    def test_standard_identity_preserves_kind_code_product_and_edition(self):
        self.assertEqual(standard_identity('064薄荷原料检验记录3.doc'),
                         standard_identity('064薄荷原料质量标准.doc'))
        self.assertNotEqual(standard_identity('064薄荷原料检验记录3.doc'),
                            standard_identity('06401薄荷成品质量标准.doc'))
        self.assertNotEqual(standard_identity('01602白茯苓成品检验记录（上海2018）3.doc'),
                            standard_identity('01602白茯苓成品质量标准（浙炮2015）.doc'))
        self.assertIsNone(standard_identity('无法识别.doc'))

    def test_repeated_instrument_lines_keep_the_correct_section_underlines(self):
        first = split_runs([('编号：', False), ('   ', True)])
        second = split_runs([('编号：', False), ('            ', True)])
        paragraphs = [('显微', []), ('编号：   ', first), ('结果', []),
                      ('理化', []), ('编号：            ', second), ('结果', [])]
        block = {'title':'理化', 'lines':['编号： ', '结果']}
        self.assertEqual(resolve_block(block, paragraphs), [second, []])

    def test_weak_single_word_context_and_unknown_standard_stay_blank(self):
        runs = split_runs([('显', False), ('____', True), ('色。', False)])
        self.assertEqual(match_answers(runs, ['显红色。']), [''])
        self.assertEqual(match_answers(runs, []), [''])

    def test_method_conditions_cannot_be_dropped_to_find_a_near_match(self):
        cases = [
            ('取水层1ml，加三氯化铁试液，即显____色。', '取乙醚层1ml，加三氯化铁试液，即显蓝色。'),
            ('取滤液1ml，加10%三氯化铁试液，即显____色。', '取滤液1ml，加20%三氯化铁试液，即显红色。'),
            ('在365nm下观察，取滤液1ml，加三氯化铁试液，即显____色。',
             '在254nm下观察，取滤液1ml，加三氯化铁试液，即显红色。'),
            ('在365nm下观察。取滤液1ml，加三氯化铁试液，即显____色。',
             '在254nm下观察。取滤液1ml，加三氯化铁试液，即显红色。'),
        ]
        for record, standard in cases:
            with self.subTest(record=record):
                self.assertEqual(match_answers(split_runs([(record, False)]), [standard]), [''])

    def test_trailing_standard_year_is_not_a_record_revision(self):
        self.assertNotEqual(standard_identity('001薄荷原料检验记录2015.doc'),
                            standard_identity('001薄荷原料质量标准2020.doc'))
        self.assertNotEqual(standard_identity('001薄荷原料检验记录药典2015.doc'),
                            standard_identity('001薄荷原料质量标准药典2020.doc'))

    def test_nominal_mass_parentheses_normalization_retains_all_method_conditions(self):
        record = '取本品粉末1g（____g），加水10ml，取滤液1ml，加试液，即显____色。'
        self.assertEqual(match_answers(split_runs([(record, False)]),
            ['取本品粉末1g，加水10ml，取滤液1ml，加试液，即显红色。']), ['', '红'])
        self.assertEqual(match_answers(split_runs([(record, False)]),
            ['取本品粉末1g，加水20ml，取滤液1ml，加试液，即显红色。']), ['', ''])


if __name__ == '__main__':
    unittest.main()
