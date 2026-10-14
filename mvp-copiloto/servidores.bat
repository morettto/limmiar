@echo off
cd /d "%~dp0"
start "copiloto-juiz" /min ferramentas\llama\llama-server.exe -m modelos\gguf\Qwen3.5-4B-Q5_K_M.gguf -ngl 99 -c 8192 -np 2 --port 8081 --host 127.0.0.1 --jinja --reasoning off
