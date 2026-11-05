import unittest
from avaliar_transcricao import evaluate, tokens, word_error_rate


class EvaluationTest(unittest.TestCase):
    def test_edits_include_substitution_insertion_and_deletion(self):
        self.assertEqual(word_error_rate(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])['edits'], 2)
        self.assertEqual(word_error_rate(['a', 'b'], [])['wer'], 1)
        self.assertIsNone(word_error_rate([], ['extra'])['wer'])

    def test_normalization_preserves_negation_and_accents(self):
        self.assertEqual(tokens('Não, João!'), ['não', 'joão'])
        self.assertNotEqual(tokens('não'), tokens('nao'))

    def test_unknown_and_silence_are_not_counted_as_correct_speakers(self):
        expected = {'id': 'case', 'turns': [{'text': 'Olá', 'role': 'Paciente', 'start_seconds': 0, 'end_seconds': 1}]}
        words = [{'text': 'Olá', 'start_seconds': 0.2, 'role': 'Paciente'},
                 {'text': 'oi', 'start_seconds': 0.5, 'role': None},
                 {'text': 'ruído', 'start_seconds': 2, 'role': 'Profissional'}]
        result = evaluate(expected, {'words': words})['speaker_at_word_start']
        self.assertEqual((result['known'], result['correct'], result['unknown'], result['outside_spoken_turn']), (1, 1, 1, 1))
