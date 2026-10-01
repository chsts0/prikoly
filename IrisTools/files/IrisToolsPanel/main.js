// ============================================================
//  IRIS TOOLS — UXP-панель для Photoshop
//  Логика: формат определяется по документу + ползунок зрачка + сужение (Pinch)
// ============================================================

const { app, core, action } = require("photoshop");
const batchPlay = action.batchPlay;
const fsLocal = require("uxp").storage.localFileSystem;

/* ================== ШАБЛОНЫ ПОД КНОПКАМИ ==================
   Путь к папке с PSD. Если шаблоны лежат в другом месте — правится здесь.
   Обрати внимание: у папки на Рабочем столе путь может идти через OneDrive,
   тогда будет "C:/Users/EyePhoto/OneDrive/Desktop/Шаблоны".
   Подпись — то, что видно на кнопке; file — имя файла как есть. */
const TEMPLATES_DIR = "C:/Users/EyePhoto/Desktop/Шаблоны";

/* Каждый вложенный список — отдельный ряд кнопок. Внутри ряда кнопки делят
   ширину поровну. Хочешь переставить — двигай строки между рядами, хочешь
   ряд из трёх — просто добавь третью строку в нужный список. */
const TEMPLATE_ROWS = [
  [
    { label: "Полароид", file: "Полароид новый.psd" },
    { label: "Мини",     file: "Фото на телефон новый.psd" },
  ],
  [
    { label: "Круг",     file: "Круглый стикер.psd" },
    { label: "Квадрат",  file: "Шаблон стикер.psd" },
  ],
  [
    { label: "Магнит",   file: "Большой магнит.psd" },
  ],
];

// ================== ШАБЛОНЫ ФОРМАТОВ ==================
// mm    — размер холста шаблона в мм [длинная сторона, короткая]
// iris  — итоговая ширина радужки в шаблоне, px
// pupil — итоговый диаметр зрачка в шаблоне, px
const FORMATS = {
  A3: { label: "А3",         mm: [420, 297], iris: 5248, pupil: 1240 },
  A4: { label: "А4",         mm: [297, 210], iris: 3632, pupil: 850  },
  A5: { label: "А5",         mm: [210, 148], iris: 2512, pupil: 600  },
  A6: { label: "А6 (10x15)", mm: [150, 100], iris: 1699, pupil: 400  }
};

// Допуск при опознании формата по размеру холста, мм.
// 4 мм с запасом покрывает округления, но не даёт спутать А4 с А5.
const SIZE_TOLERANCE_MM = 4;

// Запасной вариант для нестандартного холста: доли от длинной стороны.
// Усреднено по таблице выше — точным не будет, но панель останется рабочей.
const FALLBACK_IRIS_RATIO  = 0.61;
const FALLBACK_PUPIL_RATIO = 0.236;

// ================== НАСТРОЙКИ СУЖЕНИЯ (можно подкручивать) ==================
const PINCH = {
  zoneFactor:    0.62,  // диаметр зоны щипка = доля от ширины радужки шаблона
  zoneFeather:   25,    // растушёвка края зоны, px (мягкий переход)
  passAmount:    20,    // сила одного прохода Pinch, % (слабее = естественнее)
  shrinkPerPass: 0.88,  // насколько один проход уменьшает зрачок (0.82 = минус ~18%)
  overshoot:     0.90,  // сужаем чуть сильнее нужного (текстура заходит ПОД чёрный зрачок)
  maxPasses:     12     // предохранитель от бесконечного цикла
};
// Растушёвка чёрного зрачка: доля от его диаметра.
// 0.015 = 1.5% (А6 ~6px, А5 ~9px, А4 ~13px, А3 ~19px).
// Хотите мягче край — увеличьте (например 0.025), жёстче — уменьшите.
const PUPIL_FEATHER_FACTOR = 0.050;
const PUPIL_FEATHER_MIN = 4; // минимум, px

// Насколько слой считается «уже подогнанным» (доля от целевой ширины радужки)
const FIT_SIZE_TOLERANCE = 0.01;   // 1%
const FIT_CENTER_TOLERANCE = 2;    // px
// ============================================================================

let fmt = null;        // текущий формат: { key, label, iris, pupil, exact }
let lastDocId = null;
let busy = false;

