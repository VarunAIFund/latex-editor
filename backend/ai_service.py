"""OpenAI-powered LaTeX editing and cover letter generation."""
import os
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

EDIT_SYSTEM = """You are a LaTeX resume editor. The user will give you a LaTeX resume source and a plain-English instruction describing what to change.

Return ONLY the complete updated LaTeX source — no explanations, no markdown code fences, no extra text. Preserve all formatting and commands that weren't asked to be changed. Make surgical, minimal changes to fulfill the instruction."""

COVER_LETTER_SYSTEM = """You are an expert at writing professional cover letters in LaTeX. Generate a complete, compilable LaTeX document for a cover letter based on the candidate's resume and the job description provided.

Use a clean, professional LaTeX letter class or article class. Return ONLY the raw LaTeX source — no explanations, no markdown code fences, no extra text."""


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
