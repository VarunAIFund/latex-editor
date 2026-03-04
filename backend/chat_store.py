"""Persistent chat thread storage — backed by a single JSON file on disk."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_HISTORY_FILE = Path(__file__).parent / "chat_history.json"


# ── Atomic read / write ────────────────────────────────────────────────────────

def _load() -> dict[str, list[dict]]:
    """Return the full data dict, or {} if the file is missing / corrupt."""
    if not _HISTORY_FILE.exists():
        return {}
    try:
        return json.loads(_HISTORY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save(data: dict[str, list[dict]]) -> None:
    """Write atomically: write to .tmp then rename so partial writes never corrupt."""
    tmp = _HISTORY_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, _HISTORY_FILE)


# ── Public API ─────────────────────────────────────────────────────────────────

def get_threads(resume: str) -> list[dict]:
    """Return thread summaries (no messages) sorted by created_at descending."""
    data = _load()
    threads = data.get(resume, [])
    summaries = [
        {
            "id": t["id"],
            "title": t.get("title", "Untitled"),
            "created_at": t.get("created_at", ""),
            "message_count": len(t.get("messages", [])),
        }
        for t in threads
    ]
    return sorted(summaries, key=lambda t: t["created_at"], reverse=True)


def get_thread(resume: str, thread_id: str) -> dict | None:
    """Return the full thread including messages, or None if not found."""
    data = _load()
    for t in data.get(resume, []):
        if t["id"] == thread_id:
            return t
    return None


def upsert_thread(resume: str, thread: dict) -> None:
    """Create or replace a thread by id."""
    data = _load()
    threads = data.setdefault(resume, [])
    for i, t in enumerate(threads):
        if t["id"] == thread["id"]:
            threads[i] = thread
            _save(data)
            return
    threads.append(thread)
    _save(data)


def delete_thread(resume: str, thread_id: str) -> bool:
    data = _load()
    threads = data.get(resume, [])
    new_threads = [t for t in threads if t["id"] != thread_id]
    if len(new_threads) == len(threads):
        return False
    data[resume] = new_threads
    if not new_threads:
        data.pop(resume, None)
    _save(data)
    return True


def rename_resume(old_name: str, new_name: str) -> None:
    """Move all threads from old_name key to new_name key."""
    data = _load()
    if old_name not in data:
        return
    threads = data.pop(old_name)
    # Merge into new name if it already has threads (shouldn't normally happen)
    existing = data.get(new_name, [])
    data[new_name] = existing + threads
    _save(data)


def delete_resume(name: str) -> None:
    """Remove all threads for a resume."""
    data = _load()
    if name in data:
        data.pop(name)
        _save(data)
