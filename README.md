# Mira Companion / 小弥

一个独立的本地 Live2D 对话人物原型。复用 AIRI 的 Hiyori 模型来源与口型模块，提供中文对话界面、语音播放、人物动作与表情。

## 启动

需要 Node.js 22+、Python 3.10+ 和现代 Chrome / Edge。默认使用 Edge-TTS 在线中文语音，无需 API 密钥。Windows 系统语音可作为离线选项。

```powershell
npm ci
npm run setup:tts
npm run dev
```

打开 http://127.0.0.1:5180 。服务仅监听本机。可以设置 `PORT` 使用其他端口。

也可以双击 `start.cmd`。首次使用先执行 `npm ci` 和 `npm run setup:tts`。语音依赖安装在本项目的 `.venv` 中，不依赖其他项目；也可用 `EDGE_TTS_PYTHON` 指定已安装 `edge-tts` 的 Python。

## 已实现

- 本地加载 Hiyori Live2D 模型、原有待机/招呼动作、眨眼、呼吸和头发物理效果。
- 鼠标注视、点头、微笑、惊讶、半身/全身切换及三种背景。
- 独立标注的离线预设台词演示，以及真实模型的流式文字回复。
- 默认 Edge-TTS 晓晓 `zh-CN-XiaoxiaoNeural`，通过 AIRI + wLipSync 从实际 MP3 音频驱动嘴部开合。
- 设置中可选择晓晓、晓伊、云希、云健、云扬、台湾普通话晓臻，支持试听、停止试听、语速及音量调节，选择后自动保存。
- 仍可手动选择 Windows 离线语音；Edge 服务失败会显示错误，不会偷偷切换音色。
- 浏览器语音备选。此模式拿不到 PCM，因此口型是节奏近似，不是音素级同步。
- 浏览器语音识别、停止回复、聊天导出、新会话与响应式布局。
- 声音、语速、音量、目光等偏好在本机浏览器保存。对话记录只保存在当前页面内存，刷新即清空。

## 连接真实模型

在右上角设置中填写兼容 Chat Completions 的接口基础地址、模型名称和可选密钥。填写的密钥仅保存在本次本地服务进程内存；浏览器 localStorage 不保存密钥。重启服务后需要重新配置。

例如本机 Ollama 可填写 `http://127.0.0.1:11434/v1`，模型名称填写该服务已安装模型的名称。需要先自行运行该模型服务。

也可复制 `.env.example` 为 `.env` 并配置 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`。`.env` 已加入忽略列表。不要将密钥提交到代码仓库。

测试连接会查询 `/models`；部分兼容服务可能只支持 `/chat/completions`。这种情况下，可在确认地址正确后直接保存模型名称并测试一次聊天。

模型服务出错时会显示错误，不会用预设回复冒充 AI 回复。演示与模型切换会开始新的会话。

## 范围与限制

- 这是基于 AIRI 部分模块的独立轻量原型，不是完整 AIRI 分支，也没有包含 AIRI 的游戏、桌面控制、插件与长期记忆系统。
- 当前采用二次元 Hiyori 角色。没有提供轻写实自定义人物、真人质感或实时生成新动作。
- 表情和动作来自规则映射、现成动作及参数驱动。自由对话的动作选择尚未接入结构化动作规划。
- 文字流式显示完成后再合成并播放声音；尚未实现句级并行语音流水线或全双工对话。
- Edge-TTS 需要联网，文本发送到微软在线语音服务。支持音色和语速调节，不支持独立的情绪风格开关。Windows 语音可离线合成。语音文本最多播放 2500 字。
- 第一次升级到新版时，旧的 Windows 默认选项会迁移到 Edge 晓晓；之后保留用户选择。语速设置 -5 到 5 对应 Edge -30% 到 +30%。
- 麦克风识别依赖浏览器 Web Speech API，通常需要联网。浏览器不支持或服务不可达时可继续文字聊天；物理麦克风识别需在使用者环境验证。
- 不附带语言模型和付费 API 密钥。未配置服务时仅提供明确标记的演示对话。
- 角色素材、Cubism Core 和开源代码有不同许可，详见 `THIRD_PARTY_NOTICES.md`。当前交付定位为本地验证；正式分发前应核对素材与 SDK 的适用条款。

## 验证与构建

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:ui
node tests/voice-settings.mjs
```

