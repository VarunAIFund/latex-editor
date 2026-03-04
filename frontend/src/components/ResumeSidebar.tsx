import { useState, useRef } from "react";
import { FileText, Plus, Trash2, Upload, ChevronRight } from "lucide-react";
import { deleteResume } from "../api";

interface Props {
  resumes: string[];
  activeResume: string | null;
  onSelect: (name: string) => void;
  onNew: (name: string, latex?: string) => void;
  onRefresh: () => void;
}

export default function ResumeSidebar({
  resumes,
  activeResume,
  onSelect,
  onNew,
  onRefresh,
}: Props) {
  const [newName, setNewName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
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
      const name = window.prompt("Name this resume:", suggested) || suggested;
      onNew(name, latex);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDelete = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"?`)) return;
    await deleteResume(name);
    onRefresh();
  };

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-700 flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
          <FileText size={14} />
          Resume Library
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {resumes.length === 0 && (
          <p className="text-gray-500 text-xs px-4 py-3">No resumes yet. Create or upload one.</p>
        )}
        {resumes.map((name) => (
          <button
            key={name}
            onClick={() => onSelect(name)}
            className={`w-full text-left px-4 py-2.5 flex items-center justify-between group transition-colors ${
              activeResume === name
                ? "bg-indigo-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
          >
            <span className="text-sm truncate flex items-center gap-2">
              <ChevronRight
                size={12}
                className={activeResume === name ? "opacity-100" : "opacity-0 group-hover:opacity-50"}
              />
              {name}
            </span>
            <button
              onClick={(e) => handleDelete(name, e)}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-opacity"
            >
              <Trash2 size={13} />
            </button>
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700 space-y-2">
        {showNewInput ? (
          <div className="flex gap-1">
            <input
              autoFocus
              type="text"
              placeholder="Resume name…"
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
            <Plus size={13} /> New blank resume
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center gap-2 text-gray-400 hover:text-white text-xs py-1.5 px-2 rounded hover:bg-gray-800 transition-colors"
        >
          <Upload size={13} /> Upload .tex template
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
