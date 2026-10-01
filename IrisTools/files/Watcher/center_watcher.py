#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
center_watcher.py -- следит за папкой и центрует снимки по зрачку.

Следит за всем деревом папок, поэтому ежедневные подпапки вида
"июль 2026\\29.07" подхватываются сами, без перенастройки.

RAW  (NEF/CR2/ARW/...): рядом с файлом кладётся служебный .xmp
                        с параметрами кадрирования. Сам RAW не меняется.
                        Camera Raw откроет снимок уже обрезанным.

JPEG/TIFF/PNG:          файл реально обрезается и кладётся в подпапку
                        (по умолчанию "centered"). Оригинал не трогается.

Кроп симметричен относительно зрачка и сохраняет пропорции исходника,
поэтому зрачок оказывается ровно в геометрическом центре кадра.

Запуск:
    python center_watcher.py                 -- следить постоянно
    python center_watcher.py --once          -- обработать и выйти
    python center_watcher.py --redo          -- забыть историю и пройти заново
    python center_watcher.py --all           -- снять ограничение по свежести

Зависимости:
    pip install opencv-python numpy rawpy pillow

Рядом должен лежать detect_pupil.py.
"""

import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_pupil import find_pupil


# ======== НАСТРОЙКИ ========

# Корневая папка исходников. Следим за ней и за всеми подпапками,
# так что ежедневные папки с датами настраивать не нужно.
WATCH_FOLDER = r"C:\Users\EyePhoto\Desktop\исходники"

# Заходить в подпапки
RECURSIVE = True

# Не трогать файлы старше стольких суток. Это защита от того, чтобы
# при первом запуске сторож не полез перелопачивать весь архив.
# 0 — снять ограничение (то же самое, что ключ --all).
MAX_AGE_DAYS = 2

# Как часто проверять папку, секунд
POLL_SECONDS = 3

# Если после кадрирования остаётся меньше этой доли ширины —
# предупредить в консоли. Файл всё равно обрабатывается.
WARN_BELOW = 0.60

# Перезаписывать уже существующие .xmp.
# False — такие файлы пропускаются, чтобы не стереть вашу обработку.
OVERWRITE_XMP = False

# Помечать созданные .xmp скрытыми, чтобы они не мозолили глаза
# в Проводнике. На чтение файла атрибут никак не влияет:
# Camera Raw, Bridge и Lightroom видят их как обычно.
HIDE_XMP = True

# Куда складывать обрезанные JPEG/TIFF (подпапка внутри WATCH_FOLDER)
OUT_SUBDIR = "centered"

# ===========================


RAW_EXTS = {".nef", ".cr2", ".cr3", ".arw", ".dng", ".raf",
            ".orf", ".rw2", ".pef", ".srw", ".raw", ".nrw"}
IMG_EXTS = {".jpg", ".jpeg", ".tif", ".tiff", ".png"}

STATE_NAME = ".pupil_watch_state.json"


# ---------------------------------------------------------------- утилиты

def log(mark, name, msg=""):
    print("%-3s %-40s %s" % (mark, name[:40], msg), flush=True)


def hide_file(path):
    """Ставит атрибут «скрытый». Windows-only, на других системах молчит."""
    if os.name != "nt":
        return
    try:
        import ctypes
        FILE_ATTRIBUTE_HIDDEN = 0x02
        k32 = ctypes.windll.kernel32
        cur = k32.GetFileAttributesW(str(path))
        if cur == -1:
            return
        k32.SetFileAttributesW(str(path), cur | FILE_ATTRIBUTE_HIDDEN)
    except Exception:
        pass


def load_state(folder):
    p = os.path.join(folder, STATE_NAME)
    try:
        with open(p, "r", encoding="utf-8") as f:
            return set(json.load(f))
    except Exception:
        return set()


def save_state(folder, done):
    p = os.path.join(folder, STATE_NAME)
    try:
        if os.name == "nt" and os.path.exists(p):
            try:
                import ctypes
                ctypes.windll.kernel32.SetFileAttributesW(str(p), 0x80)
            except Exception:
                pass
        with open(p, "w", encoding="utf-8") as f:
            json.dump(sorted(done), f, ensure_ascii=False)
        hide_file(p)
    except Exception:
        pass


def too_old(path, max_days):
    if not max_days:
        return False
    try:
        return (time.time() - os.path.getmtime(path)) > max_days * 86400.0
    except OSError:
        return True


def stable(path, wait=0.6):
    """Файл дописан до конца, а не копируется прямо сейчас."""
    try:
        a = os.path.getsize(path)
        time.sleep(wait)
        b = os.path.getsize(path)
        return a == b and a > 0
    except OSError:
        return False


# ---------------------------------------------------------------- чтение

def read_raw(path):
    """RGB-превью RAW в половинном разрешении, с учётом поворота камеры."""
    import rawpy
    with rawpy.imread(path) as raw:
        rgb = raw.postprocess(half_size=True, no_auto_bright=True,
                              output_bps=8, use_camera_wb=True)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def read_image(path):
    """Обычная картинка с применённым EXIF-поворотом."""
    try:
        from PIL import Image, ImageOps
        im = Image.open(path)
        im = ImageOps.exif_transpose(im).convert("RGB")
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    except ImportError:
        return cv2.imread(path, cv2.IMREAD_COLOR)


# ---------------------------------------------------------------- геометрия

def crop_box(w, h, px, py):
    """
    Прямоугольник с центром в зрачке, с пропорциями исходника,
    максимально возможный без выхода за края.
    Возвращает (left, top, right, bottom) в пикселях и долю оставшейся ширины.
    """
    aspect = float(w) / float(h)

    hw_max = min(px, w - px)
    hh_max = min(py, h - py)

    hw = min(hw_max, hh_max * aspect)
    hh = hw / aspect

    if hw < 8 or hh < 8:
        return None, 0.0

    return (px - hw, py - hh, px + hw, py + hh), (2.0 * hw) / w


# ---------------------------------------------------------------- XMP

XMP_TEMPLATE = """<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="center_watcher">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:Version="15.0"
    crs:HasSettings="True"
    crs:HasCrop="True"
    crs:CropTop="{top:.6f}"
    crs:CropLeft="{left:.6f}"
    crs:CropBottom="{bottom:.6f}"
    crs:CropRight="{right:.6f}"
    crs:CropAngle="0"
    crs:CropConstrainToWarp="0"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
