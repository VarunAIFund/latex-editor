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

# ── System prompts ─────────────────────────────────────────────────────────────
_CHAT_SYSTEM_BASE = """You are a helpful LaTeX resume assistant. You have full access to the candidate's current resume source.

You can:
- Answer questions about the resume, discuss potential improvements, give advice on tailoring it for specific roles.
- Edit the resume by calling the `edit_resume` tool.

Call `edit_resume` ONLY when:
- The user explicitly asks you to make a change, OR
- You have discussed what to change and are now ready to apply it.

When you call `edit_resume`, include a short friendly message in `explanation` telling the user what you changed so they can review before accepting.

If the user is asking a question, chatting, or brainstorming — just respond conversationally without calling the tool."""

_CHAT_SYSTEM_NO_KB = _CHAT_SYSTEM_BASE

def _build_system(use_knowledge_base: bool) -> str:
    if use_knowledge_base and _KNOWLEDGE_BLOCK:
        return _CHAT_SYSTEM_BASE + _KNOWLEDGE_BLOCK
    return _CHAT_SYSTEM_NO_KB


# ── Tool definition ────────────────────────────────────────────────────────────
_EDIT_TOOL = {
    "type": "function",
    "function": {
        "name": "edit_resume",
        "description": (
            "Apply edits to the LaTeX resume. "
            "Call this only when you are ready to apply specific changes. "
            "Return the COMPLETE updated LaTeX source — every line, nothing omitted."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "suggested_latex": {
                    "type": "string",
                    "description": "The complete updated LaTeX source with all changes applied.",
                },
                "explanation": {
                    "type": "string",
                    "description": "A brief, friendly summary of what was changed (shown to the user before they accept/reject).",
                },
            },
            "required": ["suggested_latex", "explanation"],
        },
    },
}


# ── Main chat function ─────────────────────────────────────────────────────────
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

async def ai_chat(
    latex: str,
    prompt: str,
    images: list[str] | None = None,
    history: list[dict] | None = None,
    use_knowledge_base: bool = True,
    model: str = "gpt-4o",
) -> dict:
    """
    Returns a dict:
      {"type": "message", "message": str, "suggested_latex": None}
      {"type": "edit",    "message": str, "suggested_latex": str}
    """
    # Build the current user message content
    text_part = (
        f"Here is my current resume (LaTeX source):\n\n```latex\n{latex}\n```\n\n"
        f"{prompt}"
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

    # o-series models don't support temperature or tool_choice="auto"
    _model = model if model in SUPPORTED_MODELS else "gpt-4o"
    create_kwargs: dict = dict(model=_model, messages=messages, tools=[_EDIT_TOOL])
    if not _model.startswith("o"):
        create_kwargs["temperature"] = 0.3
        create_kwargs["tool_choice"] = "auto"

    response = await client.chat.completions.create(**create_kwargs)

    choice = response.choices[0]
    msg = choice.message

    # ── Tool call path ──────────────────────────────────────────────────────────
    if msg.tool_calls:
        tool_call = msg.tool_calls[0]
        args = json.loads(tool_call.function.arguments)
        suggested_latex = _strip_fences(args.get("suggested_latex", ""))
        explanation = args.get("explanation", "I've made the requested changes.")
        return {
            "type": "edit",
            "message": explanation,
            "suggested_latex": suggested_latex,
        }

    # ── Plain chat path ────────────────────────────────────────────────────────
    return {
        "type": "message",
        "message": (msg.content or "").strip(),
        "suggested_latex": None,
    }


# ── Cover letter (unchanged) ───────────────────────────────────────────────────
COVER_LETTER_SYSTEM = f"""You are an expert at writing professional, tailored cover letters in LaTeX. You have deep knowledge of the candidate described below.

Generate a complete, compilable LaTeX document for a cover letter that:
- Speaks specifically to the role and company provided
- Highlights the candidate's most relevant experiences and skills from the knowledge base
- Uses concrete details, metrics, and project names — never generic filler
- Sounds natural and confident, not stiff or over-formatted

Use a clean, professional LaTeX letter class or article class. Return ONLY the raw LaTeX source — no explanations, no markdown code fences, no extra text.{_KNOWLEDGE_BLOCK}"""


def _strip_fences(text: str) -> str:
    if text.startswith("```"):
        lines = text.splitlines()
        end = -1 if lines[-1].strip() == "```" else len(lines)
        return "\n".join(lines[1:end])
    return text


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
