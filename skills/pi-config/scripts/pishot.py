#!/usr/bin/env python3
"""Screenshot Pi's terminal UI as a PNG, without a model call.

Runs the real `pi` in a pseudo-terminal of a fixed size on a copy of a session (by default a fake one written by
make-session.mjs), answers the terminal queries Pi sends at startup (colors, cursor position, cell size) with the
Herdr theme of the current appearance, optionally presses keys, then draws the emulated screen with Herdr's font.
Arguments after `--` go to pi. Prints the path of each PNG written; each PNG has a .txt twin with the screen text.

Example:
  pishot.sh --out /tmp/shots/end.png --step key:ctrl+o --step shot:/tmp/shots/expanded.png -- -e ./ext.ts
"""

import argparse
import codecs
import fcntl
import json
import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path

import pyte
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
HERDR = Path.home() / ".config/herdr-app"  # the terminal the user runs Pi in; its settings give font and theme


def fail(message: str) -> None:
    sys.exit(f"pishot: {message}")


# ---------------------------------------------------------------------------
# Look of the user's terminal


def macos_appearance() -> str:
    # macOS writes AppleInterfaceStyle=Dark in dark mode and removes the key in light mode.
    r = subprocess.run(["defaults", "read", "-g", "AppleInterfaceStyle"], capture_output=True, text=True)
    return "dark" if r.returncode == 0 and r.stdout.strip() == "Dark" else "light"


def herdr_settings() -> dict:
    path = HERDR / "settings.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as error:
        fail(f"cannot read {path} ({error}); pass --font and --palette")


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")[:6]  # Herdr colors may carry an alpha byte, which a cell cannot show
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def load_palette(name: str) -> dict:
    path = Path(name) if name.endswith(".json") else HERDR / "themes" / f"{name}.json"
    try:
        data = json.loads(path.read_text())
        return {
            "fg": hex_rgb(data["foreground"]),
            "bg": hex_rgb(data["background"]),
            "cursor": hex_rgb(data.get("cursor", data["foreground"])),
            "ansi": [hex_rgb(c) for c in data["ansi"]],
        }
    except (OSError, ValueError, KeyError) as error:
        fail(f"cannot load palette {path} ({error!r}); pass --palette with a Herdr theme JSON")


def xterm_rgb(rgb: tuple[int, int, int]) -> str:
    return "rgb:" + "/".join(f"{c:02x}{c:02x}" for c in rgb)


# ---------------------------------------------------------------------------
# Terminal emulation: pyte behind a filter.
#
# pyte misreads several modern sequences (DCS/APC payloads, `CSI > ... u`, `$p`, colon sub-parameters) and does not
# track faint text. The filter answers queries, drops what pyte cannot parse, and keeps faint (SGR 2) in pyte's
# `blink` slot, which nothing else uses.

CSI_RE = re.compile(r"\x1b\[([\x30-\x3f]*)([\x20-\x2f]*)([\x40-\x7e])")
CSI_PARTIAL_RE = re.compile(r"\x1b\[[\x30-\x3f]*[\x20-\x2f]*\Z")
OSC_RE = re.compile(r"\x1b\](.*?)(\x07|\x1b\\)", re.S)
STRING_RE = re.compile(r"\x1b[P_^X](.*?)\x1b\\", re.S)  # DCS, APC, PM and SOS payloads


class FaintScreen(pyte.Screen):
    def __init__(self, cols, rows, palette, write_back):
        super().__init__(cols, rows)
        self.palette = palette
        self.write_back = write_back

    def write_process_input(self, data: str) -> None:
        self.write_back(data)  # pyte's own answers: device attributes, cursor position

    def select_graphic_rendition(self, *attrs, private=False):
        if private:
            return
        out, a, i = [], list(attrs), 0
        while i < len(a):
            x = a[i]
            if x in (38, 48, 58):
                mode = a[i + 1] if i + 1 < len(a) else None
                width = 3 if mode == 5 else 5 if mode == 2 else 1
                chunk = a[i : i + width]
                i += width
                if x == 58 or len(chunk) < width or mode not in (2, 5):
                    continue  # underline color is not drawn; a malformed color is dropped
                if mode == 5 and chunk[2] < 16:
                    out += [x, 2, *self.palette["ansi"][chunk[2]]]  # the 16 base colors come from the palette
                else:
                    out += chunk
                continue
            if x == 2:
                out.append(5)
            elif x in (5, 6, 25):
                pass
            elif x == 22:
                out += [22, 25]  # normal intensity clears bold and faint
            else:
                out.append(x)
            i += 1
        super().select_graphic_rendition(*out)


