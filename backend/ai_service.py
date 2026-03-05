"""OpenAI-powered LaTeX editing and cover letter generation."""
import json
import os
from pathlib import Path
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# ── Knowledge base ─────────────────────────────────────────────────────────────
_KNOWLEDGE_PATH = Path(__file__).parent / "KNOWLEDGE.md"
CANDIDATE_KNOWLEDGE: str = (
    _KNOWLEDGE_PATH.read_text(encoding="utf-8") if _KNOWLEDGE_PATH.exists() else ""
)
_KNOWLEDGE_BLOCK = (
    f"\n\n---\n## Candidate Knowledge Base\n\n{CANDIDATE_KNOWLEDGE}\n---\n"
    if CANDIDATE_KNOWLEDGE
    else ""
)

# ── System prompt ──────────────────────────────────────────────────────────────
_CHAT_SYSTEM_BASE = """You are a helpful LaTeX resume assistant. Each project has two files:

1. **resume.tex** — the tailored resume
2. **cover_letter.tex** — the cover letter for this application

You can:
- Answer questions, discuss improvements, give advice on tailoring for a role.
- Edit the resume by calling `edit_resume`.
- Edit/write the cover letter by calling `edit_cover_letter`.

Strict rules on when to call each tool:
- Call `edit_resume` ONLY when the user explicitly asks to edit, update, tailor, or optimize the resume.
- Call `edit_cover_letter` ONLY when the user explicitly mentions "cover letter" or asks you to write/update/tailor the cover letter. NEVER touch the cover letter unless directly asked.
- If the user asks to tailor the resume (with no mention of a cover letter), call ONLY `edit_resume`.
- If just chatting or brainstorming — respond conversationally, no tool calls.
- When you call a tool, include a short conversational message explaining what you did.
- The resume must fit on exactly one page. When editing, do not increase total content length unless you explicitly remove an equivalent amount elsewhere."""


def _build_system(use_knowledge_base: bool) -> str:
    if use_knowledge_base and _KNOWLEDGE_BLOCK:
        return _CHAT_SYSTEM_BASE + _KNOWLEDGE_BLOCK
    return _CHAT_SYSTEM_BASE


# ── Tool definitions ───────────────────────────────────────────────────────────
_EDIT_RESUME_TOOL = {
    "type": "function",
    "function": {
        "name": "edit_resume",
        "description": (
            "Apply edits to resume.tex. "
            "Return the COMPLETE updated LaTeX source — every line, nothing omitted."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "suggested_latex": {
                    "type": "string",
                    "description": "Complete updated LaTeX source for the resume.",
                },
                "explanation": {
                    "type": "string",
                    "description": "Brief, friendly summary of what was changed.",
                },
            },
            "required": ["suggested_latex", "explanation"],
        },
    },
}

_EDIT_COVER_LETTER_TOOL = {
    "type": "function",
    "function": {
        "name": "edit_cover_letter",
        "description": (
            "Write or edit cover_letter.tex for this project. "
            "Return a COMPLETE, compilable LaTeX document. "
            "ONLY call this when the user explicitly asks for a cover letter or asks to edit the cover letter. "
            "Do NOT call this when the user is only asking about the resume."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "suggested_latex": {
                    "type": "string",
                    "description": "Complete updated LaTeX source for the cover letter.",
                },
                "explanation": {
                    "type": "string",
                    "description": "Brief, friendly summary of what was written/changed.",
                },
            },
            "required": ["suggested_latex", "explanation"],
        },
    },
}

_TOOLS = [_EDIT_RESUME_TOOL, _EDIT_COVER_LETTER_TOOL]


# ── Model list ─────────────────────────────────────────────────────────────────
SUPPORTED_MODELS = [
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-thinking",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "o4-mini",
    "o3-mini",
]


