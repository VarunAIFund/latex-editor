const BASE = "http://localhost:8000";

// ── Compile ───────────────────────────────────────────────────────────────────

export interface CompileResult {
  pdf_base64: string | null;
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

// ── Models ────────────────────────────────────────────────────────────────────

export async function listModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) return ["gpt-4o", "gpt-4o-mini"];
  const data = await res.json();
  return data.models as string[];
}

// ── AI edit ───────────────────────────────────────────────────────────────────

export interface AIEditResult {
  /** "message" | "edit" | "edit_cover_letter" | "edit_and_cover_letter" */
  type: string;
  message: string;
  suggested_resume: string | null;
  suggested_cover_letter: string | null;
  cover_letter_pdf_base64: string | null;
}

export async function aiEdit(
  resumeLatex: string,
  coverLetterLatex: string,
  prompt: string,
  images: string[] = [],
  history: { role: string; content: string }[] = [],
  useKnowledgeBase: boolean = true,
  model: string = "gpt-4o",
): Promise<AIEditResult> {
  const res = await fetch(`${BASE}/ai/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume_latex: resumeLatex,
      cover_letter_latex: coverLetterLatex,
      prompt,
      images,
      history,
      use_knowledge_base: useKnowledgeBase,
      model,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "AI edit failed");
  }
  return res.json();
}

// ── Cover letter (modal) ──────────────────────────────────────────────────────

export interface CoverLetterResult {
  cover_letter_pdf_base64: string | null;
  cover_letter_latex: string | null;
  error: string | null;
}

export async function generateCoverLetter(
  resume_latex: string,
  job_title: string,
  company_name: string,
  company_description: string,
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

// ── Projects ──────────────────────────────────────────────────────────────────

export interface ProjectData {
  name: string;
  resume: string;
  cover_letter: string;
}

export async function listProjects(): Promise<string[]> {
  const res = await fetch(`${BASE}/projects`);
  const data = await res.json();
  return data.names as string[];
}

export async function loadProject(name: string): Promise<ProjectData> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Project '${name}' not found`);
  return res.json();
}

export async function createProject(name: string, resume?: string): Promise<ProjectData> {
  const res = await fetch(`${BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, resume: resume ?? "" }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create project");
  }
  return res.json();
}

export async function saveResume(name: string, content: string): Promise<void> {
  await fetch(`${BASE}/projects/${encodeURIComponent(name)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function saveCoverLetter(name: string, content: string): Promise<void> {
  await fetch(`${BASE}/projects/${encodeURIComponent(name)}/cover_letter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function renameResume(oldName: string, newName: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(oldName)}/rename`, {
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
  await fetch(`${BASE}/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ── Chat threads ──────────────────────────────────────────────────────────────

export interface ChatThreadSummary {
  id: string;
  title: string;
  created_at: string;
  message_count: number;
}

export interface ChatThreadFull {
  id: string;
  title: string;
  created_at: string;
  messages: import("./components/AIPanel").ChatMessage[];
}

export async function listChatThreads(project: string): Promise<ChatThreadSummary[]> {
  const res = await fetch(`${BASE}/chats/${encodeURIComponent(project)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getChatThread(project: string, threadId: string): Promise<ChatThreadFull | null> {
  const res = await fetch(`${BASE}/chats/${encodeURIComponent(project)}/${encodeURIComponent(threadId)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function saveChatThread(
  project: string,
  thread: { id: string; title: string; created_at: string; messages: unknown[] },
): Promise<void> {
  await fetch(`${BASE}/chats/${encodeURIComponent(project)}/${encodeURIComponent(thread.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: thread.title, created_at: thread.created_at, messages: thread.messages }),
  });
}

export async function deleteChatThread(project: string, threadId: string): Promise<void> {
  await fetch(`${BASE}/chats/${encodeURIComponent(project)}/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
}
