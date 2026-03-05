import { useState, useEffect, useRef, useCallback } from "react";
import { Save, RefreshCw, FileDown, Check, X, Sparkles, FileText, Mail } from "lucide-react";
import ResumeSidebar from "./components/ResumeSidebar";
import LatexEditor from "./components/LatexEditor";
import PdfPreview from "./components/PdfPreview";
import AIPanel from "./components/AIPanel";
import MarginsPanel from "./components/MarginsPanel";
import { compileLatex, listProjects, loadProject, saveResume, saveCoverLetter, createProject } from "./api";

type ActiveTab = "resume" | "cover_letter";
type DiffTarget = "resume" | "cover_letter";

export default function App() {
  // Project list + active project
  const [projects, setProjects] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);

  // Per-project file content
  const [resumeLatex, setResumeLatex] = useState("");
  const [coverLetterLatex, setCoverLetterLatex] = useState("");

  // Which tab is visible in the editor
  const [activeTab, setActiveTab] = useState<ActiveTab>("resume");

  // PDF / compile state (always compiles the active tab)
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);

  // Inline diff (Cursor-style)
  const [diff, setDiff] = useState<{
    original: string;
    suggested: string;
    target: DiffTarget;
  } | null>(null);
  const preDiffPdfRef = useRef<string | null>(null);

  // AI panel visibility
  const [showAIPanel, setShowAIPanel] = useState(true);

  // Debounce refs
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Project list ────────────────────────────────────────────────────────────

  const fetchProjects = useCallback(async () => {
    const names = await listProjects();
    setProjects(names);
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // ── Compile ─────────────────────────────────────────────────────────────────

  const triggerCompile = useCallback((src: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setCompiling(true);
      try {
        const result = await compileLatex(src);
        setPdfBase64(result.pdf_base64);
        setCompileError(result.error);
      } finally {
        setCompiling(false);
      }
    }, 1200);
  }, []);

  // ── Auto-save ───────────────────────────────────────────────────────────────

  const triggerAutoSave = useCallback((content: string, name: string, target: ActiveTab) => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      setSaving(true);
      if (target === "resume") await saveResume(name, content);
      else await saveCoverLetter(name, content);
      setSaving(false);
      setSavedRecently(true);
      setTimeout(() => setSavedRecently(false), 2000);
    }, 2000);
  }, []);

  // ── Editor change (from Monaco) ─────────────────────────────────────────────

  const handleLatexChange = (val: string) => {
    if (activeTab === "resume") {
      setResumeLatex(val);
    } else {
      setCoverLetterLatex(val);
    }
    triggerCompile(val);
    if (activeProject) triggerAutoSave(val, activeProject, activeTab);
  };

  // ── Tab switch ──────────────────────────────────────────────────────────────

  const handleTabSwitch = (tab: ActiveTab) => {
    setActiveTab(tab);
    const src = tab === "resume" ? resumeLatex : coverLetterLatex;
    triggerCompile(src);
  };

  // ── Select project ──────────────────────────────────────────────────────────

  const handleSelect = async (name: string) => {
    const data = await loadProject(name);
    setActiveProject(name);
    setResumeLatex(data.resume);
    setCoverLetterLatex(data.cover_letter);
    setDiff(null);
    setActiveTab("resume");
    triggerCompile(data.resume);
  };

  // ── Create new project ──────────────────────────────────────────────────────

  const handleNew = async (name: string, resumeSrc?: string) => {
    const data = await createProject(name, resumeSrc);
    await fetchProjects();
    setActiveProject(name);
    setResumeLatex(data.resume);
    setCoverLetterLatex(data.cover_letter);
    setDiff(null);
    setActiveTab("resume");
    triggerCompile(data.resume);
  };

  // ── Manual save ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!activeProject) {
      const name = window.prompt("Save as (project name):");
      if (!name?.trim()) return;
      await createProject(name.trim(), resumeLatex);
      setActiveProject(name.trim());
      await fetchProjects();
      return;
    }
    setSaving(true);
    if (activeTab === "resume") await saveResume(activeProject, resumeLatex);
    else await saveCoverLetter(activeProject, coverLetterLatex);
    setSaving(false);
    setSavedRecently(true);
    setTimeout(() => setSavedRecently(false), 2000);
  };

  // ── Rename ──────────────────────────────────────────────────────────────────

  const handleRename = async (oldName: string, newName: string) => {
    await fetchProjects();
    if (activeProject === oldName) setActiveProject(newName);
  };

  // ── AI suggestion → diff view ───────────────────────────────────────────────

  const handleAISuggestion = async (target: DiffTarget, original: string, suggested: string) => {
    preDiffPdfRef.current = pdfBase64;
    setDiff({ original, suggested, target });
    // Switch to the affected tab
    setActiveTab(target);
    setCompiling(true);
    try {
      const result = await compileLatex(suggested);
      setPdfBase64(result.pdf_base64);
      setCompileError(result.error);
    } finally {
      setCompiling(false);
    }
  };

  const handleAcceptDiff = () => {
    if (!diff) return;
    if (diff.target === "resume") {
      setResumeLatex(diff.suggested);
      if (activeProject) triggerAutoSave(diff.suggested, activeProject, "resume");
    } else {
      setCoverLetterLatex(diff.suggested);
      if (activeProject) triggerAutoSave(diff.suggested, activeProject, "cover_letter");
    }
    triggerCompile(diff.suggested);
    setDiff(null);
  };

  const handleRejectDiff = () => {
    setDiff(null);
    if (preDiffPdfRef.current !== null) {
      setPdfBase64(preDiffPdfRef.current);
      setCompileError(null);
    }
  };

  // ── Download PDF ────────────────────────────────────────────────────────────

  const downloadPdf = () => {
    if (!pdfBase64) return;
    const link = document.createElement("a");
    link.href = `data:application/pdf;base64,${pdfBase64}`;
    const suffix = activeTab === "cover_letter" ? " - Cover Letter" : "";
    link.download = `${activeProject ?? "document"}${suffix}.pdf`;
    link.click();
  };

  // ── Active latex (whichever tab) ────────────────────────────────────────────

  const activeLatex = activeTab === "resume" ? resumeLatex : coverLetterLatex;

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <ResumeSidebar
        resumes={projects}
        activeResume={activeProject}
        onSelect={handleSelect}
        onNew={handleNew}
        onRename={handleRename}
        onRefresh={fetchProjects}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top toolbar */}
        <header className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-sm">
              {activeProject ?? "LaTeX Resume Editor"}
            </span>
            {activeProject && (
              <span className="text-gray-500 text-xs">
                — {projects.length} project{projects.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <MarginsPanel latex={activeLatex} onChange={handleLatexChange} />

            <button
              onClick={() => triggerCompile(activeLatex)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-medium transition-colors"
            >
              <RefreshCw size={13} />
              Compile
            </button>

            {pdfBase64 && (
              <button
                onClick={downloadPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-medium transition-colors"
              >
                <FileDown size={13} />
                Download PDF
              </button>
            )}

            <button
              onClick={() => setShowAIPanel((v) => !v)}
              disabled={!!diff}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                showAIPanel
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white"
              }`}
            >
              <Sparkles size={13} />
              AI Edit
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-medium transition-colors ${
                savedRecently
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800"
              }`}
            >
              <Save size={13} />
              {saving ? "Saving…" : savedRecently ? "Saved ✓" : "Save"}
            </button>
          </div>
        </header>

        {/* Editor + Preview */}
        <div className="flex-1 flex min-h-0">
          {/* Editor pane */}
          <div className="flex flex-col w-1/2 min-w-0 border-r border-gray-700">
            {/* File tabs + diff controls */}
            <div className="flex items-center justify-between px-4 py-1.5 bg-gray-900 border-b border-gray-700 shrink-0">
              {diff ? (
                <>
                  <span className="text-xs text-amber-400 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                    Reviewing AI changes to {diff.target === "cover_letter" ? "cover letter" : "resume"} — PDF shows accepted result
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleRejectDiff}
                      className="flex items-center gap-1 px-3 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-medium transition-colors"
                    >
                      <X size={11} /> Reject
                    </button>
                    <button
                      onClick={handleAcceptDiff}
                      className="flex items-center gap-1 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                    >
                      <Check size={11} /> Accept
                    </button>
                  </div>
                </>
              ) : (
                /* File tabs */
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleTabSwitch("resume")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeTab === "resume"
                        ? "bg-gray-700 text-white"
                        : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                    }`}
                  >
                    <FileText size={11} />
                    resume.tex
                  </button>
                  <button
                    onClick={() => handleTabSwitch("cover_letter")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeTab === "cover_letter"
                        ? "bg-purple-800 text-white"
                        : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                    }`}
                  >
                    <Mail size={11} />
                    cover_letter.tex
                  </button>
                </div>
              )}
            </div>

            {/* Editor body */}
            <div className="flex-1 min-h-0 relative">
              {/* Normal editor — always mounted to preserve undo history */}
              <div className={`absolute inset-0 ${diff ? "invisible" : "visible"}`}>
                {(activeProject || activeLatex) ? (
                  <LatexEditor value={activeLatex} onChange={handleLatexChange} />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    Select or create a project from the sidebar
                  </div>
                )}
              </div>

              {/* Diff viewer */}
              {diff && (
                <div className="absolute inset-0">
                  <LatexEditor
                    diffMode={true}
                    original={diff.original}
                    suggested={diff.suggested}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Preview pane */}
          <div className="flex flex-col w-1/2 min-w-0 min-h-0">
            <PdfPreview pdfBase64={pdfBase64} error={compileError} loading={compiling} />
          </div>
        </div>

        {/* AI Panel */}
        {(activeProject || activeLatex) && !diff && showAIPanel && (
          <AIPanel
            resumeLatex={resumeLatex}
            coverLetterLatex={coverLetterLatex}
            pdfBase64={pdfBase64}
            projectName={activeProject}
            onSuggestion={handleAISuggestion}
          />
        )}
      </div>
    </div>
  );
}
