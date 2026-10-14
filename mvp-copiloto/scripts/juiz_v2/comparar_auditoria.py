"""Concordância de saídas com a auditoria manual. Uso: comparar_auditoria.py AMOSTRA.json SAIDA.jsonl [...]."""
import json
import sys

aud = {(j["id"], j["trecho_id"]): j["auditoria"] for j in json.load(open(sys.argv[1], encoding="utf-8"))}
for arq in sys.argv[2:]:
    L = [json.loads(l) for l in open(arq, encoding="utf-8") if l.strip()]
    pred = {(j["id"], j["trecho_id"]): j["prob"] for j in L}
    pares = [(aud[k], pred[k]) for k in aud if k in pred]
    for t in (0.5, 0.9):
        tp = sum(a == 1 and p >= t for a, p in pares); fp = sum(a == 0 and p >= t for a, p in pares)
        fn = sum(a == 1 and p < t for a, p in pares); tn = sum(a == 0 and p < t for a, p in pares)
        print(f"{arq.split('/')[-1]:28} t={t} acordo {(tp + tn) / len(pares):.2f} | aprova {tp + fp}: certos {tp}, errados {fp} | rejeita {fn + tn}: boas perdidas {fn}")
    aprov = [j for j in L if j["prob"] >= 0.5]
    print(f"   aprovados: {len(aprov)} de {len(L)}, cartões por caso positivo ~{len(aprov) / max(1, len({j['id'] for j in L if j['tipo'] == 'positivo'})):.1f}")
