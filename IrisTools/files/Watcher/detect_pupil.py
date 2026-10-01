#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
detect_pupil.py -- поиск центра зрачка на макро-снимке глаза.

    python detect_pupil.py photo.jpg
    python detect_pupil.py photo.jpg -o result.txt
    python detect_pupil.py photo.jpg --debug overlay.jpg

Вывод (stdout и, если задан, в файл -o) -- одна строка:
    OK <x> <y> <r>    центр зрачка и его радиус в пикселях исходника
    FAIL              зрачок не найден

Как работает: зрачок на макро-кадре -- самая тёмная крупная область
круглой формы. Блики от кольцевой лампы гасятся серым размыканием,
затем перебираются пороги яркости, и кандидаты оцениваются по
круглости, заполненности, контрасту с радужкой вокруг и близости
к центру кадра. Никаких сетей и интернета не требуется.

Зависимости:  pip install opencv-python numpy
"""

import argparse
import sys

import cv2
import numpy as np



def find_pupil(img, min_frac=0.002, max_frac=0.45):
    h, w = img.shape[:2]
    area_img = float(h*w)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # гасим зеркальные блики: серое РАЗМЫКАНИЕ убирает мелкие светлые пятна
    ko = max(3, (min(h,w)//45) | 1)
    opened = cv2.morphologyEx(gray, cv2.MORPH_OPEN,
              cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(ko,ko)))
    blur = cv2.GaussianBlur(opened, (0,0), max(1.0, min(h,w)/300.0))
    km = max(3, (min(h,w)//80) | 1)

    icx, icy = w/2.0, h/2.0
    diag = np.hypot(w,h)
    best = None

    for pct in (1,2,3,5,7,10,14,18,23,28,35,45):
        thr = np.percentile(blur, pct)
        mask = (blur <= thr).astype(np.uint8)*255
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(km,km)))
        cs,_ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        cs = sorted(cs, key=cv2.arcLength_ if False else (lambda c: cv2.arcLength(c,True)), reverse=True)[:25]

        for cnt in cs:
            if len(cnt) < 5: continue
            x,y,bw,bh = cv2.boundingRect(cnt)
            if bw*bh/area_img > 0.9: continue
            if min(bw,bh)/max(bw,bh) < 0.55: continue

            filled = np.zeros((h,w), np.uint8)
            cv2.drawContours(filled, [cnt], -1, 255, -1)
            area = float(cv2.countNonZero(filled))
            frac = area/area_img
            if frac < min_frac or frac > max_frac: continue

            perim = cv2.arcLength(cnt, True)
            circ = 4.0*np.pi*area/(perim*perim + 1e-9)
            if circ < 0.6: continue

            (ex,ey),(MA,ma),_ = cv2.fitEllipse(cnt)
            if MA <= 0 or ma <= 0: continue
            if min(MA,ma)/max(MA,ma) < 0.6: continue
            r = (MA+ma)/4.0
            fill = area/(np.pi*r*r + 1e-9)
            if fill < 0.65 or fill > 1.5: continue

            if ex-r < -0.03*w or ex+r > 1.03*w or ey-r < -0.03*h or ey+r > 1.03*h:
                continue

            # медианы устойчивее среднего: ресницы и веко не портят замер
            mean_in = float(np.median(gray[filled > 0]))
            ring = np.zeros((h,w), np.uint8)
            cv2.circle(ring,(int(ex),int(ey)), int(r*1.75), 255, -1)
            cv2.circle(ring,(int(ex),int(ey)), int(r*1.20), 0, -1)
            ring_px = gray[ring > 0]
            if ring_px.size < 50: continue
            mean_out = float(np.median(ring_px))
            contrast = (mean_out-mean_in)/255.0
            if contrast < 0.02: continue

            centrality = 1.0 - min(1.0, np.hypot(ex-icx, ey-icy)/(diag*0.5))
            score = 1.2*circ + 0.6*fill + 1.5*contrast - 0.5*(mean_in/255.0) + 0.25*centrality

            if best is None or score > best[0]:
                best = (score, ex, ey, r)

    if best is None: return None
    return float(best[1]), float(best[2]), float(best[3])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-o", "--out", help="файл для записи результата")
    ap.add_argument("--debug", help="сохранить копию с разметкой найденного зрачка")
    ap.add_argument("--min-frac", type=float, default=0.002,
                    help="мин. доля кадра, которую занимает зрачок")
    ap.add_argument("--max-frac", type=float, default=0.45,
                    help="макс. доля кадра, которую занимает зрачок")
    args = ap.parse_args()

    result = "FAIL"
    img = cv2.imread(args.image, cv2.IMREAD_COLOR)

    if img is not None:
        h, w = img.shape[:2]

        # считаем на уменьшенной копии -- быстрее и устойчивее к шуму
        scale, limit = 1.0, 1400
        if max(h, w) > limit:
            scale = limit / float(max(h, w))
            small = cv2.resize(img, None, fx=scale, fy=scale,
                               interpolation=cv2.INTER_AREA)
        else:
            small = img

        found = find_pupil(small, args.min_frac, args.max_frac)

        if found is not None:
            cx, cy, r = (v / scale for v in found)
            result = "OK %.2f %.2f %.2f" % (cx, cy, r)

            if args.debug:
                vis = img.copy()
                t = max(1, int(max(h, w) / 400))
                cv2.circle(vis, (int(cx), int(cy)), int(r), (0, 255, 0), t)
                cv2.drawMarker(vis, (int(cx), int(cy)), (0, 0, 255),
                               cv2.MARKER_CROSS, int(max(h, w) / 15), t)
                cv2.imwrite(args.debug, vis)

    if args.out:
        with open(args.out, "w") as f:
            f.write(result)
    print(result)
    return 0 if result.startswith("OK") else 1


if __name__ == "__main__":
    sys.exit(main())
