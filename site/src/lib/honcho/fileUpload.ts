export const FILE_UPLOAD_ACCEPT = [
  ".pdf",
  ".json",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".log",
  ".sql",
  ".html",
  ".htm",
  ".css",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".sh",
  ".zsh",
  ".bash",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".swift",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".rb",
  ".php",
  "text/*",
].join(",");

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "log",
  "sql",
  "html",
  "htm",
  "css",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "sh",
  "zsh",
  "bash",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "swift",
  "java",
  "kt",
  "kts",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "hpp",
  "rb",
  "php",
]);

/** Infer a supported MIME type when browsers leave code/text files untyped. */
export function supportedUploadContentType(fileName: string, reportedType: string): string | null {
  const type = reportedType.toLowerCase().split(";", 1)[0].trim();
  if (type === "application/pdf" || type === "application/json" || type.startsWith("text/")) {
    return type;
  }

  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf") return "application/pdf";
  if (extension === "json") return "application/json";
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain";
  return null;
}

export function prepareUploadFile(file: File): File | null {
  const contentType = supportedUploadContentType(file.name, file.type);
  if (!contentType) return null;
  if (file.type === contentType) return file;
  return new File([file], file.name, {
    type: contentType,
    lastModified: file.lastModified,
  });
}
