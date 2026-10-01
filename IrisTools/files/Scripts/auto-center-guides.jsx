/*
 * auto-center-guides.jsx  (v2 — с принудительной перерисовкой)
 * ---------------------------------------------------------------
 * Ставит две направляющие по центру холста — горизонтальную
 * и вертикальную.
 *
 * Для привязки в Script Events Manager
 * (Файл -> Сценарии -> Управление событиями сценариев):
 *   - Новый документ  (New Document)
 *   - Открыть документ (Open Document)
 *
 * ЧТО ИЗМЕНИЛОСЬ ПО СРАВНЕНИЮ С v1:
 * Направляющие ставятся через Action Manager, а не через
 * doc.guides.add(). DOM-метод в новых версиях Photoshop не вызывает
 * перерисовку холста — гайды создавались, но не отображались,
 * пока пользователь не ставил ещё одну вручную.
 * Дополнительно в конце вызывается app.refresh().
 * ---------------------------------------------------------------
 */

#target photoshop

// ======== НАСТРОЙКИ ========

// Не трогать документ, если в нём уже есть направляющие.
var ONLY_IF_NO_GUIDES = true;

// Включать показ направляющих, если они скрыты (Ctrl + ;).
var FORCE_SHOW_GUIDES = true;

// Включать линейки, если они выключены (Ctrl + R).
var FORCE_SHOW_RULERS = false;

// Запасной способ перерисовки: короткий зум in/out.
// Включать только если после app.refresh() гайды всё равно
// не появляются сразу.
var HARD_REDRAW = false;

// ===========================


(function () {

    if (app.documents.length === 0) return;

    var doc;
    try { doc = app.activeDocument; } catch (e) { return; }

    if (ONLY_IF_NO_GUIDES && doc.guides.length > 0) return;

    var oldUnits = app.preferences.rulerUnits;

    // --- направляющая через Action Manager ---
    function addGuide(positionPx, isVertical) {
        var desc = new ActionDescriptor();
        var guide = new ActionDescriptor();

        guide.putUnitDouble(stringIDToTypeID("position"),
                            stringIDToTypeID("pixelsUnit"),
                            positionPx);
        guide.putEnumerated(stringIDToTypeID("orientation"),
                            stringIDToTypeID("orientation"),
                            isVertical ? stringIDToTypeID("vertical")
                                       : stringIDToTypeID("horizontal"));

        desc.putObject(stringIDToTypeID("new"),
                       stringIDToTypeID("good"),
                       guide);

        executeAction(stringIDToTypeID("make"), desc, DialogModes.NO);
    }

    try {
        app.preferences.rulerUnits = Units.PIXELS;

        // Показ направляющих включаем ДО создания —
        // иначе первая пара может остаться невидимой.
        if (FORCE_SHOW_GUIDES) {
            try {
                if (!app.preferences.showGuides) {
                    var d = new ActionDescriptor();
                    var r = new ActionReference();
                    r.putEnumerated(charIDToTypeID("Mn  "),
                                    charIDToTypeID("MnIt"),
                                    stringIDToTypeID("toggleGuides"));
                    d.putReference(charIDToTypeID("null"), r);
                    executeAction(charIDToTypeID("slct"), d, DialogModes.NO);
                }
            } catch (e) {}
        }

        if (FORCE_SHOW_RULERS) {
            try {
                if (!app.preferences.rulerShown) {
                    app.preferences.rulerShown = true;
                }
            } catch (e) {}
        }

        addGuide(doc.height.value / 2, false);   // горизонтальная
        addGuide(doc.width.value  / 2, true);    // вертикальная

        // --- перерисовка ---
        try { app.refresh(); } catch (e) {}

        if (HARD_REDRAW) {
            try {
                app.runMenuItem(charIDToTypeID("ZmIn"));
                app.runMenuItem(charIDToTypeID("ZmOt"));
            } catch (e) {}
        }

    } catch (e) {
        // молча
    } finally {
        try { app.preferences.rulerUnits = oldUnits; } catch (e) {}
    }

})();
