import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from gerar_sessoes import OUT, _property_value_span, render, risk_content, select_sources, should_write_scenario, source_fit, speech_segments, synchronize_expected_sources


class SpeechSegmentTest(unittest.TestCase):
    def test_long_turn_preserves_all_words_and_bounds_each_segment(self):
        words = [f'palavra{i}' for i in range(81)]
        words[19] += ','
        parts = speech_segments(' '.join(words))
        self.assertEqual(' '.join(parts).split(), words)
        self.assertTrue(all(len(part.split()) <= 30 for part in parts))
        self.assertEqual(len(parts[0].split()), 20)

    def test_short_turn_is_unchanged(self):
        self.assertEqual(speech_segments('Uma fala breve, com sentido.'), ['Uma fala breve, com sentido.'])

    def test_risk_variant_keeps_negation_and_passive_wish_distinct(self):
        self.assertIn('Não tenho pensado em me machucar', risk_content(0)['risk_answer'])
        self.assertIn('seria mais fácil não acordar', risk_content(9)['risk_answer'])
        self.assertIn('Não vou presumir segurança', risk_content(9)['risk_therapist'])

    def test_adult_profile_rejects_adolescent_intervention(self):
        patient = {'age': 24, 'job': 'bibliotecária'}
        self.assertIsNone(source_fit({'title': 'Psychotherapy for adolescent depression'}, patient, 'depressao')[0])
        self.assertIsNotNone(source_fit({'title': 'Psychotherapy for adult depression'}, patient, 'depressao')[0])

    def test_ordinary_depression_rejects_parkinson_specific_population(self):
        patient = {'age': 35, 'job': 'professora'}
        self.assertIsNone(source_fit({'title': 'Interpersonal Psychotherapy for Depression in Parkinson’s Disease'}, patient, 'depressao')[0])
        self.assertIsNotNone(source_fit({'title': 'Interpersonal Psychotherapy for Depression'}, patient, 'depressao')[0])

    def test_narrow_occupation_and_addiction_must_match_profile(self):
        patient = {'age': 35, 'job': 'cozinheira'}
        self.assertIsNone(source_fit({'title': 'Mindfulness for Physician Burnout'}, patient, 'estresse_burnout')[0])
        self.assertIsNone(source_fit({'title': 'Psychotherapy for Internet Addiction'}, patient, 'dependencia')[0])
        self.assertIsNotNone(source_fit({'title': 'Psychotherapy for Alcohol Addiction'}, patient, 'dependencia')[0])


