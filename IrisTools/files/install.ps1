# ============================================================
#  Установка Iris Tools на компьютер
#  Запускается через УСТАНОВИТЬ.bat (сам этот файл не трогать).
#
#  Что делает:
#   1. Скрипты Photoshop (F1, F2, F5, печать, направляющие)
#      -> ...\Adobe Photoshop 20xx\Presets\Scripts
#   2. ICC-профиль принтера -> C:\Windows\System32\spool\drivers\color
#   3. Панель Iris Tools -> ...\Adobe Photoshop 20xx\Plug-ins\IrisToolsPanel
#      и прописывает в неё папку с шаблонами
#   4. Центровку зрачка («сторож») -> C:\Photoshop
#      и прописывает в неё папку «исходники»
#   5. Python + библиотеки (если нет), автозапуск сторожа
# ============================================================

param(
    [string]$UserDesktop = "",
    [string]$UserStartup = ""
)

$ErrorActionPreference = "Stop"

# ---------- права администратора ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    # запоминаем папки ТЕКУЩЕГО пользователя до повышения прав
    $desk = [Environment]::GetFolderPath("Desktop")
    $start = [Environment]::GetFolderPath("Startup")
    $argLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -UserDesktop "{1}" -UserStartup "{2}"' -f $PSCommandPath, $desk, $start
    try {
        Start-Process -FilePath "powershell.exe" -ArgumentList $argLine -Verb RunAs
    } catch {
        Write-Host "Нужны права администратора. Запустите ещё раз и нажмите «Да»." -ForegroundColor Red
        Read-Host "Enter — закрыть"
    }
    exit
}

if (-not $UserDesktop) { $UserDesktop = [Environment]::GetFolderPath("Desktop") }
if (-not $UserStartup) { $UserStartup = [Environment]::GetFolderPath("Startup") }

$Files     = $PSScriptRoot                      # ...\files
$Bundle    = Split-Path $PSScriptRoot -Parent   # папка архива
$WatchDir  = "C:\Photoshop"
$PythonUrl = "https://www.python.org/ftp/python/3.13.15/python-3.13.15-amd64.exe"
$PythonDir = "C:\Python\Python313"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try { Start-Transcript -Path (Join-Path $Bundle "лог установки.txt") -Force | Out-Null } catch {}

$problems = New-Object System.Collections.ArrayList
function Problem($text) { [void]$problems.Add($text); Write-Host "  ОШИБКА: $text" -ForegroundColor Red }
function Ok($text)      { Write-Host "  OK: $text" -ForegroundColor Green }
function Title($text)   { Write-Host ""; Write-Host "=== $text ===" -ForegroundColor Cyan }

Add-Type -AssemblyName System.Windows.Forms

function Pick-Folder($description, $startPath) {
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = $description
    $dlg.ShowNewFolderButton = $true
    if ($startPath -and (Test-Path -LiteralPath $startPath)) { $dlg.SelectedPath = $startPath }
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $result = $dlg.ShowDialog($owner)
    $owner.Dispose()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.SelectedPath }
    return $null
}

function Read-Utf8($path)          { return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) }
function Write-Utf8($path, $text)  { [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom) }

Write-Host ""
Write-Host "  УСТАНОВКА IRIS TOOLS" -ForegroundColor White
Write-Host "  ---------------------"

# ---------- проверки ----------
if (-not (Test-Path -LiteralPath (Join-Path $Files "Scripts"))) {
    Write-Host "Не найдены файлы установки. Сначала РАСПАКУЙТЕ архив в обычную папку." -ForegroundColor Red
    Read-Host "Enter — закрыть"
    exit 1
}

# снять пометку «скачано из интернета», чтобы Windows не блокировала файлы
try { Get-ChildItem -LiteralPath $Bundle -Recurse -File | Unblock-File } catch {}

while (Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "Photoshop открыт. Закройте его (сохраните работу) и нажмите Enter." -ForegroundColor Yellow
    Read-Host | Out-Null
}

$adobe = Join-Path $env:ProgramFiles "Adobe"
$psDirs = @(Get-ChildItem -LiteralPath $adobe -Directory -Filter "Adobe Photoshop*" -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "Presets\Scripts") })

if ($psDirs.Count -eq 0) {
    Write-Host "Photoshop не найден в $adobe. Сначала установите Photoshop." -ForegroundColor Red
    Read-Host "Enter — закрыть"
    exit 1
}
Write-Host "Найден Photoshop:"
$psDirs | ForEach-Object { Write-Host "  $($_.FullName)" }

# ---------- папки ----------
Title "Выбор папок"

