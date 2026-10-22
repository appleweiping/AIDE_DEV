import type { ToolDefinition } from '@aide/shared';

export const webSearchDefinition: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for information. Returns search results with titles, URLs, and snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      maxResults: { type: 'number', description: 'Maximum number of results (default 5)' },
    },
    required: ['query'],
  },
};

export const webFetchDefinition: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch content from a URL and extract text. Converts HTML to readable text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      selector: { type: 'string', description: 'Optional CSS selector to extract specific content' },
      maxLength: { type: 'number', description: 'Maximum content length to return (default 50000)' },
    },
    required: ['url'],
  },
};

export const notebookEditDefinition: ToolDefinition = {
  name: 'notebook_edit',
  description: 'Edit a Jupyter notebook (.ipynb) cell. Can replace, insert, or delete cells.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the .ipynb file' },
      cellIndex: { type: 'number', description: 'Zero-based cell index to operate on' },
      mode: { type: 'string', enum: ['replace', 'insert', 'delete'], description: 'Edit mode' },
      cellType: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type (for replace/insert)' },
      source: { type: 'string', description: 'New cell content (for replace/insert)' },
    },
    required: ['path', 'cellIndex', 'mode'],
  },
};

export const monitorDefinition: ToolDefinition = {
  name: 'monitor',
  description: 'Start a background monitor that watches a command output. Each stdout line triggers a notification event. Use for log tailing, file watching, or process monitoring.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run (each stdout line is an event)' },
      description: { type: 'string', description: 'Human-readable description of what is being monitored' },
      timeoutMs: { type: 'number', description: 'Kill monitor after this many ms (default 300000)' },
      persistent: { type: 'boolean', description: 'If true, runs for session lifetime (no timeout)' },
    },
    required: ['command', 'description'],
  },
};

export const powershellDefinition: ToolDefinition = {
  name: 'powershell',
  description: 'Execute a PowerShell command (Windows). Use for Windows-specific operations, registry access, and .NET integration.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The PowerShell command to execute' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
      workingDirectory: { type: 'string', description: 'Working directory for the command' },
    },
    required: ['command'],
  },
};

export const nodeReplDefinition: ToolDefinition = {
  name: 'node_repl',
  description: 'Execute JavaScript/TypeScript code in a persistent Node.js REPL. State persists between calls within a session.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript/TypeScript code to execute' },
      reset: { type: 'boolean', description: 'Reset the REPL state before executing' },
    },
    required: ['code'],
  },
};

