import type { ProviderConfig, ProviderPreset } from '@aide/shared';
import { PROVIDER_PRESETS } from '@aide/shared';
import type { LLMProvider, ProviderFactory } from './types.js';
import { OpenAICompatProvider } from './openai-compat.js';

// ---------------------------------------------------------------------------
// Built-in provider implementations
// Each Chinese LLM is just a thin subclass that sets id/name and optionally
// overrides capability flags or thinking params.
// ---------------------------------------------------------------------------

class DeepSeekProvider extends OpenAICompatProvider {
  readonly id = 'deepseek';
  readonly name = 'DeepSeek';

  supportsThinking(): boolean {
    // deepseek-reasoner supports thinking; deepseek-chat does not
    return this.model.includes('reasoner');
  }

  protected override applyThinkingParams(
    body: Record<string, unknown>,
    request: import('./types.js').CompletionRequest,
  ): void {
    body.thinking = { type: 'enabled' };
    // Remove temperature — incompatible with thinking mode
    delete body.temperature;
    const effortMap: Record<string, string> = { low: 'medium', medium: 'high', high: 'max' };
    body.reasoning_effort = effortMap[request.thinkingEffort ?? 'medium'] ?? 'high';
  }
}

class QwenProvider extends OpenAICompatProvider {
  readonly id = 'qwen';
  readonly name = 'Qwen';

  supportsThinking(): boolean {
    return this.model.startsWith('qwq');
  }

  supportsVision(): boolean {
    return this.model.includes('vl');
  }
}

class GLMProvider extends OpenAICompatProvider {
  readonly id = 'glm';
  readonly name = 'GLM';

  supportsVision(): boolean {
    return true;
  }
}

class KimiProvider extends OpenAICompatProvider {
  readonly id = 'kimi';
  readonly name = 'Kimi';
}

class DoubaoProvider extends OpenAICompatProvider {
  readonly id = 'doubao';
  readonly name = 'Doubao';

  supportsVision(): boolean {
    return true;
  }
}

class MiniMaxProvider extends OpenAICompatProvider {
  readonly id = 'minimax';
  readonly name = 'MiniMax';
}

/** Generic fallback for any OpenAI-compatible endpoint */
class GenericOpenAICompatProvider extends OpenAICompatProvider {
  readonly id: string;
  readonly name: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.id = config.id;
    this.name = config.name;
  }
}

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

const BUILT_IN_FACTORIES: Record<string, new (config: ProviderConfig) => LLMProvider> = {
  deepseek: DeepSeekProvider,
  qwen: QwenProvider,
  glm: GLMProvider,
  kimi: KimiProvider,
  doubao: DoubaoProvider,
  minimax: MiniMaxProvider,
};

export class ProviderRegistry {
  private factories = new Map<string, ProviderFactory>();
  private instances = new Map<string, LLMProvider>();

  constructor() {
    // Register all built-in factories
    for (const [id, Cls] of Object.entries(BUILT_IN_FACTORIES)) {
      this.registerFactory(id, (config) => new Cls(config));
    }
  }

  /**
   * Register a custom provider factory.
   * Call this before `get` to override a built-in or add a new provider.
   */
  registerFactory(id: string, factory: ProviderFactory): void {
    this.factories.set(id, factory);
    this.invalidate(id);
  }

  /**
   * Get (or create) a provider instance for the given config.
   * Instances are cached per id + endpoint + model + key, so changing the key
   * or model in the settings takes effect on the next request.
   */
  get(config: ProviderConfig): LLMProvider {
    const key = cacheKey(config);
    const cached = this.instances.get(key);
    if (cached) return cached;

    const factory = this.factories.get(config.id);
    const instance = factory ? factory(config) : new GenericOpenAICompatProvider(config);
    this.instances.set(key, instance);
    return instance;
  }

  /** Drop every cached instance for a provider id. */
  invalidate(id: string): void {
    for (const key of [...this.instances.keys()]) {
      if (key.startsWith(`${id}\u0000`)) this.instances.delete(key);
    }
  }

  /** Return all known provider presets (from @aide/shared constants). */
  getPresets(): ProviderPreset[] {
    return PROVIDER_PRESETS;
  }

  /** Return the preset for a given provider id, or undefined. */
  getPreset(id: string): ProviderPreset | undefined {
    return PROVIDER_PRESETS.find((p) => p.id === id);
  }
}

function cacheKey(config: ProviderConfig): string {
  return [config.id, config.baseUrl, config.model, config.apiKey].join('\u0000');
}

/** Singleton registry — import this in agent.ts and ipc-server.ts */
export const providerRegistry = new ProviderRegistry();
