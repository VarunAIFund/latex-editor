import { useState, useEffect, useRef, useCallback } from "react";
import {
  Save,
  RefreshCw,
  FileDown,
  Check,
  X,
  Sparkles,
  FileText,
  Mail,
} from "lucide-react";
import ResumeSidebar from "./components/ResumeSidebar";
import LatexEditor from "./components/LatexEditor";
import PdfPreview from "./components/PdfPreview";
import AIPanel from "./components/AIPanel";
import type { AIpanelHandle } from "./components/AIPanel";
import MarginsPanel from "./components/MarginsPanel";
import NewJobModal from "./components/NewJobModal";
import {
  compileLatex,
  listProjects,
  loadProject,
  saveResume,
  saveCoverLetter,
  createProject,
  analyzeLayout,
  aiEdit,
  saveChatThread,
} from "./api";
import type { BulletInfo } from "./components/AIPanel";
import { buildAtsPrompt, buildCoverLetterPrompt } from "./constants/prompts";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

type ActiveTab = "resume" | "cover_letter";
type DiffTarget = "resume" | "cover_letter";

export default function App() {
  // Project list + active project
  const [projects, setProjects] = useState<string[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [pinnedProjects, setPinnedProjects] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("pinnedProjects") ?? "[]");
    } catch {
      return [];
    }
  });
  const [showNewJobModal, setShowNewJobModal] = useState(false);

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

  // One-page guard
  const [overOnePage, setOverOnePage] = useState(false);
  const [bulletAnalysis, setBulletAnalysis] = useState<BulletInfo[] | null>(
    null,
  );
  const aiPanelRef = useRef<AIpanelHandle>(null);

  // Debounce refs
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Project list ────────────────────────────────────────────────────────────

  const fetchProjects = useCallback(async () => {
    const names = await listProjects();
    setProjects(names);
  }, []);

  const handleTogglePin = useCallback((name: string) => {
    setPinnedProjects((prev) => {
      const next = prev.includes(name)
        ? prev.filter((p) => p !== name)
        : [...prev, name];
      localStorage.setItem("pinnedProjects", JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // ── Compile ─────────────────────────────────────────────────────────────────

  const triggerCompile = useCallback(
    (src: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setCompiling(true);
        try {
          const result = await compileLatex(src);
          setPdfBase64(result.pdf_base64);
          setCompileError(result.error);
          if (result.pdf_base64 && activeTab === "resume") {
            const pages = await countPdfPages(result.pdf_base64);
            if (pages > 1) {
              setOverOnePage(true);
              analyzeLayout(result.pdf_base64).then(setBulletAnalysis);
            } else {
              setOverOnePage(false);
              setBulletAnalysis(null);
            }
          }
        } finally {
          setCompiling(false);
        }
      }, 1200);
    },
    [activeTab],
  );

  // ── Auto-save ───────────────────────────────────────────────────────────────

  const triggerAutoSave = useCallback(
    (content: string, name: string, target: ActiveTab) => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(async () => {
        setSaving(true);
        if (target === "resume") await saveResume(name, content);
        else await saveCoverLetter(name, content);
        setSaving(false);
        setSavedRecently(true);
        setTimeout(() => setSavedRecently(false), 2000);
      }, 2000);
    },
    [],
  );

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
    setOverOnePage(false);
    setBulletAnalysis(null);
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

  // ── New job application flow ────────────────────────────────────────────────

  const handleNewJob = async (
    jobDescription: string,
    projectLabel: string,
    baseProject: string,
  ) => {
    // 1. Load base resume content
    const baseData = await loadProject(baseProject);

    // 2. Create the new project seeded with the base resume
    await createProject(projectLabel, baseData.resume);
    await fetchProjects();

    // 3. Build prompts with the job description embedded
    const atsPrompt = buildAtsPrompt(jobDescription);
    const clPrompt = buildCoverLetterPrompt(jobDescription);

    // 4. Run both AI calls in parallel
    const [atsResult, clResult] = await Promise.all([
      aiEdit(baseData.resume, "", atsPrompt, [], [], true, "gpt-4o"),
      aiEdit(baseData.resume, "", clPrompt, [], [], true, "gpt-4o"),
    ]);

    // 5. Pre-seed chat threads so they appear immediately when the user opens the project
    const now = new Date().toISOString();
    const atsThreadId = crypto.randomUUID();
    const clThreadId = crypto.randomUUID();

    const atsMessages: object[] = [
      { role: "user", text: atsPrompt },
      {
        role: "assistant",
        text: atsResult.message,
        ...(atsResult.type === "edit" ||
        atsResult.type === "edit_and_cover_letter"
          ? {
              pendingEdit: {
                suggestedLatex: atsResult.suggested_resume ?? "",
                explanation: atsResult.message,
              },
              editAccepted: null,
            }
          : {}),
      },
    ];

    const clMessages: object[] = [
      { role: "user", text: clPrompt },
      {
        role: "assistant",
        text: clResult.message,
        ...(clResult.type === "edit_cover_letter" ||
        clResult.type === "edit_and_cover_letter"
          ? {
              pendingCLEdit: {
                suggestedLatex: clResult.suggested_cover_letter ?? "",
                explanation: clResult.message,
              },
              clEditAccepted: null,
            }
          : {}),
      },
    ];

    await Promise.all([
      saveChatThread(projectLabel, {
        id: atsThreadId,
        title: "ATS Optimize",
        created_at: now,
        messages: atsMessages,
      }),
      saveChatThread(projectLabel, {
        id: clThreadId,
        title: "Cover Letter",
        created_at: new Date(Date.now() + 1).toISOString(),
        messages: clMessages,
      }),
    ]);

    // 6. Switch to the new project
    await handleSelect(projectLabel);
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

  // ── Page-count helper ───────────────────────────────────────────────────────

  async function countPdfPages(base64: string): Promise<number> {
    const url = `data:application/pdf;base64,${base64}`;
    const buf = await (await fetch(url)).arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) })
      .promise;
    return pdf.numPages;
  }

  // ── Auto-trim apply (called by AIPanel loop) ─────────────────────────────────

  const handleAutoTrimApply = async (
    latex: string,
  ): Promise<{ pageCount: number; bulletAnalysis: BulletInfo[] }> => {
    setResumeLatex(latex);
    if (activeProject) triggerAutoSave(latex, activeProject, "resume");
    setCompiling(true);
    try {
      const result = await compileLatex(latex);
      setPdfBase64(result.pdf_base64);
      setCompileError(result.error);
      let pageCount = 1;
      let newAnalysis: BulletInfo[] = [];
      if (result.pdf_base64) {
        pageCount = await countPdfPages(result.pdf_base64);
        newAnalysis = await analyzeLayout(result.pdf_base64);
        setBulletAnalysis(newAnalysis);
        setOverOnePage(pageCount > 1);
      }
      return { pageCount, bulletAnalysis: newAnalysis };
    } finally {
      setCompiling(false);
    }
  };

  // ── Auto-trim handler ────────────────────────────────────────────────────────

  const handleAutoTrim = () => {
    setShowAIPanel(true);
    aiPanelRef.current?.triggerAutoTrim();
  };

  // ── AI suggestion → diff view ───────────────────────────────────────────────

  const handleAISuggestion = async (
    target: DiffTarget,
    original: string,
    suggested: string,
  ) => {
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

  const handleAcceptDiff = async () => {
    if (!diff) return;
    setOverOnePage(false);

    if (diff.target === "resume") {
      setResumeLatex(diff.suggested);
      if (activeProject)
        triggerAutoSave(diff.suggested, activeProject, "resume");
    } else {
      setCoverLetterLatex(diff.suggested);
      if (activeProject)
        triggerAutoSave(diff.suggested, activeProject, "cover_letter");
    }
    setDiff(null);

    setCompiling(true);
    try {
      const result = await compileLatex(diff.suggested);
      setPdfBase64(result.pdf_base64);
      setCompileError(result.error);
      if (result.pdf_base64 && diff.target === "resume") {
        const pages = await countPdfPages(result.pdf_base64);
        if (pages > 1) {
          setOverOnePage(true);
          analyzeLayout(result.pdf_base64).then(setBulletAnalysis);
        }
      }
    } finally {
      setCompiling(false);
    }
  };

  const handleRejectDiff = () => {
    // Restore the latex content to before the diff (important for auto-trim diffs
    // where the latex was already applied during the loop)
    if (diff?.target === "resume") setResumeLatex(diff.original);
    else if (diff?.target === "cover_letter")
      setCoverLetterLatex(diff.original);
    setDiff(null);
    setOverOnePage(false);
    setBulletAnalysis(null);
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
        pinnedResumes={pinnedProjects}
        onTogglePin={handleTogglePin}
        onSelect={handleSelect}
        onNew={handleNew}
        onRename={handleRename}
        onRefresh={fetchProjects}
        onNewJob={() => setShowNewJobModal(true)}
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
                    Reviewing AI changes to{" "}
                    {diff.target === "cover_letter" ? "cover letter" : "resume"}{" "}
                    — PDF shows accepted result
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

            {/* Over-page banner */}
            {overOnePage && !diff && activeTab === "resume" && (
              <div className="flex items-center gap-3 px-4 py-1.5 bg-amber-900/40 border-b border-amber-700/50 text-amber-300 text-xs flex-shrink-0">
                <span className="flex-1">
                  Resume is over 1 page after the last edit.
                </span>
                <button
                  onClick={handleAutoTrim}
                  className="px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium transition-colors"
                >
                  Trim in chat
                </button>
                <button
                  onClick={() => setOverOnePage(false)}
                  className="text-amber-500 hover:text-amber-300 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Editor body */}
            <div className="flex-1 min-h-0 relative">
              {/* Normal editor — always mounted to preserve undo history */}
              <div
                className={`absolute inset-0 ${diff ? "invisible" : "visible"}`}
              >
                {activeProject || activeLatex ? (
                  <LatexEditor
                    value={activeLatex}
                    onChange={handleLatexChange}
                  />
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
            <PdfPreview
              pdfBase64={pdfBase64}
              error={compileError}
              loading={compiling}
            />
          </div>
        </div>

        {/* AI Panel */}
        {(activeProject || activeLatex) && !diff && showAIPanel && (
          <AIPanel
            ref={aiPanelRef}
            resumeLatex={resumeLatex}
            coverLetterLatex={coverLetterLatex}
            pdfBase64={pdfBase64}
            projectName={activeProject}
            onSuggestion={handleAISuggestion}
            bulletAnalysis={bulletAnalysis}
            onAutoTrimApply={handleAutoTrimApply}
          />
        )}
      </div>

      {/* New Job Modal */}
      {showNewJobModal && (
        <NewJobModal
          pinnedProjects={pinnedProjects}
          onClose={() => setShowNewJobModal(false)}
          onCreate={handleNewJob}
        />
      )}
    </div>
  );
}
