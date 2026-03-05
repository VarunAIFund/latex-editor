"""LaTeX → PDF compilation via pdflatex subprocess."""
import base64
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import fitz  # PyMuPDF


PDFLATEX = "/Library/TeX/texbin/pdflatex"


def compile_latex(latex: str) -> tuple[str | None, str | None]:
    """Compile LaTeX source and return (pdf_base64, error_message)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        tex_file = tmp / "resume.tex"
        tex_file.write_text(latex, encoding="utf-8")

        try:
            result = subprocess.run(
                [
                    PDFLATEX,
                    "-interaction=nonstopmode",
                    "-halt-on-error",
                    "-output-directory", str(tmp),
                    str(tex_file),
                ],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=tmpdir,
            )
        except subprocess.TimeoutExpired:
            return None, "Compilation timed out after 60 seconds."
        except FileNotFoundError:
            return None, "pdflatex not found. Please install TeX Live."

        pdf_file = tmp / "resume.pdf"
        if pdf_file.exists():
            pdf_bytes = pdf_file.read_bytes()
            return base64.b64encode(pdf_bytes).decode("ascii"), None

        # Extract relevant error lines from pdflatex output
        log_file = tmp / "resume.log"
        if log_file.exists():
            log = log_file.read_text(encoding="utf-8", errors="replace")
            error_lines = [
                line for line in log.splitlines()
                if line.startswith("!") or "Error" in line or "error" in line
            ]
            error_msg = "\n".join(error_lines[:20]) if error_lines else result.stdout[-2000:]
        else:
            error_msg = result.stdout[-2000:] or result.stderr[-2000:]

        return None, error_msg


def count_pages(pdf_bytes: bytes) -> int:
    """Return number of pages in a PDF by scanning its binary header."""
    import re
    text = pdf_bytes[:4000].decode("latin-1", errors="ignore")
    m = re.search(r"/Count\s+(\d+)", text)
    return int(m.group(1)) if m else 1


def _gather_pdf_lines(pdf_bytes: bytes) -> list[dict]:
    """Extract all typeset lines from page 1 with bbox + text + max font size."""
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
            result.append({
                "text": text,
                "x0": line["bbox"][0],
                "y0": line["bbox"][1],
                "size": max_size,
            })
    result.sort(key=lambda l: l["y0"])
    return result


def analyze_bullet_lines(pdf_bytes: bytes) -> list[dict]:
    """
    Return per-bullet layout info for the first PDF page.

    Each entry: {section, role, snippet, line_count}
    Useful for identifying which bullets wrap to multiple rendered lines.
    """
    lines = _gather_pdf_lines(pdf_bytes)

    # Calibrate from the actual PDF
    size_counts = Counter(round(l["size"], 1) for l in lines)
    body_size = size_counts.most_common(1)[0][0]
    section_size_threshold = body_size * 1.15

    bullet_x_values = [l["x0"] for l in lines if l["text"].startswith("•")]
    bullet_col = (sum(bullet_x_values) / len(bullet_x_values)) if bullet_x_values else 43.0
    continuation_x_min = bullet_col - 2.0
    section_x_max = 30.0

    results: list[dict] = []
    current_section = ""
    current_role = ""
    current_bullet_text = ""
    current_line_count = 0

    def flush():
        nonlocal current_bullet_text, current_line_count
        if current_bullet_text:
            results.append({
                "section": current_section,
                "role": current_role,
                "snippet": current_bullet_text[:80],
                "line_count": current_line_count,
            })
        current_bullet_text = ""
        current_line_count = 0

    for line in lines:
        text = line["text"]
        x0 = line["x0"]
        size = round(line["size"], 1)

        # Section header: large font near left margin
        if size >= section_size_threshold and x0 <= section_x_max and len(text) > 2:
            flush()
            current_section = text.title()
            current_role = ""
            continue

        # Bullet start
        if text.startswith("•"):
            flush()
            current_bullet_text = text[1:].strip()
            current_line_count = 1
            continue

        # Continuation: indented >= bullet column, not a section header
        if current_bullet_text and x0 >= continuation_x_min and size < section_size_threshold:
            current_line_count += 1
            current_bullet_text += " " + text
            continue

        # Heading line (company / role / project)
        flush()
        if x0 < continuation_x_min and size < section_size_threshold and len(text) > 2:
            current_role = text[:60]

    flush()
    return results
