import Editor, { DiffEditor } from "@monaco-editor/react";

const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: '"Fira Code", "JetBrains Mono", monospace',
  minimap: { enabled: false },
  wordWrap: "on" as const,
  lineNumbers: "on" as const,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 12, bottom: 12 },
  smoothScrolling: true,
};

interface NormalProps {
  diffMode?: false;
  value: string;
  onChange: (value: string) => void;
}

interface DiffProps {
  diffMode: true;
  original: string;
  suggested: string;
  // onChange not used in diff mode — editor is read-only for review
}

type Props = NormalProps | DiffProps;

export default function LatexEditor(props: Props) {
  if (props.diffMode) {
    return (
      <DiffEditor
        height="100%"
        language="latex"
        theme="vs-dark"
        original={props.original}
        modified={props.suggested}
        options={{
          ...EDITOR_OPTIONS,
          renderSideBySide: false,
          readOnly: true,
          originalEditable: false,
          renderOverviewRuler: false,
        }}
      />
    );
  }

  return (
    <Editor
      height="100%"
      defaultLanguage="latex"
      theme="vs-dark"
      value={props.value}
      onChange={(v) => props.onChange(v ?? "")}
      options={EDITOR_OPTIONS}
    />
  );
}
