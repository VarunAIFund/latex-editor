import { useState } from "react";
import { X, Loader2, Download, Mail } from "lucide-react";
import { generateCoverLetter } from "../api";

interface Props {
  resumeLatex: string;
  onClose: () => void;
}

export default function CoverLetterModal({ resumeLatex, onClose }: Props) {
  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [latex, setLatex] = useState<string | null>(null);

  const generate = async () => {
    if (!jobTitle.trim() || !companyName.trim() || !description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await generateCoverLetter(
        resumeLatex,
        jobTitle,
        companyName,
        description
      );
      if (result.error) {
        setError(`Compilation error: ${result.error}`);
      }
      setPdfBase64(result.cover_letter_pdf_base64);
      setLatex(result.cover_letter_latex);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = () => {
    if (!pdfBase64) return;
    const link = document.createElement("a");
    link.href = `data:application/pdf;base64,${pdfBase64}`;
    link.download = `${companyName.replace(/\s+/g, "_")}_cover_letter.pdf`;
    link.click();
  };

  const downloadTex = () => {
    if (!latex) return;
    const blob = new Blob([latex], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${companyName.replace(/\s+/g, "_")}_cover_letter.tex`;
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-[90vw] max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-indigo-400" />
            <h2 className="text-white font-semibold">Generate Cover Letter</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Job Title *</label>
              <input
                type="text"
                placeholder="e.g. Senior Software Engineer"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Company Name *</label>
              <input
                type="text"
                placeholder="e.g. Stripe"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none placeholder-gray-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Job / Company Description *
            </label>
            <textarea
              rows={6}
              placeholder="Paste the job description or describe what the company does and what the role involves…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none placeholder-gray-500 resize-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-xs">
              {error}
            </div>
          )}

          {pdfBase64 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-emerald-400 text-sm font-medium">Cover letter generated!</span>
                <div className="flex gap-2">
                  <button
                    onClick={downloadTex}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium transition-colors"
                  >
                    <Download size={12} />
                    .tex
                  </button>
                  <button
                    onClick={downloadPdf}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                  >
                    <Download size={12} />
                    PDF
                  </button>
                </div>
              </div>
              <iframe
                title="Cover Letter Preview"
                src={`data:application/pdf;base64,${pdfBase64}`}
                className="w-full rounded-lg border border-gray-700"
                style={{ height: "400px" }}
              />
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium transition-colors"
          >
            Close
          </button>
          <button
            onClick={generate}
            disabled={loading || !jobTitle.trim() || !companyName.trim() || !description.trim()}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating…
              </>
            ) : (
              "Generate Cover Letter"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