Write-Host "Окно 1: папка с шаблонами PSD (Полароид, Магнит, Круглый стикер...)"
$tplDir = Pick-Folder "Выберите папку с ШАБЛОНАМИ (PSD для кнопок панели: Полароид, Мини, Круг, Квадрат, Магнит)" (Join-Path $UserDesktop "Шаблоны")
if ($tplDir) { Ok "Шаблоны: $tplDir" } else { Write-Host "  Пропущено — кнопки шаблонов на панели не будут работать." -ForegroundColor Yellow }

Write-Host "Окно 2: папка «исходники», куда приходят снимки с камеры"
$srcDir = Pick-Folder "Выберите папку ИСХОДНИКИ — куда приходят снимки с камеры (для автоцентровки по зрачку). Отмена — не ставить центровку." (Join-Path $UserDesktop "исходники")
if ($srcDir) { Ok "Исходники: $srcDir" } else { Write-Host "  Пропущено — автоцентровка ставиться не будет." -ForegroundColor Yellow }

# ---------- 1. скрипты ----------
Title "Скрипты Photoshop"
foreach ($ps in $psDirs) {
    try {
        $scripts = Join-Path $ps.FullName "Presets\Scripts"
        # все .jsx из Scripts и Print, кроме направляющих (они отдельно, ниже)
        $jsx = @(Get-ChildItem -LiteralPath (Join-Path $Files "Scripts"), (Join-Path $Files "Print") -Filter "*.jsx" |
                 Where-Object { $_.Name -ne "auto-center-guides.jsx" })
        $jsx | Copy-Item -Destination $scripts -Force

        # скрипт направляющих — в «Event Scripts Only», чтобы он был в списке Диспетчера событий
        $eventDir = Join-Path $scripts "Event Scripts Only"
        if (-not (Test-Path -LiteralPath $eventDir)) { New-Item -ItemType Directory -Path $eventDir | Out-Null }
        Copy-Item -LiteralPath (Join-Path $Files "Scripts\auto-center-guides.jsx") -Destination $eventDir -Force
        # если раньше он лежал в Scripts (и к нему уже привязаны события) — обновим и там
        $old = Join-Path $scripts "auto-center-guides.jsx"
        if (Test-Path -LiteralPath $old) { Copy-Item -LiteralPath (Join-Path $Files "Scripts\auto-center-guides.jsx") -Destination $old -Force }

        Ok $scripts
    } catch { Problem "скрипты в $($ps.Name): $($_.Exception.Message)" }
}

# ---------- 2. ICC-профиль ----------
Title "Цветовой профиль принтера"
try {
    Get-ChildItem -LiteralPath (Join-Path $Files "Print") -Filter "*.icm" |
        Copy-Item -Destination (Join-Path $env:WINDIR "System32\spool\drivers\color") -Force
    Ok "L8050_EyePH_Chern.icm"
} catch { Problem "профиль: $($_.Exception.Message)" }

# ---------- 3. панель ----------
Title "Панель Iris Tools"
foreach ($ps in $psDirs) {
    try {
        $plugins = Join-Path $ps.FullName "Plug-ins"
        if (-not (Test-Path -LiteralPath $plugins)) { New-Item -ItemType Directory -Path $plugins | Out-Null }
        $dst = Join-Path $plugins "IrisToolsPanel"
        if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $Files "IrisToolsPanel") -Destination $dst -Recurse -Force

        if ($tplDir) {
            $mainJs = Join-Path $dst "main.js"
            $tplFwd = $tplDir -replace '\\', '/'
            $js = Read-Utf8 $mainJs
            $js = [regex]::Replace($js, 'const TEMPLATES_DIR = "[^"]*";',
                                   { param($m) 'const TEMPLATES_DIR = "' + $tplFwd + '";' })
            Write-Utf8 $mainJs $js
        }
        Ok $dst
    } catch { Problem "панель в $($ps.Name): $($_.Exception.Message)" }
}