# ── Main chat function ─────────────────────────────────────────────────────────
async def ai_chat(
    resume_latex: str,
    cover_letter_latex: str = "",
    prompt: str = "",
    images: list[str] | None = None,
    history: list[dict] | None = None,
    use_knowledge_base: bool = True,
    model: str = "gpt-4o",
) -> dict:
    """
    Returns a dict with one of these types:
      "message"               – plain chat, no edits
      "edit"                  – resume edited
      "edit_cover_letter"     – cover letter edited/written
      "edit_and_cover_letter" – both edited in one turn
    Plus fields: message, suggested_resume, suggested_cover_letter
    """
    cl_section = (
        f"\n\n---\n**cover_letter.tex (current):**\n```latex\n{cover_letter_latex}\n```"
        if cover_letter_latex.strip()
        else "\n\n---\n**cover_letter.tex:** (empty — not written yet)"
    )
    non_empty_lines = len([l for l in resume_latex.splitlines() if l.strip()])
    if non_empty_lines > 60:
        page_hint = (
            f"\n\n[Resume size: ~{non_empty_lines} non-empty lines — likely close to or over 1 page. "
            f"Be conservative: only add content if you remove an equal amount.]"
        )
    else:
        page_hint = (
            f"\n\n[Resume size: ~{non_empty_lines} non-empty lines — fits on 1 page. Keep it that way.]"
        )
    text_part = (
        f"**resume.tex (current):**\n```latex\n{resume_latex}\n```"
        f"{cl_section}\n\n---\n{prompt}{page_hint}"
    )

    if images:
        content: list[dict] = [{"type": "text", "text": text_part}]
        for url in images:
            content.append({"type": "image_url", "image_url": {"url": url, "detail": "high"}})
        user_message: dict = {"role": "user", "content": content}
    else:
        user_message = {"role": "user", "content": text_part}

    messages: list[dict] = [
        {"role": "system", "content": _build_system(use_knowledge_base)},
        *(history or []),
        user_message,
    ]

    _model = model if model in SUPPORTED_MODELS else "gpt-4o"
    create_kwargs: dict = dict(model=_model, messages=messages, tools=_TOOLS)
    if not _model.startswith("o"):
        create_kwargs["temperature"] = 0.3
        create_kwargs["tool_choice"] = "auto"

    response = await client.chat.completions.create(**create_kwargs)
    choice = response.choices[0]
    msg = choice.message

    suggested_resume: str | None = None
    suggested_cover_letter: str | None = None
    explanations: list[str] = []

    if msg.tool_calls:
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments)
            latex_src = _strip_fences(args.get("suggested_latex", ""))
            expl = args.get("explanation", "")
            if tc.function.name == "edit_resume":
                suggested_resume = latex_src
                explanations.append(expl or "I've updated the resume.")
            elif tc.function.name == "edit_cover_letter":
                suggested_cover_letter = latex_src
                explanations.append(expl or "I've written the cover letter.")

    if suggested_resume and suggested_cover_letter:
        resp_type = "edit_and_cover_letter"
    elif suggested_resume:
        resp_type = "edit"
    elif suggested_cover_letter:
        resp_type = "edit_cover_letter"
    else:
        resp_type = "message"

    reply = (msg.content or "").strip()
    if explanations and not reply:
        reply = " ".join(explanations)

    return {
        "type": resp_type,
        "message": reply,
        "suggested_resume": suggested_resume,
        "suggested_cover_letter": suggested_cover_letter,
    }


def _strip_fences(text: str) -> str:
    if text.startswith("```"):
        lines = text.splitlines()
        end = -1 if lines[-1].strip() == "```" else len(lines)
        return "\n".join(lines[1:end])
    return text


# ── Standalone cover letter (for the modal route) ─────────────────────────────
COVER_LETTER_SYSTEM = f"""You are an expert at writing professional, tailored cover letters in LaTeX.

Generate a complete, compilable LaTeX document for a cover letter that:
- Speaks specifically to the role and company provided
- Highlights the candidate's most relevant experiences and skills
- Uses concrete details, metrics, and project names — never generic filler
- Sounds natural and confident

Use a clean article or letter class. Return ONLY raw LaTeX — no markdown fences, no extra text.{_KNOWLEDGE_BLOCK}"""


async def ai_generate_cover_letter(
    resume_latex: str,
    job_title: str,
    company_name: str,
    company_description: str,
) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": COVER_LETTER_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Candidate's resume (LaTeX):\n{resume_latex}\n\n"
                    f"Job Title: {job_title}\n"
                    f"Company: {company_name}\n"
                    f"Company/Job Description:\n{company_description}\n\n"
                    "Write a tailored cover letter in LaTeX."
                ),
            },
        ],
        temperature=0.4,
    )
    return _strip_fences(response.choices[0].message.content.strip())
