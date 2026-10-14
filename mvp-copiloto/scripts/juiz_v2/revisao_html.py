"""Monta o formulário local para o profissional avaliar cartões do fluxo.
Uso: revisao_html.py RESULTADOS.jsonl SAIDA_DIR [N=300]

Amostra estratificada dos cartões mostrados: parte na fonte exata de onde a fala foi gerada (confere o gerador),
a maioria em outros trechos (mede a precisão real) e os cartões que saíram em falas negativas (todos, até o limite).
Gera SAIDA_DIR/rotular-5k.html (respostas ficam no navegador; botão baixa rotulos-5k.json) e SAIDA_DIR/rotulagem-5k.json.
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

PAGINA = r"""<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Avaliar cartões</title>
<style>:root{--bg:#fafaf7;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--bd:#dcdcd4;--ok:#1f7a4d;--no:#b3261e;--ns:#8a6d00}@media(prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecece6;--mut:#9a9a92;--card:#1f1f1c;--bd:#33332f;--ok:#58c28b;--no:#f2877f;--ns:#e2c15a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:16px}h1{font-size:18px;margin:0 0 4px}.sub{color:var(--mut);font-size:14px;margin-bottom:12px}
.bar{height:6px;background:var(--bd);border-radius:3px;margin:8px 0 16px}.bar i{display:block;height:100%;background:var(--ok);border-radius:3px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:12px}.lbl{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin-bottom:4px}
.fala{font-size:18px;margin:0 0 12px}.trecho{border-left:3px solid var(--bd);padding-left:12px;margin:0}.src{color:var(--mut);font-size:13px;margin-top:8px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{flex:1;min-width:120px;padding:12px;border:1px solid var(--bd);background:var(--card);color:var(--fg);border-radius:10px;font:inherit;cursor:pointer}
button.ok{border-color:var(--ok);color:var(--ok)}button.no{border-color:var(--no);color:var(--no)}button.ns{border-color:var(--ns);color:var(--ns)}button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.nav{display:flex;justify-content:space-between;align-items:center;color:var(--mut);font-size:14px}.nav button{flex:none;min-width:0;padding:8px 12px}</style>
<main><h1>Esse cartão faz sentido?</h1><div class="sub">O paciente disse a frase abaixo. O trecho do material <b>explica o que ele descreve</b>? Teclas: <b>S</b> sim, <b>N</b> não, <b>D</b> dúvida, <b>←</b> volta. As respostas ficam salvas neste navegador.</div>
<div class="bar"><i id="b"></i></div><div id="c"></div></main>
<script>
const D=__DATA__;const K="__CHAVE__";let R={};try{R=JSON.parse(localStorage.getItem(K)||"{}")}catch(e){}
let i=D.cards.findIndex(c=>!(c.k in R));if(i<0)i=0;
function salvar(){try{localStorage.setItem(K,JSON.stringify(R))}catch(e){}}
function esc(s){return s.replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))}
function desenhar(){const n=Object.keys(R).length;document.getElementById("b").style.width=(100*n/D.cards.length)+"%";
if(i>=D.cards.length){document.getElementById("c").innerHTML=`<div class="card"><p>Terminou: ${n} de ${D.cards.length} respondidos.</p><div class="btns"><button class="ok" onclick="baixar()">Baixar respostas (__ARQUIVO__)</button><button onclick="i=D.cards.length-1;desenhar()">Voltar</button></div></div>`;return}
const c=D.cards[i],r=R[c.k];document.getElementById("c").innerHTML=`<div class="nav"><span>${i+1} de ${D.cards.length}</span><span>${r?("respondido: "+r):""}</span></div>
<div class="card"><div class="lbl">Frase do paciente</div><p class="fala">${esc(c.fala)}</p>
<div class="lbl">Trecho do material</div><p class="trecho">${esc(c.trecho)}</p><div class="src">${esc(c.obra)}, p. ${c.p}</div>
<div class="btns"><button class="ok" onclick="resp('sim')">Sim (S)</button><button class="no" onclick="resp('nao')">Não (N)</button><button class="ns" onclick="resp('duvida')">Dúvida (D)</button></div></div>
<div class="nav"><button onclick="if(i>0){i--;desenhar()}">← Anterior</button><button onclick="baixar()">Baixar respostas</button></div>`}
function resp(v){R[D.cards[i].k]=v;salvar();i++;desenhar()}
function baixar(){const b=new Blob([JSON.stringify(R,null,1)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="__ARQUIVO__";a.click()}
addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(k==="s")resp("sim");else if(k==="n")resp("nao");else if(k==="d")resp("duvida");else if(e.key==="ArrowLeft"&&i>0){i--;desenhar()}});
desenhar();
</script></html>"""


def amostrar(resultados: list[dict], n: int, semente: int = 3) -> list[dict]:
    azar = random.Random(semente)
    fonte, outros, negativos = [], [], []
    for r in resultados:
        for c in r["cartoes"]:
            item = {"k": f"{r['id']}|{c['trecho_id']}", "fala": r["fala"], "trecho": " ".join(c["texto"].split())[:900],
                    "obra": c["arquivo"].split(".pdf")[0][:60], "p": c["pagina"], "prob": c["prob"]}
            (negativos if r["tipo"] != "positivo" else fonte if c["fonte_exata"] else outros).append(item)
    for grupo in (fonte, outros, negativos):
        azar.shuffle(grupo)
    cota_neg = min(len(negativos), n // 8)
    cota_fonte = min(len(fonte), n // 4)
    escolhidos = ([dict(c, estrato="fonte_exata") for c in fonte[:cota_fonte]] + [dict(c, estrato="outro_trecho") for c in outros[:n - cota_neg - cota_fonte]]
                  + [dict(c, estrato="negativo") for c in negativos[:cota_neg]])
    azar.shuffle(escolhidos)
    return escolhidos


def main() -> None:
    resultados = [json.loads(l) for l in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if l.strip()]
    pasta, n = Path(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 300
    pasta.mkdir(parents=True, exist_ok=True)
    cards = amostrar(resultados, n)
    (pasta / "rotulagem-5k.json").write_text(json.dumps({"cards": cards}, ensure_ascii=False), encoding="utf-8")
    publico = [{k: c[k] for k in ("k", "fala", "trecho", "obra", "p")} for c in cards]
    pagina = PAGINA.replace("__DATA__", json.dumps({"cards": publico}, ensure_ascii=False)).replace("__CHAVE__", "rotulos-5k-v1").replace("__ARQUIVO__", "rotulos-5k.json")
    (pasta / "rotular-5k.html").write_text(pagina, encoding="utf-8")
    por = {}
    for c in cards:
        por[c["estrato"]] = por.get(c["estrato"], 0) + 1
    print(f"{len(cards)} cartões: {por}")


if __name__ == "__main__":
    main()
