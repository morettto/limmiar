@echo off
cd /d "%~dp0"
echo Subindo o copiloto. O navegador abre sozinho quando os modelos terminarem de carregar.
start "" /b powershell -NoProfile -Command "while (-not (try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8001/api/saude } catch { $null })) { Start-Sleep 2 }; Start-Process http://127.0.0.1:8001"
.venv\Scripts\python.exe -m uvicorn copiloto.pesquisa:app --app-dir src --port 8001
