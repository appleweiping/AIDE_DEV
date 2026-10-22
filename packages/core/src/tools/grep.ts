import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { resolvePath, getWorkingDirectory } from './path-guard.js';
import type { RegisteredTool, ToolResult } from './registry.js';

const DEFINITION = {
  name: 'grep',
  description:
    'Search for a pattern in file contents. ' +
    'Uses ripgrep (rg) if available for speed; falls back to a built-in recursive search. ' +
    'Supports regular expressions. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in. Defaults to current working directory.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files, e.g. "*.ts" or "*.{js,ts}".',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'If true, perform case-insensitive matching. Defaults to false.',
      },
      context_lines: {
        type: 'number',
        description: 'Number of lines of context to show before and after each match. Defaults to 0.',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of matching lines to return. Defaults to 200.',
      },
    },
    required: ['pattern'],
  },
};

async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = String(args.pattern ?? '').trim();
  if (!pattern) {
    return { output: 'Error: pattern is required', isError: true };
  }

  const searchPath = args.path ? resolvePath(String(args.path)) : getWorkingDirectory();
  const glob = args.glob ? String(args.glob) : undefined;
  const caseInsensitive = Boolean(args.case_insensitive);
  const contextLines = typeof args.context_lines === 'number' ? Math.max(0, args.context_lines) : 0;
  const maxResults = typeof args.max_results === 'number' ? Math.max(1, args.max_results) : 200;

  // Try ripgrep first
  const rgAvailable = await isRipgrepAvailable();
  if (rgAvailable) {
    return runRipgrep(pattern, searchPath, { glob, caseInsensitive, contextLines, maxResults });
  }

  // Fall back to built-in search
  return runBuiltinSearch(pattern, searchPath, { glob, caseInsensitive, contextLines, maxResults });
}

// ---------------------------------------------------------------------------
// Ripgrep implementation
// ---------------------------------------------------------------------------

interface SearchOptions {
  glob?: string;
  caseInsensitive: boolean;
  contextLines: number;
  maxResults: number;
}

async function runRipgrep(
  pattern: string,
  searchPath: string,
  opts: SearchOptions,
): Promise<ToolResult> {
  const rgArgs: string[] = [
    '--line-number',
    '--no-heading',
    '--color=never',
    `--max-count=${opts.maxResults}`,
  ];

  if (opts.caseInsensitive) rgArgs.push('--ignore-case');
  if (opts.contextLines > 0) rgArgs.push(`--context=${opts.contextLines}`);
  if (opts.glob) rgArgs.push(`--glob=${opts.glob}`);

  rgArgs.push(pattern, searchPath);

  return new Promise<ToolResult>((resolve_) => {
    let stdout = '';
    let stderr = '';

    const child = spawn('rg', rgArgs, { windowsHide: true });

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        // rg exits 1 when no matches found
        const output = stdout.trimEnd();
        if (!output) {
          resolve_({ output: `No matches found for "${pattern}"`, isError: false });
        } else {
          const lines = output.split('\n');
          const header = `Found ${lines.length} match(es) for "${pattern}":\n`;
          resolve_({ output: header + output, isError: false });
        }
      } else {
        resolve_({
          output: `ripgrep error (exit ${code}): ${stderr.slice(0, 500)}`,
          isError: true,
        });
      }
    });

    child.on('error', () => {
      // rg not found — should not happen since we checked, but handle gracefully
      resolve_({ output: 'ripgrep not available', isError: true });
    });
  });
}

// ---------------------------------------------------------------------------
// Built-in fallback search
// ---------------------------------------------------------------------------

async function runBuiltinSearch(
  pattern: string,
  searchPath: string,
  opts: SearchOptions,
): Promise<ToolResult> {
  const flags = opts.caseInsensitive ? 'i' : '';
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    return { output: `Invalid regex: ${pattern}`, isError: true };
  }

  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache']);
  const results: string[] = [];
  let totalMatches = 0;

  // Build glob filter regex if provided
  const globRegex = opts.glob ? buildGlobRegex(opts.glob) : null;

  async function walk(dir: string): Promise<void> {
    if (totalMatches >= opts.maxResults) return;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (totalMatches >= opts.maxResults) break;

      const fullPath = join(dir, entry);
      let stats;
      try {
        stats = await stat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) await walk(fullPath);
      } else {
        if (globRegex && !globRegex.test(entry)) continue;

        let content: string;
        try {
          content = await readFile(fullPath, 'utf-8');
        } catch {
          continue; // Skip binary or unreadable files
        }

        const lines = content.split('\n');
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          if (totalMatches >= opts.maxResults) break;
          if (regex.test(lines[lineIdx])) {
            totalMatches++;

            if (opts.contextLines > 0) {
              const start = Math.max(0, lineIdx - opts.contextLines);
              const end = Math.min(lines.length - 1, lineIdx + opts.contextLines);
              for (let ci = start; ci <= end; ci++) {
                const sep = ci === lineIdx ? ':' : '-';
                results.push(`${fullPath}:${ci + 1}${sep}${lines[ci]}`);
              }
              results.push('--');
            } else {
              results.push(`${fullPath}:${lineIdx + 1}:${lines[lineIdx]}`);
            }
          }
        }
      }
    }
  }

  // Check if searchPath is a file or directory
  let pathStat;
  try {
    pathStat = await stat(searchPath);
  } catch (err) {
    return { output: `Path not found: ${searchPath}`, isError: true };
  }

  if (pathStat.isFile()) {
    // Search single file
    let content: string;
    try {
      content = await readFile(searchPath, 'utf-8');
    } catch (err) {
      return { output: `Cannot read file: ${searchPath}`, isError: true };
    }
    const lines = content.split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (totalMatches >= opts.maxResults) break;
      if (regex.test(lines[lineIdx])) {
        totalMatches++;
        results.push(`${searchPath}:${lineIdx + 1}:${lines[lineIdx]}`);
      }
    }
  } else {
    await walk(searchPath);
  }

  if (results.length === 0) {
    return { output: `No matches found for "${pattern}"`, isError: false };
  }

  const header = `Found ${totalMatches} match(es) for "${pattern}":\n`;
  return { output: header + results.join('\n'), isError: false };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

let rgAvailableCache: boolean | null = null;

async function isRipgrepAvailable(): Promise<boolean> {
  if (rgAvailableCache !== null) return rgAvailableCache;

  return new Promise<boolean>((resolve_) => {
    const child = spawn('rg', ['--version'], { windowsHide: true });
    child.on('close', (code) => {
      rgAvailableCache = code === 0;
      resolve_(rgAvailableCache);
    });
    child.on('error', () => {
      rgAvailableCache = false;
      resolve_(false);
    });
  });
}

function buildGlobRegex(glob: string): RegExp {
  // Simple glob-to-regex for filename matching only (no path separators)
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export const grepTool: RegisteredTool = {
  definition: DEFINITION,
  handler,
};
