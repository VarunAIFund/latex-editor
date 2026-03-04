import { useState, useRef, useCallback } from "react";
import { Sparkles, Loader2, Send, Paperclip, X } from "lucide-react";
import { aiEdit } from "../api";

interface Props {
  latex: string;
  onSuggestion: (original: string, suggested: string) => void;
}

const QUICK_PROMPTS = [
  "Make it more concise",
  "Improve the bullet points",
  "Add more technical keywords",
  "Change margins to be wider",
  "Make font size 10pt",
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AIPanel({ latex, onSuggestion }: Props) {
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]); // data URLs
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const submit = async (p: string) => {
    const trimmed = p.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await aiEdit(latex, trimmed, images);
      onSuggestion(latex, result.suggested_latex);
      setPrompt("");
      setImages([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "AI edit failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={13} className="text-indigo-400" />
        <span className="text-xs text-indigo-300 font-medium uppercase tracking-wider">AI Edit</span>
      </div>

      {/* Quick prompts */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {QUICK_PROMPTS.map((qp) => (
          <button
            key={qp}
            onClick={() => submit(qp)}
            disabled={loading}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2.5 py-1 rounded-full border border-gray-700 hover:border-indigo-500 transition-colors disabled:opacity-50"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Image thumbnails */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((src, idx) => (
            <div key={idx} className="relative group">
              <img
                src={src}
                alt={`attachment ${idx + 1}`}
                className="h-14 w-14 object-cover rounded-lg border border-gray-700"
              />
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
      <div className="flex gap-2 items-end">
        {/* Paperclip upload button */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
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

        <textarea
          ref={textareaRef}
          rows={2}
          placeholder={
            images.length
              ? "Describe what to do with the image… Enter to send, Shift+Enter for new line"
              : "Describe what to change… Enter to send, Shift+Enter for new line"
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

      {error && <p className="text-red-400 text-xs mt-2">Error: {error}</p>}
    </div>
  );
}
