import time, json, torch, numpy as np
from sentence_transformers import SentenceTransformer
from transformers import AutoModelForSequenceClassification, AutoTokenizer
def med(f,n=7):
    f(); ts=[]
    for _ in range(n):
        torch.cuda.synchronize(); t=time.perf_counter(); f(); torch.cuda.synchronize(); ts.append(time.perf_counter()-t)
    return f"{np.median(ts)*1000:.0f} ms"
q=["tenho pesadelos com o acidente e evito passar por aquela rua","I have nightmares about the accident","tengo pesadillas con el accidente"]
for dev,dt in [("cpu",torch.float32),("cuda",torch.float32),("cuda",torch.float16)]:
    m=SentenceTransformer("BAAI/bge-m3",device=dev,model_kwargs={"dtype":dt})
    torch.cuda.reset_peak_memory_stats()
    print("bge-m3",dev,dt,med(lambda: m.encode(q,normalize_embeddings=True)), f"pico {torch.cuda.max_memory_allocated()/2**30:.2f}GiB", flush=True)
    del m; torch.cuda.empty_cache()
pares=[json.loads(l) for l in open("data/avaliacao/dev_pares.jsonl",encoding="utf-8")][:20]
for nome in ["sonda-mmbert-small","sonda-gte"]:
    d=f"modelos/juiz-local/{nome}/torch"
    tok=AutoTokenizer.from_pretrained(d,trust_remote_code=True)
    for dt in (torch.float32,torch.float16):
        m=AutoModelForSequenceClassification.from_pretrained(d,trust_remote_code=True,dtype=dt).cuda().eval()
        import sys; sys.path.insert(0,"scripts"); import treinar; treinar._reparar(m); m.cuda()
        for n in (20,10):
            enc=tok([p["fala"] for p in pares[:n]],[p["trecho"][:900] for p in pares[:n]],truncation="only_second",max_length=256,padding=True,return_tensors="pt").to("cuda")
            def f():
                with torch.no_grad(): m(**enc)
            torch.cuda.reset_peak_memory_stats()
            print(nome,dt,n,med(f), f"pico {torch.cuda.max_memory_allocated()/2**30:.2f}GiB", flush=True)
        del m; torch.cuda.empty_cache()
