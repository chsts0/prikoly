@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

rem ============================================================
rem  Установка Print_ByFormat в Photoshop
rem  Просто дважды щёлкните по этому файлу.
rem ============================================================

rem --- нужны права администратора (папка Program Files) ---
net session >nul 2>&1
if errorlevel 1 (
    echo Запрашиваю права администратора...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "SRC=%~dp0"
set FOUND=0

echo.
echo === Копирую скрипты в Photoshop ===
for /d %%P in ("%ProgramFiles%\Adobe\Adobe Photoshop*") do (
    if exist "%%~P\Presets\Scripts\" (
        copy /Y "%SRC%Print_ByFormat.jsx"       "%%~P\Presets\Scripts\" >nul
        copy /Y "%SRC%Print_ByFormat_Setup.jsx" "%%~P\Presets\Scripts\" >nul
        echo   OK: %%~P
        set FOUND=1
    )
)
if "!FOUND!"=="0" (
    echo   ОШИБКА: Photoshop не найден в "%ProgramFiles%\Adobe\"
    echo   Скопируйте Print_ByFormat.jsx и Print_ByFormat_Setup.jsx вручную
    echo   в папку ...\Adobe Photoshop 2025\Presets\Scripts\
)

echo.
echo === Цветовой профиль ===
set ICC=0
for %%F in ("%SRC%*.icm" "%SRC%*.icc") do (
    copy /Y "%%~F" "%WINDIR%\System32\spool\drivers\color\" >nul
    echo   OK: %%~nxF
    set ICC=1
)
if "!ICC!"=="0" (
    if exist "%WINDIR%\System32\spool\drivers\color\L8050_EyePH_Chern.icm" (
        echo   L8050_EyePH_Chern.icm уже установлен.
    ) else (
        echo   ВНИМАНИЕ: профиль L8050_EyePH_Chern.icm не найден.
        echo   Положите его рядом с install.bat и запустите ещё раз.
    )
)

echo.
echo === Готово ===
echo 1. Перезапустите Photoshop.
echo 2. Откройте шаблон каждого формата и запустите
echo    File - Scripts - Print_ByFormat_Setup  (один раз на формат).
echo 3. Печать: File - Scripts - Print_ByFormat
echo.
pause
