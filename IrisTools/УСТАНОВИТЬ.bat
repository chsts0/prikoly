@echo off
chcp 65001 >nul
rem Установка Iris Tools: двойной щелчок по этому файлу.
if not exist "%~dp0files\install.ps1" (
    echo Сначала распакуйте архив в обычную папку, потом запустите этот файл.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0files\install.ps1"
