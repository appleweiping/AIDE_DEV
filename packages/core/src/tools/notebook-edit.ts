import * as fs from 'node:fs';
import * as path from 'node:path';
import { notebookEditDefinition } from './definitions-extra.js';
import { resolvePath, validateWritePath } from './path-guard.js';

export const notebookEditTool = {
  definition: notebookEditDefinition,

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = resolvePath(String(args.path ?? ''));
    const denied = validateWritePath(filePath);
    if (denied) throw new Error(denied);
    const cellIndex = args.cellIndex as number;
    const mode = args.mode as 'replace' | 'insert' | 'delete';
    const cellType = (args.cellType as string) || 'code';
    const source = (args.source as string) || '';

    if (!fs.existsSync(filePath)) {
      if (mode !== 'insert') {
        return `Error: File not found: ${filePath}`;
      }
      const notebook = createEmptyNotebook();
      notebook.cells.push(createCell(cellType, source));
      fs.writeFileSync(filePath, JSON.stringify(notebook, null, 2), 'utf-8');
      return `Created notebook with 1 ${cellType} cell`;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let notebook: NotebookDocument;
    try {
      notebook = JSON.parse(content);
    } catch {
      return `Error: Invalid notebook JSON in ${filePath}`;
    }

    if (!notebook.cells) {
      notebook.cells = [];
    }

    switch (mode) {
      case 'replace': {
        if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
          return `Error: Cell index ${cellIndex} out of range (0-${notebook.cells.length - 1})`;
        }
        notebook.cells[cellIndex] = createCell(cellType, source);
        break;
      }
      case 'insert': {
        const insertAt = Math.min(Math.max(0, cellIndex), notebook.cells.length);
        notebook.cells.splice(insertAt, 0, createCell(cellType, source));
        break;
      }
      case 'delete': {
        if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
          return `Error: Cell index ${cellIndex} out of range (0-${notebook.cells.length - 1})`;
        }
        notebook.cells.splice(cellIndex, 1);
        break;
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(notebook, null, 2), 'utf-8');
    return `Notebook ${mode}d cell at index ${cellIndex}. Total cells: ${notebook.cells.length}`;
  },
};

interface NotebookCell {
  cell_type: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface NotebookDocument {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
}

function createEmptyNotebook(): NotebookDocument {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: { name: 'python', version: '3.11.0' },
    },
    cells: [],
  };
}

function createCell(type: string, source: string): NotebookCell {
  const cell: NotebookCell = {
    cell_type: type,
    source: source.split('\n').map((line, i, arr) => (i < arr.length - 1 ? line + '\n' : line)),
    metadata: {},
  };
  if (type === 'code') {
    cell.outputs = [];
    cell.execution_count = null;
  }
  return cell;
}
