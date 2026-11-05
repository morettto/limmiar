"""Compara palavras e papéis reais com os turnos TTS; não inventa avaliação clínica."""
import argparse
import json
import re
import unicodedata
from pathlib import Path


def tokens(text):
    return re.findall(r'[^\W_]+', unicodedata.normalize('NFC', text).casefold())


def word_error_rate(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for index, expected in enumerate(reference, 1):
        current = [index]
        for position, actual in enumerate(hypothesis, 1):
            current.append(min(previous[position] + 1, current[-1] + 1,
                               previous[position - 1] + (expected != actual)))
        previous = current
    errors = previous[-1]
    return {'reference_words': len(reference), 'recognized_words': len(hypothesis),
            'edits': errors, 'wer': errors / len(reference) if reference else None}


def evaluate(expected, observed):
    reference = tokens(' '.join(turn['text'] for turn in expected['turns']))
    actual = tokens(' '.join(word['text'] for word in observed['words']))
    known = correct = outside = unknown = 0
    for word in observed['words']:
        time = word['start_seconds']
        turn = next((turn for turn in expected['turns'] if turn['start_seconds'] <= time < turn['end_seconds']), None)
        if turn is None:
            outside += 1
        elif word.get('role') not in ('Profissional', 'Paciente'):
            unknown += 1
        else:
            known += 1
            correct += word['role'] == turn['role']
    return {'id': expected['id'], 'asr': word_error_rate(reference, actual),
            'speaker_at_word_start': {'known': known, 'correct': correct, 'unknown': unknown,
                                      'outside_spoken_turn': outside,
                                      'accuracy_on_known': correct / known if known else None},
            'limits': ['TTS evaluation only; not human speech performance.',
                       'Role agreement uses UI timestamps at word start; boundary and ASR errors affect this measurement.',
                       'No gold clinical labels: card acceptance, clinical accuracy and false-positive rate are unmeasured.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('expected', type=Path)
    parser.add_argument('observed', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = evaluate(json.loads(args.expected.read_text('utf-8')), json.loads(args.observed.read_text('utf-8')))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(result, ensure_ascii=False))
