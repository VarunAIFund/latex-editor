import { useState, useEffect } from "react";
import { Settings, X } from "lucide-react";

interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Props {
  latex: string;
  onChange: (latex: string) => void;
}

function parseMargins(latex: string): Margins {
  const extract = (cmd: string, fallback: number): number => {
    // Match \addtolength{\topmargin}{-0.5in} or \addtolength{\oddsidemargin}{-0.5in}
    const re = new RegExp(
      String.raw`\\addtolength\{\\` + cmd + String.raw`\}\{([^}]+)\}`
    );
    const m = latex.match(re);
    if (!m) return fallback;
    const val = parseFloat(m[1]);
    return isNaN(val) ? fallback : -val; // negate: pdflatex convention uses negative for shrink
  };
  return {
    top: extract("topmargin", 0.5),
    bottom: extract("textheight", -1.0),
    left: extract("oddsidemargin", 0.5),
    right: extract("evensidemargin", 0.5),
  };
}

function applyMargins(latex: string, m: Margins): string {
  const replace = (cmd: string, val: number): string => {
    const re = new RegExp(
      String.raw`\\addtolength\{\\` + cmd + String.raw`\}\{[^}]+\}`
    );
    const formatted = `\\addtolength{\\${cmd}}{${(-val).toFixed(2)}in}`;
    if (re.test(latex)) return latex.replace(re, formatted);
    // Insert before \urlstyle or just append to preamble area
    return latex.replace("\\urlstyle", `${formatted}\n\\urlstyle`);
  };

  let result = latex;
  result = replace("oddsidemargin", m.left);
  result = replace("evensidemargin", m.right);
  result = replace("topmargin", m.top);
  // textheight is additive positive for increase
  const thr = new RegExp(
    String.raw`\\addtolength\{\\textheight\}\{[^}]+\}`
  );
  const thFormatted = `\\addtolength{\\textheight}{${(m.top + m.bottom).toFixed(2)}in}`;
  result = thr.test(result)
    ? result.replace(thr, thFormatted)
    : result.replace("\\urlstyle", `${thFormatted}\n\\urlstyle`);
  return result;
}

export default function MarginsPanel({ latex, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [margins, setMargins] = useState<Margins>({ top: 0.5, bottom: 1.0, left: 0.5, right: 0.5 });

  useEffect(() => {
    setMargins(parseMargins(latex));
  }, []);

  const update = (key: keyof Margins, val: number) => {
    const next = { ...margins, [key]: val };
    setMargins(next);
    onChange(applyMargins(latex, next));
  };

  const Slider = ({
    label,
    k,
  }: {
    label: string;
    k: keyof Margins;
  }) => (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 text-xs w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={margins[k]}
        onChange={(e) => update(k, parseFloat(e.target.value))}
        className="flex-1 accent-indigo-500"
      />
      <span className="text-gray-300 text-xs w-12 text-right font-mono">
        {margins[k].toFixed(2)}"
      </span>
    </div>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          open
            ? "bg-indigo-600 text-white"
            : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
        }`}
      >
        <Settings size={13} />
        Margins
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-40 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white text-sm font-semibold">Page Margins</span>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-3">
            <Slider label="Top" k="top" />
            <Slider label="Bottom" k="bottom" />
            <Slider label="Left" k="left" />
            <Slider label="Right" k="right" />
          </div>
          <p className="text-gray-600 text-xs mt-3">Changes update the LaTeX source immediately.</p>
        </div>
      )}
    </div>
  );
}
