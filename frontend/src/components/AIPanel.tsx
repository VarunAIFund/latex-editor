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
  | { role: "assistant"; text: string; pendingEdit?: PendingEdit; editAccepted?: boolean | null };

interface Props {
  latex: string;
  pdfBase64: string | null;
  resumeName: string | null;
  onSuggestion: (original: string, suggested: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const YES_PHRASES = new Set([
  "yes", "y", "yep", "yeah", "yup", "sure", "ok", "okay",
  "apply", "apply it", "do it", "looks good", "go ahead", "accept",
]);

function generateId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

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

// ── Component ──────────────────────────────────────────────────────────────────

export default function AIPanel({ latex, pdfBase64, resumeName, onSuggestion }: Props) {
  // Thread list
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [activeCreatedAt, setActiveCreatedAt] = useState<string>("");
  const [threadsLoading, setThreadsLoading] = useState(false);

  // Input state
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
  const activeResumeRef = useRef(resumeName);

  // ── Load available models once on mount ──────────────────────────────────────
  useEffect(() => {
    listModels().then((models) => {
      if (models.length) setAvailableModels(models);
    });
  }, []);

  // ── Load thread list when resume changes ─────────────────────────────────────
  useEffect(() => {
    activeResumeRef.current = resumeName;
    setLoading(false);
    setError(null);
    setActiveThreadId(null);
    setChatHistory([]);
    setThreads([]);

    if (!resumeName) return;
    setThreadsLoading(true);
    listChatThreads(resumeName).then((list) => {
      setThreads(list);
      setThreadsLoading(false);
    });
  }, [resumeName]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────────
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
    // Optimistically add to sidebar
    setThreads((prev) => [
      { id, title: "New chat", created_at: now, message_count: 0 },
      ...prev,
    ]);
  };

  const selectThread = async (threadId: string) => {
    if (!resumeName || threadId === activeThreadId) return;
    setError(null);
    const full = await getChatThread(resumeName, threadId);
    if (!full) return;
    setActiveThreadId(full.id);
    setActiveCreatedAt(full.created_at);
    setChatHistory(full.messages as ChatMessage[]);
  };

  const deleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!resumeName) return;
    await deleteChatThread(resumeName, threadId);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setChatHistory([]);
    }
  };

  // ── Persist current thread ────────────────────────────────────────────────────
  const persistThread = useCallback(
    async (messages: ChatMessage[], threadId: string, createdAt: string) => {
      if (!resumeName || !threadId) return;
      const title = threadTitle(messages);
      await saveChatThread(resumeName, { id: threadId, title, created_at: createdAt, messages });
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? { ...t, title, message_count: messages.length }
            : t
        )
      );
    },
    [resumeName]
  );

  // ── Pending edit helpers ──────────────────────────────────────────────────────
  const pendingEditIndex = (() => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (m.role === "assistant" && m.pendingEdit && m.editAccepted === null) return i;
    }
    return -1;
  })();

  const acceptEdit = useCallback(
    (idx: number, history: ChatMessage[]) => {
      const msg = history[idx];
      if (msg.role !== "assistant" || !msg.pendingEdit) return history;
      onSuggestion(latex, msg.pendingEdit.suggestedLatex);
      return history.map((m, i) =>
        i === idx && m.role === "assistant" ? { ...m, editAccepted: true } : m
      );
    },
    [latex, onSuggestion]
  );

  const handleAcceptEdit = (idx: number) => {
    const updated = acceptEdit(idx, chatHistory);
    setChatHistory(updated);
    if (activeThreadId) persistThread(updated, activeThreadId, activeCreatedAt);
  };

  const handleRejectEdit = (idx: number) => {
    const updated = chatHistory.map((m, i) =>
      i === idx && m.role === "assistant" ? { ...m, editAccepted: false } : m
    );
    setChatHistory(updated);
    if (activeThreadId) persistThread(updated, activeThreadId, activeCreatedAt);
  };

  // ── Image helpers ─────────────────────────────────────────────────────────────
  const addImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const dataUrls = await Promise.all(imageFiles.map(readFileAsDataUrl));
    setImages((prev) => [...prev, ...dataUrls]);
  }, []);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((i) => i.type.startsWith("image/"));
      if (!imageItems.length) return;
      e.preventDefault();
      const files = imageItems.map((i) => i.getAsFile()).filter(Boolean) as File[];
      await addImages(files);
    },
    [addImages]
  );

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    await addImages(files);
    e.target.value = "";
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
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

    // Ensure there's an active thread
    let threadId = activeThreadId;
    let createdAt = activeCreatedAt;
    if (!threadId) {
      threadId = generateId();
      createdAt = nowIso();
      setActiveThreadId(threadId);
      setActiveCreatedAt(createdAt);
      setThreads((prev) => [
        { id: threadId!, title: "New chat", created_at: createdAt, message_count: 0 },
        ...prev,
      ]);
    }

    // "yes" shortcut — accept pending edit
    if (pendingEditIndex >= 0 && YES_PHRASES.has(trimmed.toLowerCase())) {
      const afterAccept = acceptEdit(pendingEditIndex, chatHistory);
      const withConfirm: ChatMessage[] = [
        ...afterAccept,
        { role: "user", text: trimmed },
        { role: "assistant", text: "Done! The changes have been applied to the editor." },
      ];
      setChatHistory(withConfirm);
      persistThread(withConfirm, threadId, createdAt);
      setPrompt("");
      return;
    }

    setLoading(true);
    setError(null);
    const currentImages = [...images];
    const resumeAtSubmit = activeResumeRef.current;
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
      const content = msg.pendingEdit
        ? `${msg.text} [Proposed edit: ${msg.pendingEdit.explanation}]`
        : msg.text;
      return [{ role: "assistant", content }];
    });

    try {
      const result = await aiEdit(latex, trimmed, currentImages, historyForApi, useKnowledgeBase, model);

      if (activeResumeRef.current !== resumeAtSubmit) return;

      let finalHistory: ChatMessage[];
      if (result.type === "edit" && result.suggested_latex) {
        finalHistory = [
          ...historyWithUser,
          {
            role: "assistant",
            text: result.message,
            pendingEdit: { suggestedLatex: result.suggested_latex!, explanation: result.message },
            editAccepted: null,
          },
        ];
      } else {
        finalHistory = [
          ...historyWithUser,
          { role: "assistant", text: result.message },
        ];
      }
      setChatHistory(finalHistory);
      persistThread(finalHistory, threadAtSubmit, createdAt);
    } catch (e: unknown) {
      if (activeResumeRef.current === resumeAtSubmit) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setChatHistory(chatHistory);
      }
    } finally {
      if (activeResumeRef.current === resumeAtSubmit) {
        setLoading(false);
      }
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
          {resumeName && (
            <span className="text-xs text-gray-500 truncate">
              — editing <span className="text-gray-300 font-medium">{resumeName}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Model selector */}
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer hover:border-gray-500 transition-colors"
            title="Select model"
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* KB toggle */}
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

      {/* Body: thread list + chat */}
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
                  title="Delete chat"
                >
                  <Trash2 size={11} />
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {!activeThreadId && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <MessageSquare size={24} className="text-gray-700" />
                <p className="text-xs text-gray-500">
                  Select a chat or start a new one
                </p>
              </div>
            )}

            {activeThreadId && chatHistory.length === 0 && !loading && (
              <p className="text-xs text-gray-500 text-center pt-4">
                Chat with your resume assistant. Ask questions, request edits, or attach the PDF to inspect styling.
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

                  {/* Pending edit card */}
                  {msg.role === "assistant" && msg.pendingEdit && (
                    <div
                      className={`rounded-xl border text-xs overflow-hidden ${
                        msg.editAccepted === true
                          ? "border-green-700/50 bg-green-950/30"
                          : msg.editAccepted === false
                          ? "border-gray-700 bg-gray-800/40 opacity-60"
                          : "border-indigo-600/50 bg-indigo-950/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-current/10">
                        <GitCompare size={12} className={msg.editAccepted === true ? "text-green-400" : "text-indigo-400"} />
                        <span className={`font-medium ${msg.editAccepted === true ? "text-green-300" : "text-indigo-300"}`}>
                          {msg.editAccepted === true
                            ? "Changes applied"
                            : msg.editAccepted === false
                            ? "Changes rejected"
                            : "Proposed changes — review in editor"}
                        </span>
                      </div>
                      {msg.editAccepted === null && (
                        <div className="flex gap-2 px-3 py-2">
                          <button
                            onClick={() => handleAcceptEdit(idx)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                          >
                            <Check size={11} /> Accept
                          </button>
                          <button
                            onClick={() => handleRejectEdit(idx)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors"
                          >
                            <XCircle size={11} /> Reject
                          </button>
                          <span className="ml-auto self-center text-gray-500 italic">or type "yes"</span>
                        </div>
                      )}
                    </div>
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

          {/* Staged image thumbnails */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 py-1 border-t border-gray-800 flex-shrink-0">
              {images.map((src, idx) => (
                <div key={idx} className="relative group">
                  <img src={src} alt="" className="h-12 w-12 object-cover rounded-lg border border-gray-700" />
                  <button
                    onClick={() => removeImage(idx)}
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
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              title="Attach image"
              className="flex-shrink-0 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <Paperclip size={14} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />

            <button
              onClick={attachPdf}
              disabled={loading || pdfAttaching || !pdfBase64}
              title="Attach all PDF pages as images"
              className="flex-shrink-0 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pdfAttaching ? <Loader2 size={14} className="animate-spin" /> : <FileImage size={14} />}
            </button>

            <textarea
              rows={2}
              placeholder={
                !activeThreadId
                  ? "Start a new chat to begin…"
                  : pendingEditIndex >= 0
                  ? 'Type "yes" to apply, or keep chatting…'
                  : "Ask anything or request an edit… Enter ↵ to send"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(prompt);
                }
              }}
              onPaste={handlePaste}
              disabled={loading}
              className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none placeholder-gray-500 disabled:opacity-50 resize-none"
            />

            <button
              onClick={() => submit(prompt)}
              disabled={loading || (!prompt.trim() && !images.length)}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          {error && <p className="text-red-400 text-xs px-4 pb-2 flex-shrink-0">Error: {error}</p>}
        </div>
      </div>
    </div>
  );
}