# ---------- 4-5. центровка зрачка ----------
if ($srcDir) {
    Title "Python"

    function Find-Python {
        $c = New-Object System.Collections.ArrayList
        foreach ($base in @("C:\Python", (Join-Path $env:LOCALAPPDATA "Programs\Python"), $env:ProgramFiles)) {
            Get-ChildItem -LiteralPath $base -Directory -Filter "Python3*" -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { [void]$c.Add((Join-Path $_.FullName "python.exe")) }
        }
        Get-Command python.exe -All -ErrorAction SilentlyContinue |
            Where-Object { $_.Source -notlike "*WindowsApps*" } |
            ForEach-Object { [void]$c.Add($_.Source) }
        foreach ($p in $c) {
            if ($p -and (Test-Path -LiteralPath $p) -and (Test-Path -LiteralPath (Join-Path (Split-Path $p) "pythonw.exe"))) { return $p }
        }
        return $null
    }

    $py = Find-Python
    if (-not $py) {
        Write-Host "  Python не найден — скачиваю и ставлю (нужен интернет, ~30 МБ)..."
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $ProgressPreference = "SilentlyContinue"
            $setup = Join-Path $env:TEMP "python-setup.exe"
            Invoke-WebRequest -Uri $PythonUrl -OutFile $setup -UseBasicParsing
            $p = Start-Process -FilePath $setup -Wait -PassThru `
                 -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0 TargetDir=`"$PythonDir`""
            if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "установщик Python завершился с кодом $($p.ExitCode)" }
            $py = Find-Python
        } catch {
            Problem "Python не установился автоматически: $($_.Exception.Message)"
            Write-Host "  Поставьте Python вручную: $PythonUrl" -ForegroundColor Yellow
            Write-Host "  (при установке отметьте «Add python.exe to PATH»), затем запустите УСТАНОВИТЬ.bat ещё раз." -ForegroundColor Yellow
        }
    }

    if ($py) {
        Ok $py
        $pyw = Join-Path (Split-Path $py) "pythonw.exe"

        Title "Библиотеки Python (opencv, numpy, rawpy, pillow)"
        # внешние программы пишут предупреждения в stderr — это не ошибка
        $ErrorActionPreference = "Continue"
        & $py -m pip install --upgrade --disable-pip-version-check opencv-python numpy rawpy pillow
        & $py -c "import cv2, numpy, rawpy, PIL"
        $libsOk = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = "Stop"
        if ($libsOk) { Ok "библиотеки установлены" }
        else { Problem "библиотеки Python не установились (нет интернета?) — запустите УСТАНОВИТЬ.bat ещё раз" }

        Title "Центровка зрачка"
        try {
            # остановить уже работающий сторож, чтобы не было двух
            Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -like "*center_watcher*" } |
                ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }

            if (-not (Test-Path -LiteralPath $WatchDir)) { New-Item -ItemType Directory -Path $WatchDir | Out-Null }
            Get-ChildItem -LiteralPath (Join-Path $Files "Watcher") -File |
                Copy-Item -Destination $WatchDir -Force

            $watcher = Join-Path $WatchDir "center_watcher.py"
            $srcFwd = $srcDir -replace '\\', '/'
            $code = Read-Utf8 $watcher
            $code = [regex]::Replace($code, '(?m)^WATCH_FOLDER = [^\r\n]*',
                                     { param($m) 'WATCH_FOLDER = r"' + $srcFwd + '"' })
            Write-Utf8 $watcher $code
            Ok "C:\Photoshop, слежу за: $srcDir"

            $bat = (Get-ChildItem -LiteralPath $WatchDir -Filter "*.bat" |
                    Where-Object { (Read-Utf8 $_.FullName) -match 'set "PYTHON=' } |
                    Select-Object -First 1).FullName
            if ($bat) {
                $b = Read-Utf8 $bat
                $b = [regex]::Replace($b, '(?m)^set "PYTHON=[^\r\n]*', { param($m) 'set "PYTHON=' + $py + '"' })
                $b = [regex]::Replace($b, '(?m)^set "SCRIPT=[^\r\n]*', { param($m) 'set "SCRIPT=' + $watcher + '"' })
                Write-Utf8 $bat $b
            }

            # автозапуск: убрать старые ярлыки сторожа и создать один новый
            $ws = New-Object -ComObject WScript.Shell
            foreach ($dir in @($UserStartup, [Environment]::GetFolderPath("CommonStartup"))) {
                Get-ChildItem -LiteralPath $dir -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
                    try {
                        if ($ws.CreateShortcut($_.FullName).Arguments -like "*center_watcher*") {
                            Remove-Item -LiteralPath $_.FullName -Force
                        }
                    } catch {}
                }
            }
            $lnkPath = Join-Path $UserStartup "Центровка зрачка.lnk"
            $lnk = $ws.CreateShortcut($lnkPath)
            $lnk.TargetPath = $pyw
            $lnk.Arguments = '"' + $watcher + '"'
            $lnk.WorkingDirectory = $WatchDir
            $lnk.Save()
            Ok "автозапуск: $lnkPath"

            # запустить прямо сейчас (через проводник — без прав администратора)
            Start-Process -FilePath "explorer.exe" -ArgumentList ('"' + $lnkPath + '"')
            Ok "сторож запущен"
        } catch { Problem "центровка: $($_.Exception.Message)" }
    }
}

# ---------- итог ----------
Title "Итог"
if ($problems.Count -eq 0) {
    Write-Host "Всё установлено без ошибок." -ForegroundColor Green
} else {
    Write-Host "Были ошибки:" -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
Write-Host ""
Write-Host "Дальше — в Photoshop, по «Инструкции по установке», шаги 3–7:"
Write-Host "  горячие клавиши, Диспетчер событий, панель, папка для F5, настройка печати."
Write-Host ""
try { Stop-Transcript | Out-Null } catch {}
Read-Host "Enter — закрыть"
