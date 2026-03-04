import { useState, useEffect, useRef, useCallback } from "react";
import { Save, Mail, RefreshCw, FileDown, Check, X, Sparkles } from "lucide-react";
import ResumeSidebar from "./components/ResumeSidebar";
import LatexEditor from "./components/LatexEditor";
import PdfPreview from "./components/PdfPreview";
import AIPanel from "./components/AIPanel";
import CoverLetterModal from "./components/CoverLetterModal";
import MarginsPanel from "./components/MarginsPanel";
import { compileLatex, listResumes, loadResume, saveResume } from "./api";

const BLANK_TEMPLATE = String.raw`\documentclass[letterpaper,11pt]{article}
\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.50in}
\addtolength{\evensidemargin}{-0.50in}
\addtolength{\textwidth}{1.00in}
\addtolength{\topmargin}{-0.50in}
\addtolength{\textheight}{1.00in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\begin{document}

\begin{center}
    \textbf{\Huge \scshape Your Name} \\ \vspace{1pt}
    \small 123-456-7890 $|$ \href{mailto:you@email.com}{\underline{you@email.com}}
\end{center}

\section{Education}
\begin{itemize}[leftmargin=0.15in, label={}]
  \item \textbf{Your University} \hfill City, State \\
  Bachelor of Science in Your Major \hfill Aug 2020 -- May 2024
\end{itemize}

\section{Experience}
\begin{itemize}[leftmargin=0.15in, label={}]
  \item \textbf{Your Company} \hfill City, State \\
  \textit{Your Role} \hfill Jan 2023 -- Present
  \begin{itemize}
    \item Accomplished X by doing Y which resulted in Z
  \end{itemize}
\end{itemize}

\section{Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
  \small{\item{
    \textbf{Languages}{: Python, JavaScript, Java} \\
    \textbf{Frameworks}{: React, FastAPI, Node.js}
  }}
\end{itemize}

\end{document}`;

export default function App() {
  const [resumes, setResumes] = useState<string[]>([]);
  const [activeResume, setActiveResume] = useState<string | null>(null);
  const [latex, setLatex] = useState("");
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diff, setDiff] = useState<{ original: string; suggested: string } | null>(null);
  const [showCoverLetter, setShowCoverLetter] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);
  // Cache the pre-diff PDF so we can restore it on reject
  const preDiffPdfRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchResumes = useCallback(async () => {
    const names = await listResumes();
    setResumes(names);
  }, []);

  useEffect(() => {
    fetchResumes();
  }, [fetchResumes]);

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

  const handleLatexChange = (val: string) => {
    setLatex(val);
    triggerCompile(val);
  };

  const handleSelect = async (name: string) => {
    const src = await loadResume(name);
    setActiveResume(name);
    setLatex(src);
    setDiff(null);
    triggerCompile(src);
  };

  const handleNew = async (name: string, src?: string) => {
    const content = src ?? BLANK_TEMPLATE;
    await saveResume(name, content);
    await fetchResumes();
    setActiveResume(name);
    setLatex(content);
    setDiff(null);
    triggerCompile(content);
  };

  const handleSave = async () => {
    if (!activeResume) {
      const name = window.prompt("Save as (resume name):");
      if (!name?.trim()) return;
      await saveResume(name.trim(), latex);
      setActiveResume(name.trim());
      await fetchResumes();
      return;
    }
    setSaving(true);
    await saveResume(activeResume, latex);
    setSaving(false);
  };

  const handleSaveAs = async () => {
    const suggested = activeResume ? `${activeResume} (copy)` : "";
    const name = window.prompt("Save as (new name):", suggested);
    if (!name?.trim()) return;
    await saveResume(name.trim(), latex);
    setActiveResume(name.trim());
    await fetchResumes();
  };

  // Called when AI returns a suggestion — switch to inline diff mode
  // and immediately compile the suggested version for the live preview
  const handleAISuggestion = async (original: string, suggested: string) => {
    preDiffPdfRef.current = pdfBase64; // cache current PDF
    setDiff({ original, suggested });
    // Show what the accepted version would look like
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
    setLatex(diff.suggested);
    setDiff(null);
    // PDF already shows the accepted version — just trigger a fresh compile
    triggerCompile(diff.suggested);
  };

  const handleRejectDiff = () => {
    setDiff(null);
    // Restore the PDF that was showing before the AI suggestion
    if (preDiffPdfRef.current !== null) {
      setPdfBase64(preDiffPdfRef.current);
      setCompileError(null);
    }
  };

  const downloadPdf = () => {
    if (!pdfBase64) return;
    const link = document.createElement("a");
    link.href = `data:application/pdf;base64,${pdfBase64}`;
    link.download = `${activeResume ?? "resume"}.pdf`;
    link.click();
  };

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <ResumeSidebar
        resumes={resumes}
        activeResume={activeResume}
        onSelect={handleSelect}
        onNew={handleNew}
        onRefresh={fetchResumes}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top toolbar */}
        <header className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-sm">
              {activeResume ?? "LaTeX Resume Editor"}
            </span>
            {activeResume && (
              <span className="text-gray-500 text-xs">
                — {resumes.length} resume{resumes.length !== 1 ? "s" : ""} saved
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <MarginsPanel latex={latex} onChange={handleLatexChange} />

            <button
              onClick={() => triggerCompile(latex)}
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
              onClick={() => setShowCoverLetter(true)}
              disabled={!latex}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 text-white text-xs font-medium transition-colors disabled:cursor-not-allowed"
            >
              <Mail size={13} />
              Cover Letter
            </button>

            <button
              onClick={handleSaveAs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-medium transition-colors"
            >
              Save As…
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-xs font-medium transition-colors"
            >
              <Save size={13} />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {/* Editor + Preview */}
        <div className="flex-1 flex min-h-0">
          {/* Editor pane */}
          <div className="flex flex-col w-1/2 min-w-0 border-r border-gray-700">
            {/* Editor header — shows diff controls when in diff mode */}
            <div className="flex items-center justify-between px-4 py-1.5 bg-gray-900 border-b border-gray-700 shrink-0">
              {diff ? (
                <>
                  <span className="text-xs text-amber-400 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                    Reviewing AI changes — PDF shows accepted result
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleRejectDiff}
                      className="flex items-center gap-1 px-3 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-medium transition-colors"
                    >
                      <X size={11} />
                      Reject
                    </button>
                    <button
                      onClick={handleAcceptDiff}
                      className="flex items-center gap-1 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                    >
                      <Check size={11} />
                      Accept
                    </button>
                  </div>
                </>
              ) : (
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                  LaTeX Source
                </span>
              )}
            </div>

            {/* Editor body */}
            <div className="flex-1 min-h-0 relative">
              {/* Normal editor — always mounted so undo history survives accept */}
              <div className={`absolute inset-0 ${diff ? "invisible" : "visible"}`}>
                {latex !== undefined && (
                  <LatexEditor value={latex} onChange={handleLatexChange} />
                )}
                {!activeResume && !latex && (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    Select or create a resume from the sidebar
                  </div>
                )}
              </div>

              {/* Diff viewer — overlays the editor only during review */}
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
        {(activeResume || latex) && !diff && showAIPanel && (
          <AIPanel latex={latex} onSuggestion={handleAISuggestion} />
        )}
      </div>

      {/* Cover Letter modal */}
      {showCoverLetter && (
        <CoverLetterModal
          resumeLatex={latex}
          onClose={() => setShowCoverLetter(false)}
        />
      )}
    </div>
  );
}
