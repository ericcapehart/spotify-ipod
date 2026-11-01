"""Draws the iPod launcher icon at each Android density. Pure Python (no Pillow needed).

Run: python3 android/tools/make_icons.py
"""
import os
import struct
import zlib

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
OUT = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res")
SS = 4  # supersampling per axis, for smooth edges


def inside_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(u, v):
    """Colour at unit coordinates (0..1), or None for transparent."""
    if not inside_round_rect(u, v, 0.17, 0.04, 0.83, 0.96, 0.08):
        return None
    # Screen
    if inside_round_rect(u, v, 0.24, 0.11, 0.76, 0.46, 0.02):
        if v < 0.15:
            return (215, 220, 226)  # status bar
        if 0.20 < v < 0.25 and 0.27 < u < 0.73:
            return (45, 115, 225)  # highlighted menu row
        return (250, 251, 252)
    if inside_round_rect(u, v, 0.235, 0.10, 0.765, 0.47, 0.025):
        return (25, 25, 25)  # screen bezel
    # Click wheel
    dx, dy = u - 0.5, v - 0.72
    d = (dx * dx + dy * dy) ** 0.5
    if d <= 0.075:
        return (222, 224, 226)  # centre button
    if d <= 0.085:
        return (196, 199, 202)
    if d <= 0.205:
        return (252, 252, 252)  # wheel
    if d <= 0.215:
        return (200, 203, 206)
    # Brushed-silver body, lighter at the top
    return mix((246, 247, 248), (190, 193, 197), v)


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter type: none
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            n = SS * SS
            if a:
                row += bytes([int(r / a), int(g / a), int(b / a), int(255 * a / n)])
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


for density, size in SIZES.items():
    folder = os.path.join(OUT, "mipmap-" + density)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "ic_launcher.png"), "wb") as f:
        f.write(png(size, render(size)))
    print(density, size)