def normalize_sgr(params: str) -> str:
    """Turn colon sub-parameters (`4:3`, `38:2::r:g:b`) into the form pyte reads."""
    parts = []
    for p in params.split(";"):
        if ":" not in p:
            parts.append(p)
            continue
        sub = p.split(":")
        head = sub[0]
        if head in ("38", "48", "58") and len(sub) > 1:
            nums = [s for s in sub[2:] if s != ""]
            if sub[1] == "2" and len(nums) >= 3:
                parts.append(";".join([head, "2", *nums[-3:]]))
            elif sub[1] == "5" and nums:
                parts.append(";".join([head, "5", nums[-1]]))
        elif head == "4":
            parts.append("24" if sub[1:] == ["0"] else "4")
        else:
            parts.append(head)
    return ";".join(parts)


class Terminal:
    """The filter in front of pyte, with the answers to the queries pyte does not know."""

    def __init__(self, screen: FaintScreen, appearance: str, cell_px: tuple[int, int], query_log: list[str]):
        self.screen = screen
        self.stream = pyte.Stream(screen)
        self.appearance = appearance
        self.cell_px = cell_px
        self.query_log = query_log
        self.pending = ""

    def feed(self, text: str) -> None:
        buf = self.pending + text
        self.pending = ""
        out = []
        i = 0
        while True:
            j = buf.find("\x1b", i)
            if j < 0:
                out.append(buf[i:])
                break
            out.append(buf[i:j])
            end, keep = self._sequence(buf, j)
            if end is None:  # incomplete: wait for the rest
                self.pending = buf[j:]
                break
            if keep is not None:
                out.append(keep)
            i = end
        self.stream.feed("".join(out))

    def _sequence(self, s: str, j: int):
        """(end, text for pyte) for the escape sequence at j, or (None, None) when it is incomplete."""
        if j + 1 >= len(s):
            return None, None
        kind = s[j + 1]
        if kind == "[":
            m = CSI_RE.match(s, j)
            if not m:
                if CSI_PARTIAL_RE.match(s, j):
                    return None, None
                return j + 1, None  # malformed: drop the ESC
            params, inter, final = m.groups()
            self._csi_query(params, inter, final)
            if inter or (params and params[0] in "<=>"):
                return m.end(), None
            if final == "m":
                return m.end(), f"\x1b[{normalize_sgr(params)}m"
            if ":" in params:
                return m.end(), None
            return m.end(), m.group(0)
        if kind == "]":
            m = OSC_RE.match(s, j)
            if not m:
                return None, None
            self._osc(m.group(1), m.group(2))
            return m.end(), None
        if kind in "P_^X":
            m = STRING_RE.match(s, j)
            if not m:
                return None, None
            self.query_log.append(f"dropped string {kind}: {m.group(1)[:80]!r}")
            return m.end(), None
        if kind in "()*+":
            if j + 2 >= len(s):
                return None, None
            return j + 3, s[j : j + 3]
        return j + 2, s[j : j + 2]

    def _osc(self, body: str, term: str) -> None:
        code, _, rest = body.partition(";")
        p = self.screen.palette
        if code in ("10", "11", "12") and rest == "?":
            rgb = {"10": p["fg"], "11": p["bg"], "12": p["cursor"]}[code]
            self.screen.write_back(f"\x1b]{code};{xterm_rgb(rgb)}{term}")
            self.query_log.append(f"answered OSC {code}")
        elif code == "4" and "?" in rest:
            fields = rest.split(";")
            for n, q in zip(fields[0::2], fields[1::2]):
                if q == "?" and n.isdigit() and int(n) < 16:
                    self.screen.write_back(f"\x1b]4;{n};{xterm_rgb(p['ansi'][int(n)])}{term}")
            self.query_log.append(f"answered OSC 4;{fields[0]}")
        elif rest.endswith("?") or body.endswith("?"):
            self.query_log.append(f"unanswered OSC {body[:80]!r}")

    def _csi_query(self, params: str, inter: str, final: str) -> None:
        cw, ch = self.cell_px
        rows, cols = self.screen.lines, self.screen.columns
        reply = None
        if final == "n" and params == "?996":
            reply = "\x1b[?997;1n" if self.appearance == "dark" else "\x1b[?997;2n"
        elif final == "t" and params == "14":
            reply = f"\x1b[4;{rows * ch};{cols * cw}t"
        elif final == "t" and params == "16":
            reply = f"\x1b[6;{ch};{cw}t"
        elif final == "t" and params == "18":
            reply = f"\x1b[8;{rows};{cols}t"
        elif final == "p" and inter == "$" and params.startswith("?"):
            reply = f"\x1b[{params};0$y"  # mode not recognized
        elif final in "uq" and params[:1] in "?>":
            self.query_log.append(f"unanswered CSI {params}{inter}{final}")
        if reply:
            self.screen.write_back(reply)
            self.query_log.append(f"answered CSI {params}{inter}{final}")


