# 浏览器连接与音频

## 目录

- 连接已有浏览器与导入兼容
- 安装虚拟麦克风
- 生成并输入语音
- 隔离自检与实际收音
- 清理

## 连接已有浏览器与导入兼容

先使用宿主提供的浏览器能力。仅在当前环境允许普通 Playwright / CDP 时使用以下方法；它不是绕过工具权限的手段。

Windows 可只读检查已经启用远程调试的 Chrome 主进程：

```powershell
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object {
    $_.CommandLine -match 'remote-debugging' -and
    $_.CommandLine -notmatch 'type='
  } |
  Select-Object ProcessId, CommandLine
```

根据实际进程参数确认本机端点，不默认 9222 一定正确。CDP 能连接只说明端点可用，不能证明是用户已登录的 profile。不要为了连接而终止日常浏览器、复制 profile 或导出 cookies。没有可连接的端点时，使用宿主浏览器或专用自动化浏览器，由用户完成其登录。

通常可以直接 `await import('playwright')`。某些宿主的 ESM 封装报 `does not provide an export named 'default'` 时，可从**已发现的**运行环境依赖目录按 CommonJS 加载：

```js
const { createRequire } = await import('node:module');
const { join } = await import('node:path');
// nodeModulesDirectory 来自宿主运行环境发现结果，不硬编码版本目录。
const requireFromRuntime = createRequire(join(nodeModulesDirectory, 'package.json'));
const { chromium } = requireFromRuntime('playwright');
const browser = await chromium.connectOverCDP(observedLocalCdpEndpoint);

const pages = browser.contexts().flatMap(context => context.pages());
const inventory = await Promise.all(pages.map(async (page, index) => ({
  index,
  origin: new URL(page.url()).origin,
  title: await page.title(),
})));
```

在本地核对目标标签页；不要把完整标签清单、OAuth URL 或用户目录发布到日志或仓库。多条课程页面时结合用户指定页面和当前 UI 选择，不能盲选第一个 context/page。只有目标 browser profile 确实没有课程页时才新建页面。

## 安装虚拟麦克风

认证回调完成、模拟尚未开始时，向已确认的目标页面注入：

```js
await page.addInitScript({ path: join(skillDirectory, 'scripts', 'fake-mic.js') });
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
```

外层工具预算要长于 reload 的 45 秒。一次正常 reload 后先检查 UI；不要把持续白屏当成必须多刷几次。

脚本有三个关键约束：

1. `getUserMedia` 必须可写、可配置。原始实现遗漏 `writable: true` 后，应用媒体适配器曾报：

   ```text
   TypeError: Cannot assign to read only property 'getUserMedia' of object '#<MediaDevices>'
   ```

2. `MediaStreamDestination` 的源音轨由静音 oscillator 保持，**每次请求都返回 clone**。UI 停止设备测试的旧流后，新会话仍可收音。
3. `window.__fakeMic` 只提供音频播放能力。音频进入正常麦克风流，再由课程自己的录音与识别流程处理；不调用答案或评分接口。

脚本保留非音频请求与组合请求的视频部分，给音轨补充设备选择所需的 label/deviceId。它面向已观察到的课程设备选择流程，不是完整的物理设备约束模拟器；若应用新版本要求新的 mandatory constraint，先查实际错误再适配，不声明所有约束都已实现。

仅需要麦克风时：

```js
await page.context().grantPermissions(['microphone'], {
  origin: 'https://ocean.secondnature.ai',
});
// 此处重新读取 UI；授权可能已经自动推进，无需再点击旧的授权按钮。
```

AudioContext 可能受自动播放限制而 suspended。先正常点击页面，再调用播放；脚本会尝试 resume，5 秒未恢复会给出明确错误。音轨创建不会被这个等待无限卡住。

## 生成并输入语音

枚举实际安装的声音：

```powershell
powershell.exe -NoProfile -File .\scripts\speak.ps1 -ListVoices
```

按列表中的语言选择声音。不要假定所有 Windows 都有 `Microsoft Huihui Desktop`；本次中文场景使用该已安装声音与 Rate 2 成功，其他机器和语言必须重新选择。

下面是普通 Node.js 环境中的调用片段。`answerText`、`voiceName`、`workDirectory` 和 `skillDirectory` 由当前任务确定，工作目录事先创建：

```js
const fs = await import('node:fs/promises');
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const runFile = promisify(execFile);
const textPath = join(workDirectory, 'answer.txt');
const wavPath = join(workDirectory, 'answer.wav');
await fs.writeFile(textPath, answerText, 'utf8');
await runFile('powershell.exe', [
  '-NoProfile', '-File', join(skillDirectory, 'scripts', 'speak.ps1'),
  '-TextPath', textPath, '-OutputPath', wavPath,
  '-Voice', voiceName, '-Rate', '2',
]);
const base64 = (await fs.readFile(wavPath)).toString('base64');
```

参数数组和 UTF-8 文件避免回答中的引号、反引号、`$()` 被 shell 解释。不要用拼接 shell 命令传入整段答案。WAV 字节可直接进入 `page.evaluate`，无需额外 HTTP server。

在正常 UI 确认 noisy / 按住说话模式使用 Space 后，先等对方说完并恢复模拟，确认页面焦点不在结束按钮，再发送：

```js
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await page.keyboard.down('Space');
try {
  await delay(250);
  await page.evaluate(audio => window.__fakeMic.playBase64(audio), base64);
} finally {
  await delay(700);
  await page.keyboard.up('Space');
}
```

外层执行预算包括整段音频时长。运行时被强制中止时 `finally` 未必执行；恢复连接后先释放可能残留的 Space，再读当前页面状态。不要在对方发言时播放，也不要并发播放两段答案。

## 隔离自检与实际收音

运行 `node scripts/test-fake-mic.cjs`。测试启动独立 headless Chrome，拦截全部测试请求并返回本地 HTML，使用合成正弦 WAV 和 canvas 视频，不访问课程、不请求真实麦克风或摄像头。

它检查应用能包装 `getUserMedia`、旧 clone 停止后新 clone 仍 live、音频录制可解码且 RMS/peak 非零、视频/非音频请求透传，以及其他 origin 不被注入。RMS 是收音链路证据，不是远端 ASR 成功证据。

在真实课程上，再用中性短句完成页面麦克风测试，确认“加入”已可点击。必要时在正式加入前复用测试中的 MediaRecorder 录制逻辑；结束后停止的是测试 clone，不能停止 destination 源音轨。正式对话中以识别内容和对方确认判断是否完整收到。

## 清理

删除当前任务生成的临时 WAV/文本；不要递归清理用户已有目录。停止自己启动的临时服务。页面级 init script 会在该页面后续导航继续运行，简单删除 `window.__fakeMic` 不能还原原始方法；关闭本次专用训练页即可清除，保留独立分析页。连接共享 CDP 浏览器时，不调用关闭整个浏览器的操作。
