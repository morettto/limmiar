"""Registra revisão explícita do conjunto de contrastes, sem alterar provas antigas."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
ENTRADAS_SHA256 = 'e45f2c602641c1735f465ca74f421bfa3fb7f0cd07e94417c2baa0157aece781'
sys.path.insert(0, str(RAIZ / 'src'))
from copiloto import frase, revisao_fontes

POSITIVOS = {
    8: ('vontade de nada', 'Desânimo e perda de iniciativa', 'Como se houvesse certa impotência diante do mundo externo que pede ação, movimento',
        'A descrição de impotência e falta de iniciativa corresponde à vontade de nada. Não exige inferir doença mental, reabilitação ou causa menopausal.'),
    10: ('eles que estragam tudo, eu não tenho nada a ver com isso', 'Atribuição defensiva de responsabilidade ao outro',
         'Eu não merecia a culpa pelas dores de Irma, já que ela própria era  culpada, por se recusar a aceitar minha solução.',
         'O exemplo descreve negar a própria responsabilidade atribuindo a culpa ao outro, comportamento expresso na frase. O uso de um exemplo de sonho não atribui esse sonho ao paciente.'),
    11: ('tô apaixonada por você, e no dia seguinte tenho raiva', 'Ambivalência afetiva em uma relação',
         'Júlia mantinha uma relação bastante ambivalente em relação ao irmão, três anos mais velho que ela, com fortes sentimentos de amor e ódio.',
         'Amor e ódio dirigidos à mesma pessoa descrevem a ambivalência expressa. A pessoa destinatária ser irmão no exemplo não impede a referência ao mecanismo relacional; não se infere borderline.'),
    13: ('seria melhor não tá mais aqui', 'Desejo de não estar vivo', 'uma pessoa que não tem vontade de viver, de ficar aqui.',
         'O desejo de não viver está descrito literalmente. A citação não atribui ao paciente falta de compreensão nem substitui a ansiedade expressa como circunstância.'),
    14: ('fiquei presa em casa com covid, eu e as duas crianças, sem dinheiro entrando', 'Restrição de rotina com sofrimento familiar',
         'As restrições na vida social ou nas rotinas de trabalho são citadas como prejuízos vividos e estes determinam estados emocionais no interior do núcleo familiar:',
         'A frase liga restrição de sair/trabalhar e dificuldades familiares ao sofrimento. A passagem descreve essa relação geral, sem exigir atribuir uma psicopatologia do artigo à paciente.'),
    18: ('me machuquei no serviço e a dor não passou mais', 'Persistência da dor depois de lesão', 'For some people the pain does not subside',
         'A passagem descreve dor que não cede depois de lesão, explicitamente dita. Não precisa explicar também a ansiedade anterior nem permite concluir duração superior a três meses.'),
    19: ('a dor me deixa nervosa e o nervoso piora a dor', 'Interação entre dor e resposta emocional',
         'This suggests that pain-related emotion impacts ANS responsivity.',
         'O trecho descreve a ligação da emoção relacionada à dor com resposta autonômica. Essa parte explica um componente da interação dita, sem inferir PTSD ou exigir todos os componentes do ciclo.'),
    20: ('quando tô ansiosa qualquer dorzinha parece o dobro', 'Amplificação da sensação dolorosa com ansiedade',
         'AS hrt been suggested to potentiate pain sensations in some patients with PD',
         'A passagem descreve potencialização da sensação dolorosa relacionada à sensibilidade à ansiedade. É referência a esse mecanismo, não diagnóstico de pânico ou mensuração da sensibilidade da paciente.'),
    22: ('parei de caminhar, de pegar peso, de brincar com meu filho, tenho pavor de que a coluna piore', 'Evitamento ligado ao temor da dor após lesão',
         "increases the risk of pain-related avoidance and disability following physiial.i+jy.fy in adultstsal and in children with chronic pain.",
         'A passagem descreve evitamento relacionado à dor e incapacidade depois de lesão. Corresponde ao abandono de atividades por temor de piora da coluna; não atribui PTSD ou pânico.'),
    23: ('fico sempre de olho na porta', 'Atenção persistente a ameaça',
         'that is, they direct attention toward objects or situations that they fear.',
         'A frase descreve vigiar a porta e o apoio imediato situa o assalto. O mecanismo explícito de direcionar atenção à ameaça é pertinente mesmo sem explicar também irritabilidade e gritos.'),
    24: ('dou uma volta enorme pra não passar ali', 'Precauções e evitamento de lembretes traumáticos',
         'reducing unhelpful strategies such as rumination, hypervigilance for threat, thought suppression, and excessive precautions (safety behaviors)',
         'A intervenção explicitamente aborda precauções excessivas e processos ligados ao trauma. É referência pertinente ao desvio e evitamento expressos, sem afirmar que o paciente tenha todos os processos listados ou prescrever a intervenção.'),
    27: ('a pedir ajuda', 'Busca de ajuda como estratégia de enfrentamento',
         'Pida ayuda siempre que sea necesario. Tenga  el buen tino de pedirla a las personas correctas',
         'A passagem aborda pedir ajuda como estratégia. Essa ação está na frase; não é necessário que a fonte demonstre também adesão à terapia, e a citação exclui a lista de medicamentos e os outros conselhos.'),
    28: ('parece que minha vida parou ali', 'Perda de iniciativa e sensação de vida paralisada',
         'deixa tudo do mesmo jeito, é assim parado para a vida, sabe?',
         'A descrição de estar parado para a vida corresponde ao abandono das atividades e relações ditas. O exemplo visto pela família não permite atribuir um diagnóstico ao paciente.'),
    60: ('waiting for something bad to happen', 'Expectativa ansiosa de que algo ruim aconteça',
         'porque siempre pienso en que algo  malo va a pasar.',
         'A expectativa de algo ruim é explicitamente comum à frase e à passagem. A referência não precisa explicar também o ato de examinar a sala nem atribui todos os detalhes do relato da fonte.'),
}

NEGATIVOS = {
    0: 'Lista complicações e diagnósticos associados à ansiedade; não descreve antecipação catastrófica nem o aperto referido.',
    1: 'Restrição genérica de sair e impacto familiar não descrevem temor de contágio como razão do evitamento e perda de rotina.',
    2: 'A passagem descreve restrição social, não o efeito protetor de criar rotina e caminhar.',
    3: 'O relato pressupõe sofrimento de cuidador/familiar de pessoa doente. A frase pede ser ouvido sem esse contexto ou mecanismo.',
    4: 'A semelhança de permanecer em casa não explica a relação entre recursos econômicos e nervos expressa na frase.',
    5: 'A passagem situa tristeza e desejo de não viver em incompreensão. A frase não expressa incompreensão ou desejo de morrer.',
    6: 'Não conseguir levantar do sofá não é descrito pelo relato de restrições de sair de casa e prejuízo familiar.',
    7: 'A passagem não descreve restrição econômica nem apagamento emocional; apenas o tema geral da restrição social não basta.',
    9: 'Desejo de deixar sessões e silêncio não descrevem explosão diante de um limite ou exigência de controle.',
    12: 'Dificuldade genérica para sair não explica temor de passar mal e ficar sem saída em locais lotados.',
    15: 'O trecho condiciona agorafobia a pânico, aprisionamento ou desamparo. A frase só relata receio de readaptação; esses elementos não podem ser inferidos.',
    16: 'O mecanismo de projeção de ódio e transferência borderline é diferente do medo concreto na internação relatado.',
    17: 'A frase relata coexistência de crises de pânico e tensão musculoesquelética; não afirma amplificação dolorosa ou medo das consequências da ansiedade, necessários a este mecanismo.',
    21: 'Autolesão intencional para aliviar dor emocional difere da ausência temporária de percepção de queimadura acidental.',
    25: 'Exposição imaginária com recontagem de memória difere da exposição presencial com redução de tremor expressa na frase.',
    26: 'Silêncio e desejo de deixar a sessão não equivalem a pedir relaxamento e adiar conversa sobre um acontecimento.',
    29: 'Dificuldade de diagnóstico e culpa de uma cuidadora não descrevem estigma familiar que atrasou a procura por psicólogo.',
    30: 'A interpretação de Hamlet envolve vingança, desejos recalcados e autorrecriminação; a frase só expressa amor e ódio pelo pai, sem esses mecanismos.',
    31: 'Realização de desejo sobre subir escadas e tranquilizar o coração não é repetição traumática do assalto em pesadelos.',
    32: 'Sonho para prolongar o sono é diferente de pesadelo recorrente com despertar autonômico.',
    33: 'Estímulos físicos de gota e roupas no sono são causas expressas distintas da revivência do assalto.',
    34: 'Apoio de vizinhos e solidão não descrevem pesadelo nem despertar com sudorese e palpitações.',
    35: 'Comunicação sobre doença epidêmica não descreve sonho traumático ou ativação autonômica ao despertar.',
    36: 'O procedimento de ensinar sonho lúcido não descreve pesadelo do assalto nem estabelece, neste trecho, indicação para essa experiência.',
    37: 'Organização do descanso hospitalar não descreve repetição de assalto em pesadelos.',
    38: 'Vínculo com pais falecidos é assunto diferente da revivência noturna de assalto.',
    39: 'Orfandade adulta por morte dos pais não corresponde a pesadelo de assalto.',
    40: 'Instrumento de rastreamento de preocupação geral não explica pesadelo traumático com despertar autonômico.',
    41: 'Correlações entre valores pessoais e autoestima não descrevem experiência de sonho traumático.',
    42: 'Insônia e turnos de profissionais de saúde não explicam a repetição do assalto em pesadelos.',
    43: 'Culpa e associações por falhas médicas não descrevem memória intrusiva de acidente com revivência.',
    44: 'Ruído do despertador incorporado ao sonho difere de sobressalto acordado e vigilância persistente.',
    45: 'Imagens intrusivas e distração com Tetris não correspondem ao entorpecimento emocional após tiroteio.',
    46: 'Ausência física e abandono efetivo de familiares não descrevem solidão apesar de companhia e falta de compreensão.',
    47: 'O relato descreve visitas e contato familiar presentes, em oposição à falta de ligações dos filhos.',
    48: 'O trecho explica resposta do tratamento da depressão; esse diagnóstico e tratamento não estão expressos. Não descreve irritação e falta de concentração por sono ruim.',
    49: 'Visitas familiares desejadas não descrevem evitamento social por temor de julgamento.',
    50: 'Despertar por necessidade de urinar difere de pesadelos de acidente e despertar gritando.',
    51: 'Violência de policiais penais e reincidência prisional não correspondem a imagens intrusivas de violência sexual sofrida.',
    52: 'Vingança em interpretação de sonho e culpa por recusar uma solução médica não descrevem abuso coercivo do parceiro.',
    53: 'Rivalidade e desejo de fracasso de um colega não descrevem temor de falar em público ou ser observado.',
    54: 'Nome em sonho associado à tosse externa não corresponde a pesadelo de guerra com sudorese.',
    55: 'O trecho relata imagens intrusivas, não evitamento de dirigir e mudança de transporte.',
    56: 'A solidão descrita depende de morar e dormir sozinho; a frase expressa solidão mesmo com a família presente.',
    57: 'Identificação inconsciente com ataques de outra pessoa não é recorrência do mesmo pesadelo após assalto.',
    58: 'Recordações por associação voluntária entre casos médicos não são imagens traumáticas involuntárias de choque.',
    59: 'Persistência de lembrança de sonho difere de memória de um acontecimento e sua revivência; a frase não expressa sonho.',
    61: 'Imagens intrusivas e benefício de Tetris não descrevem evitamento de lembretes e isolamento social.',
    62: 'Atribuição de culpa e rejeição de pessoas em um sonho não descrevem evitamento de lembretes de um acontecimento.',
}


def main() -> None:
    bruto = (RAIZ / 'resultados/fontes-contraste-dev-revisao-v2.json').read_bytes()
    if hashlib.sha256(bruto).hexdigest() != ENTRADAS_SHA256:
        raise ValueError('O conjunto revisado mudou; as decisões por posição não podem ser reutilizadas.')
    entradas = json.loads(bruto)
    if set(POSITIVOS) & set(NEGATIVOS) or set(POSITIVOS) | set(NEGATIVOS) != set(range(len(entradas))):
        raise ValueError('Todas as passagens do conjunto devem ter decisão explícita.')
    decisoes = []
    for i, p in enumerate(entradas):
        positivo = POSITIVOS.get(i)
        ancora, fenomeno, citacao, motivo = positivo if positivo else ('', '', '', NEGATIVOS[i])
        if positivo and (ancora not in p['fala'] or citacao not in p['trecho'] or len(citacao.split()) < 6):
            raise ValueError(f'Âncora ou citação literal inválida na decisão {i}.')
        decisoes.append({k: p[k] for k in ('id', 'arquivo', 'pagina', 'paragrafo', 'grupo', 'parte')}
                        | {'protocolo': revisao_fontes.PROTOCOLO, 'alvo_anterior': p['alvo'], 'valido': bool(positivo),
                           'fala_sha256': hashlib.sha256(frase.consulta(p['fala'], p['contexto']).encode()).hexdigest(),
                           'trecho_sha256': hashlib.sha256(p['trecho'].encode()).hexdigest(),
                           'ancora_na_fala': ancora, 'fenomeno': fenomeno, 'citacao_literal': citacao,
                           'justificativa': motivo, 'revisor': 'Codex', 'data': '2026-10-04'})
    destino = RAIZ / 'data/treino/fontes-dev-semantica-v2.jsonl'
    destino.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in decisoes), encoding='utf-8')
    revisao_fontes.aplicar(entradas, destino)
    print(f'{len(decisoes)} passagens revistas; {len(POSITIVOS)} alternativas pertinentes; {len(NEGATIVOS)} incompatíveis.')


if __name__ == '__main__':
    main()
