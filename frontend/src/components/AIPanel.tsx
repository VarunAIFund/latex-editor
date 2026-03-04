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
} from "lucide-react";
import { aiEdit } from "../api";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface Props {
  latex: string;
  pdfBase64: string | null;
  onSuggestion: (original: string, suggested: string) => void;
}

type PendingEdit = {
  suggestedLatex: string;
  explanation: string;
};

type ChatMessage =
  | { role: "user"; text: string; images?: string[] }
  | { role: "assistant"; text: string; pendingEdit?: PendingEdit; editAccepted?: boolean | null };

const YES_PHRASES = new Set([
  "yes", "y", "yep", "yeah", "yup", "sure", "ok", "okay",
  "apply", "apply it", "do it", "looks good", "go ahead", "accept",
]);

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

export default function AIPanel({ latex, pdfBase64, onSuggestion }: Props) {
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(true);
  const [pdfAttaching, setPdfAttaching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  // Find the most recent pending (unresolved) edit in history
  const pendingEditIndex = (() => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (m.role === "assistant" && m.pendingEdit && m.editAccepted === null) return i;
    }
    return -1;
  })();

  const acceptEdit = useCallback(
    (idx: number) => {
      const msg = chatHistory[idx];
      if (msg.role !== "assistant" || !msg.pendingEdit) return;
      onSuggestion(latex, msg.pendingEdit.suggestedLatex);
      setChatHistory((prev) =>
        prev.map((m, i) =>
          i === idx && m.role === "assistant" ? { ...m, editAccepted: true } : m
        )
      );
    },
    [chatHistory, latex, onSuggestion]
  );

  const rejectEdit = useCallback((idx: number) => {
    setChatHistory((prev) =>
      prev.map((m, i) =>
        i === idx && m.role === "assistant" ? { ...m, editAccepted: false } : m
      )
    );
  }, []);

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

  const submit = async (p: string) => {
    const trimmed = p.trim();
    if (!trimmed || loading) return;

    // Shortcut: "yes" / "apply" accepts a pending edit without hitting the API
    if (pendingEditIndex >= 0 && YES_PHRASES.has(trimmed.toLowerCase())) {
      acceptEdit(pendingEditIndex);
      setChatHistory((prev) => [
        ...prev,
        { role: "user", text: trimmed },
        { role: "assistant", text: "Done! The changes have been applied to the editor." },
      ]);
      setPrompt("");
      return;
    }

    setLoading(true);
    setError(null);
    const currentImages = [...images];

    setChatHistory((prev) => [
      ...prev,
      { role: "user", text: trimmed, images: currentImages.length ? currentImages : undefined },
    ]);
    setPrompt("");
    setImages([]);

    // Build OpenAI-format history (text only — no inline images in history)
    const historyForApi = chatHistory.flatMap<{ role: string; content: string }>((msg) => {
      if (msg.role === "user") return [{ role: "user", content: msg.text }];
      // For assistant edits, send the explanation so the model knows what it proposed
      const content = msg.pendingEdit
        ? `${msg.text} [Proposed edit: ${msg.pendingEdit.explanation}]`
        : msg.text;
      return [{ role: "assistant", content }];
    });

    try {
      const result = await aiEdit(latex, trimmed, currentImages, historyForApi, useKnowledgeBase);

      if (result.type === "edit" && result.suggested_latex) {
        setChatHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            text: result.message,
            pendingEdit: {
              suggestedLatex: result.suggested_latex!,
              explanation: result.message,
            },
            editAccepted: null,
          },
        ]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", text: result.message },
        ]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setChatHistory((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border-t border-gray-700 flex flex-col" style={{ height: "360px" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-indigo-400" />
          <span className="text-xs text-indigo-300 font-medium uppercase tracking-wider">AI Assistant</span>
        </div>
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
          <span>Knowledge Base</span>
          <span className={`w-2 h-2 rounded-full ${useKnowledgeBase ? "bg-indigo-400" : "bg-gray-600"}`} />
        </button>
      </div>

      {/* Chat log */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {chatHistory.length === 0 && (
          <p className="text-xs text-gray-500 text-center pt-4">
            Chat with your resume assistant. Ask questions, request edits, or say "look at the PDF" to inspect styling.
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
              {/* Message bubble */}
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
                        onClick={() => acceptEdit(idx)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                      >
                        <Check size={11} /> Accept
                      </button>
                      <button
                        onClick={() => rejectEdit(idx)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors"
                      >
                        <XCircle size={11} /> Reject
                      </button>
                      <span className="ml-auto self-center text-gray-500 italic">or type "yes" to apply</span>
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
            pendingEditIndex >= 0
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
  );
}
