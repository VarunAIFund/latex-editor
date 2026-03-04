import { AlertCircle, Loader2 } from "lucide-react";

interface Props {
  pdfBase64: string | null;
  error: string | null;
  loading: boolean;
}

export default function PdfPreview({ pdfBase64, error, loading }: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-800 relative">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">PDF Preview</span>
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-indigo-400">
            <Loader2 size={12} className="animate-spin" />
            Compiling…
          </span>
        )}
      </div>

      {error && (
        <div className="m-3 p-3 bg-red-900/40 border border-red-700 rounded-lg">
          <div className="flex items-center gap-2 text-red-400 text-xs font-semibold mb-1">
            <AlertCircle size={13} />
            Compilation Error
          </div>
          <pre className="text-red-300 text-xs whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
            {error}
          </pre>
        </div>
      )}

      {pdfBase64 ? (
        <iframe
          title="PDF Preview"
          src={`data:application/pdf;base64,${pdfBase64}`}
          className="flex-1 w-full border-0"
        />
      ) : (
        !loading &&
        !error && (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            PDF preview will appear here
          </div>
        )
      )}
    </div>
  );
}
