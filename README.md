# LaTeX Resume Editor

A full-stack AI-powered LaTeX resume editor. Write and compile LaTeX resumes directly in the browser, get GPT-4o suggestions tailored to specific job applications, generate cover letters, and manage multiple resume projects — all in one place.

## Features

- **Live LaTeX editor** — Monaco-based editor with real-time PDF preview
- **AI chat assistant** — Conversational GPT-4o assistant that edits your resume or cover letter on request, grounded in a personal knowledge base
- **Cover letter generation** — Generate and edit a matching `cover_letter.tex` per job application
- **Multi-project management** — Save and switch between separate resume versions (e.g. one per company)
- **Diff view** — See exactly what the AI changed before accepting edits
- **Margin controls** — Fine-tune page margins without touching LaTeX directly
- **Image context** — Paste job posting screenshots to give the AI additional context
- **One-page enforcement** — AI is instructed to keep the resume to exactly one page

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Editor | Monaco Editor (`@monaco-editor/react`) |
| PDF Preview | `pdfjs-dist`, `react-pdf` |
| Backend | FastAPI, Uvicorn, Python |
| AI | OpenAI API (`gpt-4o`, `gpt-4o-mini`), function calling |
| PDF Compilation | LaTeX (system `pdflatex`) via `compiler.py` |
| Data | File-based storage (`store.py`, `chat_store.py`) |

## Project Structure

```
latex_editor/
├── backend/
│   ├── main.py             # FastAPI app and route definitions
│   ├── ai_service.py       # OpenAI function-calling logic
│   ├── compiler.py         # Calls pdflatex and returns base64 PDF
│   ├── store.py            # Resume project persistence
│   ├── chat_store.py       # Per-project chat history persistence
│   ├── KNOWLEDGE.md        # Candidate knowledge base (used by AI)
│   ├── resumes/            # Saved resume projects (one folder each)
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx
    │   ├── api.ts           # All fetch calls to the backend
    │   └── components/
    │       ├── AIPanel.tsx          # Chat + AI edit panel
    │       ├── LatexEditor.tsx      # Monaco editor wrapper
    │       ├── PdfPreview.tsx       # Live PDF renderer
    │       ├── ResumeSidebar.tsx    # Project list + switcher
    │       ├── CoverLetterModal.tsx # Cover letter viewer/editor
    │       ├── MarginsPanel.tsx     # Margin adjustment UI
    │       └── NewJobModal.tsx      # New project creation modal
    └── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- A working `pdflatex` installation (e.g. [TeX Live](https://www.tug.org/texlive/) or [MiKTeX](https://miktex.org/))
- An OpenAI API key

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```
OPENAI_API_KEY=sk-...
```

Start the server:

```bash
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs at [http://localhost:5173](http://localhost:5173) and proxies API calls to the backend at port 8000.

## Knowledge Base

`backend/KNOWLEDGE.md` is a plain-text file with detailed context about the candidate — work history, skills, projects, and writing notes. When the AI assistant is active, this document is injected into the system prompt so edits and cover letters are grounded in accurate personal details rather than inferred from the LaTeX alone.

To customize for your own use, replace the contents of `KNOWLEDGE.md` with your own background.

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/compile` | Compile LaTeX string → base64 PDF |
| `POST` | `/ai-edit` | Run AI chat turn (may return resume/cover letter edits) |
| `GET` | `/resumes` | List all saved resume projects |
| `GET` | `/resumes/{name}` | Load a project's LaTeX and cover letter |
| `POST` | `/resumes/{name}` | Save a project |
| `DELETE` | `/resumes/{name}` | Delete a project |
| `GET` | `/chat/{name}` | Load chat history for a project |
| `POST` | `/chat/{name}` | Append a message to chat history |
| `DELETE` | `/chat/{name}` | Clear chat history for a project |
