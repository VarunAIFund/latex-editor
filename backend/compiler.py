"""LaTeX → PDF compilation via pdflatex subprocess."""
import base64
import subprocess
import tempfile
from pathlib import Path


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
