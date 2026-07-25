"""Port de app/api/channel-logo/route.ts (Satori+Sharp → Pillow).

Note : ce logo est un visuel statique et décoratif (badge de la chaîne
Telegram), pas le ticket de pari — depuis le passage à la publication par
capture d'écran réelle (voir routers/publish.py), plus aucun ticket n'est
généré automatiquement par l'IA. Seul ce logo statique reste à porter.
"""
import io
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

SIZE = 640

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
]


@lru_cache(maxsize=8)
def _font(size: int) -> ImageFont.FreeTypeFont:
    for path in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _gradient_color(t: float, stops: list[tuple[float, tuple[int, int, int]]]) -> tuple[int, int, int]:
    """t dans [0,1] — interpole entre les couleurs de `stops` (positions triées)."""
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if p0 <= t <= p1:
            local_t = (t - p0) / (p1 - p0) if p1 > p0 else 0
            return tuple(round(_lerp(c0[i], c1[i], local_t)) for i in range(3))  # type: ignore[return-value]
    return stops[-1][1]


def _diagonal_gradient(size: int, stops: list[tuple[float, tuple[int, int, int]]]) -> Image.Image:
    """Approximation d'un linear-gradient(135deg, ...) CSS — diagonale
    haut-gauche → bas-droite."""
    img = Image.new("RGB", (size, size))
    max_d = (size - 1) * 2
    pixels = []
    for y in range(size):
        for x in range(size):
            t = (x + y) / max_d
            pixels.append(_gradient_color(t, stops))
    img.putdata(pixels)
    return img


def _draw_spaced_text(
    draw: ImageDraw.ImageDraw,
    center_x: int,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    letter_spacing: int,
) -> None:
    """PIL ne supporte pas letter-spacing nativement — dessine caractère par
    caractère avec un espacement fixe, centré horizontalement."""
    widths = [draw.textlength(ch, font=font) for ch in text]
    total_width = sum(widths) + letter_spacing * max(0, len(text) - 1)
    x = center_x - total_width / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + letter_spacing


def generate_channel_logo() -> bytes:
    base = _diagonal_gradient(
        SIZE,
        [
            (0.0, _hex_to_rgb("060d1f")),
            (0.5, _hex_to_rgb("0a1428")),
            (1.0, _hex_to_rgb("0d1f3c")),
        ],
    ).convert("RGBA")

    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx = cy = SIZE // 2

    # Cercle décoratif extérieur / intérieur
    draw.ellipse([60, 60, 60 + 520, 60 + 520], outline=(201, 163, 92, 51), width=2)
    draw.ellipse([110, 110, 110 + 420, 110 + 420], outline=(201, 163, 92, 26), width=1)

    # Badge doré "IA"
    badge_size = 140
    badge_box = [cx - badge_size // 2, 250 - 16, cx + badge_size // 2, 250 - 16 + badge_size]
    badge = Image.new("RGBA", (badge_size, badge_size), (0, 0, 0, 0))
    badge_draw = ImageDraw.Draw(badge)
    for row in range(badge_size):
        t = row / (badge_size - 1)
        color = _gradient_color(t, [(0.0, _hex_to_rgb("d9b56f")), (1.0, _hex_to_rgb("9c7739"))])
        badge_draw.line([(0, row), (badge_size, row)], fill=(*color, 255))
    mask = Image.new("L", (badge_size, badge_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, badge_size, badge_size], radius=32, fill=255)
    overlay.paste(badge, (badge_box[0], badge_box[1]), mask)

    ia_font = _font(58)
    ia_bbox = draw.textbbox((0, 0), "IA", font=ia_font)
    ia_w, ia_h = ia_bbox[2] - ia_bbox[0], ia_bbox[3] - ia_bbox[1]
    draw.text(
        (cx - ia_w / 2 - ia_bbox[0], badge_box[1] + badge_size / 2 - ia_h / 2 - ia_bbox[1]),
        "IA",
        font=ia_font,
        fill=(6, 13, 31, 255),
    )

    y = badge_box[3] + 16
    _draw_spaced_text(draw, cx, y, "PRONOSTICS", _font(52), (201, 163, 92, 255), 6)
    y += 52 + 12

    draw.rectangle([cx - 100, y, cx + 100, y + 2], fill=(201, 163, 92, 200))
    y += 2 + 12

    _draw_spaced_text(draw, cx, y, "& COUPONS", _font(28), (255, 255, 255, 255), 10)
    y += 28 + 16

    _draw_spaced_text(draw, cx, y, "PARIS FOOTBALL", _font(13), (201, 163, 92, 153), 4)

    final = Image.alpha_composite(base, overlay).convert("RGB")
    buf = io.BytesIO()
    final.save(buf, format="PNG")
    return buf.getvalue()
