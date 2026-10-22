import type { ProviderPreset } from './types.js';

export const APP_NAME = 'AiDE';
export const APP_VERSION = '0.1.0';

export const DEFAULT_MAX_ITERATIONS = 50;
export const DEFAULT_TOOL_OUTPUT_LIMIT = 50000;
export const DEFAULT_THINKING_EFFORT = 'medium' as const;

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    nameZh: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: false,
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', contextWindow: 64000, supportsToolUse: true, supportsThinking: false },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', contextWindow: 64000, supportsToolUse: false, supportsThinking: true },
    ],
  },
  {
    id: 'qwen',
    name: 'Qwen (Alibaba)',
    nameZh: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    supportsToolUse: true,
    supportsThinking: true,
    supportsVision: true,
    models: [
      { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32000, supportsToolUse: true, supportsThinking: false },
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072, supportsToolUse: true, supportsThinking: false },
      { id: 'qwq-plus', name: 'QwQ Plus', contextWindow: 131072, supportsToolUse: true, supportsThinking: true },
    ],
  },
  {
    id: 'glm',
    name: 'GLM (Zhipu)',
    nameZh: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: true,
    models: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000, supportsToolUse: true, supportsThinking: false },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000, supportsToolUse: true, supportsThinking: false },
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    nameZh: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: false,
    models: [
      { id: 'moonshot-v1-128k', name: 'Moonshot 128K', contextWindow: 128000, supportsToolUse: true, supportsThinking: false },
      { id: 'moonshot-v1-32k', name: 'Moonshot 32K', contextWindow: 32000, supportsToolUse: true, supportsThinking: false },
    ],
  },
  {
    id: 'doubao',
    name: 'Doubao (ByteDance)',
    nameZh: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: true,
    models: [
      { id: 'doubao-1.5-pro-256k', name: 'Doubao 1.5 Pro 256K', contextWindow: 256000, supportsToolUse: true, supportsThinking: false },
      { id: 'doubao-1.5-lite-32k', name: 'Doubao 1.5 Lite 32K', contextWindow: 32000, supportsToolUse: true, supportsThinking: false },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    nameZh: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    supportsToolUse: true,
    supportsThinking: false,
    supportsVision: false,
    models: [
      { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', contextWindow: 1000000, supportsToolUse: true, supportsThinking: false },
    ],
  },
];
