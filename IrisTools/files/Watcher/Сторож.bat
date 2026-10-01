@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
title Pupil centering watcher

rem ---- edit these two paths ----
set "PYTHON=C:\Python\Python313\python.exe"
set "SCRIPT=C:\Photoshop\center_watcher.py"
rem ------------------------------

if not exist "%PYTHON%" (
    echo [ERROR] Python not found:
    echo   %PYTHON%
    echo Fix the PYTHON line in this file.
    echo.
    pause
    exit /b 1
)

if not exist "%SCRIPT%" (
    echo [ERROR] Script not found:
    echo   %SCRIPT%
    echo Fix the SCRIPT line in this file.
    echo.
    pause
    exit /b 1
)

"%PYTHON%" "%SCRIPT%" %*

echo.
echo Watcher stopped.
pause
