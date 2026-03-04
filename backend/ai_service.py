"""OpenAI-powered LaTeX editing and cover letter generation."""
import os
from pathlib import Path
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# Load the candidate knowledge base once at import time
_KNOWLEDGE_PATH = Path(__file__).parent / "KNOWLEDGE.md"
CANDIDATE_KNOWLEDGE: str = (
    _KNOWLEDGE_PATH.read_text(encoding="utf-8") if _KNOWLEDGE_PATH.exists() else ""
)

_KNOWLEDGE_BLOCK = (
    f"\n\n---\n## Candidate Knowledge Base\n\n{CANDIDATE_KNOWLEDGE}\n---\n"
    if CANDIDATE_KNOWLEDGE
    else ""
)

EDIT_SYSTEM = f"""You are a LaTeX resume editor with deep knowledge of the candidate described below. The user will give you a LaTeX resume source and a plain-English instruction describing what to change.

Return ONLY the complete updated LaTeX source — no explanations, no markdown code fences, no extra text. Preserve all formatting and commands that weren't asked to be changed. Make surgical, minimal changes to fulfill the instruction.

When the instruction asks you to add, expand, or rewrite content, draw on the detailed candidate knowledge base below for accurate facts, metrics, and context.{_KNOWLEDGE_BLOCK}"""

COVER_LETTER_SYSTEM = f"""You are an expert at writing professional, tailored cover letters in LaTeX. You have deep knowledge of the candidate described below.

Generate a complete, compilable LaTeX document for a cover letter that:
- Speaks specifically to the role and company provided
- Highlights the candidate's most relevant experiences and skills from the knowledge base
- Uses concrete details, metrics, and project names — never generic filler
- Sounds natural and confident, not stiff or over-formatted

Use a clean, professional LaTeX letter class or article class. Return ONLY the raw LaTeX source — no explanations, no markdown code fences, no extra text.{_KNOWLEDGE_BLOCK}"""


async def ai_edit_latex(latex: str, prompt: str) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": EDIT_SYSTEM},
            {
                "role": "user",
                "content": f"Here is the current LaTeX resume:\n\n{latex}\n\nInstruction: {prompt}",
            },
        ],
        temperature=0.2,
    )
    result = response.choices[0].message.content.strip()
    # Strip markdown fences if the model adds them anyway
    if result.startswith("```"):
        lines = result.splitlines()
        result = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return result


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
    result = response.choices[0].message.content.strip()
    if result.startswith("```"):
        lines = result.splitlines()
        result = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return result