# ---------------------------------------------------------------------------
# Drawing

GLYPH_FALLBACKS = ["Menlo.ttc", "Apple Symbols.ttf", "Arial Unicode.ttf"]  # macOS fonts that cover what a terminal font lacks
EMOJI_FONT = "Apple Color Emoji.ttc"
EMOJI_PX = 160  # Apple Color Emoji only holds bitmaps at fixed sizes; 160 is one of them
FAINT = 0.45  # how far faint text moves from its color toward the background, close to Ghostty's rendering
PAD = 12  # margin around the screen in the PNG, in pixels

NAMED = {"black": 0, "red": 1, "green": 2, "brown": 3, "blue": 4, "magenta": 5, "cyan": 6, "white": 7}


def find_font(name: str, size: int) -> ImageFont.FreeTypeFont | None:
    """A font by file name, with or without extension, searched by Pillow in the macOS font directories."""
    try:
        return ImageFont.truetype(name, size)
    except OSError:  # not installed: the caller decides whether that matters
        return None


def cmap_of(font: ImageFont.FreeTypeFont) -> set[int]:
    return set(TTFont(font.path, fontNumber=0, lazy=True).getBestCmap() or {})


class Glyphs:
    def __init__(self, family: str, size: int):
        # A Nerd Font's `Mono` files keep every icon one cell wide, as a terminal draws them.
        base = family.replace(" ", "")
        for stem in (f"{base}Mono", base):
            regular = find_font(f"{stem}-Regular", size)
            if regular:
                break
        else:
            fail(f"no font files for {family!r}; pass --font with an installed family")
        self.styles = {}
        for key, style in {(False, False): "Regular", (True, False): "Bold",
                           (False, True): "Italic", (True, True): "BoldItalic"}.items():
            font = find_font(f"{stem}-{style}", size)
            if font is None:
                print(f"pishot: no {stem}-{style} font file; {style} text is drawn with Regular", file=sys.stderr)
            self.styles[key] = font or regular
        self.cmap = cmap_of(regular)
        self.fallbacks = [(font, cmap_of(font)) for font in (find_font(n, size) for n in GLYPH_FALLBACKS) if font]
        emoji = find_font(EMOJI_FONT, EMOJI_PX)
        self.emoji = (emoji, cmap_of(emoji)) if emoji else None
        ascent, descent = regular.getmetrics()
        self.ascent = ascent
        self.cell_w = round(regular.getlength("M"))
        self.cell_h = ascent + descent
        self.missing = set()

    def font_for(self, char: str, bold: bool, italic: bool):
        cp = ord(char[0])
        if cp in self.cmap:
            return self.styles[(bold, italic)], False
        for font, cmap in self.fallbacks:
            if cp in cmap:
                return font, False
        if self.emoji and cp in self.emoji[1]:
            return self.emoji[0], True
        self.missing.add(char)
        return self.styles[(bold, italic)], False


