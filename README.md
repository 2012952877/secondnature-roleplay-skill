# Second Nature Role Play Skill

用于完成 `ocean.secondnature.ai` 上的 Second Nature AI 语音角色扮演。

该 Skill 会读取场景背景和评分标准，建立浏览器虚拟麦克风，逐轮理解 AI 角色的回应并生成自适应回答，最后检查评分以及课程进度是否达到 100%。

## 主要能力

- 从课程页面和只读网络响应中提取场景、客户顾虑和评分标准。
- 使用 Web Audio 虚拟麦克风稳定输入合成语音。
- 根据角色的最新回答逐轮调整话术，而不是播放固定脚本。
- 覆盖需求发现、场景相关性、业务风险、云方案映射、异议处理和后续步骤。
- 根据评分反馈重试并补强薄弱项。
- 最终确认任务通过、任务进度 100%、课程进度 100%。

## 安装

在 PowerShell 中运行：

```powershell
git clone https://github.com/2012952877/secondnature-roleplay-skill.git `
  "$HOME\.scout\m-skills\secondnature-roleplay"
```

重新启动 Microsoft Scout 后，可以直接使用：

```text
/secondnature-roleplay
```

也可以发送 Second Nature 课程链接并说明“帮我完成这个 Role Play”。

## 运行要求

- 可控制浏览器的 Playwright 工具。
- 用户本人完成登录、密码输入和 MFA。
- Windows 当前实现使用 `System.Speech` 生成 WAV；其他平台可替换为可用的本地 TTS。
- Python 仅用于按需启动绑定到 `127.0.0.1` 的临时音频服务器。

## 安全边界

- 不读取或代填密码和 MFA。
- 不修改后端分数、课程进度或伪造完成状态。
- 不替用户填写个人反思、价值判断、签名或合规证明。
- 仅在真实完成并验证通过后报告结果。

详细流程见 [SKILL.md](SKILL.md)。
