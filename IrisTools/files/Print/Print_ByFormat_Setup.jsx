#target photoshop

/* ============================================================
   НАСТРОЙКА ПЕЧАТИ ПО ФОРМАТУ — запускать на каждом компе
   один раз для каждого формата.

   1. Откройте шаблон формата (A6, 10x15 магнит/стикер, A5, A4, A3).
   2. File -> Scripts -> Print_ByFormat_Setup
   3. В окне печати выберите бумагу, как она называется на этой
      точке, и нажмите «Готово».

   Вся логика — в Print_ByFormat.jsx (должен лежать рядом).
   ============================================================ */

var PBF_SETUP_MODE = true;

(function () {
    var main = new File(new File($.fileName).parent + "/Print_ByFormat.jsx");
    if (!main.exists) {
        alert("Не найден Print_ByFormat.jsx рядом с этим скриптом:\n" + main.fsName);
        return;
    }
    $.evalFile(main);
})();
