import { useState, useEffect } from "react";
import { X, Briefcase, Loader2 } from "lucide-react";

interface Props {
  pinnedProjects: string[];
  onClose: () => void;
  onCreate: (jobDescription: string, projectLabel: string, baseProject: string) => Promise<void>;
}

export default function NewJobModal({ pinnedProjects, onClose, onCreate }: Props) {
  const [jobDescription, setJobDescription] = useState("");
  const [projectLabel, setProjectLabel] = useState("Varun - ");
  const [selectedBase, setSelectedBase] = useState(pinnedProjects[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep selectedBase in sync if pinnedProjects changes
  useEffect(() => {
    if (!selectedBase && pinnedProjects.length > 0) {
      setSelectedBase(pinnedProjects[0]);
    }
  }, [pinnedProjects, selectedBase]);

  const canSubmit = jobDescription.trim().length > 0 && projectLabel.trim().length > 0 && selectedBase;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setError(null);
    setLoading(true);
    try {
      await onCreate(jobDescription.trim(), projectLabel.trim(), selectedBase);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[720px] max-w-[95vw] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2.5">
            <Briefcase size={16} className="text-teal-400" />
            <h2 className="text-white font-semibold text-sm">New Job Application</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Job description */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Job Description <span className="text-red-400">*</span>
            </label>
            <textarea
              autoFocus
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full job description here…"
              rows={12}
              className="w-full bg-gray-800 text-gray-100 text-xs leading-relaxed px-3 py-2.5 rounded-lg border border-gray-700 focus:border-teal-500 focus:outline-none resize-none placeholder-gray-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Project label */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Project Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={projectLabel}
                onChange={(e) => setProjectLabel(e.target.value)}
                placeholder="e.g. Varun - Google"
                className="w-full bg-gray-800 text-gray-100 text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-teal-500 focus:outline-none placeholder-gray-600"
              />
              <p className="text-xs text-gray-600 mt-1">Name for the new project folder</p>
            </div>

            {/* Base resume picker */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Base Resume <span className="text-red-400">*</span>
              </label>
              {pinnedProjects.length === 0 ? (
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-500">
                  No pinned projects. Pin a project in the sidebar first.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pinnedProjects.map((p) => (
                    <label
                      key={p}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedBase === p
                          ? "border-teal-500 bg-teal-900/30 text-white"
                          : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                      }`}
                    >
                      <input
                        type="radio"
                        name="baseProject"
                        value={p}
                        checked={selectedBase === p}
                        onChange={() => setSelectedBase(p)}
                        className="accent-teal-500"
                      />
                      <span className="text-xs truncate">{p}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-600 mt-1">Resume to copy as the starting point</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-500">
            Creates the project and runs ATS optimize + cover letter in the background
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || loading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Optimizing…
                </>
              ) : (
                <>
                  <Briefcase size={12} />
                  Create &amp; Optimize
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
