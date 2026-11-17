# Second Nature Role Play Skill

用于操作 `ocean.secondnature.ai` 的客户角色扮演和面试式技能测评：读取实际场景及评分表，通过正常课程 UI 输入合成语音，逐轮作答，最后确认真实评分与课程完成状态。

## 这次更新解决的问题

- 支持普通 Playwright / CDP，不再依赖某个特定工具名；连接后先确认目标浏览器 profile 和登录状态。
- 将虚拟麦克风提取为脚本，修复 `getUserMedia` 不可写导致应用媒体适配器报错、页面白屏的问题。
- 每次返回独立音轨，加入实际录音自检；Windows TTS 可枚举声音并配置语速，直接传递 WAV 字节，不需要音频 HTTP server。
- 区分客户对话与面试问答，处理“还有补充吗”、追问、重复字幕、部分语音识别和断线续接。
- 区分对话结束与评分完成，处理翻译切换、弹窗遮挡及分析页入口，核对任务与课程两层状态。
- 将原来的主权云话术移到可选示例，避免套用到不相关课程。

## 安装

将此仓库放到运行环境的 skill 目录，文件夹名使用 `secondnature-roleplay`。例如在 Codex 的默认 Windows skill 目录安装：

```powershell
git clone https://github.com/2012952877/secondnature-roleplay-skill.git `
  "$HOME\.codex\skills\secondnature-roleplay"
```

其他宿主使用其实际配置的 skill 目录。重新加载 skills 或开启新会话，然后发送课程链接并说明“请使用 secondnature-roleplay 完成这个对话”。已有 Git 安装可在目录中运行 `git pull --ff-only`；如有本地改动，先保留并审查，不能覆盖。

## 运行要求

- 当前环境允许使用的 Playwright 页面控制、初始化脚本和页面执行能力；CDP 是可选的连接方式。
- 用户本人完成目标浏览器中的登录与 MFA。
- Windows TTS 使用 `powershell.exe` 和 `System.Speech`，需要所选语言的已安装声音。其他系统可替换为可用的 TTS，输出浏览器可解码的音频。
- Node.js 与 Playwright 用于脚本示例及隔离自检。优先使用已有运行环境，不为连接课程重建用户浏览器 profile。

## 文件

| 文件 | 用途 |
| --- | --- |
| [SKILL.md](SKILL.md) | 主流程、边界及完成条件 |
| [浏览器与音频](references/browser-audio.md) | CDP、导入兼容、音频注入、自检与调用示例 |
| [对话与恢复](references/dialogue-recovery.md) | 问题读取、断线续接、超时、页面和评分排障 |
| [主权云示例](references/sovereignty-example.md) | 仅在相关课程中使用的原版示例 |
| [fake-mic.js](scripts/fake-mic.js) | 限定 origin 的 Web Audio 虚拟麦克风 |
| [speak.ps1](scripts/speak.ps1) | 可配置声音与语速的本地 WAV 生成器 |
| [test-fake-mic.cjs](scripts/test-fake-mic.cjs) | 无需登录、不连接真实课程的浏览器回归自检 |

## 本地自检

在仓库目录运行：

```powershell
powershell.exe -NoProfile -File .\scripts\speak.ps1 -ListVoices
node --check .\scripts\fake-mic.js
node .\scripts\test-fake-mic.cjs
```

自检需要 Playwright 和本机 Chrome，默认以 headless Chrome 运行。若 Playwright 位于宿主提供的外部依赖目录，可设置 `PLAYWRIGHT_NODE_MODULES` 为实际 `node_modules` 目录；若使用其他 Chromium 可执行文件，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。不要将本机绝对路径写入仓库。

自检在被本地 route 完全替代的测试页面中检查：属性可写、应用包装兼容、独立音轨生命周期、实际录音 RMS、视频透传、无音频请求透传和 origin 隔离。它不访问课程后端、不登录、不开始训练，也不证明远端 ASR 已收到答案；真实课程仍需自己的麦克风测试和逐轮回应确认。

## 使用边界

只通过正常 UI 和音频完成对话。不得修改后端分数、进度、完成状态或直接注入协议答案。个人反思、签名和合规证明由用户本人处理。内部材料、账户信息、会话标识、截图及对话日志不得提交到公共仓库。详细要求见 [SKILL.md](SKILL.md)。
