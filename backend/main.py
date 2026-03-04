"""FastAPI backend for the LaTeX Resume Tailoring App."""
from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import store
import compiler
import ai_service

app = FastAPI(title="LaTeX Resume Tailoring API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Models ───────────────────────────────────────────────────────────────────

class CompileRequest(BaseModel):
    latex: str

class CompileResponse(BaseModel):
    pdf_base64: str | None = None
    error: str | None = None

class AIEditRequest(BaseModel):
    latex: str
    prompt: str
    images: list[str] = []          # data URLs: "data:image/png;base64,..."
    history: list[dict] = []        # prior OpenAI message dicts
    use_knowledge_base: bool = True

class AIEditResponse(BaseModel):
    type: str                          # "message" | "edit"
    message: str                       # assistant's reply text
    suggested_latex: str | None = None # only when type == "edit"

class CoverLetterRequest(BaseModel):
    resume_latex: str
    job_title: str
    company_name: str
    company_description: str

class CoverLetterResponse(BaseModel):
    cover_letter_pdf_base64: str | None = None
    cover_letter_latex: str | None = None
    error: str | None = None

class SaveResumeRequest(BaseModel):
    latex: str

class ResumeListResponse(BaseModel):
    names: list[str]

class ResumeResponse(BaseModel):
    name: str
    latex: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.post("/compile", response_model=CompileResponse)
async def compile_route(req: CompileRequest):
    pdf_b64, error = compiler.compile_latex(req.latex)
    return CompileResponse(pdf_base64=pdf_b64, error=error)


@app.post("/ai/edit", response_model=AIEditResponse)
async def ai_edit_route(req: AIEditRequest):
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set")
    result = await ai_service.ai_chat(
        req.latex, req.prompt, req.images, req.history, req.use_knowledge_base
    )
    return AIEditResponse(**result)


@app.post("/ai/cover-letter", response_model=CoverLetterResponse)
async def cover_letter_route(req: CoverLetterRequest):
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set")
    latex = await ai_service.ai_generate_cover_letter(
        req.resume_latex, req.job_title, req.company_name, req.company_description
    )
    pdf_b64, error = compiler.compile_latex(latex)
    return CoverLetterResponse(
        cover_letter_pdf_base64=pdf_b64,
        cover_letter_latex=latex,
        error=error,
    )


@app.get("/resumes", response_model=ResumeListResponse)
async def list_resumes_route():
    return ResumeListResponse(names=store.list_resumes())


@app.get("/resumes/{name}", response_model=ResumeResponse)
async def get_resume_route(name: str):
    latex = store.get_resume(name)
    if latex is None:
        raise HTTPException(status_code=404, detail=f"Resume '{name}' not found")
    return ResumeResponse(name=name, latex=latex)


@app.post("/resumes/{name}", response_model=ResumeResponse)
async def save_resume_route(name: str, req: SaveResumeRequest):
    store.save_resume(name, req.latex)
    return ResumeResponse(name=name, latex=req.latex)


@app.delete("/resumes/{name}")
async def delete_resume_route(name: str):
    ok = store.delete_resume(name)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Resume '{name}' not found")
    return {"deleted": name}
