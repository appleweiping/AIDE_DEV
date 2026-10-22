import { readFile, stat } from 'node:fs/promises';
import { resolvePath } from './path-guard.js';
import type { RegisteredTool, ToolResult } from './registry.js';

const DEFINITION = {
  name: 'file_read',
  description:
    'Read the contents of a file. Returns the file content with line numbers. ' +
    'Use offset and limit to read a specific range of lines.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read.',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-indexed). Defaults to 1.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read. Defaults to 2000.',
      },
    },
    required: ['path'],
  },
};

async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = String(args.path ?? '');
  if (!filePath) {
    return { output: 'Error: path is required', isError: true };
  }

  const absPath = resolvePath(filePath);
  const offset = typeof args.offset === 'number' ? Math.max(1, Math.floor(args.offset)) : 1;
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 2000;

  let content: string;
  try {
    const stats = await stat(absPath);
    if (stats.isDirectory()) {
      return { output: `Error: ${absPath} is a directory, not a file`, isError: true };
    }
    content = await readFile(absPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Error reading file: ${message}`, isError: true };
  }

  const lines = content.split('\n');
  const totalLines = lines.length;

  // offset is 1-indexed
  const startIdx = offset - 1;
  const endIdx = Math.min(startIdx + limit, totalLines);

  if (startIdx >= totalLines) {
    return {
      output: `File has ${totalLines} lines; offset ${offset} is out of range.`,
      isError: false,
    };
  }

  const selectedLines = lines.slice(startIdx, endIdx);
  const numbered = selectedLines
    .map((line, i) => `${String(startIdx + i + 1).padStart(6)}\t${line}`)
    .join('\n');

  const header =
    `File: ${absPath}\n` +
    `Lines: ${startIdx + 1}-${endIdx} of ${totalLines}\n` +
    `${'─'.repeat(60)}\n`;

  return { output: header + numbered, isError: false };
}

export const fileReadTool: RegisteredTool = {
  definition: DEFINITION,
  handler,
};
