"""Resumo das amostras reais, preservando unidades e limites de atribuição."""
from __future__ import annotations

import csv
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / ".local/simulacao-100/recursos"
SERVICE_FIELDS = ["service", "samples", "cpu_unit", "cpu_mean", "cpu_peak", "rss_mean_mib", "rss_peak_mib"]


def memory_bytes(value: str) -> float:
    match = re.fullmatch(r"([\d.]+)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB)", value.strip())
    if not match:
        raise ValueError("Unidade de memória desconhecida")
    factors = {"B": 1, "kB": 1000, "KB": 1000, "KiB": 1024, "MB": 10**6, "MiB": 1024**2, "GB": 10**9, "GiB": 1024**3}
    return float(match[1]) * factors[match[2]]


def summarize() -> dict:
    series = defaultdict(lambda: {"cpu": [], "memory": [], "unit": "percent_of_machine"})
    gpu = []
    first = last = None
    sample_path = ROOT / "amostras.jsonl"
    if not sample_path.is_file():
        raise FileNotFoundError(f"Amostras de recursos não encontradas: {sample_path}")
    lines = [line for line in sample_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        raise ValueError(f"Nenhuma amostra de recursos em {sample_path}")
    for line in lines:
        sample = json.loads(line)
        first = first or sample["at"]
        last = sample["at"]
        for row in sample["services"]:
            if row["pids"]:
                series[row["service"]]["memory"].append(row["rss_bytes"])
                if not row["cpu_warmup"]:
                    series[row["service"]]["cpu"].append(row["cpu_percent_machine"])
        for row in sample["containers"]:
            values = series[row["Name"]]
            values["unit"] = "docker_percent_one_core"
            values["cpu"].append(float(row["CPUPerc"].rstrip("%")))
            values["memory"].append(memory_bytes(row["MemUsage"].split("/")[0]))
        if sample["gpu_total_csv"]:
            fields = next(csv.reader([sample["gpu_total_csv"]]))
            gpu.append({"utilization_percent": float(fields[-4]), "used_mib": float(fields[-3]), "total_mib": float(fields[-2])})
    rows = []
    for service, values in series.items():
        cpu = values["cpu"]
        memory = values["memory"]
        rows.append({"service": service, "samples": len(memory), "cpu_unit": values["unit"],
                     "cpu_mean": statistics.mean(cpu) if cpu else None, "cpu_peak": max(cpu) if cpu else None,
                     "rss_mean_mib": statistics.mean(memory) / 1024**2, "rss_peak_mib": max(memory) / 1024**2})
    return {"first_sample": first, "last_sample": last, "services": rows,
            "gpu": {"attribution": "whole_device_Windows_driver_does_not_expose_per_process_memory", "samples": len(gpu),
                    "utilization_mean_percent": statistics.mean(item["utilization_percent"] for item in gpu) if gpu else None,
                    "utilization_peak_percent": max((item["utilization_percent"] for item in gpu), default=None),
                    "memory_peak_mib": max((item["used_mib"] for item in gpu), default=None)},
            "notice": "Working sets include shared pages; do not sum them as exclusive physical memory. Browser process group may include other tabs; page JS heap is recorded separately in event evidence."}


def write_reports(report: dict, root: Path = ROOT) -> None:
    (root / "relatorio.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with (root / "servicos.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=SERVICE_FIELDS)
        writer.writeheader()
        writer.writerows(report["services"])


if __name__ == "__main__":
    assert memory_bytes("1.5GiB") == 1.5 * 1024**3
    assert memory_bytes("512MiB") == 512 * 1024**2
    report = summarize()
    write_reports(report)
    print(json.dumps({"services": len(report["services"]), "first": report["first_sample"], "last": report["last_sample"]}))
