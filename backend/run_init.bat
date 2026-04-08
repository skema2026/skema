@echo off
echo Running DB initialization...
cd /d "%~dp0"
..\\.venv\\Scripts\\python.exe init_db.py
pause