// ---------- ссылки на элементы ----------
const fmtInfo     = document.getElementById("fmtInfo");
const pupilSlider = document.getElementById("pupilSlider");
const pupilVal    = document.getElementById("pupilVal");
const applyBtn    = document.getElementById("applyBtn");
const statusEl    = document.getElementById("status");

// ================== УТИЛИТЫ ==================
const px = v => ({ _unit: "pixelsUnit", _value: v });

// Успешные сообщения больше не показываем — панель должна быть компактной.
// Ошибки остаются видимыми, иначе непонятно, почему ничего не произошло.
function setStatus(msg, isError) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = isError ? "err" : "";
}

function canvasSize() {
  const d = app.activeDocument;
  return { W: d.width, H: d.height };
}

async function bp(cmds) {
  return await batchPlay(cmds, {});
}

async function selectEllipseCentered(diameter) {
  const { W, H } = canvasSize();
  const r = diameter / 2;
  await bp([{
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: {
      _obj: "ellipse",
      top: px(H / 2 - r), left: px(W / 2 - r),
      bottom: px(H / 2 + r), right: px(W / 2 + r)
    },
    antiAlias: true
  }]);
}

async function feather(radius) {
  await bp([{ _obj: "feather", radius: px(radius) }]);
}

async function deselect() {
  await bp([{
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: { _enum: "ordinal", _value: "none" }
  }]);
}

async function fillBlack() {
  await bp([{
    _obj: "fill",
    using: { _enum: "fillContents", _value: "color" },
    color: { _obj: "RGBColor", red: 0, grain: 0, blue: 0 },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" }
  }]);
}

async function pinch(amount) {
  await bp([{ _obj: "pinch", amount: Math.round(amount) }]);
}

function getActiveLayer() {
  const layers = app.activeDocument.activeLayers;
  if (!layers || layers.length === 0) return null;
  return layers[0];
}

// ================== ОПРЕДЕЛЕНИЕ ФОРМАТА ПО ДОКУМЕНТУ ==================
// Считаем размер холста в миллиметрах, а не в пикселях, чтобы результат
// не зависел от разрешения шаблона (500 ppi или любое другое).
function detectFormat() {
  const doc = app.activeDocument;
  if (!doc) return null;

  const dpi = doc.resolution || 72;
  const longPx  = Math.max(doc.width, doc.height);
  const shortPx = Math.min(doc.width, doc.height);
  const longMM  = longPx  / dpi * 25.4;
  const shortMM = shortPx / dpi * 25.4;

  for (const key of Object.keys(FORMATS)) {
    const f = FORMATS[key];
    if (Math.abs(longMM  - f.mm[0]) <= SIZE_TOLERANCE_MM &&
        Math.abs(shortMM - f.mm[1]) <= SIZE_TOLERANCE_MM) {
      return { key, label: f.label, iris: f.iris, pupil: f.pupil, exact: true };
    }
  }

  // холст не совпал ни с одним шаблоном — работаем по пропорции
  const iris = Math.round(longPx * FALLBACK_IRIS_RATIO);
  return {
    key: null,
    label: Math.round(longMM) + "x" + Math.round(shortMM) + " мм",
    iris,
    pupil: Math.round(iris * FALLBACK_PUPIL_RATIO),
    exact: false
  };
}

// Пересчитать формат и обновить интерфейс. Вызывается при смене документа.
function syncDocument(force) {
  if (busy) return;

  let doc = null;
  try { doc = app.activeDocument; } catch (e) { doc = null; }
  const id = doc ? doc.id : null;
  if (!force && id === lastDocId) return;
  lastDocId = id;

  fmt = doc ? detectFormat() : null;

  if (!fmt) {
    fmtInfo.textContent = "Нет открытого документа";
    applyBtn.classList.add("disabled");
    return;
  }

  // диапазон ползунка под формат: от зрачка шаблона до ~3.2x
  pupilSlider.min = Math.round(fmt.pupil * 0.9);
  pupilSlider.max = Math.round(fmt.pupil * 3.2);
  pupilSlider.value = Math.round(fmt.pupil * 1.6);
  if (pupilVal) pupilVal.textContent = pupilSlider.value;

  fmtInfo.textContent = fmt.exact
    ? fmt.label + ": радужка " + fmt.iris + " px, зрачок " + fmt.pupil + " px"
    : "Формат не опознан (" + fmt.label + ") — считаю по пропорции: радужка "
      + fmt.iris + " px, зрачок " + fmt.pupil + " px";

  applyBtn.classList.remove("disabled");
  setStatus("");
}

