import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  Sparkles,
  Loader2,
  Send,
  Square,
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
  Zap,
} from "lucide-react";
import {
  aiEdit,
  listModels,
  listChatThreads,
  getChatThread,
  saveChatThread,
  deleteChatThread,
} from "../api";
import type { ChatThreadSummary } from "../api";
import { buildAtsPrompt, buildCoverLetterPrompt } from "../constants/prompts";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
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

export interface AIpanelHandle {
  triggerAutoTrim: () => void;
}

export interface BulletInfo {
  section: string;
  role: string;
  snippet: string;
  line_count: number;
}

interface Props {
  resumeLatex: string;
  coverLetterLatex: string;
  pdfBase64: string | null;
  projectName: string | null;
  onSuggestion: (
    target: "resume" | "cover_letter",
    original: string,
    suggested: string,
  ) => void;
  bulletAnalysis?: BulletInfo[] | null;
  onAutoTrimApply?: (
    latex: string,
  ) => Promise<{ pageCount: number; bulletAnalysis: BulletInfo[] }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const YES_PHRASES = new Set([
  "yes",
  "y",
  "yep",
  "yeah",
  "yup",
  "sure",
  "ok",
  "okay",
  "apply",
  "apply it",
  "do it",
  "looks good",
  "go ahead",
  "accept",
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
  if (diffDays === 0)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
    .promise;
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

// ── Quick prompts ──────────────────────────────────────────────────────────────

const TRIM_PROMPT_BASE = `My resume is slightly over one page. Make ONE micro-edit to reduce its length. Use this priority order — stop at the first that applies:

1. Find the bullet whose continuation line has the fewest words (i.e. it barely spills onto a second line). Rewrite that bullet to be ~10 words shorter while keeping all key facts — the goal is to make it fit in one fewer rendered line.
2. If no bullet can be shortened without losing key info, find a phrase that can be tightened (e.g. "in order to" → "to", "responsible for building" → "built", "was able to" → drop entirely).
3. Only as a last resort: remove the single least-impactful bullet from a role older than 2 years.

Rules: do NOT remove entire sections. Do NOT change formatting, spacing, or margins. Return the full resume with only this one change.`;

function buildTrimPrompt(analysis: BulletInfo[] | null): string {
  const multiLine = (analysis ?? []).filter((b) => b.line_count > 1);
  if (multiLine.length === 0) return TRIM_PROMPT_BASE;
  const lines = multiLine
    .map((b) => {
      const loc = [b.section, b.role].filter(Boolean).join(" / ");
      return `- [${b.line_count} rendered lines${loc ? ", " + loc : ""}] "${b.snippet.slice(0, 70)}…"`;
    })
    .join("\n");
  return (
    TRIM_PROMPT_BASE +
    `\n\nThese specific bullets are wrapping to multiple rendered lines in the PDF — prioritize shortening one of these first:\n${lines}`
  );
}

const QUICK_PROMPTS: { label: string; color: string; text: string }[] = [
  {
    label: "ATS Optimize",
    color: "text-emerald-300 border-emerald-700/60 hover:bg-emerald-900/40",
    text: buildAtsPrompt("[paste job description here]"),
  },
  {
    label: "Tailor Resume",
    color: "text-indigo-300 border-indigo-700/60 hover:bg-indigo-900/40",
    text: `Please tailor my resume for this role. Here's the job description:

[paste job description here]

Keep the formatting intact and only change content that strengthens my fit for this specific role.`,
  },
  {
    label: "Cover Letter",
    color: "text-purple-300 border-purple-700/60 hover:bg-purple-900/40",
    text: buildCoverLetterPrompt("[paste job description here]"),
  },
  {
    label: "Tailor + Cover",
    color: "text-amber-300 border-amber-700/60 hover:bg-amber-900/40",
    text: `Based on this job description, please:
1. Tailor my resume for the role
2. Write a cover letter

Job description:
[paste job description here]`,
  },
  {
    label: "Trim to 1 page",
    color: "text-orange-300 border-orange-700/60 hover:bg-orange-900/40",
    text: TRIM_PROMPT_BASE,
  },
];

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
    <div
      className={`rounded-xl border text-xs overflow-hidden ${
        accepted === true
          ? "border-green-700/50 bg-green-950/30"
          : accepted === false
            ? "border-gray-700 bg-gray-800/40 opacity-60"
            : isCL
              ? "border-purple-600/50 bg-purple-950/30"
              : "border-indigo-600/50 bg-indigo-950/40"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        {isCL ? (
          <Mail
            size={12}
            className={accepted === true ? "text-green-400" : "text-purple-400"}
          />
        ) : (
          <GitCompare
            size={12}
            className={accepted === true ? "text-green-400" : "text-indigo-400"}
          />
        )}
        <span
          className={`font-medium ${
            accepted === true
              ? "text-green-300"
              : isCL
                ? "text-purple-300"
                : "text-indigo-300"
          }`}
        >
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
              isCL
                ? "bg-purple-700 hover:bg-purple-600"
                : "bg-indigo-600 hover:bg-indigo-500"
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
          <span className="ml-auto self-center text-gray-500 italic">
            or type "yes"
          </span>
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

const AIPanel = forwardRef<AIpanelHandle, Props>(function AIPanel(
  {
    resumeLatex,
    coverLetterLatex,
    pdfBase64,
    projectName,
    onSuggestion,
    bulletAnalysis,
    onAutoTrimApply,
  }: Props,
  ref,
) {
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
  const [model, setModel] = useState("gpt-5-mini");
  const [availableModels, setAvailableModels] = useState<string[]>([
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "o4-mini",
    "o3",
  ]);
  const [pdfAttaching, setPdfAttaching] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [trimmingRound, setTrimmingRound] = useState<{
    current: number;
    max: number;
  } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeProjectRef = useRef(projectName);

  // ── Load available models ─────────────────────────────────────────────────────
  useEffect(() => {
    listModels().then((models) => {
      if (models.length) setAvailableModels(models);
    });
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
    setThreads((prev) => [
      { id, title: "New chat", created_at: now, message_count: 0 },
      ...prev,
    ]);
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
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setChatHistory([]);
    }
  };

  // ── Persist thread ────────────────────────────────────────────────────────────
  const persistThread = useCallback(
    async (messages: ChatMessage[], threadId: string, createdAt: string) => {
      if (!projectName || !threadId) return;
      const title = threadTitle(messages);
      await saveChatThread(projectName, {
        id: threadId,
        title,
        created_at: createdAt,
        messages,
      });
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? { ...t, title, message_count: messages.length }
            : t,
        ),
      );
    },
    [projectName],
  );

  // ── Pending edit helpers ──────────────────────────────────────────────────────
  const hasPendingEdit = (() => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (m.role === "assistant") {
        if (
          (m.pendingEdit && m.editAccepted === null) ||
          (m.pendingCLEdit && m.clEditAccepted === null)
        )
          return i;
      }
    }
    return -1;
  })();

  const acceptEdit = useCallback(
    (
      idx: number,
      history: ChatMessage[],
      target: "resume" | "cover_letter",
    ) => {
      const msg = history[idx];
      if (msg.role !== "assistant") return history;
      if (target === "resume" && msg.pendingEdit) {
        onSuggestion("resume", resumeLatex, msg.pendingEdit.suggestedLatex);
        return history.map((m, i) =>
          i === idx && m.role === "assistant"
            ? { ...m, editAccepted: true }
            : m,
        );
      }
      if (target === "cover_letter" && msg.pendingCLEdit) {
        onSuggestion(
          "cover_letter",
          coverLetterLatex,
          msg.pendingCLEdit.suggestedLatex,
        );
        return history.map((m, i) =>
          i === idx && m.role === "assistant"
            ? { ...m, clEditAccepted: true }
            : m,
        );
      }
      return history;
    },
    [resumeLatex, coverLetterLatex, onSuggestion],
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
      const items = Array.from(e.clipboardData.items).filter((i) =>
        i.type.startsWith("image/"),
      );
      if (!items.length) return;
      e.preventDefault();
      const files = items.map((i) => i.getAsFile()).filter(Boolean) as File[];
      await addImages(files);
    },
    [addImages],
  );

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await addImages(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  // ── Quick prompt insertion ─────────────────────────────────────────────────────
  const insertQuickPrompt = (text: string) => {
    if (!activeThreadId) startNewThread();
    setPrompt(text);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      // Move cursor to the placeholder so user can type immediately
      const pos = text.indexOf("[paste job description here]");
      if (pos !== -1) {
        ta.setSelectionRange(pos, pos + "[paste job description here]".length);
      }
    }, 50);
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
      setThreads((prev) => [
        {
          id: threadId!,
          title: "New chat",
          created_at: createdAt,
          message_count: 0,
        },
        ...prev,
      ]);
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
    const ac = new AbortController();
    abortControllerRef.current = ac;

    const userMsg: ChatMessage = {
      role: "user",
      text: trimmed,
      images: currentImages.length ? currentImages : undefined,
    };
    const historyWithUser: ChatMessage[] = [...chatHistory, userMsg];
    setChatHistory(historyWithUser);
    setPrompt("");
    setImages([]);

    const historyForApi = chatHistory.flatMap<{
      role: string;
      content: string;
    }>((msg) => {
      if (msg.role === "user") return [{ role: "user", content: msg.text }];
      const parts: string[] = [msg.text];
      if (msg.pendingEdit)
        parts.push(`[Proposed resume edit: ${msg.pendingEdit.explanation}]`);
      if (msg.pendingCLEdit)
        parts.push(
          `[Proposed cover letter edit: ${msg.pendingCLEdit.explanation}]`,
        );
      return [{ role: "assistant", content: parts.join(" ") }];
    });

    try {
      const result = await aiEdit(
        resumeLatex,
        coverLetterLatex,
        trimmed,
        currentImages,
        historyForApi,
        useKnowledgeBase,
        model,
        ac.signal,
      );

      if (activeProjectRef.current !== projectAtSubmit) return;

      const hasResumeEdit =
        (result.type === "edit" || result.type === "edit_and_cover_letter") &&
        result.suggested_resume;
      const hasCLEdit =
        (result.type === "edit_cover_letter" ||
          result.type === "edit_and_cover_letter") &&
        result.suggested_cover_letter;

      const assistantMsg: ChatMessage = {
        role: "assistant",
        text: result.message,
        ...(hasResumeEdit
          ? {
              pendingEdit: {
                suggestedLatex: result.suggested_resume!,
                explanation: result.message,
              },
              editAccepted: null,
            }
          : {}),
        ...(hasCLEdit
          ? {
              pendingCLEdit: {
                suggestedLatex: result.suggested_cover_letter!,
                explanation: result.message,
              },
              clEditAccepted: null,
            }
          : {}),
      };

      const finalHistory: ChatMessage[] = [...historyWithUser, assistantMsg];
      setChatHistory(finalHistory);
      persistThread(finalHistory, threadAtSubmit, createdAt);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        // User cancelled — remove the pending user message from history
        setChatHistory(chatHistory);
      } else if (activeProjectRef.current === projectAtSubmit) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setChatHistory(historyWithUser);
      }
    } finally {
      abortControllerRef.current = null;
      if (activeProjectRef.current === projectAtSubmit) setLoading(false);
    }
  };

  // ── Auto-trim loop ────────────────────────────────────────────────────────────
  const runTrimLoop = async () => {
    if (trimming || loading || !onAutoTrimApply) return;
    setTrimming(true);
    setTrimmingRound(null);
    const ac = new AbortController();
    abortControllerRef.current = ac;

    // Reuse existing thread or create one
    let threadId = activeThreadId;
    let createdAt = activeCreatedAt;
    if (!threadId) {
      threadId = generateId();
      createdAt = nowIso();
      setActiveThreadId(threadId);
      setActiveCreatedAt(createdAt);
      setThreads((prev) => [
        {
          id: threadId!,
          title: "Auto-trim",
          created_at: createdAt,
          message_count: 0,
        },
        ...prev,
      ]);
    }

    const MAX_ROUNDS = 10;
    const preTrimLatex = resumeLatex; // snapshot before any changes
    let currentLatex = resumeLatex;
    let currentAnalysis = bulletAnalysis ?? null;
    let history: ChatMessage[] = [...chatHistory];
    let anyEditMade = false;

    const toApiHistory = (msgs: ChatMessage[]) =>
      msgs.flatMap<{ role: string; content: string }>((msg) => {
        if (msg.role === "user") return [{ role: "user", content: msg.text }];
        const parts: string[] = [msg.text];
        if (msg.role === "assistant") {
          if (msg.pendingEdit)
            parts.push(`[Resume edit: ${msg.pendingEdit.explanation}]`);
          if (msg.pendingCLEdit)
            parts.push(`[Cover letter edit: ${msg.pendingCLEdit.explanation}]`);
        }
        return [{ role: "assistant", content: parts.join(" ") }];
      });

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      setTrimmingRound({ current: round, max: MAX_ROUNDS });
      const prompt = buildTrimPrompt(currentAnalysis);

      // Build API history from existing history (no extra user label message added)
      const historyForApi = toApiHistory(history);

      let result;
      try {
        result = await aiEdit(
          currentLatex,
          coverLetterLatex,
          prompt,
          [],
          historyForApi,
          useKnowledgeBase,
          model,
          ac.signal,
        );
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") break;
        const errMsg: ChatMessage = {
          role: "assistant",
          text:
            e instanceof Error
              ? `Error: ${e.message}`
              : "Something went wrong during auto-trim.",
        };
        history = [...history, errMsg];
        setChatHistory(history);
        break;
      }

      if (!result.suggested_resume) {
        // AI couldn't find a cut
        const doneMsg: ChatMessage = {
          role: "assistant",
          text:
            result.message ||
            "No further changes needed — resume is as compact as possible.",
        };
        history = [...history, doneMsg];
        setChatHistory(history);
        persistThread(history, threadId, createdAt);
        break;
      }

      // Auto-accept the edit (editAccepted: true — shows green "changes applied" card)
      const assistantMsg: ChatMessage = {
        role: "assistant",
        text: result.message,
        pendingEdit: {
          suggestedLatex: result.suggested_resume,
          explanation: result.message,
        },
        editAccepted: true,
      };
      history = [...history, assistantMsg];
      setChatHistory(history);

      // Compile + layout check
      const { pageCount, bulletAnalysis: newAnalysis } = await onAutoTrimApply(
        result.suggested_resume,
      );
      currentLatex = result.suggested_resume;
      currentAnalysis = newAnalysis;
      anyEditMade = true;

      const isLastRound = pageCount <= 1 || round === MAX_ROUNDS;
      if (isLastRound) {
        const finalMsg: ChatMessage = {
          role: "assistant",
          text:
            pageCount <= 1
              ? `Resume fits on 1 page now. Done after ${round} round${round > 1 ? "s" : ""}.`
              : `Reached maximum rounds (${MAX_ROUNDS}). Resume may still be slightly over — you can run again or adjust manually.`,
        };
        history = [...history, finalMsg];
        setChatHistory(history);
        persistThread(history, threadId, createdAt);
        break;
      }
      persistThread(history, threadId, createdAt);
    }

    // Show a diff of pre-trim vs post-trim so the user can review and revert if needed
    if (anyEditMade && currentLatex !== preTrimLatex) {
      onSuggestion("resume", preTrimLatex, currentLatex);
    }

    abortControllerRef.current = null;
    setTrimming(false);
    setTrimmingRound(null);
  };

  // ── Resizable panel ──────────────────────────────────────────────────────────
  const [panelHeight, setPanelHeight] = useState(380);
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef<number>(380);

  const onDragStart = (e: React.MouseEvent) => {
    dragStartY.current = e.clientY;
    dragStartH.current = panelHeight;
    const onMove = (ev: MouseEvent) => {
      if (dragStartY.current === null) return;
      const delta = dragStartY.current - ev.clientY; // dragging up = taller
      setPanelHeight(Math.max(180, Math.min(800, dragStartH.current + delta)));
    };
    const onUp = () => {
      dragStartY.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Imperative handle ─────────────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      triggerAutoTrim: () => {
        if (onAutoTrimApply) {
          runTrimLoop();
        } else {
          // Fallback: populate textarea for manual send
          insertQuickPrompt(buildTrimPrompt(bulletAnalysis ?? null));
        }
      },
    }),
    [bulletAnalysis, resumeLatex, onAutoTrimApply],
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div
      className="bg-gray-900 border-t border-gray-700 flex flex-col"
      style={{ height: panelHeight }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="h-1.5 flex-shrink-0 cursor-row-resize hover:bg-indigo-600/50 transition-colors group"
        title="Drag to resize"
      >
        <div className="mx-auto mt-0.5 w-8 h-0.5 rounded-full bg-gray-700 group-hover:bg-indigo-500 transition-colors" />
      </div>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={13} className="text-indigo-400 flex-shrink-0" />
          <span className="text-xs text-indigo-300 font-medium uppercase tracking-wider flex-shrink-0">
            AI Assistant
          </span>
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
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            onClick={() => setUseKnowledgeBase((v) => !v)}
            title={
              useKnowledgeBase ? "Knowledge base ON" : "Knowledge base OFF"
            }
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              useKnowledgeBase
                ? "bg-indigo-900/50 border-indigo-600 text-indigo-300 hover:bg-indigo-800/50"
                : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400"
            }`}
          >
            <Database size={11} />
            <span>KB</span>
            <span
              className={`w-2 h-2 rounded-full ${useKnowledgeBase ? "bg-indigo-400" : "bg-gray-600"}`}
            />
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
              <p className="text-gray-600 text-xs px-3 py-3 text-center">
                No chats yet
              </p>
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
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    {formatDate(t.created_at)}
                  </p>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => deleteThread(t.id, e)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && deleteThread(t.id, e as never)
                  }
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
                <p className="text-xs text-gray-500">
                  Select a chat or start a new one
                </p>
              </div>
            )}
            {activeThreadId && chatHistory.length === 0 && !loading && (
              <p className="text-xs text-gray-500 text-center pt-4">
                Ask to tailor the resume, generate a cover letter, or both at
                once.
              </p>
            )}

            {chatHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
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
                    <p className="whitespace-pre-wrap break-words">
                      {msg.text}
                    </p>
                    {msg.role === "user" &&
                      msg.images &&
                      msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {msg.images.map((src, i) => (
                            <img
                              key={i}
                              src={src}
                              alt=""
                              className="h-12 w-12 object-cover rounded border border-white/10"
                            />
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
            {trimming && (
              <div className="flex gap-2 justify-start">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-700 flex items-center justify-center">
                  <Sparkles size={11} className="text-amber-200" />
                </div>
                <div className="bg-amber-900/30 border border-amber-700/40 rounded-xl rounded-tl-sm px-3 py-2 flex items-center gap-2">
                  <Loader2 size={13} className="text-amber-400 animate-spin" />
                  <span className="text-xs text-amber-300">
                    {trimmingRound
                      ? `Auto-trimming — round ${trimmingRound.current} of ${trimmingRound.max}…`
                      : "Auto-trimming…"}
                  </span>
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
                  <img
                    src={src}
                    alt=""
                    className="h-12 w-12 object-cover rounded-lg border border-gray-700"
                  />
                  <button
                    onClick={() =>
                      setImages((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="absolute -top-1.5 -right-1.5 bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick prompt chips */}
          <div className="flex items-center gap-1.5 px-4 py-1.5 border-t border-gray-800 flex-shrink-0 overflow-x-auto">
            <Zap size={11} className="text-gray-600 flex-shrink-0" />
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.label}
                onClick={() => insertQuickPrompt(qp.text)}
                disabled={loading || trimming}
                className={`flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full border bg-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${qp.color}`}
              >
                {qp.label}
              </button>
            ))}
          </div>

          {/* Input row */}
          <div className="flex gap-2 items-end px-4 py-2 border-t border-gray-800 flex-shrink-0">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading || trimming}
              title="Attach image"
              className="flex-shrink-0 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <Paperclip size={14} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />

            <button
              onClick={attachPdf}
              disabled={loading || trimming || pdfAttaching || !pdfBase64}
              title="Attach all PDF pages as images"
              className="flex-shrink-0 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pdfAttaching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FileImage size={14} />
              )}
            </button>

            <textarea
              ref={textareaRef}
              rows={2}
              placeholder={
                trimming
                  ? "Auto-trimming in progress…"
                  : !activeThreadId
                    ? "Start a new chat to begin…"
                    : hasPendingEdit >= 0
                      ? 'Type "yes" to apply, or keep chatting…'
                      : "Ask anything, request edits, or ask for a cover letter… Enter ↵ to send"
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
              disabled={loading || trimming}
              className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none placeholder-gray-500 disabled:opacity-50 resize-none"
            />

            {loading || trimming ? (
              <button
                onClick={() => abortControllerRef.current?.abort()}
                title="Stop generation"
                className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors"
              >
                <Square size={13} className="fill-white" />
              </button>
            ) : (
              <button
                onClick={() => submit(prompt)}
                disabled={!prompt.trim() && !images.length}
                className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-sm font-medium transition-colors disabled:cursor-not-allowed"
              >
                <Send size={14} />
              </button>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-xs px-4 pb-2 flex-shrink-0">
              Error: {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

export default AIPanel;