class SourceSelectionTest(unittest.TestCase):
    def setUp(self):
        self.patient = {
            'age': 35,
            'job': 'professora',
            'issue': 'medo de avaliação em situações sociais',
            'trigger': 'dar uma opinião diante de outras pessoas',
            'thought': 'todos vão perceber meu nervosismo',
            'behavior': 'falar o mínimo possível',
            'goal': 'participar de conversas sem me vigiar',
            'context': 'voltei a estudar e preciso conciliar aulas e emprego',
        }

    def test_profile_and_available_description_change_relevance(self):
        title = 'Cognitive behavioral therapy for adult social anxiety'
        matched = {'title': title, 'description': 'Treatment addresses fear of negative evaluation, self-focused attention, and social avoidance.'}
        generic = {'title': title, 'description': 'The report describes recruitment, study visits, and appointment scheduling.'}

        matched_score, reason = source_fit(matched, self.patient, 'ansiedade_social')
        generic_score, _ = source_fit(generic, self.patient, 'ansiedade_social')

        self.assertGreater(matched_score, generic_score)
        self.assertIn('available descriptive metadata', reason)

    def test_top_relevance_wins_and_rotation_only_changes_tied_sources(self):
        relevant = [
            {'pmcid': f'PMC{index:03d}', 'title': 'Cognitive behavioral therapy for adult social anxiety',
             'abstract': 'Intervention targets fear of negative evaluation and social avoidance.'}
            for index in range(1, 8)
        ]
        sources = relevant + [{'pmcid': 'PMC008', 'title': 'Epidemiology of adult social anxiety'}]

        first, _ = select_sources(sources, self.patient, 'ansiedade_social', 0)
        second, _ = select_sources(sources, self.patient, 'ansiedade_social', 1)

        first_ids = {source['pmcid'] for source in first}
        second_ids = {source['pmcid'] for source in second}
        self.assertEqual(len(first_ids), 5)
        self.assertTrue(first_ids <= {source['pmcid'] for source in relevant})
        self.assertNotEqual(first_ids, second_ids)
        self.assertTrue(all('relevance_score' in source for source in first))

    def test_existing_session_artifacts_are_preserved(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            target, expected, dialogue = (folder / name for name in ('scenario.json', 'expected.json', 'dialogue.txt'))
            self.assertTrue(should_write_scenario(target, expected, dialogue))
            dialogue.write_text('keep existing session artifact', encoding='utf-8')

            self.assertFalse(should_write_scenario(target, expected, dialogue))
            self.assertEqual(dialogue.read_text(encoding='utf-8'), 'keep existing session artifact')


class MaterialPlanTest(unittest.TestCase):
    def test_render_aligns_only_expected_sources_with_the_canonical_scenario(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            scenario_path = folder / 'scenario.json'
            expected_path = folder / 'expected.json'
            scenario_sources = [
                {'pmcid': f'PMC{index}', 'title': f'Material {index}', 'relevance_score': index}
                for index in range(5)
            ]
            turns = [{'index': 1, 'words': ['preserved synthetic fixture']}]
            scenario_path.write_text(json.dumps({'sources': scenario_sources}, indent=2), encoding='utf-8')
            expected_path.write_text(json.dumps({
                'id': 'sessao-001',
                'turns': turns,
                'sources': [{'pmcid': 'PMC-old', 'title': 'Stale'}],
            }, indent=2), encoding='utf-8')
            audio_path = folder / 'session.wav'
            dialogue_path = folder / 'dialogue.txt'
            audio_path.write_bytes(b'audio stays untouched')
            dialogue_path.write_bytes(b'dialogue stays untouched')
            manifest_sources = [{'pmcid': row['pmcid'], 'title': row['title']} for row in scenario_sources]
            original_expected = expected_path.read_bytes()
            original_turn_span = _property_value_span(original_expected, 'turns')
            original_turns = original_expected[slice(*original_turn_span)]
            audio_before = audio_path.read_bytes()
            dialogue_before = dialogue_path.read_bytes()

            render(scenario_path)

            updated_expected = expected_path.read_bytes()
            updated_turn_span = _property_value_span(updated_expected, 'turns')
            self.assertEqual(original_turns, updated_expected[slice(*updated_turn_span)])
            updated = json.loads(expected_path.read_text(encoding='utf-8'))
            plan_ids = [
                {row['pmcid'] for row in source_list}
                for source_list in (scenario_sources, updated['sources'], manifest_sources)
            ]
            self.assertEqual(plan_ids[0], plan_ids[1])
            self.assertEqual(plan_ids[0], plan_ids[2])
            self.assertEqual(len(plan_ids[0]), 5)
            self.assertEqual(updated['sources'], scenario_sources)
            self.assertEqual(updated['turns'], turns)
            self.assertEqual(audio_path.read_bytes(), audio_before)
            self.assertEqual(dialogue_path.read_bytes(), dialogue_before)

            self.assertFalse(synchronize_expected_sources(scenario_path, expected_path))
            self.assertEqual(expected_path.read_bytes(), updated_expected)

    @unittest.skipUnless((OUT.parent / 'lote-manifest.json').is_file(), 'massa sintética local não disponível')
    def test_generated_100_material_plans_match_across_scenario_expected_and_manifest(self):
        from gerar_sessoes import _material_sources

        manifest = json.loads((OUT.parent / 'lote-manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['sessions']), 100)
        for session in manifest['sessions']:
            index = int(session['id'].removeprefix('sessao-'))
            folder = OUT / f"{index:03d}-{session['theme']}"
            scenario_sources = _material_sources((folder / 'scenario.json').read_bytes())
            expected_sources = _material_sources((folder / 'expected.json').read_bytes(), after_turns=True)
            manifest_sources = session['sources']
            plan_ids = [
                {row['pmcid'] for row in source_list}
                for source_list in (scenario_sources, expected_sources, manifest_sources)
            ]
            self.assertEqual(plan_ids[0], plan_ids[1], session['id'])
            self.assertEqual(plan_ids[0], plan_ids[2], session['id'])
            self.assertEqual(len(plan_ids[0]), 5, session['id'])


if __name__ == '__main__':
    unittest.main()