// ================== ПОДГОНКА СЛОЯ ПОД ФОРМАТ ==================
// Ничего не запоминаем: смотрим фактические габариты слоя. Если он уже нужного
// размера и по центру — не трогаем. Поэтому повторные движения ползунка слой не
// пересчитывают, а новая радужка в том же документе подгоняется сама.
async function ensureLayerFitted() {
  const layer = getActiveLayer();
  if (!layer) throw new Error("Выделите слой с радужкой");

  let b = layer.bounds;
  const cur = Math.max(b.right - b.left, b.bottom - b.top);
  if (cur <= 0) throw new Error("Слой пустой");

  const { W, H } = canvasSize();
  const sizeOk = Math.abs(cur - fmt.iris) <= fmt.iris * FIT_SIZE_TOLERANCE;
  const centerOk =
    Math.abs((b.left + b.right) / 2 - W / 2) <= FIT_CENTER_TOLERANCE &&
    Math.abs((b.top + b.bottom) / 2 - H / 2) <= FIT_CENTER_TOLERANCE;

  if (sizeOk && centerOk) return false;

  await deselect().catch(() => {});

  if (!sizeOk) {
    const pct = (fmt.iris / cur) * 100;
    await layer.scale(pct, pct);
  }

  b = layer.bounds;
  await layer.translate(W / 2 - (b.left + b.right) / 2,
                        H / 2 - (b.top + b.bottom) / 2);
  return true;
}

// ================== ШАГ 1: ПРЕДПРОСМОТР ЗРАЧКА ==================
let previewTimer = null;

function schedulePreview() {
  if (pupilVal) pupilVal.textContent = pupilSlider.value;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 220);
}

async function runPreview() {
  if (busy) return;
  busy = true;
  try {
    if (!fmt) syncDocument(true);
    if (!fmt) throw new Error("Нет открытого документа");

    let fitted = false;
    await core.executeAsModal(async () => {
      fitted = await ensureLayerFitted();
    }, { commandName: "Iris Tools: подгонка радужки" });

    await core.executeAsModal(async () => {
      await selectEllipseCentered(Number(pupilSlider.value));
    }, { commandName: "Iris Tools: круг зрачка" });

    if (fitted) {
      setStatus("Радужка подогнана под " + fmt.label + " (" + fmt.iris + " px)");
    }
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    busy = false;
  }
}

// ================== ШАГ 2: СУЖЕНИЕ + ЗАЛИВКА ==================
async function applyPupil() {
  if (busy) return;
  if (!fmt) syncDocument(true);
  if (!fmt) { setStatus("Нет открытого документа", true); return; }

  busy = true;
  applyBtn.classList.add("disabled");

  const currentPupil = Number(pupilSlider.value);
  const targetTexture = fmt.pupil * PINCH.overshoot; // тянем текстуру чуть глубже

  try {
    await core.executeAsModal(async () => {
      // на случай, если ползунок не трогали — слой всё равно встанет в размер
      await ensureLayerFitted();

      await deselect().catch(() => {});

      // --- многопроходный Pinch ---
      const ratio = targetTexture / currentPupil;
      let passes = 0;
      if (ratio < 1) {
        passes = Math.ceil(Math.log(ratio) / Math.log(PINCH.shrinkPerPass));
        passes = Math.min(Math.max(passes, 1), PINCH.maxPasses);

        const zone = fmt.iris * PINCH.zoneFactor;
        await selectEllipseCentered(zone);
        await feather(PINCH.zoneFeather);
        for (let i = 0; i < passes; i++) {
          await pinch(PINCH.passAmount);
        }
        await deselect();
      }

      // --- чёрный зрачок точно в размер шаблона, с мягким краем ---
      const pupilFeather = Math.max(PUPIL_FEATHER_MIN, Math.round(fmt.pupil * PUPIL_FEATHER_FACTOR));
      await selectEllipseCentered(fmt.pupil);
      await feather(pupilFeather);
      await fillBlack();
      await deselect();

      setStatus("Готово! Проходов Pinch: " + passes +
        "\nЗрачок: " + fmt.pupil + " px (" + fmt.label + ")");
    }, { commandName: "Iris Tools: зрачок" });
  } catch (e) {
    setStatus("Ошибка: " + e.message, true);
  } finally {
    busy = false;
    applyBtn.classList.remove("disabled");
  }
}

