"""
Test script: analyze PDF layout of Varun Resume Base and report
per-bullet rendered line counts. Run from backend/ directory:

    python test_bullet_analysis.py
"""
import sys
import base64
from pathlib import Path

import fitz  # PyMuPDF

sys.path.insert(0, str(Path(__file__).parent))
from compiler import compile_latex  # noqa: E402


# ── Compile ────────────────────────────────────────────────────────────────────

RESUME_PATH = Path(__file__).parent / "resumes" / "Varun Resume Base" / "resume.tex"
latex = RESUME_PATH.read_text(encoding="utf-8")

print("Compiling resume…")
pdf_b64, err = compile_latex(latex)
if err or not pdf_b64:
    sys.exit(f"Compile error: {err}")

pdf_bytes = base64.b64decode(pdf_b64)
print(f"PDF size: {len(pdf_bytes):,} bytes\n")


# ── Layout extraction ──────────────────────────────────────────────────────────

def _gather_lines(pdf_bytes: bytes) -> list[dict]:
    """Return every typeset line in page order with bbox + full text + max font size."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    raw = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    result: list[dict] = []
    for block in raw["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            spans = line.get("spans", [])
            text = "".join(s["text"] for s in spans).strip()
            if not text:
                continue
            max_size = max((s["size"] for s in spans), default=0)
            x0 = line["bbox"][0]
            y0 = line["bbox"][1]
            result.append({"text": text, "x0": x0, "y0": y0, "size": max_size})
    result.sort(key=lambda l: l["y0"])
    return result


def analyze_bullet_lines(pdf_bytes: bytes) -> list[dict]:
    """
    Return a list of bullet-info dicts:
        {section, role, snippet, line_count}
    Bullets that span >1 rendered line are flagged (line_count > 1).
    """
    lines = _gather_lines(pdf_bytes)

    # ── Calibrate thresholds from the actual PDF ───────────────────────────────
    from collections import Counter
    size_counts = Counter(round(l["size"], 1) for l in lines)
    body_size = size_counts.most_common(1)[0][0]
    section_size_threshold = body_size * 1.15  # section headers are larger

    # Bullet x: lines starting with "•" tell us exactly where bullets sit
    bullet_x_values = [l["x0"] for l in lines if l["text"].startswith("•")]
    bullet_col = (sum(bullet_x_values) / len(bullet_x_values)) if bullet_x_values else 43.0

    # Continuation lines are INDENTED FURTHER than the bullet (no bullet marker).
    # Company/role headings are LESS indented than the bullet.
    # So the rule: a continuation line has x0 >= bullet_col - 2 (within 2pts of bullet x).
    CONTINUATION_X_MIN = bullet_col - 2.0
    SECTION_X_MAX = 30.0  # section headers hug the left margin

    results: list[dict] = []
    current_section = ""
    current_role = ""
    current_bullet_text = ""
    current_line_count = 0
    bullet_text_x0 = None

    def flush_bullet():
        nonlocal current_bullet_text, current_line_count, bullet_text_x0
        if current_bullet_text:
            results.append({
                "section": current_section,
                "role": current_role,
                "snippet": current_bullet_text[:80],
                "line_count": current_line_count,
            })
        current_bullet_text = ""
        current_line_count = 0
        bullet_text_x0 = None

    for line in lines:
        text = line["text"]
        x0 = line["x0"]
        size = round(line["size"], 1)

        # ── Section header: large font near left margin ────────────────────────
        if size >= section_size_threshold and x0 <= SECTION_X_MAX and len(text) > 2:
            flush_bullet()
            current_section = text.title()
            current_role = ""
            continue

        # ── Bullet start: line beginning with "•" ─────────────────────────────
        if text.startswith("•"):
            flush_bullet()
            bullet_body = text[1:].strip()
            current_bullet_text = bullet_body
            current_line_count = 1
            bullet_text_x0 = x0
            continue

        # ── Continuation line: indented >= bullet x, not a new bullet/section ──
        if current_bullet_text and x0 >= CONTINUATION_X_MIN and size < section_size_threshold:
            current_line_count += 1
            current_bullet_text += " " + text
            continue

        # ── Heading line (company / role / project) ────────────────────────────
        flush_bullet()
        if x0 < CONTINUATION_X_MIN and size < section_size_threshold and len(text) > 2:
            current_role = text[:60]

    flush_bullet()
    return results


# ── Run analysis and pretty-print ─────────────────────────────────────────────

bullets = analyze_bullet_lines(pdf_bytes)

print(f"Found {len(bullets)} bullets total\n")
print("=" * 72)

current_section = None
current_role = None
for b in bullets:
    if b["section"] != current_section:
        current_section = b["section"]
        print(f"\n=== {current_section} ===")
        current_role = None
    if b["role"] != current_role:
        current_role = b["role"]
        print(f"  [{current_role}]")
    flag = "  *** MULTI-LINE ***" if b["line_count"] > 1 else ""
    print(f"    [{b['line_count']} line{'s' if b['line_count'] > 1 else ' '}]  {b['snippet'][:70]!r}{flag}")

print("\n" + "=" * 72)
multi = [b for b in bullets if b["line_count"] > 1]
print(f"\nMulti-line bullets: {len(multi)} / {len(bullets)}")
for b in multi:
    role_tag = f" / {b['role']}" if b["role"] else ""
    print(f"  [{b['section']}{role_tag}]  {b['snippet'][:60]!r}  ({b['line_count']} lines)")

# ── Debug dump: all raw lines with position info ───────────────────────────────
if "--debug" in sys.argv:
    print("\n\n── RAW LINES (--debug) ─────────────────────────────────────────")
    for l in _gather_lines(pdf_bytes):
        print(f"  x={l['x0']:6.1f}  y={l['y0']:6.1f}  sz={l['size']:5.1f}  {l['text'][:80]!r}")
