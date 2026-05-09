import {
  CodeFileIcon,
  DataFileIcon,
  DocumentIcon,
  ImageFileIcon,
  StyleFileIcon,
} from "../components/icons";

type IconKind = "code" | "data" | "doc" | "image" | "style";

const EXTENSION_MAP: Record<string, IconKind> = {
  // Code
  ts: "code", tsx: "code", js: "code", jsx: "code", mjs: "code", cjs: "code",
  py: "code", rb: "code", rs: "code", go: "code", java: "code", kt: "code",
  c: "code", h: "code", cpp: "code", cc: "code", cxx: "code", hpp: "code",
  cs: "code", swift: "code", php: "code", lua: "code", sh: "code", bash: "code",
  zsh: "code", fish: "code", ps1: "code", vue: "code", svelte: "code",
  // Data / config
  json: "data", yaml: "data", yml: "data", toml: "data", xml: "data",
  ini: "data", env: "data", lock: "data", csv: "data", tsv: "data",
  // Style
  css: "style", scss: "style", sass: "style", less: "style", styl: "style",
  // Docs / text
  md: "doc", markdown: "doc", mdx: "doc", txt: "doc", rst: "doc",
  // Image
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  webp: "image", avif: "image", bmp: "image", ico: "image",
  // Web
  html: "code", htm: "code", sql: "code",
};

const SPECIAL_FILES: Record<string, IconKind> = {
  dockerfile: "code",
  makefile: "code",
  ".gitignore": "data",
  ".gitattributes": "data",
  ".npmrc": "data",
  ".dockerignore": "data",
  "package.json": "data",
  "tsconfig.json": "data",
  "license": "doc",
  "readme.md": "doc",
};

export function fileIconKind(name: string): IconKind {
  const lower = name.toLowerCase();
  if (lower in SPECIAL_FILES) return SPECIAL_FILES[lower];
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "doc";
  const ext = lower.slice(dot + 1);
  return EXTENSION_MAP[ext] ?? "doc";
}

export function FileIcon({ name, size = 12 }: { name: string; size?: number }) {
  const kind = fileIconKind(name);
  switch (kind) {
    case "code":
      return <CodeFileIcon size={size} />;
    case "data":
      return <DataFileIcon size={size} />;
    case "image":
      return <ImageFileIcon size={size} />;
    case "style":
      return <StyleFileIcon size={size} />;
    case "doc":
    default:
      return <DocumentIcon size={size} />;
  }
}