// ================== КНОПКИ ШАБЛОНОВ ==================
// Photoshop сам не открывает один и тот же PSD дважды, но переключаться на
// уже открытую вкладку он тоже не станет — поэтому сначала ищем её сами.
function findOpenDoc(fileName) {
  const target = normName(fileName);
  const bare = target.replace(/\.psd$/, "");
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents[i];
    try {
      const name = normName(d.name);
      if (name === target || name.replace(/\.psd$/, "") === bare) return d;
    } catch (e) { /* документ закрывается прямо сейчас */ }
  }
  return null;
}

/* Присваивание app.activeDocument вкладку не переключает — окно остаётся
   прежним. Надёжно работает только явная команда выбора документа. */
async function activateDoc(doc) {
  const id = doc.id;
  await core.executeAsModal(async () => {
    try {
      app.activeDocument = doc;
    } catch (e) { /* пойдём вторым путём */ }
    await batchPlay(
      [{ _obj: "select", _target: [{ _ref: "document", _id: id }] }],
      { synchronousExecution: true }
    );
  }, { commandName: "Iris Tools: переключить документ" });
}

/* Буква «й» в именах файлов бывает двух видов: цельная (U+0439) и составная
   («и» + галочка U+0306). На вид одинаковы, для строк — разные. Поэтому имена
   не сравниваем напрямую, а приводим к одной форме и снимаем надстрочные знаки.
   Заодно это лечит разный регистр и «ё» против «е». */
function normName(v) {
  let out = String(v || "");
  try {
    out = out.normalize("NFC");
  } catch (e) { /* движок без normalize — обойдёмся снятием знаков */ }
  return out
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/gi, "е")
    .trim()
    .toLowerCase();
}

/* Ищем файл перебором содержимого папки, а не по собранному пути:
   так имя на диске может быть записано как угодно. */
async function findTemplateEntry(fileName) {
  const dirUrl = "file:///" + TEMPLATES_DIR.replace(/\\/g, "/");
  const folder = await fsLocal.getEntryWithUrl(dirUrl);
  const entries = await folder.getEntries();
  const want = normName(fileName);
  for (const e of entries) {
    if (normName(e.name) === want) return e;
  }
  // не нашли точно — пробуем без расширения, вдруг оно скрыто в проводнике
  const bare = want.replace(/\.psd$/, "");
  for (const e of entries) {
    if (normName(e.name).replace(/\.psd$/, "") === bare) return e;
  }
  return null;
}

async function openTemplate(tpl) {
  try {
    const already = findOpenDoc(tpl.file);
    if (already) {
      await activateDoc(already);
      setStatus("");
      return;
    }
    const entry = await findTemplateEntry(tpl.file);
    if (!entry) {
      setStatus("Нет файла: " + tpl.file + "\nв папке " + TEMPLATES_DIR, true);
      return;
    }
    await core.executeAsModal(async () => {
      await app.open(entry);
    }, { commandName: "Iris Tools: открыть шаблон" });
    setStatus("");
  } catch (e) {
    setStatus("Папка не читается:\n" + TEMPLATES_DIR + "\nпроверь путь в начале main.js", true);
  }
}

const tplBox = document.getElementById("tplRow");
TEMPLATE_ROWS.forEach((row) => {
  const line = document.createElement("div");
  line.className = "tpl-row";
  row.forEach((tpl, i) => {
    const b = document.createElement("div");
    b.className = "tpl" + (i === row.length - 1 ? " last" : "");
    b.textContent = tpl.label;
    b.addEventListener("click", () => openTemplate(tpl));
    line.appendChild(b);
  });
  tplBox.appendChild(line);
});

// ================== ПОДПИСКИ ==================
pupilSlider.addEventListener("input", schedulePreview);
pupilSlider.addEventListener("change", schedulePreview);

applyBtn.addEventListener("click", applyPupil);

// Следим за сменой активного документа, чтобы диапазон ползунка и подпись
// всегда соответствовали тому файлу, в котором вы сейчас работаете.
setInterval(() => {
  try { syncDocument(false); } catch (e) { /* документ ещё не готов */ }
}, 700);

// ---------- стартовое состояние ----------
try { syncDocument(true); } catch (e) { /* документа может не быть */ }
