"""In-memory resume store with file-system persistence."""
import os
import json
from pathlib import Path

RESUMES_DIR = Path(__file__).parent / "resumes"
RESUMES_DIR.mkdir(exist_ok=True)

# In-memory cache: {name: latex_content}
_store: dict[str, str] = {}


def _tex_path(name: str) -> Path:
    safe = name.replace("/", "_").replace("\\", "_")
    return RESUMES_DIR / f"{safe}.tex"


def _meta_path() -> Path:
    return RESUMES_DIR / "_meta.json"


def _load_from_disk() -> None:
    """Load all .tex files from disk into memory on startup."""
    for tex_file in RESUMES_DIR.glob("*.tex"):
        name = tex_file.stem
        _store[name] = tex_file.read_text(encoding="utf-8")


def save_resume(name: str, latex: str) -> None:
    _store[name] = latex
    _tex_path(name).write_text(latex, encoding="utf-8")


def get_resume(name: str) -> str | None:
    return _store.get(name)


def list_resumes() -> list[str]:
    return sorted(_store.keys())


def rename_resume(old_name: str, new_name: str) -> bool:
    if old_name not in _store or new_name in _store:
        return False
    latex = _store.pop(old_name)
    _store[new_name] = latex
    old_path = _tex_path(old_name)
    if old_path.exists():
        old_path.rename(_tex_path(new_name))
    else:
        _tex_path(new_name).write_text(latex, encoding="utf-8")
    return True


def delete_resume(name: str) -> bool:
    if name not in _store:
        return False
    del _store[name]
    p = _tex_path(name)
    if p.exists():
        p.unlink()
    return True


# Load persisted resumes on import
_load_from_disk()