"""


def write_xmp(raw_path, box, w, h):
    left, top, right, bottom = box
    xmp = XMP_TEMPLATE.format(left=left / w, right=right / w,
                              top=top / h, bottom=bottom / h)
    out = os.path.splitext(raw_path)[0] + ".xmp"

    # если файл уже был скрытым, запись поверх него упадёт —
    # снимаем атрибут, пишем, возвращаем обратно
    if os.name == "nt" and os.path.exists(out):
        try:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(str(out), 0x80)
        except Exception:
            pass

    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(xmp)

    if HIDE_XMP:
        hide_file(out)

    return out


# ---------------------------------------------------------------- обработка

def process(path):
    """Возвращает (успех, сообщение)."""
    ext = os.path.splitext(path)[1].lower()
    is_raw = ext in RAW_EXTS

    try:
        img = read_raw(path) if is_raw else read_image(path)
    except Exception as e:
        return False, "не читается: %s" % e

    if img is None:
        return False, "не читается"

    if is_raw and not OVERWRITE_XMP:
        side = os.path.splitext(path)[0] + ".xmp"
        if os.path.exists(side):
            return False, "уже есть .xmp — пропускаю"

    h, w = img.shape[:2]

    # детект на уменьшенной копии
    scale, limit = 1.0, 1400
    if max(h, w) > limit:
        scale = limit / float(max(h, w))
        small = cv2.resize(img, None, fx=scale, fy=scale,
                           interpolation=cv2.INTER_AREA)
    else:
        small = img

    found = find_pupil(small)
    if found is None:
        return False, "зрачок не найден"

    px, py = found[0] / scale, found[1] / scale

    box, keep = crop_box(w, h, px, py)
    if box is None:
        return False, "зрачок у самого края, резать нечего"

    note = "осталось %d%% ширины" % round(keep * 100)
    if keep < WARN_BELOW:
        note += "  <-- сильная обрезка, проверьте кадр"

    if is_raw:
        write_xmp(path, box, w, h)
        return True, note

    # обычная картинка — режем по-настоящему
    l, t, r, b = [int(round(v)) for v in box]
    out_dir = os.path.join(os.path.dirname(path), OUT_SUBDIR)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, os.path.basename(path))

    crop = img[t:b, l:r]
    params = []
    if ext in (".jpg", ".jpeg"):
        params = [cv2.IMWRITE_JPEG_QUALITY, 97]
    if not cv2.imwrite(out_path, crop, params):
        return False, "не удалось записать результат"

    return True, note


# ---------------------------------------------------------------- главный цикл

def iter_files(root):
    """Все подходящие файлы в дереве, кроме папок с результатами."""
    if not RECURSIVE:
        try:
            for name in sorted(os.listdir(root)):
                p = os.path.join(root, name)
                if os.path.isfile(p):
                    yield p
        except OSError:
            pass
        return

    for cur, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs
                         if d != OUT_SUBDIR and not d.startswith("."))
        for name in sorted(files):
            yield os.path.join(cur, name)


def scan(root, done, max_days):
    changed = False

    for path in iter_files(root):
        ext = os.path.splitext(path)[1].lower()
        if ext not in RAW_EXTS and ext not in IMG_EXTS:
            continue

        key = os.path.relpath(path, root)
        if key in done:
            continue

        if too_old(path, max_days):
            done.add(key)          # помечаем, чтобы не проверять каждый раз
            changed = True
            continue

        if not stable(path):
            continue

        ok, msg = process(path)
        log("OK" if ok else "--", key, msg)

        done.add(key)
        changed = True

    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", default=WATCH_FOLDER)
    ap.add_argument("--once", action="store_true",
                    help="обработать текущее содержимое и выйти")
    ap.add_argument("--redo", action="store_true",
                    help="забыть историю и пройти папку заново")
    ap.add_argument("--all", action="store_true",
                    help="обработать и старые файлы, без ограничения по дате")
    args = ap.parse_args()

    folder = args.folder
    if not os.path.isdir(folder):
        print("Папка не найдена: %s" % folder)
        return 1

    done = set() if args.redo else load_state(folder)
    max_days = 0 if args.all else MAX_AGE_DAYS

    print("Слежу за папкой: %s" % folder)
    print("Подпапки: %s" % ("да" if RECURSIVE else "нет"))
    print("Свежесть: %s" % ("без ограничения" if not max_days
                            else "файлы за последние %d сут." % max_days))
    print("Обработано ранее: %d файлов" % len(done))
    print("Остановить — Ctrl+C или просто закройте окно.")
    print("-" * 62, flush=True)

    if args.once:
        if scan(folder, done, max_days):
            save_state(folder, done)
        print("-" * 62)
        print("Готово.")
        return 0

    try:
        while True:
            if scan(folder, done, max_days):
                save_state(folder, done)
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        save_state(folder, done)
        print("\nОстановлено.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
