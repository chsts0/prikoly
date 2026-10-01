/*
 * save_jpeg.jsx
 * ---------------------------------------------------------------
 * Сохраняет текущий документ в JPEG (качество 12) в папку
 * сегодняшнего дня. Папки создаёт сам:
 *
 *     <корневая папка>\август 2026\10.08\4-1233.jpg
 *
 * Имя вводится как 4 цифры, префикс "4-" подставляется сам.
 *
 * ПУТЬ НЕ ЗАШИТ В КОД. При первом запуске скрипт спросит
 * корневую папку и запомнит её. Дальше работает молча.
 *
 * Настройка хранится в файле:
 *   Windows: %APPDATA%\IrisTools\settings.txt   (ключ savePath)
 *   macOS:   ~/Library/Application Support/IrisTools/settings.txt
 *
 * Сменить папку: удалить строку savePath=... из этого файла,
 * либо запустить скрипт с зажатым Shift.
 * ---------------------------------------------------------------
 */

#target photoshop

(function () {

    // ======== НАСТРОЙКИ ========

    var QUALITY = 12;          // качество JPEG, 1–12
    var PREFIX  = "4-";        // что подставляется перед номером
    var DIGITS  = 4;           // сколько цифр требовать

    // ===========================

    var months = ["январь", "февраль", "март", "апрель",
                  "май", "июнь", "июль", "август",
                  "сентябрь", "октябрь", "ноябрь", "декабрь"];

    if (app.documents.length === 0) {
        alert("Нет открытого документа.");
        return;
    }

    // ---------- 1. корневая папка ----------

    var settings = loadSettings();
    var root = settings["savePath"];

    // Shift при запуске — принудительно спросить заново
    var forceAsk = false;
    try { forceAsk = ScriptUI.environment.keyboardState.shiftKey; } catch (e) {}

    if (forceAsk || !root || !(new Folder(root)).exists) {

        if (root && !forceAsk) {
            alert("Папка из настроек больше не существует:\n" + root +
                  "\n\nУкажите её заново.");
        }

        var picked = Folder.selectDialog(
            "Выберите КОРНЕВУЮ папку для готовых фото\n" +
            "(внутри неё скрипт сам создаст папки месяца и дня)");

        if (picked === null) return;   // отмена

        root = picked.fsName;
        settings["savePath"] = root;
        saveSettings(settings);
    }

    // ---------- 2. папка сегодняшнего дня ----------

    var now = new Date();
    var monthFolder = months[now.getMonth()] + " " + now.getFullYear();
    var dayFolder = ("0" + now.getDate()).slice(-2) + "." +
                    ("0" + (now.getMonth() + 1)).slice(-2);

    var basePath = root + "/" + monthFolder + "/" + dayFolder;

    var folder = new Folder(basePath);
    if (!folder.exists) {
        if (!folder.create()) {
            alert("Не удалось создать папку:\n" + basePath);
            return;
        }
    }

    // ---------- 3. номер файла ----------

    var re = new RegExp("^\\d{" + DIGITS + "}$");
    var num = null;

    while (true) {
        num = prompt("Номер фото (" + PREFIX +
                     new Array(DIGITS + 1).join("_") +
                     "), ровно " + DIGITS + " цифры:", "");
        if (num === null) return;              // отмена
        if (re.test(num)) break;
        alert("Нужно ввести ровно " + DIGITS + " цифры, например: 1233");
    }

    // ---------- 4. сохранение ----------

    var fileName = PREFIX + num;
    var saveFile = new File(basePath + "/" + fileName + ".jpg");

    if (saveFile.exists) {
        if (!confirm("Файл «" + fileName + ".jpg» уже существует.\n" +
                     "Перезаписать?")) return;
    }

    try {
        var opts = new JPEGSaveOptions();
        opts.quality = QUALITY;
        app.activeDocument.saveAs(saveFile, opts, true);
    } catch (e) {
        alert("Не удалось сохранить файл.\n\n" + e.message +
              "\n\nПуть: " + saveFile.fsName);
    }

    // ================= НАСТРОЙКИ =================

    function settingsFile() {
        var f = new Folder(Folder.userData + "/IrisTools");
        if (!f.exists) f.create();
        return new File(f.fsName + "/settings.txt");
    }

    function loadSettings() {
        var obj = {};
        var f = settingsFile();
        if (f.exists && f.open("r")) {
            while (!f.eof) {
                var line = f.readln();
                var i = line.indexOf("=");
                if (i > 0) obj[line.substring(0, i)] = line.substring(i + 1);
            }
            f.close();
        }
        return obj;
    }

    function saveSettings(obj) {
        var f = settingsFile();
        if (f.open("w")) {
            for (var k in obj) f.writeln(k + "=" + obj[k]);
            f.close();
        }
    }

})();
