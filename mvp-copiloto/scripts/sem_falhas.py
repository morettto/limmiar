import json
import sys
from pathlib import Path

for nome in sys.argv[1:]:
    p = Path(nome)
    linhas = [l for l in p.open(encoding="utf-8") if l.strip()]
    boas = [l for l in linhas if json.loads(l)["decisao"]["motivo_silencio"] != "decisor indisponível"]
    p.write_text("".join(boas), encoding="utf-8")
    print(f"{p.name}: {len(linhas) - len(boas)} falhas removidas")
