"""Generate iOS launch (splash) images from app/assets/icon-1024.png.

iOS shows these while a home-screen web app starts. Each iPhone screen size
needs its own image, selected by a media query in index.html (the <link> tags
this script prints). The icon is centered on its own background colour.

Run from the repo root (needs Pillow):  python app/scripts/make_splash.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICON = ROOT / "assets" / "icon-1024.png"
OUT = ROOT / "public" / "splash"

# (pixel width, pixel height, CSS device width, CSS device height, pixel ratio)
DEVICES = [
    (1320, 2868, 440, 956, 3),  # iPhone 16 Pro Max
    (1206, 2622, 402, 874, 3),  # iPhone 16 Pro
    (1290, 2796, 430, 932, 3),  # 16 Plus, 15 Pro Max/Plus, 14 Pro Max
    (1179, 2556, 393, 852, 3),  # 16, 15, 15 Pro, 14 Pro
    (1284, 2778, 428, 926, 3),  # 14 Plus, 13/12 Pro Max
    (1170, 2532, 390, 844, 3),  # 14, 13, 13 Pro, 12, 12 Pro
    (1125, 2436, 375, 812, 3),  # 13/12 mini, 11 Pro, XS, X
    (1242, 2688, 414, 896, 3),  # 11 Pro Max, XS Max
    (828, 1792, 414, 896, 2),  # 11, XR
    (750, 1334, 375, 667, 2),  # SE (2nd/3rd gen), 8
]


def main() -> None:
    icon = Image.open(ICON).convert("RGB")
    bg_top = icon.getpixel((icon.width // 2, 8))
    bg_bottom = icon.getpixel((icon.width // 2, icon.height - 8))
    OUT.mkdir(parents=True, exist_ok=True)
    links = []
    for w, h, dw, dh, ratio in DEVICES:
        # Vertical gradient matching the icon's own background.
        img = Image.new("RGB", (w, h))
        px = img.load()
        for y in range(h):
            t = y / (h - 1)
            c = tuple(round(bg_top[i] + (bg_bottom[i] - bg_top[i]) * t) for i in range(3))
            for x in range(w):
                px[x, y] = c
        # Icon with rounded corners, like on the home screen (drawn at 4x, then scaled, for smooth edges).
        size = round(w * 0.34)
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * 0.225), fill=255)
        mask = mask.resize((size, size), Image.LANCZOS)
        img.paste(icon.resize((size, size), Image.LANCZOS), ((w - size) // 2, (h - size) // 2 - round(h * 0.03)), mask)
        name = f"splash-{w}x{h}.png"
        img.save(OUT / name, optimize=True)
        links.append(
            f'<link rel="apple-touch-startup-image" href="/splash/{name}" media="(device-width: {dw}px) and '
            f'(device-height: {dh}px) and (-webkit-device-pixel-ratio: {ratio}) and (orientation: portrait)" />'
        )
        print("wrote", name)
    print("\n".join(links))


if __name__ == "__main__":
    main()
