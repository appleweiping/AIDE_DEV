# AIDE_DEV

AIDE_DEV is a coding agent for Chinese LLM APIs (DeepSeek, Qwen, GLM, Kimi,
Doubao, MiniMax, or any OpenAI-compatible endpoint): a TypeScript engine that
reads, edits and runs code in a project and asks before risky actions, plus a
Tauri desktop shell around it.

> Not related to WecoAI's AIDE (the ML-engineering agent); the name collision
> is accidental.

## Status

This README is being rewritten together with the code. An earlier version
listed installers, an npm package and features that did not exist; those
lines have been removed. What is true today:

- there are **no prebuilt installers** and **no npm package**; build from
  source;
- the engine (`packages/core`) and a small terminal client (`packages/cli`)
  are the parts that run;
- the desktop shell (`packages/desktop`) is being fixed so that it builds.

## Build from source

Requires Node.js 22 and pnpm 9.

```bash
git clone https://github.com/appleweiping/AIDE_DEV.git
cd AIDE_DEV
pnpm install
pnpm --filter @aide/shared build
pnpm --filter @aide/core build
```

## License

Apache-2.0, see [LICENSE](LICENSE).
