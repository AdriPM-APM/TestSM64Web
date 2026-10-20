"""Generate the PWA icons (golden star on a rounded dark tile).

Pure numpy + the PNG writer, no imaging library needed.
    python3 web/tools/mkicons.py web
"""
import math
import os
import sys

import numpy as np

SS = 4  # supersampling factor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def star_poly(cx, cy, r_out, r_in, points=5, rot=-math.pi / 2):
    pts = []
    for i in range(points * 2):
        a = rot + i * math.pi / points
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def inside(xs, ys, poly):
    """Even-odd point-in-polygon test, vectorised over a grid."""
    xs = xs[None, :]
    ys = ys[:, None]
    out = np.zeros((ys.shape[0], xs.shape[1]), bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        crosses = ((y1 > ys) != (y2 > ys))
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (x2 - x1) * (ys - y1) / (y2 - y1) + x1
        out ^= crosses & (xs < xint)
    return out


def make(size, path, png):
    s = size * SS
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float64) / s

    # rounded-rectangle tile
    r = 0.22
    dx = np.minimum(xx, 1 - xx)
    dy = np.minimum(yy, 1 - yy)
    corner = (dx < r) & (dy < r)
    dist = np.sqrt((r - dx) ** 2 + (r - dy) ** 2)
    tile = (~corner) | (dist <= r)

    # dark background with a soft lift from the top centre
    rd = np.sqrt((xx - 0.5) ** 2 + (yy - 0.34) ** 2)
    lift = np.clip(1.0 - rd / 0.85, 0, 1) ** 2
    bg = np.array([11, 14, 19], float) + (np.array([40, 54, 78], float) - np.array([11, 14, 19], float)) * lift[..., None]

    # golden star, slightly darker rim for definition
    star = inside(xx[0], yy[:, 0], star_poly(0.5, 0.505, 0.355, 0.148))
    inner = inside(xx[0], yy[:, 0], star_poly(0.5, 0.505, 0.335, 0.140))
    grad = np.clip((yy - 0.16) / 0.68, 0, 1)
    gold = np.array([255, 232, 130], float) + (np.array([226, 150, 20], float) - np.array([255, 232, 130], float)) * grad[..., None]
    gold = np.where(inner[..., None], gold, gold * 0.78)

    rgb = np.where(star[..., None], gold, bg)
    alpha = np.where(tile, 255.0, 0.0)

    # down-sample with alpha-weighted colour so edges do not darken
    a = alpha.reshape(size, SS, size, SS, 1)
    c = rgb.reshape(size, SS, size, SS, 3)
    acc_a = a.sum(axis=(1, 3))
    acc_c = (c * a).sum(axis=(1, 3))
    out_a = acc_a / (SS * SS)
    out_c = np.where(acc_a > 0, acc_c / np.maximum(acc_a, 1e-9), 0)

    out = np.concatenate([np.clip(out_c, 0, 255), np.clip(out_a, 0, 255)], axis=2).astype(np.uint8)
    png.write(path, out)
    print("wrote", path, out.shape)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else ROOT
    sys.path.insert(0, "/tmp/cleanroom")
    from cleanroom.gfx import png  # noqa: E402  (vendored PNG writer)
    for size in (192, 512):
        make(size, os.path.join(out_dir, f"icon-{size}.png"), png)


if __name__ == "__main__":
    main()
