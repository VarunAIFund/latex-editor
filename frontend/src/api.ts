const BASE = "http://localhost:8000";

export interface CompileResult {
  pdf_base64: string | null;
  error: string | null;
}

export interface AIEditResult {
  type: "message" | "edit";
  message: string;
  suggested_latex: string | null;
}

export interface CoverLetterResult {
  cover_letter_pdf_base64: string | null;
  cover_letter_latex: string | null;
  error: string | null;
}

export async function compileLatex(latex: string): Promise<CompileResult> {
  const res = await fetch(`${BASE}/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latex }),
  });
  return res.json();
}

export async function aiEdit(
  latex: string,
  prompt: string,
  images: string[] = [],
  history: { role: string; content: string }[] = [],
  useKnowledgeBase: boolean = true,
): Promise<AIEditResult> {
  const res = await fetch(`${BASE}/ai/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latex, prompt, images, history, use_knowledge_base: useKnowledgeBase }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "AI edit failed");
  }
  return res.json();
}

export async function generateCoverLetter(
  resume_latex: string,
  job_title: string,
  company_name: string,
  company_description: string
): Promise<CoverLetterResult> {
  const res = await fetch(`${BASE}/ai/cover-letter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume_latex, job_title, company_name, company_description }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Cover letter generation failed");
  }
  return res.json();
}

export async function listResumes(): Promise<string[]> {
  const res = await fetch(`${BASE}/resumes`);
  const data = await res.json();
  return data.names;
}

export async function loadResume(name: string): Promise<string> {
  const res = await fetch(`${BASE}/resumes/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Resume '${name}' not found`);
  const data = await res.json();
  return data.latex;
}

export async function saveResume(name: string, latex: string): Promise<void> {
  await fetch(`${BASE}/resumes/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latex }),
  });
}

export async function renameResume(oldName: string, newName: string): Promise<void> {
  const res = await fetch(`${BASE}/resumes/${encodeURIComponent(oldName)}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Rename failed");
  }
}

export async function deleteResume(name: string): Promise<void> {
  await fetch(`${BASE}/resumes/${encodeURIComponent(name)}`, { method: "DELETE" });
}
