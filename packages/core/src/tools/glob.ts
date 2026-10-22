import { readdir, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { resolvePath, getWorkingDirectory } from './path-guard.js';
import type { RegisteredTool, ToolResult } from './registry.js';

const DEFINITION = {
  name: 'glob',
  description:
    'Find files matching a glob pattern. ' +
    'Supports ** for recursive matching, * for any filename segment, and ? for single characters. ' +
    'Returns matching file paths sorted by modification time (newest first).',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match, e.g. "**/*.ts" or "src/**/*.{js,ts}".',
      },
      path: {
        type: 'string',
        description: 'Root directory to search in. Defaults to current working directory.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return. Defaults to 500.',
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

  const rootDir = args.path ? resolvePath(String(args.path)) : getWorkingDirectory();
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 500;

  let matches: Array<{ path: string; mtime: number }>;
  try {
    matches = await globSearch(rootDir, pattern, limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Error during glob search: ${message}`, isError: true };
  }

  if (matches.length === 0) {
    return { output: `No files matched pattern "${pattern}" in ${rootDir}`, isError: false };
  }

  // Sort by mtime descending (newest first)
  matches.sort((a, b) => b.mtime - a.mtime);

  const lines = matches.map((m) => m.path);
  const header = `Found ${matches.length} file(s) matching "${pattern}" in ${rootDir}:\n`;
  return { output: header + lines.join('\n'), isError: false };
}

// ---------------------------------------------------------------------------
// Glob implementation (no external dependencies)
// ---------------------------------------------------------------------------

interface FileEntry {
  path: string;
  mtime: number;
}

async function globSearch(rootDir: string, pattern: string, limit: number): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  const regex = globToRegex(pattern);

  // Directories to skip
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache']);

  async function walk(dir: string): Promise<void> {
    if (results.length >= limit) return;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) break;

      const fullPath = join(dir, entry);
      let stats;
      try {
        stats = await stat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) {
          await walk(fullPath);
        }
      } else {
        const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
        if (regex.test(relPath)) {
          results.push({ path: fullPath, mtime: stats.mtimeMs });
        }
      }
    }
  }

  await walk(rootDir);
  return results;
}

/**
 * Convert a glob pattern to a RegExp.
 * Handles: **, *, ?, {a,b}, character classes [abc], and literal escaping.
 */
function globToRegex(pattern: string): RegExp {
  // Normalize path separators
  const normalized = pattern.replace(/\\/g, '/');

  let regexStr = '';
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        // ** matches any path segment including /
        regexStr += '.*';
        i += 2;
        // Skip trailing slash after **
        if (normalized[i] === '/') i++;
      } else {
        // * matches anything except /
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '{') {
      // {a,b,c} → (a|b|c)
      const end = normalized.indexOf('}', i);
      if (end === -1) {
        regexStr += escapeRegex(ch);
        i++;
      } else {
        const options = normalized.slice(i + 1, end).split(',').map(escapeRegex);
        regexStr += `(${options.join('|')})`;
        i = end + 1;
      }
    } else if (ch === '[') {
      // Pass character classes through
      const end = normalized.indexOf(']', i);
      if (end === -1) {
        regexStr += escapeRegex(ch);
        i++;
      } else {
        regexStr += normalized.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      regexStr += escapeRegex(ch);
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`, 'i');
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export const globTool: RegisteredTool = {
  definition: DEFINITION,
  handler,
};
