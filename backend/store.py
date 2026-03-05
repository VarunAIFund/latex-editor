"""Project store – folder-based layout.

Each project lives at:
    resumes/<project_name>/resume.tex
    resumes/<project_name>/cover_letter.tex

Migration: existing flat  resumes/<name>.tex  files are automatically
converted into the folder structure on first access.
"""
import shutil
from pathlib import Path

RESUMES_DIR = Path(__file__).parent / "resumes"
RESUMES_DIR.mkdir(exist_ok=True)

BLANK_RESUME = r"""\documentclass[letterpaper,11pt]{article}
\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.50in}
\addtolength{\evensidemargin}{-0.50in}
\addtolength{\textwidth}{1.00in}
\addtolength{\topmargin}{-0.50in}
\addtolength{\textheight}{1.00in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\begin{document}

\begin{center}
    \textbf{\Huge \scshape Your Name} \\ \vspace{1pt}
    \small 123-456-7890 $|$ \href{mailto:you@email.com}{\underline{you@email.com}}
\end{center}

\section{Education}
\begin{itemize}[leftmargin=0.15in, label={}]
  \item \textbf{Your University} \hfill City, State \\
  Bachelor of Science in Your Major \hfill Aug 2020 -- May 2024
\end{itemize}

\section{Experience}
\begin{itemize}[leftmargin=0.15in, label={}]
  \item \textbf{Your Company} \hfill City, State \\
  \textit{Your Role} \hfill Jan 2023 -- Present
  \begin{itemize}
    \item Accomplished X by doing Y which resulted in Z
  \end{itemize}
\end{itemize}

\section{Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
  \small{\item{
    \textbf{Languages}{: Python, JavaScript, Java} \\
    \textbf{Frameworks}{: React, FastAPI, Node.js}
  }}
\end{itemize}

\end{document}
"""

BLANK_COVER_LETTER = r"""\documentclass[letterpaper,11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{parskip}

\begin{document}

\begin{flushright}
Your Name \\
City, State ZIP \\
\href{mailto:you@email.com}{you@email.com} \\
\today
\end{flushright}

\vspace{1em}

Hiring Manager \\
Company Name \\
City, State ZIP

\vspace{1em}

Dear Hiring Manager,

I am writing to express my strong interest in the [Position] role at [Company].
With my background in [relevant field], I am confident in my ability to contribute
meaningfully to your team.

[Describe a key achievement or relevant experience that aligns with the role.]

[Explain why you are specifically excited about this company and role.]

I would welcome the opportunity to discuss how my skills and experiences align with
your needs. Thank you for your time and consideration.

\vspace{1em}

Sincerely,

\vspace{2em}

Your Name

\end{document}
"""


def _safe(name: str) -> str:
    return name.replace("/", "_").replace("\\", "_")


def _migrate_flat_files() -> None:
    """Convert legacy flat  <name>.tex  files to folder structure."""
    for tex_file in list(RESUMES_DIR.glob("*.tex")):
        project_name = tex_file.stem
        project_dir = RESUMES_DIR / _safe(project_name)
        if not project_dir.exists():
            project_dir.mkdir()
            content = tex_file.read_text(encoding="utf-8")
            (project_dir / "resume.tex").write_text(content, encoding="utf-8")
            (project_dir / "cover_letter.tex").write_text(BLANK_COVER_LETTER, encoding="utf-8")
        tex_file.unlink()


def list_projects() -> list[str]:
    _migrate_flat_files()
    return sorted(d.name for d in RESUMES_DIR.iterdir() if d.is_dir())


def load_project(name: str) -> dict:
    """Return {"resume": str, "cover_letter": str}."""
    d = RESUMES_DIR / _safe(name)
    resume = (d / "resume.tex").read_text(encoding="utf-8") if (d / "resume.tex").exists() else BLANK_RESUME
    cl = (d / "cover_letter.tex").read_text(encoding="utf-8") if (d / "cover_letter.tex").exists() else BLANK_COVER_LETTER
    return {"resume": resume, "cover_letter": cl}


def save_file(name: str, file: str, content: str) -> None:
    """Save resume.tex or cover_letter.tex inside the project folder."""
    assert file in ("resume", "cover_letter"), f"Unknown file type: {file}"
    d = RESUMES_DIR / _safe(name)
    d.mkdir(exist_ok=True)
    (d / f"{file}.tex").write_text(content, encoding="utf-8")


def create_project(name: str, resume: str = BLANK_RESUME, cover_letter: str = BLANK_COVER_LETTER) -> None:
    d = RESUMES_DIR / _safe(name)
    d.mkdir(exist_ok=True)
    if not (d / "resume.tex").exists():
        (d / "resume.tex").write_text(resume, encoding="utf-8")
    if not (d / "cover_letter.tex").exists():
        (d / "cover_letter.tex").write_text(cover_letter, encoding="utf-8")


def rename_project(old_name: str, new_name: str) -> bool:
    old_dir = RESUMES_DIR / _safe(old_name)
    new_dir = RESUMES_DIR / _safe(new_name)
    if not old_dir.exists() or new_dir.exists():
        return False
    old_dir.rename(new_dir)
    return True


def delete_project(name: str) -> bool:
    d = RESUMES_DIR / _safe(name)
    if not d.exists():
        return False
    shutil.rmtree(d)
    return True


# ── Backward-compat shims (used by chat_store key lookups, unchanged) ──────────
def list_resumes() -> list[str]:
    return list_projects()


def save_resume(name: str, latex: str) -> None:
    save_file(name, "resume", latex)


def get_resume(name: str) -> str | None:
    d = RESUMES_DIR / _safe(name)
    p = d / "resume.tex"
    return p.read_text(encoding="utf-8") if p.exists() else None


def rename_resume(old_name: str, new_name: str) -> bool:
    return rename_project(old_name, new_name)


def delete_resume(name: str) -> bool:
    return delete_project(name)
