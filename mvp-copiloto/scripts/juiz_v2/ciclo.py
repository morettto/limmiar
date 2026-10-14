"""Ciclo de retreino do juiz. Uso: ciclo.py montar SAIDA.jsonl [FEEDBACK.jsonl] | ciclo.py decidir CANDIDATO.previsoes.jsonl ATIVO.previsoes.jsonl [CANDIDATO-5K.previsoes.jsonl ATIVO-5K.previsoes.jsonl]"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from copiloto.votos import ARQUIVO as VOTOS, limpar
import avaliar_5k
from rotulos_5k import lado
from teste_fixo import DADOS, treino_permitido

DIFICEIS = ("dificil", "rotulo_usuario", "fonte-dev")
MIN_DIFICEIS = 80
LIMIAR_OPERACAO = 0.9


def auroc(pares: list[tuple[float, int]]) -> float:
    """Por postos, com empate pela média; nan se faltar uma das classes."""
    ordem = sorted(range(len(pares)), key=lambda i: pares[i][0])
    posto = [0.0] * len(pares)
    i = 0
    while i < len(ordem):
        j = i
        while j + 1 < len(ordem) and pares[ordem[j + 1]][0] == pares[ordem[i]][0]:
            j += 1
        for k in range(i, j + 1):
            posto[ordem[k]] = (i + j) / 2 + 1
        i = j + 1
    p = sum(a for _, a in pares)
    n = len(pares) - p
    if p == 0 or n == 0:
        return float("nan")
    return (sum(posto[k] for k, (_, a) in enumerate(pares) if a) - p * (p + 1) / 2) / (p * n)


def precisao(pares: list[tuple[float, int]], limiar: float) -> float:
    aprovados = [a for s, a in pares if s >= limiar]
    return sum(aprovados) / len(aprovados) if aprovados else float("nan")


def cobertura(pares: list[tuple[float, int]], limiar: float) -> float:
    positivos = sum(a for _, a in pares)
    return sum(a for s, a in pares if s >= limiar) / positivos if positivos else float("nan")


def veredito(candidato: list[dict], ativo: list[dict], reamostras: int = 1000, semente: int = 0,
             notas: tuple[list[dict], list[dict]] | None = None) -> dict:
    """O teste fixo barra regressão; a melhora vem das notas do profissional (se houver) ou da precisão no limiar de operação.

    Sem notas: precisão sobe 0,05 sem perder mais de 0,10 de cobertura. Com notas (previsões nas avaliações reservadas por obra):
    correlação e precisão na faixa sim sobem 0,10. O AUROC dos difíceis só informa: com poucos positivos ele oscila demais.
    """
    por_ativo = {r["trecho_id"]: r for r in ativo}
    juntos = [(r, por_ativo[r["trecho_id"]]) for r in candidato if r["trecho_id"] in por_ativo]
    difs = [(c["prob"], a["prob"], c["alvo"]) for c, a in juntos if c["origem"] in DIFICEIS]
    todos = [(c["prob"], a["prob"], c["alvo"]) for c, a in juntos]
    res = {"n": len(todos), "n_dificeis": len(difs), "limiar_operacao": LIMIAR_OPERACAO, "razoes": []}
    if len(difs) < MIN_DIFICEIS:
        res.update(promover=False)
        res["razoes"].append(f"só {len(difs)} casos difíceis no teste fixo; o mínimo é {MIN_DIFICEIS}")
        return res
    cand, ati = [(c, y) for c, _, y in todos], [(a, y) for _, a, y in todos]
    azar = random.Random(semente)
    d_ger = []
    for _ in range(reamostras):
        amostra = [todos[azar.randrange(len(todos))] for _ in todos]
        d = auroc([(c, y) for c, _, y in amostra]) - auroc([(a, y) for _, a, y in amostra])
        if d == d:
            d_ger.append(d)
    d_ger.sort()
    nan0 = lambda v: 0.0 if v != v else v
    prec_c, prec_a = nan0(precisao(cand, LIMIAR_OPERACAO)), nan0(precisao(ati, LIMIAR_OPERACAO))
    cob_c, cob_a = nan0(cobertura(cand, LIMIAR_OPERACAO)), nan0(cobertura(ati, LIMIAR_OPERACAO))
    p5_geral = d_ger[int(0.05 * len(d_ger))]
    res.update(precisao_aprovados={"candidato": prec_c, "ativo": prec_a}, cobertura={"candidato": cob_c, "ativo": cob_a},
               auroc_geral={"candidato": auroc(cand), "ativo": auroc(ati), "delta_p5": p5_geral},
               auroc_dificeis_informativo={"candidato": auroc([(c, y) for c, _, y in difs]), "ativo": auroc([(a, y) for _, a, y in difs])})
    if notas is None:
        melhora = [(prec_c >= prec_a + 0.05, "a precisão dos aprovados não subiu 0,05"), (cob_c >= cob_a - 0.10, "a cobertura caiu mais de 0,10")]
        regressao = [(p5_geral >= -0.005, "o AUROC geral pode ter caído mais de 0,005")]
    else:
        n_c, n_a = avaliar_5k.resumo(notas[0]), avaliar_5k.resumo(notas[1])
        res["notas_do_profissional"] = {"candidato": n_c, "ativo": n_a}
        melhora = [(n_c["spearman"] >= n_a["spearman"] + 0.10, "a correlação com a nota do profissional não subiu 0,10"),
                   ((n_c["precisao_sim"] or 0) >= (n_a["precisao_sim"] or 0) + 0.10, "a precisão na faixa sim do profissional não subiu 0,10")]
        regressao = [(prec_c >= prec_a - 0.02, "a precisão no teste fixo caiu mais de 0,02"), (p5_geral >= -0.005, "o AUROC geral pode ter caído mais de 0,005")]
    res["razoes"] = [msg for passou, msg in melhora + regressao if not passou]
    res["promover"] = not res["razoes"]
    return res


def separar_votos(votos: list[dict]) -> tuple[list[dict], list[dict]]:
    """A obra inteira fica de um lado: votos de obras do lado "teste" medem a melhora (alvo_suave 0/1) e nunca treinam."""
    treino = [r for r in votos if lado(r["arquivo"]) == "treino"]
    teste = [{**r, "alvo_suave": float(r["alvo"])} for r in votos if lado(r["arquivo"]) == "teste"]
    return treino, teste


def montar(feedback: list[dict], base: list[dict], fixos: set[str]) -> tuple[list[dict], list[dict]]:
    treino, teste = separar_votos([r for r in limpar(feedback, excluir=fixos) if treino_permitido(r, fixos)])
    return [r for r in base if treino_permitido(r, fixos)] + treino, teste


def main() -> None:
    comando = sys.argv[1]
    if comando == "montar":
        entrada = Path(sys.argv[3]) if len(sys.argv) > 3 else VOTOS
        feedback = [json.loads(l) for l in entrada.read_text(encoding="utf-8").splitlines() if l.strip()]
        base = [json.loads(l) for l in (DADOS / "treino-lora.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        fixos = {json.loads(l)["trecho_id"] for l in (DADOS / "teste-fixo.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        linhas, teste = montar(feedback, base, fixos)
        saida = Path(sys.argv[2])
        saida.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in linhas), encoding="utf-8")
        saida.with_suffix(".votos-teste.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in teste), encoding="utf-8")
        print(f"{len(linhas)} linhas de treino (teste fixo excluído), {len(teste)} votos reservados para medir a melhora")
    elif comando == "decidir":
        ler = lambda p: [json.loads(l) for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()]
        notas = (ler(sys.argv[4]), ler(sys.argv[5])) if len(sys.argv) > 5 else None
        print(json.dumps(veredito(ler(sys.argv[2]), ler(sys.argv[3]), notas=notas), ensure_ascii=False, indent=1))
    else:
        raise SystemExit("Use montar ou decidir")


if __name__ == "__main__":
    main()
