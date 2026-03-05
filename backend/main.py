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
import chat_store

app = FastAPI(title="LaTeX Resume Tailoring API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Pydantic models ───────────────────────────────────────────────────────────

class CompileRequest(BaseModel):
    latex: str

class CompileResponse(BaseModel):
    pdf_base64: str | None = None
    error: str | None = None

class AIEditRequest(BaseModel):
    resume_latex: str
    cover_letter_latex: str = ""
    prompt: str
    images: list[str] = []
    history: list[dict] = []
    use_knowledge_base: bool = True
    model: str = "gpt-4o"

class AIEditResponse(BaseModel):
    # type: "message" | "edit" | "edit_cover_letter" | "edit_and_cover_letter"
    type: str
    message: str
    suggested_resume: str | None = None
    suggested_cover_letter: str | None = None
    cover_letter_pdf_base64: str | None = None  # compiled cover letter preview

class CoverLetterRequest(BaseModel):
    resume_latex: str
    job_title: str
    company_name: str
    company_description: str

class CoverLetterResponse(BaseModel):
    cover_letter_pdf_base64: str | None = None
    cover_letter_latex: str | None = None
    error: str | None = None

class SaveFileRequest(BaseModel):
    content: str

class CreateProjectRequest(BaseModel):
    name: str
    resume: str = ""   # optional seed content

class RenameRequest(BaseModel):
    new_name: str

class ChatThread(BaseModel):
    id: str
    title: str
    created_at: str
    messages: list[dict] = []

class UpsertThreadRequest(BaseModel):
    title: str
    created_at: str
    messages: list[dict] = []

class ProjectListResponse(BaseModel):
    names: list[str]

class ProjectResponse(BaseModel):
    name: str
    resume: str
    cover_letter: str


# ─── Utility routes ────────────────────────────────────────────────────────────

@app.get("/models")
async def list_models():
    return {"models": ai_service.SUPPORTED_MODELS}


@app.post("/compile", response_model=CompileResponse)
async def compile_route(req: CompileRequest):
    pdf_b64, error = compiler.compile_latex(req.latex)
    return CompileResponse(pdf_base64=pdf_b64, error=error)


# ─── AI routes ─────────────────────────────────────────────────────────────────

@app.post("/ai/edit", response_model=AIEditResponse)
async def ai_edit_route(req: AIEditRequest):
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set")
    result = await ai_service.ai_chat(
        resume_latex=req.resume_latex,
        cover_letter_latex=req.cover_letter_latex,
        prompt=req.prompt,
        images=req.images,
        history=req.history,
        use_knowledge_base=req.use_knowledge_base,
        model=req.model,
    )
    # Compile cover letter preview when one was produced
    cl_pdf: str | None = None
    if result.get("suggested_cover_letter"):
        cl_pdf_b64, _ = compiler.compile_latex(result["suggested_cover_letter"])
        cl_pdf = cl_pdf_b64
    return AIEditResponse(
        type=result["type"],
        message=result["message"],
        suggested_resume=result.get("suggested_resume"),
        suggested_cover_letter=result.get("suggested_cover_letter"),
        cover_letter_pdf_base64=cl_pdf,
    )


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


# ─── Project routes ────────────────────────────────────────────────────────────

@app.get("/projects", response_model=ProjectListResponse)
async def list_projects_route():
    return ProjectListResponse(names=store.list_projects())


@app.get("/projects/{name}", response_model=ProjectResponse)
async def get_project_route(name: str):
    names = store.list_projects()
    if name not in names:
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    data = store.load_project(name)
    return ProjectResponse(name=name, resume=data["resume"], cover_letter=data["cover_letter"])


@app.post("/projects", response_model=ProjectResponse)
async def create_project_route(req: CreateProjectRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    store.create_project(name, resume=req.resume or store.BLANK_RESUME)
    data = store.load_project(name)
    return ProjectResponse(name=name, resume=data["resume"], cover_letter=data["cover_letter"])


@app.post("/projects/{name}/resume", response_model=ProjectResponse)
async def save_resume_route(name: str, req: SaveFileRequest):
    store.save_file(name, "resume", req.content)
    data = store.load_project(name)
    return ProjectResponse(name=name, resume=data["resume"], cover_letter=data["cover_letter"])


@app.post("/projects/{name}/cover_letter", response_model=ProjectResponse)
async def save_cover_letter_route(name: str, req: SaveFileRequest):
    store.save_file(name, "cover_letter", req.content)
    data = store.load_project(name)
    return ProjectResponse(name=name, resume=data["resume"], cover_letter=data["cover_letter"])


@app.post("/projects/{name}/rename")
async def rename_project_route(name: str, req: RenameRequest):
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="New name cannot be empty")
    ok = store.rename_project(name, new_name)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot rename '{name}' to '{new_name}' (not found or name taken)",
        )
    chat_store.rename_resume(name, new_name)
    return {"old_name": name, "new_name": new_name}


@app.delete("/projects/{name}")
async def delete_project_route(name: str):
    ok = store.delete_project(name)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    chat_store.delete_resume(name)
    return {"deleted": name}


# ─── Chat thread routes ────────────────────────────────────────────────────────

@app.get("/chats/{project}")
async def list_threads_route(project: str):
    return chat_store.get_threads(project)


@app.get("/chats/{project}/{thread_id}")
async def get_thread_route(project: str, thread_id: str):
    thread = chat_store.get_thread(project, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@app.post("/chats/{project}/{thread_id}")
async def upsert_thread_route(project: str, thread_id: str, req: UpsertThreadRequest):
    thread = {"id": thread_id, "title": req.title, "created_at": req.created_at, "messages": req.messages}
    chat_store.upsert_thread(project, thread)
    return thread


@app.delete("/chats/{project}/{thread_id}")
async def delete_thread_route(project: str, thread_id: str):
    ok = chat_store.delete_thread(project, thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"deleted": thread_id}