def resolve(color: str, default, palette):
    if color == "default":
        return default
    if color.startswith("bright"):
        return palette["ansi"][NAMED.get(color[6:], 7) + 8]
    if color in NAMED:
        return palette["ansi"][NAMED[color]]
    if re.fullmatch(r"[0-9a-fA-F]{6}", color):
        return hex_rgb(color)
    return default


def mix(a, b, t):
    return tuple(round(x * (1 - t) + y * t) for x, y in zip(a, b))


# Box drawing is drawn as terminals draw it, so lines join across cells whatever the font's metrics.
# (up, down, left, right): 1 light, 2 heavy, 3 double.
BOX = {ch: tuple(int(c) for c in s) for ch, s in {
    "─": "0011", "━": "0022", "│": "1100", "┃": "2200", "═": "0033", "║": "3300",
    "┌": "0101", "┐": "0110", "└": "1001", "┘": "1010", "╭": "0101", "╮": "0110", "╰": "1001", "╯": "1010",
    "┏": "0202", "┓": "0220", "┗": "2002", "┛": "2020", "╔": "0303", "╗": "0330", "╚": "3003", "╝": "3030",
    "├": "1101", "┤": "1110", "┬": "0111", "┴": "1011", "┼": "1111",
    "┣": "2202", "┫": "2220", "┳": "0222", "┻": "2022", "╋": "2222",
    "╠": "3303", "╣": "3330", "╦": "0333", "╩": "3033", "╬": "3333",
    "╴": "0010", "╵": "1000", "╶": "0001", "╷": "0100", "╸": "0020", "╹": "2000", "╺": "0002", "╻": "0200",
}.items()}
ROUNDED = set("╭╮╰╯")
BLOCKS = {  # (left, top, right, bottom) as fractions of the cell
    "█": (0, 0, 1, 1), "▀": (0, 0, 1, 0.5), "▄": (0, 0.5, 1, 1), "▌": (0, 0, 0.5, 1), "▐": (0.5, 0, 1, 1),
    "▁": (0, 7 / 8, 1, 1), "▂": (0, 6 / 8, 1, 1), "▃": (0, 5 / 8, 1, 1), "▅": (0, 3 / 8, 1, 1),
    "▆": (0, 2 / 8, 1, 1), "▇": (0, 1 / 8, 1, 1), "▉": (0, 0, 7 / 8, 1), "▊": (0, 0, 6 / 8, 1),
    "▋": (0, 0, 5 / 8, 1), "▍": (0, 0, 3 / 8, 1), "▎": (0, 0, 2 / 8, 1), "▏": (0, 0, 1 / 8, 1),
    "▔": (0, 0, 1, 1 / 8), "▕": (7 / 8, 0, 1, 1),
}
SHADES = {"░": 0.25, "▒": 0.5, "▓": 0.75}


