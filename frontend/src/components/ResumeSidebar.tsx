import { useState, useRef } from "react";
import { FolderOpen, Plus, Trash2, Upload, ChevronRight, Pencil, Check, X } from "lucide-react";
import { deleteResume, renameResume } from "../api";

interface Props {
  resumes: string[];
  activeResume: string | null;
  onSelect: (name: string) => void;
  onNew: (name: string, latex?: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onRefresh: () => void;
}

export default function ResumeSidebar({
  resumes,
  activeResume,
  onSelect,
  onNew,
  onRename,
  onRefresh,
}: Props) {
  const [newName, setNewName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onNew(name);
    setNewName("");
    setShowNewInput(false);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const latex = reader.result as string;
      const suggested = file.name.replace(/\.tex$/, "");
      const name = window.prompt("Name this project:", suggested) || suggested;
      onNew(name, latex);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDelete = async (name: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"?`)) return;
    await deleteResume(name);
    onRefresh();
  };

  const startRename = (name: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setRenamingName(name);
    setRenameValue(name);
  };

  const commitRename = async () => {
    const newName = renameValue.trim();
    if (!newName || !renamingName) { cancelRename(); return; }
    if (newName === renamingName) { cancelRename(); return; }
    try {
      await renameResume(renamingName, newName);
      onRename(renamingName, newName);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rename failed");
    }
    setRenamingName(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingName(null);
    setRenameValue("");
  };

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-700 flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
          <FolderOpen size={14} />
          Projects
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {resumes.length === 0 && (
          <p className="text-gray-500 text-xs px-4 py-3">No projects yet. Create one below.</p>
        )}
        {resumes.map((name) => (
          <div
            key={name}
            className={`group w-full flex items-center gap-1 px-3 py-2 transition-colors cursor-pointer ${
              activeResume === name
                ? "bg-indigo-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            onClick={() => renamingName !== name && onSelect(name)}
          >
            <ChevronRight
              size={12}
              className={`flex-shrink-0 ${activeResume === name ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}
            />

            {renamingName === name ? (
              /* Inline rename input */
              <div className="flex flex-1 items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") cancelRename();
                  }}
                  className="flex-1 min-w-0 bg-gray-700 text-white text-xs px-1.5 py-0.5 rounded border border-indigo-500 focus:outline-none"
                />
                <span
                  role="button"
                  tabIndex={0}
                  onClick={commitRename}
                  onKeyDown={(e) => e.key === "Enter" && commitRename()}
                  className="text-green-400 hover:text-green-300 flex-shrink-0"
                  title="Confirm rename"
                >
                  <Check size={13} />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={cancelRename}
                  onKeyDown={(e) => e.key === "Enter" && cancelRename()}
                  className="text-gray-400 hover:text-white flex-shrink-0"
                  title="Cancel"
                >
                  <X size={13} />
                </span>
              </div>
            ) : (
              /* Normal row */
              <>
                <span className="flex-1 text-sm truncate min-w-0">{name}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => startRename(name, e)}
                    onKeyDown={(e) => e.key === "Enter" && startRename(name, e)}
                    className="text-gray-400 hover:text-indigo-300 transition-colors"
                    title="Rename"
                  >
                    <Pencil size={12} />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleDelete(name, e)}
                    onKeyDown={(e) => e.key === "Enter" && handleDelete(name, e)}
                    className="text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700 space-y-2">
        {showNewInput ? (
          <div className="flex gap-1">
            <input
              autoFocus
              type="text"
              placeholder="Project name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setShowNewInput(false);
              }}
              className="flex-1 bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={handleCreate}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-2 py-1.5 rounded"
            >
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewInput(true)}
            className="w-full flex items-center gap-2 text-gray-400 hover:text-white text-xs py-1.5 px-2 rounded hover:bg-gray-800 transition-colors"
          >
            <Plus size={13} /> New project
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center gap-2 text-gray-400 hover:text-white text-xs py-1.5 px-2 rounded hover:bg-gray-800 transition-colors"
        >
          <Upload size={13} /> Upload resume.tex
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".tex"
          className="hidden"
          onChange={handleUpload}
        />
      </div>
    </aside>
  );
}
