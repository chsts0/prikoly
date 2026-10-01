// ============================================================
//  IRIS TOOLS — Парная раскладка: ВАРИАНТ 1 «ЦЕЛЫЕ»
//  Оба глаза целиком в кадре, по диагонали
//  (левый — снизу, правый — сверху).
//
//  КАК ПОЛЬЗОВАТЬСЯ:
//   1. Перетащите оба готовых глаза в файл шаблона
//      (примерно: левый глаз — левее, правый — правее)
//   2. Выделите ОБА слоя с глазами в панели Layers
//   3. Запустите скрипт
//
//  Скрипт сам определяет формат по размеру документа (px)
//  и берёт значения из таблицы FORMATS.
//
//  У формата можно задать:
//   - только right (правый верхний глаз) — тогда левый
//     ставится зеркально (как у А3/А4/А5);
//   - right И left явно — для форматов с индивидуальным
//     смещением под принтер (как у А6).
// ============================================================

#target photoshop

(function () {

    // ================== ТАБЛИЦА ФОРМАТОВ ==================
    // cx — доля ширины холста, cy — доля высоты, d — диаметр в долях высоты
    var FORMATS = [
        // А6 (2953x1969) — ОБА глаза заданы явно (поправка на смещение принтера):
        //   левый:  1230 px, X  254, Y 535
        //   правый: 1230 px, X 1442, Y 214
        { name: "A6", w: 2953, h: 1969,
          right: { cx: 0.6966, cy: 0.4210, d: 0.6247 },
          left:  { cx: 0.2943, cy: 0.5838, d: 0.6247 } },

        // А5 (4134x2913) — из данных: правый глаз 1823x1824 px, X 2037, Y 307.
        // Левый — зеркально.
        { name: "A5", w: 4134, h: 2913,
          right: { cx: 0.7132, cy: 0.4185, d: 0.6262 } },

        // А4 (5846x4134) — пропорции как у А5, те же доли
        { name: "A4", w: 5846, h: 4134,
          right: { cx: 0.7132, cy: 0.4185, d: 0.6262 } },

        // А3 (8268x5846) — пропорции как у А5, те же доли
        { name: "A3", w: 8268, h: 5846,
          right: { cx: 0.7132, cy: 0.4185, d: 0.6262 } }
    ];

    // Для нераспознанного размера холста (запасной вариант — как А5):
    var DEFAULT = { name: "по умолчанию (как А5)",
                    right: { cx: 0.7132, cy: 0.4185, d: 0.6262 } };

    var SIZE_TOLERANCE = 4; // допуск совпадения размера, px
    // ======================================================

    placePair();

    function placePair() {
        if (app.documents.length === 0) { alert("Нет открытого документа."); return; }

        var doc = app.activeDocument;
        var oldUnits = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        try {
            var ids = getSelectedLayerIDs();
            if (ids.length !== 2) {
                alert("Выделите ровно ДВА слоя с глазами в панели Layers\n(клик + Ctrl-клик), затем запустите скрипт снова.\n\nСейчас выделено слоёв: " + ids.length);
                return;
            }

            var W = doc.width.value;
            var H = doc.height.value;

            // --- определяем формат по размеру документа ---
            var fmt = DEFAULT;
            for (var f = 0; f < FORMATS.length; f++) {
                if (Math.abs(FORMATS[f].w - W) <= SIZE_TOLERANCE &&
                    Math.abs(FORMATS[f].h - H) <= SIZE_TOLERANCE) {
                    fmt = FORMATS[f];
                    break;
                }
            }
            if (fmt === DEFAULT) {
                alert("Формат " + W + "x" + H + " px не найден в таблице.\nИспользую значения: " + DEFAULT.name + ".");
            }

            var slotR = fmt.right;
            var slotL = fmt.left
                ? fmt.left
                : { cx: 1 - fmt.right.cx, cy: 1 - fmt.right.cy, d: fmt.right.d };

            // --- какой из выделённых слоёв левее ---
            var info = [];
            for (var i = 0; i < 2; i++) {
                selectLayerByID(ids[i]);
                var b = doc.activeLayer.bounds;
                info.push({ id: ids[i], cx: (b[0].value + b[2].value) / 2 });
            }
            var leftID, rightID;
            if (info[0].cx <= info[1].cx) { leftID = info[0].id; rightID = info[1].id; }
            else                          { leftID = info[1].id; rightID = info[0].id; }

            placeLayer(leftID,  slotL, W, H);
            placeLayer(rightID, slotR, W, H);

        } catch (e) {
            alert("Ошибка: " + e.message);
        } finally {
            app.preferences.rulerUnits = oldUnits;
        }
    }

    function placeLayer(id, slot, W, H) {
        selectLayerByID(id);
        var layer = app.activeDocument.activeLayer;

        var b = layer.bounds;
        var curW = b[2].value - b[0].value;
        var curH = b[3].value - b[1].value;
        var cur = Math.max(curW, curH);
        var target = slot.d * H;
        if (cur > 0) {
            var pct = (target / cur) * 100;
            layer.resize(pct, pct, AnchorPosition.MIDDLECENTER);
        }

        b = layer.bounds;
        var bcx = (b[0].value + b[2].value) / 2;
        var bcy = (b[1].value + b[3].value) / 2;
        layer.translate(slot.cx * W - bcx, slot.cy * H - bcy);
    }

    function getSelectedLayerIDs() {
        var ids = [];
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("targetLayersIDs"));
        ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref);
        if (desc.hasKey(stringIDToTypeID("targetLayersIDs"))) {
            var list = desc.getList(stringIDToTypeID("targetLayersIDs"));
            for (var i = 0; i < list.count; i++) {
                ids.push(list.getReference(i).getIdentifier());
            }
        }
        return ids;
    }

    function selectLayerByID(id) {
        var ref = new ActionReference();
        ref.putIdentifier(charIDToTypeID("Lyr "), id);
        var d = new ActionDescriptor();
        d.putReference(charIDToTypeID("null"), ref);
        d.putBoolean(charIDToTypeID("MkVs"), false);
        executeAction(charIDToTypeID("slct"), d, DialogModes.NO);
    }

})();
