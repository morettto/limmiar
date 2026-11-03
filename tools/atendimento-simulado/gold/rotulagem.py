"""Segunda régua do profissional: os cartões que o copiloto mostrou numa rodada do avaliar_copiloto.py, para ele avaliar.

Uso: rotulagem.py RUN. Grava, ao lado de resultados/RUN.jsonl, RUN.rotulagem.json (o formato de entrada do
mvp-copiloto/scripts/juiz_v2/rotulos_5k.py, com a instrução dentro) e RUN.rotular.html (a página de avaliação).
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

from avaliar_copiloto import RESULTADOS, ler
from passagens import GOLD, carregar

INSTRUCAO = ('Abra {html} no navegador e responda cada cartão: S quando o trecho explica o que o paciente descreve, N quando '
             'não explica, D na dúvida. No fim, "Baixar respostas" salva {rotulos}. Depois, da raiz do repositório: '
             'mvp-copiloto/.venv/Scripts/python.exe mvp-copiloto/scripts/juiz_v2/rotulos_5k.py {json} {rotulos} '
             '.local/claude-goal/gold/rotulos-{run}. Sem essas respostas a versão não pode ser promovida.')

PAGINA = '''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avaliar cartões</title><style>:root{--bg:#fafaf7;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--bd:#dcdcd4;--ok:#1f7a4d;--no:#b3261e;--ns:#8a6d00}
@media(prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecece6;--mut:#9a9a92;--card:#1f1f1c;--bd:#33332f;--ok:#58c28b;--no:#f2877f;--ns:#e2c15a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:16px}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--mut);font-size:14px;margin-bottom:12px}.bar{height:6px;background:var(--bd);border-radius:3px;margin:8px 0 16px}
.bar i{display:block;height:100%;background:var(--ok);border-radius:3px}.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:12px}
.lbl{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin-bottom:4px}.fala{font-size:18px;margin:0 0 12px}
.trecho{border-left:3px solid var(--bd);padding-left:12px;margin:0}.src{color:var(--mut);font-size:13px;margin-top:8px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{flex:1;min-width:120px;padding:12px;border:1px solid var(--bd);background:var(--card);color:var(--fg);border-radius:10px;font:inherit;cursor:pointer}
button.ok{border-color:var(--ok);color:var(--ok)}button.no{border-color:var(--no);color:var(--no)}button.ns{border-color:var(--ns);color:var(--ns)}
.nav{display:flex;justify-content:space-between;align-items:center;color:var(--mut);font-size:14px}.nav button{flex:none;min-width:0;padding:8px 12px}</style>
<main><h1>Esse cartão faz sentido?</h1><div class="sub">O paciente disse a frase abaixo. O trecho do material <b>explica o que ele descreve</b>?
Teclas: <b>S</b> sim, <b>N</b> não, <b>D</b> dúvida, <b>←</b> volta. As respostas ficam salvas neste navegador.</div>
<div class="bar"><i id="b"></i></div><div id="c"></div></main><script>
const D=__DADOS__;const K=__CHAVE__;const ARQ=__ARQUIVO__;let R={};try{R=JSON.parse(localStorage.getItem(K)||"{}")}catch(e){}
let i=D.cards.findIndex(c=>!(c.k in R));if(i<0)i=0;
function salvar(){try{localStorage.setItem(K,JSON.stringify(R))}catch(e){}}
function esc(s){return s.replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))}
function desenhar(){const n=Object.keys(R).length;document.getElementById("b").style.width=(100*n/D.cards.length)+"%";
if(i>=D.cards.length){document.getElementById("c").innerHTML=`<div class="card"><p>Terminou: ${n} de ${D.cards.length} respondidos.</p><div class="btns"><button class="ok" onclick="baixar()">Baixar respostas (${ARQ})</button><button onclick="i=D.cards.length-1;desenhar()">Voltar</button></div></div>`;return}
const c=D.cards[i],r=R[c.k];document.getElementById("c").innerHTML=`<div class="nav"><span>${i+1} de ${D.cards.length}</span><span>${r?("respondido: "+r):""}</span></div>
<div class="card"><div class="lbl">Frase do paciente</div><p class="fala">${esc(c.fala)}</p>
<div class="lbl">Trecho do material</div><p class="trecho">${esc(c.trecho)}</p><div class="src">${esc(c.obra)}, p. ${c.p}</div>
<div class="btns"><button class="ok" onclick="resp('sim')">Sim (S)</button><button class="no" onclick="resp('nao')">Não (N)</button><button class="ns" onclick="resp('duvida')">Dúvida (D)</button></div></div>
<div class="nav"><button onclick="if(i>0){i--;desenhar()}">← Anterior</button><button onclick="baixar()">Baixar respostas</button></div>`}
function resp(v){R[D.cards[i].k]=v;salvar();i++;desenhar()}
function baixar(){const b=new Blob([JSON.stringify(R,null,1)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=ARQ;a.click()}
addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(k==="s")resp("sim");else if(k==="n")resp("nao");else if(k==="d")resp("duvida");else if(e.key==="ArrowLeft"&&i>0){i--;desenhar()}});
desenhar();</script></html>
'''


def estrato(gold: dict, cartao: dict) -> str:
    if gold['tipo'] != 'positivo':
        return 'negativo'
    if cartao['trecho_id'] == gold['ancora']['trecho_id']:
        return 'fonte_exata'
    return 'mesmo_material' if cartao['pmcid'] == gold['ancora']['pmcid'] else 'outro_material'


def cartoes(linhas: list[dict], semente: int = 20261021) -> list[dict]:
    gold = {row['id']: row for sessao in sorted({r['sessao'] for r in linhas})
            for row in ler(GOLD / 'sessoes' / f'{sessao}.jsonl')}
    passagens: dict[str, dict] = {}
    saida = []
    for linha in linhas:
        for cartao in linha['cartoes']:
            if cartao['pmcid'] not in passagens:
                passagens[cartao['pmcid']] = carregar(cartao['pmcid'])
            g = gold[linha['id']]
            saida.append({'k': f'{linha["id"]}|{cartao["trecho_id"]}', 'fala': g['frase'], 'ctx': linha['contexto'],
                          'trecho': passagens[cartao['pmcid']][cartao['trecho_id']]['texto'], 'obra': cartao['pmcid'],
                          'p': cartao['pagina'], 'prob': cartao['probabilidade'], 'estrato': estrato(g, cartao),
                          'citacao': cartao['citacao_literal']})
    # Shuffled so the reviewer never sees a run of one stratum, with a fixed seed so the file is reproducible.
    random.Random(semente).shuffle(saida)
    return saida


def main(argv: list[str]) -> int:
    run = argv[0]
    lista = cartoes(ler(RESULTADOS / f'{run}.jsonl'))
    destino_json, destino_html = RESULTADOS / f'{run}.rotulagem.json', RESULTADOS / f'{run}.rotular.html'
    rotulos = f'rotulos-{run}.json'
    instrucao = INSTRUCAO.format(html=destino_html.name, rotulos=rotulos, json=destino_json.as_posix(), run=run)
    destino_json.write_text(json.dumps({'instrucao': instrucao, 'cards': lista}, ensure_ascii=False, indent=1),
                            encoding='utf-8')
    dados = json.dumps({'cards': lista}, ensure_ascii=False).replace('</', '<\\/')
    destino_html.write_text(PAGINA.replace('__DADOS__', dados).replace('__CHAVE__', json.dumps(f'rotulos-{run}'))
                            .replace('__ARQUIVO__', json.dumps(rotulos)), encoding='utf-8')
    print(f'{len(lista)} cartões em {destino_json}; página {destino_html}')
    print(instrucao)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
