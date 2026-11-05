"""Amostragem local de recursos por processo/serviço; não coleta texto clínico ou comandos."""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil

PORTS = {5173: "front_vite", 8787: "front_app", 5259: "api", 8000: "copiloto", 8100: "juiz"}
ROOT = Path(__file__).resolve().parents[2]
DOCKER = Path.home() / "AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe"


def command(args: list[str]) -> tuple[str, str | None]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=6, creationflags=subprocess.CREATE_NO_WINDOW)
        return result.stdout.strip(), None if result.returncode == 0 else f"exit_{result.returncode}"
    except (OSError, subprocess.TimeoutExpired) as error:
        return "", type(error).__name__


def sample(cache: dict[int, psutil.Process]) -> dict:
    started = time.monotonic()
    groups: dict[str, set[int]] = {label: set() for label in PORTS.values()}
    errors = []
    try:
        for connection in psutil.net_connections(kind="tcp"):
            if connection.status == psutil.CONN_LISTEN and connection.pid and connection.laddr.port in PORTS:
                groups[PORTS[connection.laddr.port]].add(connection.pid)
    except (psutil.Error, OSError) as error:
        errors.append(type(error).__name__)
    for process in psutil.process_iter(["name", "cmdline"]):
        try:
            if any(Path(argument).name == 'candidato_cpu.py' for argument in process.info['cmdline'] or []):
                groups.setdefault('treino_candidato_cpu', set()).add(process.pid)
            if process.info["name"].lower() == "vmmemwsl":
                groups.setdefault("vm_docker_wsl", set()).add(process.pid)
            if process.info["name"].lower() in ("chrome.exe", "chromium.exe", "msedge.exe", "chrome-headless-shell.exe"):
                args = " ".join(process.info["cmdline"] or []).lower()
                if "playwright" in args or "mcp-chrome" in args:
                    groups.setdefault("navegador_playwright", set()).add(process.pid)
                    groups["navegador_playwright"].update(child.pid for child in process.children(recursive=True))
        except (psutil.Error, OSError):
            continue
    services = []
    for name, pids in groups.items():
        row = {"service": name, "pids": [], "cpu_percent_one_core": 0.0, "rss_bytes": 0, "private_bytes": 0}
        for pid in pids:
            try:
                process = cache.setdefault(pid, psutil.Process(pid))
                cpu = process.cpu_percent()
                memory = process.memory_info()
                row["pids"].append(pid)
                row["cpu_percent_one_core"] += cpu
                row["rss_bytes"] += memory.rss
                row["private_bytes"] += getattr(memory, "private", 0)
            except (psutil.Error, OSError):
                cache.pop(pid, None)
        row["cpu_percent_machine"] = row["cpu_percent_one_core"] / (psutil.cpu_count() or 1)
        row["cpu_warmup"] = not bool(pids) or not getattr(sample, "previous", False)
        services.append(row)
    sample.previous = True
    text, docker_error = command([str(DOCKER), "stats", "--no-stream", "--format", "{{json .}}"])
    containers = []
    for line in text.splitlines():
        try:
            value = json.loads(line)
            if value["Name"].startswith(("nemotron-speech-", "limmiar-local-postgres", "pg-")):
                containers.append({key: value.get(key) for key in ("Name", "CPUPerc", "MemUsage", "MemPerc", "BlockIO", "NetIO", "PIDs")})
        except (ValueError, KeyError):
            errors.append("docker_stats_invalid")
    gpu, gpu_error = command(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,power.draw", "--format=csv,noheader,nounits"])
    system = psutil.virtual_memory()
    return {"at": datetime.now(timezone.utc).isoformat(), "services": services, "containers": containers,
            "gpu_total_csv": gpu or None, "gpu_attribution": "device_total_not_per_service", "system": {"memory_used_bytes": system.used, "memory_available_bytes": system.available, "cpu_percent": psutil.cpu_percent()},
            "errors": errors + ([docker_error] if docker_error else []) + ([gpu_error] if gpu_error else []), "sample_duration_seconds": time.monotonic() - started}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=float, default=5)
    parser.add_argument("--saida", default=".local/simulacao-100/recursos")
    args = parser.parse_args()
    output = ROOT / args.saida
    output.mkdir(parents=True, exist_ok=True)
    cache = {}
    aggregates = {}
    count = 0
    while True:
        value = sample(cache)
        with (output / "amostras.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(value, ensure_ascii=False) + "\n")
        count += 1
        for row in value["services"]:
            if not row["pids"] or row["cpu_warmup"]:
                continue
            stats = aggregates.setdefault(row["service"], {"samples": 0, "cpu_sum": 0.0, "cpu_peak": 0.0, "rss_sum": 0, "rss_peak": 0})
            stats["samples"] += 1
            stats["cpu_sum"] += row["cpu_percent_machine"]
            stats["cpu_peak"] = max(stats["cpu_peak"], row["cpu_percent_machine"])
            stats["rss_sum"] += row["rss_bytes"]
            stats["rss_peak"] = max(stats["rss_peak"], row["rss_bytes"])
        summary = {name: {"samples": stats["samples"], "cpu_machine_mean": stats["cpu_sum"] / stats["samples"], "cpu_machine_peak": stats["cpu_peak"], "rss_mean_bytes": stats["rss_sum"] / stats["samples"], "rss_peak_bytes": stats["rss_peak"]} for name, stats in aggregates.items()}
        (output / "resumo.json").write_text(json.dumps({"updated_at": value["at"], "total_samples": count, "services": summary, "gpu_attribution": value["gpu_attribution"], "cpu_unit": "percent_of_all_logical_cores", "rss_notice": "Working set includes shared pages; do not sum services as unique physical memory."}, ensure_ascii=False, indent=2), encoding="utf-8")
        if args.once:
            print(json.dumps({"services": [row["service"] for row in value["services"]], "containers": len(value["containers"]), "errors": value["errors"]}))
            return
        time.sleep(max(0, args.interval - value["sample_duration_seconds"]))


if __name__ == "__main__":
    main()