def draw_special(draw, ch, x0, y0, cw, chh, fg, bg) -> bool:
    if ch in BLOCKS:
        l, t, r, b = BLOCKS[ch]
        draw.rectangle([x0 + round(l * cw), y0 + round(t * chh), x0 + round(r * cw) - 1, y0 + round(b * chh) - 1],
                       fill=fg)
        return True
    if ch in SHADES:
        draw.rectangle([x0, y0, x0 + cw - 1, y0 + chh - 1], fill=mix(bg, fg, SHADES[ch]))
        return True
    if ch not in BOX:
        return False
    up, down, left, right = BOX[ch]
    light = max(1, round(cw / 9))  # stroke width close to a terminal's light line
    cx, cy = x0 + cw // 2, y0 + chh // 2
    half = light // 2

    def hline(a, b, y, w):
        draw.rectangle([a, y - w // 2, b, y - w // 2 + w - 1], fill=fg)

    def vline(a, b, x, w):
        draw.rectangle([x - w // 2, a, x - w // 2 + w - 1, b], fill=fg)

    if ch in ROUNDED:
        r = min(cw, chh) // 2
        arc = {"╭": (cx, cy, cx + 2 * r, cy + 2 * r, 180, 270), "╮": (cx - 2 * r, cy, cx, cy + 2 * r, 270, 360),
               "╰": (cx, cy - 2 * r, cx + 2 * r, cy, 90, 180), "╯": (cx - 2 * r, cy - 2 * r, cx, cy, 0, 90)}[ch]
        draw.arc([arc[0] - half, arc[1] - half, arc[2] - half, arc[3] - half], arc[4], arc[5], fill=fg, width=light)
        if right:
            hline(cx + r, x0 + cw - 1, cy, light)
        if left:
            hline(x0, cx - r, cy, light)
        if down:
            vline(cy + r, y0 + chh - 1, cx, light)
        if up:
            vline(y0, cy - r, cx, light)
        return True

    def stroke(weight, horizontal, a, b):
        if not weight:
            return
        line = hline if horizontal else vline
        center = cy if horizontal else cx
        if weight == 3:  # double: two light lines
            for off in (-(light + 1), light + 1):
                line(a, b, center + off, light)
        else:
            line(a, b, center, light if weight == 1 else light * 2 + 1)

    stroke(left, True, x0, cx)
    stroke(right, True, cx, x0 + cw - 1)
    stroke(up, False, y0, cy)
    stroke(down, False, cy, y0 + chh - 1)
    return True


def render(screen: pyte.Screen, palette: dict, glyphs: Glyphs, path: Path) -> None:
    cw, ch = glyphs.cell_w, glyphs.cell_h
    img = Image.new("RGB", (screen.columns * cw + 2 * PAD, screen.lines * ch + 2 * PAD), palette["bg"])
    draw = ImageDraw.Draw(img)
    cursor = None if screen.cursor.hidden else (screen.cursor.x, screen.cursor.y)
    for y in range(screen.lines):
        row = screen.buffer[y]
        for x in range(screen.columns):
            c = row[x]
            fg = resolve(c.fg, palette["fg"], palette)
            bg = resolve(c.bg, palette["bg"], palette)
            if c.reverse:
                fg, bg = bg, fg
            if cursor == (x, y):
                fg, bg = palette["bg"], palette["cursor"]
            if c.blink:  # faint, see FaintScreen
                fg = mix(fg, bg, FAINT)
            x0, y0 = PAD + x * cw, PAD + y * ch
            if bg != palette["bg"]:
                draw.rectangle([x0, y0, x0 + cw - 1, y0 + ch - 1], fill=bg)
            if c.data in ("", " ") or draw_special(draw, c.data, x0, y0, cw, ch, fg, bg):
                continue
            font, is_emoji = glyphs.font_for(c.data, c.bold, c.italics)
            if is_emoji:
                glyph = Image.new("RGBA", (EMOJI_PX + 40, EMOJI_PX + 40), (0, 0, 0, 0))
                ImageDraw.Draw(glyph).text((0, 0), c.data, font=font, embedded_color=True)
                glyph = glyph.crop(glyph.getbbox() or (0, 0, 1, 1))
                scale = min(2 * cw / glyph.width, ch / glyph.height)
                glyph = glyph.resize((max(1, int(glyph.width * scale)), max(1, int(glyph.height * scale))))
                img.paste(glyph, (x0, y0 + (ch - glyph.height) // 2), glyph)
            else:
                draw.text((x0, y0 + glyphs.ascent), c.data, font=font, fill=fg, anchor="ls")
            if c.underscore:
                draw.line([x0, y0 + ch - 2, x0 + cw - 1, y0 + ch - 2], fill=fg)
            if c.strikethrough:
                draw.line([x0, y0 + ch // 2, x0 + cw - 1, y0 + ch // 2], fill=fg)
    img.save(path)


# ---------------------------------------------------------------------------
# Driving Pi

KEYS = {  # legacy encodings: Pi falls back to them because the kitty keyboard query is left unanswered
    "enter": "\r", "esc": "\x1b", "tab": "\t", "shift+tab": "\x1b[Z", "backspace": "\x7f", "space": " ",
    "up": "\x1b[A", "down": "\x1b[B", "right": "\x1b[C", "left": "\x1b[D",
    "home": "\x1b[H", "end": "\x1b[F", "pageup": "\x1b[5~", "pagedown": "\x1b[6~",
}


def key_bytes(name: str) -> str:
    name = name.lower()
    if name in KEYS:
        return KEYS[name]
    m = re.fullmatch(r"ctrl\+([a-z])", name)
    if m:
        return chr(ord(m.group(1)) - 96)
    raise ValueError(f"unknown key {name!r}; use ctrl+<letter> or one of {', '.join(KEYS)}")


def parse_step(text: str) -> tuple[str, object]:
    """One --step, checked before Pi starts: ("input", chars), ("wait", seconds) or ("shot", path)."""
    kind, _, value = text.partition(":")
    try:
        if kind == "key":
            return "input", key_bytes(value)
        if kind == "text":
            return "input", value
        if kind == "wait":
            return "wait", float(value)
        if kind == "shot":
            return "shot", Path(value).resolve()
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error
    raise argparse.ArgumentTypeError(f"unknown step {text!r}; use key:, text:, wait: or shot:")


def read_some(fd: int) -> bytes | None:
    """What the program wrote within 50 ms: None if nothing, b"" once it has closed the terminal."""
    if not select.select([fd], [], [], 0.05)[0]:
        return None
    try:
        return os.read(fd, 65536)
    except OSError:  # EIO: the program closed the terminal
        return b""


def reap(pid: int, fd: int, sig: int) -> bool:
    """Sends `sig` and waits for Pi to exit, reading its output: Pi cannot exit while that output sits unread."""
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):  # already exited; macOS answers EPERM for a zombie group
        pass
    deadline = time.monotonic() + 3.0  # Pi restores the terminal on exit in well under a second
    while time.monotonic() < deadline:
        if os.waitpid(pid, os.WNOHANG)[0]:
            return True
        read_some(fd)
    return False


def pi_argv(args: argparse.Namespace, work: Path) -> list[str]:
    sessions = work / "sessions"
    sessions.mkdir()
    argv = ["pi", "--session-dir", str(sessions), "--offline"]
    if args.blank:
        return [*argv, "--no-session", *args.pi_args]
    session = sessions / "session.jsonl"
    if args.session:
        try:
            shutil.copy(args.session, session)
        except OSError as error:
            fail(f"cannot copy the session {args.session}: {error}")
    else:
        project = work / "project"
        project.mkdir()
        r = subprocess.run(["node", str(HERE / "make-session.mjs"), str(session), str(project)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            fail(f"make-session.mjs failed:\n{r.stderr.strip()}")
    return [*argv, "--session", str(session), *args.pi_args]


def capture(argv: list[str], args: argparse.Namespace, palette: dict, appearance: str, glyphs: Glyphs) -> None:
    # A clean terminal identity: inherited multiplexer variables would make Pi talk to the caller's terminal.
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("HC_", "GHOSTTY", "KITTY", "WEZTERM", "TMUX", "TERM_PROGRAM", "COLORFGBG"))}
    env.update(TERM="xterm-256color", COLORTERM="truecolor")
    winsize = struct.pack("HHHH", args.rows, args.cols, args.cols * glyphs.cell_w, args.rows * glyphs.cell_h)

    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(sys.stdout.fileno(), termios.TIOCSWINSZ, winsize)  # before exec: Pi's first read sees it
        os.execvpe(argv[0], argv, env)

    raw = bytearray()
    queries: list[str] = []
    screen = FaintScreen(args.cols, args.rows, palette, lambda s: os.write(fd, s.encode()))
    term = Terminal(screen, appearance, (glyphs.cell_w, glyphs.cell_h), queries)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")

    def pump(seconds: float) -> bool:
        """Feeds the screen until `settle` seconds pass without output, at most `seconds`. False once Pi exited."""
        deadline = time.monotonic() + seconds
        last = time.monotonic()
        while time.monotonic() < deadline:
            data = read_some(fd)
            if data is None:
                if time.monotonic() - last >= args.settle:
                    break
                continue
            if not data:
                return False
            raw.extend(data)
            term.feed(decoder.decode(data))
            last = time.monotonic()
        return True

    def shot(path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        render(screen, palette, glyphs, path)
        path.with_suffix(".txt").write_text("\n".join(line.rstrip() for line in screen.display) + "\n")
        print(path)

    alive = True
    try:
        alive = pump(args.timeout)
        for kind, value in args.step:
            if not alive:
                break
            if kind == "shot":
                shot(value)
            elif kind == "wait":
                alive = pump(value)
            else:
                os.write(fd, value.encode())
                alive = pump(args.timeout)
        shot(args.out)
    finally:
        exited = any(reap(pid, fd, sig) for sig in (signal.SIGTERM, signal.SIGKILL))
        os.close(fd)
        if args.debug:
            args.out.with_suffix(".ansi").write_bytes(bytes(raw))
            args.out.with_suffix(".log").write_text("\n".join(queries) + "\n")
        if not exited:
            print(f"pishot: pi (pid {pid}) survived SIGKILL; kill it by hand", file=sys.stderr)
    if glyphs.missing:
        print(f"pishot: no font has these glyphs, drawn as boxes: {''.join(sorted(glyphs.missing))}", file=sys.stderr)
    if not alive:
        fail(f"pi exited before the last screenshot; its last screen is in {args.out.with_suffix('.txt')}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=lambda p: Path(p).resolve(), help="final PNG")
    source = ap.add_mutually_exclusive_group()
    source.add_argument("--session", help="session JSONL to open, copied first (default: a fake session)")
    source.add_argument("--blank", action="store_true", help="no session: shows Pi's startup screen and diagnostics")
    # 110x50 is a common laptop terminal; vary --cols to check that renderers fit narrow and wide widths.
    ap.add_argument("--cols", type=int, default=110)
    ap.add_argument("--rows", type=int, default=50)
    ap.add_argument("--appearance", choices=["dark", "light"], help="default: the macOS appearance")
    ap.add_argument("--palette", help="Herdr theme name or JSON file (default: Herdr's theme for the appearance)")
    ap.add_argument("--font", help="font family (default: Herdr's)")
    # 15 px keeps the text legible to an agent once a 110-column PNG is scaled down for reading.
    ap.add_argument("--font-size", type=int, default=15)
    # Pi redraws in bursts; one second of silence means a frame is complete.
    ap.add_argument("--settle", type=float, default=1.0, help="seconds without output that count as settled")
    ap.add_argument("--timeout", type=float, default=25.0, help="max seconds to wait for each settle")
    ap.add_argument("--step", action="append", default=[], type=parse_step,
                    help="key:<name> | text:<chars> | wait:<seconds> | shot:<png>, run in order")
    ap.add_argument("--debug", action="store_true", help="also write the raw output (.ansi) and the queries (.log)")
    ap.add_argument("pi_args", nargs="*", help="arguments for pi, after --")
    args = ap.parse_args()

    appearance = args.appearance or macos_appearance()
    settings = herdr_settings() if not (args.palette and args.font) else {}
    palette = load_palette(args.palette or settings.get("theme", {}).get(appearance)
                           or fail(f"{HERDR}/settings.json has no theme.{appearance}; pass --palette"))
    glyphs = Glyphs(args.font or settings.get("font") or fail(f"{HERDR}/settings.json has no font; pass --font"),
                    args.font_size)
    if shutil.which("pi") is None:
        fail("pi is not on PATH")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pishot-") as work:
        capture(pi_argv(args, Path(work)), args, palette, appearance, glyphs)


if __name__ == "__main__":
    main()