浏览器测试要求开发服务已启动，Edge-TTS 依赖已安装且网络可用。`node tests/edge-live.mjs` 会真实合成全部精选音色并保存试听 MP3 至 `artifacts/edge-voices/`。测试截图在 `artifacts/`。生产预览先 `npm run build`，再 `npm start`。

## 形象库

打开右上角「连接与偏好设置」→「形象」，可搜索、按分类筛选、查看缩略图和动态预览；点击「使用此形象」应用到聊天舞台。预览支持目光跟随和动作预览。动态预览使用独立 iframe 隔离 Cubism 的 WebGL 全局状态，关闭设置会释放预览，当前选择保存在浏览器中。形象与 TTS 音色独立，默认音色仍为 `zh-CN-XiaoxiaoNeural`。

已从用户本地 `D:\github\live2d` 素材合集导入 250 个可用角色/服装配置，加上原来的日和，共 251 款。包含 Cubism 2 `.moc` 和 Cubism 3 `.moc3` 两代资源。仅按需加载选中的模型，完整资源已复制到项目，运行时不依赖源文件夹。1 份同目录重复配置已合并；圣路易斯「Tipsy Snow」在当前运行时始终透明，暂不列入可选库，原因保存在 `shared/character-exclusions.json`，原始素材未修改。不同模型支持的动作、表情和口型参数可能不同；素材没有的动作不会凭空生成。缺失的可选动作已剔除，模型原配语音已关闭，避免覆盖 TTS。

开发者重新导入和生成预览（先启动开发服务）：

```powershell
node scripts/import-characters.mjs D:\github\live2d
node scripts/preview-characters.mjs
node tests/characters.mjs
node tests/character-framing.mjs
```

导入器只读取模型数据，不执行合集中的页面脚本、不修改源目录；修复模型自身的根路径误写并跳过同目录重复配置。`shared/character-import-report.json` 记录缺失的可选资源，实际渲染检查记录在 `artifacts/character-render-report.json`。新增素材后需重新生成预览并构建。缩略图取自真实渲染，位于 `public/assets/character-previews/`。

合集来源与非商用学习限制保存在 `licenses/live2d-collection-README.md`，人物版权归原作者/公司，详见 `THIRD_PARTY_NOTICES.md`。

## 源码结构

- `src/Avatar.tsx`：Live2D 人物渲染与参数驱动。
- `src/voice.ts`：语音播放、打断及音频到口型的连接。
- `src/vendor/`：保留来源的 AIRI 口型模块和校准数据。
- `src/App.tsx`：聊天、麦克风、模式和设置。
- `server/index.mjs`：进程入口，只负责读取运行模式并监听端口。
- `server/app.mjs`：Express 应用工厂、本地访问策略和前端托管。
- `server/api.mjs`：可注入依赖的 API 路由与会话内配置状态。
- `server/chat.mjs` / `server/tts.mjs`：对话流解析、输入校验和语音合成。
- `scripts/characters/import-core.mjs`：多来源模型发现、安全路径解析、稳定 ID、内容指纹和增量去重规划。
- `scripts/characters/import-imuncle.mjs`：现有 imuncle 合集的来源适配器；根目录导入脚本只负责 CLI 调度。
- `shared/character-sources.json`：形象来源名称和链接，界面不再硬编码来源判断。
- `shared/voices.json`：前后端共用的精选音色列表。
- `shared/*-audit.json`：外部模型集合的只读审计结果；未获再分发许可的素材不会进入运行资源。
- `public/assets/hiyori/`：从 AIRI 配置的上游地址下载的示例人物。
- `licenses/`：第三方授权文件。

上游：<https://github.com/moeru-ai/airi>
