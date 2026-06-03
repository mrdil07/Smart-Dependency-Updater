/**
 * Cleans and analyzes raw GitHub Actions logs.
 *
 * GitHub log lines look like:
 *   2024-01-02T03:04:05.1234567Z   error TS2554: Expected 1 arguments...
 * and may contain ANSI colour codes. We strip both, then extract the most
 * relevant error context and the source files referenced by the failures.
 *
 * Everything here is pure (no I/O) so it is straightforward to unit test.
 */
import { FileReference, ParsedLog } from '../types';

// Matches ANSI SGR sequences: ESC [ ... m  (ESC = U+001B).
const ANSI_REGEX = /\u001b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;

/** Lines that strongly indicate an error worth showing the model. */
const ERROR_SIGNAL_REGEX =
  /\b(error|errors|failed|failure|exception|traceback|assert|assertion|cannot find|is not a function|is not defined|has no exported member|undefined is not|typeerror|referenceerror|syntaxerror|importerror|modulenotfounderror|deprecat|no overload|does not exist|expected|unexpected)\b|error ts\d+|✕|✗|×|✖/i;

/** Noise we never want to forward to the model. */
const NOISE_REGEX =
  /^(##\[group\]|##\[endgroup\]|##\[debug\]|\[command\]|Requirement already satisfied|Receiving objects|Resolving deltas|remote:|Downloading |Collecting |Installing |added \d+ packages|npm warn|npm notice)/i;

/** Known source-code extensions used to filter file references. */
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rb',
  'java',
  'kt',
  'rs',
  'php',
  'cs',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'swift',
  'scala',
  'vue',
  'svelte',
]);

/** Path patterns we never want to treat as a fixable source file. */
const PATH_BLOCKLIST_REGEX =
  /(^|\/)(node_modules|dist|build|vendor|\.venv|venv|site-packages|\.git|coverage)\//i;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '');
}

export function stripTimestamps(input: string): string {
  return input
    .split('\n')
    .map((line) => line.replace(TIMESTAMP_REGEX, ''))
    .join('\n');
}

/** Strip ANSI codes and per-line timestamps, normalize line endings. */
export function cleanLog(raw: string): string {
  return stripTimestamps(stripAnsi(raw.replace(/\r\n?/g, '\n'))).trimEnd();
}

function hasCodeExtension(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return CODE_EXTENSIONS.has(ext);
}

function normalizePath(path: string): string {
  // Drop a leading "./" and any "<workspace>/" absolute prefix we can detect.
  let p = path.replace(/^\.\//, '');
  const runnerMatch = p.match(
    /\/(?:home|Users)\/[^/]+\/work\/[^/]+\/[^/]+\/(.+)$/,
  );
  if (runnerMatch) {
    p = runnerMatch[1];
  }
  return p;
}

/**
 * Extract source-file references from a cleaned log. Recognizes the common
 * formats emitted by tsc, eslint, jest, node stack traces, python tracebacks,
 * go, and generic `path:line:col` output.
 */
export function extractFileReferences(cleaned: string): FileReference[] {
  const byPath = new Map<string, FileReference>();

  const record = (rawPath: string, line?: number, column?: number): void => {
    const path = normalizePath(rawPath);
    if (!path || path.length < 3) return;
    if (!hasCodeExtension(path)) return;
    if (PATH_BLOCKLIST_REGEX.test(`/${path}/`)) return;

    const existing = byPath.get(path);
    if (existing) {
      existing.hits += 1;
      if (existing.line === undefined && line !== undefined) {
        existing.line = line;
        existing.column = column;
      }
    } else {
      byPath.set(path, { path, line, column, hits: 1 });
    }
  };

  // Python: File "path/to/file.py", line 12
  const pyRegex = /File "([^"]+)", line (\d+)/g;
  for (const m of cleaned.matchAll(pyRegex)) {
    record(m[1], Number.parseInt(m[2], 10));
  }

  // Generic path:line:col or path:line  (tsc, eslint, node, go, ...).
  // Allows an optional "(", "@" or whitespace before the path.
  const genericRegex =
    /(?:^|\s|\(|@)([A-Za-z0-9_./\\-]+\.[A-Za-z]+):(\d+)(?::(\d+))?/gm;
  for (const m of cleaned.matchAll(genericRegex)) {
    const line = Number.parseInt(m[2], 10);
    const column = m[3] ? Number.parseInt(m[3], 10) : undefined;
    record(m[1].replace(/\\/g, '/'), line, column);
  }

  return Array.from(byPath.values()).sort((a, b) => b.hits - a.hits);
}

/**
 * Build a focused excerpt: keep windows of lines around each error signal,
 * drop obvious noise, and cap the total size so the prompt stays bounded.
 */
export function extractErrorExcerpt(cleaned: string, maxChars = 12000): string {
  const lines = cleaned.split('\n');
  const keep = new Array<boolean>(lines.length).fill(false);
  const windowBefore = 4;
  const windowAfter = 8;

  let anySignal = false;
  for (let i = 0; i < lines.length; i++) {
    if (ERROR_SIGNAL_REGEX.test(lines[i])) {
      anySignal = true;
      const start = Math.max(0, i - windowBefore);
      const end = Math.min(lines.length - 1, i + windowAfter);
      for (let j = start; j <= end; j++) {
        keep[j] = true;
      }
    }
  }

  // If nothing matched, fall back to the tail of the log (errors usually land
  // near the end of a failing job).
  if (!anySignal) {
    const tail = lines.slice(-120).filter((l) => !NOISE_REGEX.test(l.trim()));
    return clampToChars(tail.join('\n'), maxChars);
  }

  const out: string[] = [];
  let lastKept = -2;
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) continue;
    if (NOISE_REGEX.test(lines[i].trim())) continue;
    if (i > lastKept + 1 && out.length > 0) {
      out.push('  …');
    }
    out.push(lines[i]);
    lastKept = i;
  }

  return clampToChars(out.join('\n'), maxChars);
}

function clampToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Keep the end — the most actionable errors are usually last.
  return '… (truncated) …\n' + text.slice(text.length - maxChars);
}

/** Full pipeline: raw log -> cleaned, excerpt, and ranked file references. */
export function parseLog(raw: string): ParsedLog {
  const cleaned = cleanLog(raw);
  return {
    cleaned,
    errorExcerpt: extractErrorExcerpt(cleaned),
    fileReferences: extractFileReferences(cleaned),
  };
}
