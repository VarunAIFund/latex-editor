import { useState, useRef, useCallback, useEffect } from "react";
import {
  Sparkles,
  Loader2,
  Send,
  Paperclip,
  X,
  FileImage,
  Database,
  Check,
  XCircle,
  GitCompare,
  Plus,
  Trash2,
  MessageSquare,
  Mail,
} from "lucide-react";
import { aiEdit, listModels, listChatThreads, getChatThread, saveChatThread, deleteChatThread } from "../api";
import type { ChatThreadSummary } from "../api";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// ── Types ──────────────────────────────────────────────────────────────────────

export type PendingEdit = {
  suggestedLatex: string;
  explanation: string;
};

export type ChatMessage =
  | { role: "user"; text: string; images?: string[] }
  | {
      role: "assistant";
      text: string;
      /** Pending resume.tex edit */
      pendingEdit?: PendingEdit;
      editAccepted?: boolean | null;
      /** Pending cover_letter.tex edit */
      pendingCLEdit?: PendingEdit;
      clEditAccepted?: boolean | null;
    };

interface Props {
  resumeLatex: string;
  coverLetterLatex: string;
  pdfBase64: string | null;
  projectName: string | null;
  onSuggestion: (target: "resume" | "cover_letter", original: string, suggested: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const YES_PHRASES = new Set([
  "yes", "y", "yep", "yeah", "yup", "sure", "ok", "okay",
  "apply", "apply it", "do it", "looks good", "go ahead", "accept",
]);

function generateId(): string { return crypto.randomUUID(); }
function nowIso(): string { return new Date().toISOString(); }

function threadTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  return first.text.slice(0, 45) + (first.text.length > 45 ? "…" : "");
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function renderAllPdfPagesToPng(base64: string): Promise<string[]> {
  const dataUrl = `data:application/pdf;base64,${base64}`;
  const response = await fetch(dataUrl);
  const arrayBuffer = await response.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const results: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    results.push(canvas.toDataURL("image/png"));
  }
  return results;
}

// ── Pending edit card ──────────────────────────────────────────────────────────

function EditCard({
  target,
  accepted,
  onAccept,
  onReject,
}: {
  target: "resume" | "cover_letter";
  accepted: boolean | null | undefined;
  onAccept: () => void;
  onReject: () => void;
}) {
  const isCL = target === "cover_letter";
  return (
    <div className={`rounded-xl border text-xs overflow-hidden ${
      accepted === true
        ? "border-green-700/50 bg-green-950/30"
        : accepted === false
        ? "border-gray-700 bg-gray-800/40 opacity-60"
        : isCL
        ? "border-purple-600/50 bg-purple-950/30"
        : "border-indigo-600/50 bg-indigo-950/40"
    }`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        {isCL
          ? <Mail size={12} className={accepted === true ? "text-green-400" : "text-purple-400"} />
          : <GitCompare size={12} className={accepted === true ? "text-green-400" : "text-indigo-400"} />
        }
        <span className={`font-medium ${
          accepted === true ? "text-green-300" : isCL ? "text-purple-300" : "text-indigo-300"
        }`}>
          {accepted === true
            ? `${isCL ? "Cover letter" : "Resume"} changes applied`
            : accepted === false
            ? "Changes rejected"
            : `Proposed ${isCL ? "cover_letter.tex" : "resume.tex"} changes — review in editor`}
        </span>
      </div>
      {accepted === null && (
        <div className="flex gap-2 px-3 py-2">
          <button
            onClick={onAccept}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white font-medium transition-colors ${
              isCL ? "bg-purple-700 hover:bg-purple-600" : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            <Check size={11} /> Accept
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors"
          >
            <XCircle size={11} /> Reject
          </button>
          <span className="ml-auto self-center text-gray-500 italic">or type "yes"</span>
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AIPanel({ resumeLatex, coverLetterLatex, pdfBase64, projectName, onSuggestion }: Props) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [activeCreatedAt, setActiveCreatedAt] = useState<string>("");
  const [threadsLoading, setThreadsLoading] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(true);
  const [model, setModel] = useState("gpt-4o");
  const [availableModels, setAvailableModels] = useState<string[]>([
    "gpt-5", "gpt-5-mini", "gpt-5-thinking", "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "o3-mini",
  ]);
  const [pdfAttaching, setPdfAttaching] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeProjectRef = useRef(projectName);

  // ── Load available models ─────────────────────────────────────────────────────
  useEffect(() => {
    listModels().then((models) => { if (models.length) setAvailableModels(models); });
  }, []);

  // ── Reload threads when project changes ───────────────────────────────────────
  useEffect(() => {
    activeProjectRef.current = projectName;
    setLoading(false);
    setError(null);
    setActiveThreadId(null);
    setChatHistory([]);
    setThreads([]);

    if (!projectName) return;
    setThreadsLoading(true);
    listChatThreads(projectName).then((list) => {
      setThreads(list);
      setThreadsLoading(false);
    });
  }, [projectName]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  // ── Thread actions ────────────────────────────────────────────────────────────
  const startNewThread = () => {
    const id = generateId();
    const now = nowIso();
    setActiveThreadId(id);
    setActiveCreatedAt(now);
    setChatHistory([]);
    setError(null);
    setThreads((prev) => [{ id, title: "New chat", created_at: now, message_count: 0 }, ...prev]);
  };

  const selectThread = async (threadId: string) => {
    if (!projectName || threadId === activeThreadId) return;
    setError(null);
    const full = await getChatThread(projectName, threadId);
    if (!full) return;
    setActiveThreadId(full.id);
    setActiveCreatedAt(full.created_at);
    setChatHistory(full.messages as ChatMessage[]);
  };

  const deleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectName) return;
    await deleteChatThread(projectName, threadId);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (activeThreadId === threadId) { setActiveThreadId(null); setChatHistory([]); }
  };

  // ── Persist thread ────────────────────────────────────────────────────────────
  const persistThread = useCallback(
    async (messages: ChatMessage[], threadId: string, createdAt: string) => {
      if (!projectName || !threadId) return;
      const title = threadTitle(messages);
      await saveChatThread(projectName, { id: threadId, title, created_at: createdAt, messages });
      setThreads((prev) =>
        prev.map((t) => t.id === threadId ? { ...t, title, message_count: messages.length } : t)
      );
    },
    [projectName]
  );

  // ── Pending edit helpers ──────────────────────────────────────────────────────
  const hasPendingEdit = (() => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (m.role === "assistant") {
        if ((m.pendingEdit && m.editAccepted === null) || (m.pendingCLEdit && m.clEditAccepted === null)) return i;
      }
    }
    return -1;
  })();

  const acceptEdit = useCallback(
    (idx: number, history: ChatMessage[], target: "resume" | "cover_letter") => {
      const msg = history[idx];
      if (msg.role !== "assistant") return history;
      if (target === "resume" && msg.pendingEdit) {
        onSuggestion("resume", resumeLatex, msg.pendingEdit.suggestedLatex);
        return history.map((m, i) =>
          i === idx && m.role === "assistant" ? { ...m, editAccepted: true } : m
        );
      }
      if (target === "cover_letter" && msg.pendingCLEdit) {
        onSuggestion("cover_letter", coverLetterLatex, msg.pendingCLEdit.suggestedLatex);
        return history.map((m, i) =>
          i === idx && m.role === "assistant" ? { ...m, clEditAccepted: true } : m
        );
      }
      return history;
    },
    [resumeLatex, coverLetterLatex, onSuggestion]
  );

  const handleAcceptEdit = (idx: number, target: "resume" | "cover_letter") => {
    const updated = acceptEdit(idx, chatHistory, target);
    setChatHistory(updated);
    if (activeThreadId) persistThread(updated, activeThreadId, activeCreatedAt);
  };

  const handleRejectEdit = (idx: number, target: "resume" | "cover_letter") => {
    const updated = chatHistory.map((m, i) => {
      if (i !== idx || m.role !== "assistant") return m;
      return target === "resume"
        ? { ...m, editAccepted: false }
        : { ...m, clEditAccepted: false };
    });
    setChatHistory(updated);
    if (activeThreadId) persistThread(updated, activeThreadId, activeCreatedAt);
  };

  // ── Image helpers ─────────────────────────────────────────────────────────────
  const addImages = useCallback(async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const urls = await Promise.all(imgs.map(readFileAsDataUrl));
    setImages((prev) => [...prev, ...urls]);
  }, []);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
      if (!items.length) return;
      e.preventDefault();
      const files = items.map((i) => i.getAsFile()).filter(Boolean) as File[];
      await addImages(files);
    },
    [addImages]
  );

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await addImages(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const attachPdf = async () => {
    if (!pdfBase64 || pdfAttaching) return;
    setPdfAttaching(true);
    try {
      const pages = await renderAllPdfPagesToPng(pdfBase64);
      setImages((prev) => [...prev, ...pages]);
    } catch {
      setError("Failed to render PDF pages");
    } finally {
      setPdfAttaching(false);
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const submit = async (p: string) => {
    const trimmed = p.trim();
    if (!trimmed || loading) return;

    let threadId = activeThreadId;
    let createdAt = activeCreatedAt;
    if (!threadId) {
      threadId = generateId();
      createdAt = nowIso();
      setActiveThreadId(threadId);
      setActiveCreatedAt(createdAt);
      setThreads((prev) => [{ id: threadId!, title: "New chat", created_at: createdAt, message_count: 0 }, ...prev]);
    }

    // "yes" shortcut — accept all pending edits
    if (hasPendingEdit >= 0 && YES_PHRASES.has(trimmed.toLowerCase())) {
      let afterAccept = chatHistory;
      const msg = chatHistory[hasPendingEdit];
      if (msg.role === "assistant") {
        if (msg.pendingEdit && msg.editAccepted === null)
          afterAccept = acceptEdit(hasPendingEdit, afterAccept, "resume");
        if (msg.pendingCLEdit && msg.clEditAccepted === null)
          afterAccept = acceptEdit(hasPendingEdit, afterAccept, "cover_letter");
      }
      const withConfirm: ChatMessage[] = [
        ...afterAccept,
        { role: "user", text: trimmed },
        { role: "assistant", text: "Done! Changes applied to the editor." },
      ];
      setChatHistory(withConfirm);
      persistThread(withConfirm, threadId, createdAt);
      setPrompt("");
      return;
    }

    setLoading(true);
    setError(null);
    const currentImages = [...images];
    const projectAtSubmit = activeProjectRef.current;
    const threadAtSubmit = threadId;

    const userMsg: ChatMessage = {
      role: "user",
      text: trimmed,
      images: currentImages.length ? currentImages : undefined,
    };
    const historyWithUser: ChatMessage[] = [...chatHistory, userMsg];
    setChatHistory(historyWithUser);
    setPrompt("");
    setImages([]);

    const historyForApi = chatHistory.flatMap<{ role: string; content: string }>((msg) => {
      if (msg.role === "user") return [{ role: "user", content: msg.text }];
      const parts: string[] = [msg.text];
      if (msg.pendingEdit) parts.push(`[Proposed resume edit: ${msg.pendingEdit.explanation}]`);
      if (msg.pendingCLEdit) parts.push(`[Proposed cover letter edit: ${msg.pendingCLEdit.explanation}]`);
      return [{ role: "assistant", content: parts.join(" ") }];
    });

    try {
      const result = await aiEdit(
        resumeLatex, coverLetterLatex, trimmed, currentImages,
        historyForApi, useKnowledgeBase, model,
      );

      if (activeProjectRef.current !== projectAtSubmit) return;

      const hasResumeEdit = (result.type === "edit" || result.type === "edit_and_cover_letter") && result.suggested_resume;
      const hasCLEdit = (result.type === "edit_cover_letter" || result.type === "edit_and_cover_letter") && result.suggested_cover_letter;

      const assistantMsg: ChatMessage = {
        role: "assistant",
        text: result.message,
        ...(hasResumeEdit ? {
          pendingEdit: { suggestedLatex: result.suggested_resume!, explanation: result.message },
          editAccepted: null,
        } : {}),
        ...(hasCLEdit ? {
          pendingCLEdit: { suggestedLatex: result.suggested_cover_letter!, explanation: result.message },
          clEditAccepted: null,
        } : {}),
      };

      const finalHistory: ChatMessage[] = [...historyWithUser, assistantMsg];
      setChatHistory(finalHistory);
      persistThread(finalHistory, threadAtSubmit, createdAt);
    } catch (e: unknown) {
      if (activeProjectRef.current === projectAtSubmit) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setChatHistory(historyWithUser);
      }
    } finally {
      if (activeProjectRef.current === projectAtSubmit) setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-900 border-t border-gray-700 flex flex-col" style={{ height: "380px" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={13} className="text-indigo-400 flex-shrink-0" />
          <span className="text-xs text-indigo-300 font-medium uppercase tracking-wider flex-shrink-0">AI Assistant</span>
          {projectName && (
            <span className="text-xs text-gray-500 truncate">
              — <span className="text-gray-300 font-medium">{projectName}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer hover:border-gray-500 transition-colors"
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={() => setUseKnowledgeBase((v) => !v)}
            title={useKnowledgeBase ? "Knowledge base ON" : "Knowledge base OFF"}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              useKnowledgeBase
                ? "bg-indigo-900/50 border-indigo-600 text-indigo-300 hover:bg-indigo-800/50"
                : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400"
            }`}
          >
            <Database size={11} />
            <span>KB</span>
            <span className={`w-2 h-2 rounded-full ${useKnowledgeBase ? "bg-indigo-400" : "bg-gray-600"}`} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Thread sidebar */}
        <div className="w-44 flex-shrink-0 border-r border-gray-800 flex flex-col min-h-0">
          <button
            onClick={startNewThread}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-indigo-300 hover:text-white hover:bg-gray-800 transition-colors border-b border-gray-800 flex-shrink-0"
          >
            <Plus size={12} /> New chat
          </button>
          <div className="flex-1 overflow-y-auto">
            {threadsLoading && (
              <div className="flex justify-center py-4">
                <Loader2 size={14} className="text-gray-500 animate-spin" />
              </div>
            )}
            {!threadsLoading && threads.length === 0 && (
              <p className="text-gray-600 text-xs px-3 py-3 text-center">No chats yet</p>
            )}
            {threads.map((t) => (
              <div
                key={t.id}
                onClick={() => selectThread(t.id)}
                className={`group flex items-start justify-between px-3 py-2 cursor-pointer transition-colors border-b border-gray-800/50 ${
                  activeThreadId === t.id
                    ? "bg-indigo-900/40 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                }`}
              >
                <div className="flex-1 min-w-0 mr-1">
                  <p className="text-xs truncate leading-tight">{t.title}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5">{formatDate(t.created_at)}</p>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => deleteThread(t.id, e)}
                  onKeyDown={(e) => e.key === "Enter" && deleteThread(t.id, e as never)}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                >
                  <Trash2 size={11} />
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {!activeThreadId && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <MessageSquare size={24} className="text-gray-700" />
                <p className="text-xs text-gray-500">Select a chat or start a new one</p>
              </div>
            )}
            {activeThreadId && chatHistory.length === 0 && !loading && (
              <p className="text-xs text-gray-500 text-center pt-4">
                Ask to tailor the resume, generate a cover letter, or both at once.
              </p>
            )}

            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center mt-0.5">
                    <Sparkles size={11} className="text-indigo-200" />
                  </div>
                )}
                <div className="max-w-[82%] space-y-2">
                  <div
                    className={`rounded-xl px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-indigo-700/60 text-white rounded-tr-sm"
                        : "bg-gray-800 text-gray-200 rounded-tl-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    {msg.role === "user" && msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.images.map((src, i) => (
                          <img key={i} src={src} alt="" className="h-12 w-12 object-cover rounded border border-white/10" />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Resume edit card */}
                  {msg.role === "assistant" && msg.pendingEdit && (
                    <EditCard
                      target="resume"
                      accepted={msg.editAccepted ?? null}
                      onAccept={() => handleAcceptEdit(idx, "resume")}
                      onReject={() => handleRejectEdit(idx, "resume")}
                    />
                  )}

                  {/* Cover letter edit card */}
                  {msg.role === "assistant" && msg.pendingCLEdit && (
                    <EditCard
                      target="cover_letter"
                      accepted={msg.clEditAccepted ?? null}
                      onAccept={() => handleAcceptEdit(idx, "cover_letter")}
                      onReject={() => handleRejectEdit(idx, "cover_letter")}
                    />
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center">
                  <Sparkles size={11} className="text-indigo-200" />
                </div>
                <div className="bg-gray-800 rounded-xl rounded-tl-sm px-3 py-2 flex items-center gap-2">
                  <Loader2 size={13} className="text-indigo-400 animate-spin" />
                  <span className="text-xs text-gray-400">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Staged images */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 py-1 border-t border-gray-800 flex-shrink-0">
              {images.map((src, idx) => (
                <div key={idx} className="relative group">
                  <img src={src} alt="" className="h-12 w-12 object-cover rounded-lg border border-gray-700" />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1.5 -right-1.5 bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="flex gap-2 items-end px-4 py-2 border-t border-gray-800 flex-shrink-0">
            <button onClick={() => fileRef.current?.click()} disabled={loading} title="Attach image"
              className="flex-shrink-0 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">
              <Paperclip size={14} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />

            <button onClick={attachPdf} disabled={loading || pdfAttaching || !pdfBase64}
              title="Attach all PDF pages as images"
              className="flex-shrink-0 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {pdfAttaching ? <Loader2 size={14} className="animate-spin" /> : <FileImage size={14} />}
            </button>

            <textarea
              rows={2}
              placeholder={
                !activeThreadId
                  ? "Start a new chat to begin…"
                  : hasPendingEdit >= 0
                  ? 'Type "yes" to apply, or keep chatting…'
                  : "Ask anything, request edits, or ask for a cover letter… Enter ↵ to send"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(prompt); }
              }}
              onPaste={handlePaste}
              disabled={loading}
              className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none placeholder-gray-500 disabled:opacity-50 resize-none"
            />

            <button onClick={() => submit(prompt)}
              disabled={loading || (!prompt.trim() && !images.length)}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-sm font-medium transition-colors disabled:cursor-not-allowed">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {error && <p className="text-red-400 text-xs px-4 pb-2 flex-shrink-0">Error: {error}</p>}
        </div>
      </div>
    </div>
  );
}
