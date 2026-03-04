import { useState } from "react";
import { Sparkles, Loader2, Send } from "lucide-react";
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

export default function AIPanel({ latex, onSuggestion }: Props) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (p: string) => {
    const trimmed = p.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await aiEdit(latex, trimmed);
      onSuggestion(latex, result.suggested_latex);
      setPrompt("");
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

      {/* Custom prompt input */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Describe what to change… e.g. 'Tailor this for a backend engineer role at Stripe'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(prompt)}
          disabled={loading}
          className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none placeholder-gray-500 disabled:opacity-50"
        />
        <button
          onClick={() => submit(prompt)}
          disabled={loading || !prompt.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-sm font-medium transition-colors disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs mt-2">Error: {error}</p>
      )}
    </div>
  );
}
