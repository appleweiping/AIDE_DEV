# AIDE_DEV

AIDE_DEV 是一个面向国产大模型 API（DeepSeek、通义千问、智谱 GLM、Kimi、豆包、MiniMax，
或任何 OpenAI 兼容接口）的桌面编程 Agent：选好项目目录、描述要做的修改，它会读文件、改文件、
跑命令，写文件或执行有风险的命令之前会先弹窗问你。

> 和 WecoAI 的 [AIDE](https://github.com/WecoAI/aideml)（机器学习工程 Agent）没有关系，只是重名。

![AIDE_DEV 修好 greet.js 里的拼写错误之后](docs/desktop.png)

截图是桌面端界面跑完一轮之后的样子：通过 `scripts/dev-bridge.mjs` 在无头 Chromium 里运行
（同一套 React 界面、同一个引擎进程），模型回复由 `scripts/fake-llm.mjs` 预先写好，
文件修改和 `Hello, world!` 输出是真实执行的结果。

## 现状

- `packages/core`：TypeScript 写的 Agent 引擎，流式 OpenAI 兼容客户端（支持工具调用和
  DeepSeek/QwQ 的 `reasoning_content`）、工具循环、审批规则、会话存储、stdio 上的 JSON-RPC。
- `packages/desktop`：Tauri 2 + React 桌面端，Rust 一侧用 `node` 启动引擎。
- `packages/cli`：同一个引擎的命令行客户端，不装 Rust 也能用。
- Windows 安装包：[v0.1.0](https://github.com/appleweiping/AIDE_DEV/releases/tag/v0.1.0)
  （由 GitHub Actions 从打了标签的提交构建，未签名，SmartScreen 会提示；需要 PATH 里有 Node.js 22）。
  没有 npm 包，没有自动更新；macOS / Linux 没有测试过。
- 以前的 README 写过多平台安装包、npm 包、手机端、VS Code 插件等，这些都不存在，已经删掉。

## 不用 API Key 先试一下

需要 Node.js 22 和 pnpm 9：

```bash
git clone https://github.com/appleweiping/AIDE_DEV.git
cd AIDE_DEV
pnpm install
pnpm build
pnpm demo      # 用预设的假模型驱动真实的 CLI，修好一个一行的 bug
```

## 用真实的 Key

```bash
export AIDE_API_KEY=sk-...
node packages/cli/dist/index.js --provider deepseek --dir 你的项目目录
```

`--permission safe`（默认）在写文件和有风险的命令前询问，`trusted` 不再询问，`locked`
不使用任何工具；`rm -rf /`、格式化磁盘之类的命令在任何模式下都会被拦截。

## 构建桌面端

需要 Rust stable，Windows 上还需要 MSVC 构建工具（见 Tauri 的
[环境要求](https://tauri.app/start/prerequisites/)）。桌面端运行时也需要 PATH 里有 Node.js 22。

```bash
pnpm install
pnpm build
pnpm --filter @aide/desktop tauri dev      # 运行
pnpm --filter @aide/desktop tauri build    # 生成 Windows 安装包（NSIS）
```

## 测试

`pnpm test` 运行 `packages/core/test` 里的 12 个测试，CI 在 Ubuntu 和 Windows 上跑。

## 相关项目

[claudeseek](https://github.com/appleweiping/claudeseek) 是零依赖的 Node.js DeepSeek Agent
（终端 + 本地网页），[WEIPING_WHALE](https://github.com/appleweiping/WEIPING_WHALE)
是基于 CodeWhale 的 TypeScript 终端 Agent。AIDE_DEV 是三个里唯一有桌面端、并预设多家国产模型的。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。
