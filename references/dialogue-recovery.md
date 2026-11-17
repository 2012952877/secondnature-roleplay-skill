# 对话读取、恢复与评分核验

## 目录

- 读取完整问题
- 面试问答与中断恢复
- 页面故障排查
- 评分与完成状态
- 公开内容边界

## 读取完整问题

优先使用可见字幕和页面状态。需要完整问题时，允许只读观察当前会话消息。曾观察到的字段是 `action: "playback-text"` 和 `text`；`persona`、`input`、`lastSnippet` 可辅助区分角色和片段，但结构可能改变，不写死 persona 名称。

`page.on('websocket')` 只发现注册监听后新建的连接。运行时重置后要读已经存在的连接，可以在当前目标页面建立 CDP **只读**监听：

```js
const cdp = await page.context().newCDPSession(page);
const messages = [];
const onFrame = event => {
  if (event.response.opcode !== 1) return;
  const payload = event.response.payloadData;
  if (typeof payload !== 'string' || payload.length > 200000) return;
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  if (!['playback-text', 'transcript'].includes(message.action)) return;
  if (typeof message.text !== 'string' || !message.text.trim()) return;
  messages.push({
    receivedAt: Date.now(),
    action: message.action,
    text: message.text,
    lastSnippet: message.lastSnippet === true,
  });
  if (messages.length > 80) messages.shift();
};
cdp.on('Network.webSocketFrameReceived', onFrame);
await cdp.send('Network.enable');
// 本地读取 messages，结合字幕确认当前问题。会话结束时：
// cdp.off('Network.webSocketFrameReceived', onFrame);
// await cdp.detach();
```

只记录本轮必要的文本，不输出整个 payload、persona 配置、音频、认证 URL。上例的 `Network.enable` 是启用观察，不发送应用 WebSocket 数据；禁止调用发送帧或后端答案写入接口。

同一问题可能先出现完整文本，随后又出现多个播放片段，最后标记 `lastSnippet: true`。按当前轮次核对全文，去除重复；不要把全文和片段直接串起来。`transcript` 也可能逐字修订，不代表完整最终 ASR。没有可靠轮次边界时，保留少量原始文本供人工判断，不自动把队列中的最后一条当作新问题。

若这些途径不足，可以只读查看 React fiber/hooks 中当前消息；不依赖固定组件名或 hook index，不修改 state。不要为增加监听而重载正在进行的评估。

## 面试问答与中断恢复

维护轻量本地状态：当前问题、准备回答、最后一次发送的文本、对方是否确认收到、是否有追问。不要存储无关配置。

| 观察到的情况 | 下一步 |
| --- | --- |
| 点击“跳过”后没有第一题 | 等欢迎语结束；用一句“我准备好了，请开始第一个问题”启动 |
| “你还有什么要补充的吗？” | 有遗漏则补充；完整时单独说“我对这个问题没有其他补充，请继续下一个问题” |
| 很短的推进句只识别出“没有” | 先等回应；若未推进，改用更完整的确认句，不立即重播整段答案 |
| 追问“为什么做这些推荐？” | 回答选择依据、业务影响与取舍，不提前结束 |
| 网络不稳定，出现“继续 / 关闭” | 用“继续”恢复当前评估，保留问题与答案 |
| 恢复后对方说后半段未收到 | 按对方要求重述完整答案或缺失部分，等确认后再前进 |
| TTS 本地成功但没有对方回应 | 查 ASR、连接和页面模式；不能据播放成功推断远端已完整收到 |

不要在静默期间不断塞入重复答案。暂停用于思考，恢复用于发送；恢复后先确认对方是否仍在说话。

## 页面故障排查

### 白屏：先区分脚本异常与网络超时

在目标页面记录精简的 console error、pageerror 和 requestfailed；仅在本地保留必要信息。原始日志可能包含身份或内部地址，不直接贴到公开仓库。

- `Cannot assign to read only property 'getUserMedia'`：检查覆盖属性的 `writable: true`，不是继续等静态资源。
- 翻译 JSON 或其他静态资源超时：确认错误指向实际静态资源，比较页面请求和只读请求的结果。认证回调、脚本异常和静态超时不是同一个故障。
- OAuth 回调尚未结束：让认证完成，不反复刷新或复制登录状态。

仅当已证实某个**静态资源 host** 的浏览器传输失败，而请求工具可正常获取时，可考虑将该 host 的资源原样透传：

```js
// observedStaticHostPattern 由本次失败资源确认，不用 **/*。
const passThrough = async route => {
  try {
    const response = await route.fetch({ timeout: 15000 });
    await route.fulfill({ response });
  } catch {
    await route.continue();
  }
};
await page.route(observedStaticHostPattern, passThrough);
// 目标页面恢复且不再需要时：
// await page.unroute(observedStaticHostPattern, passThrough);
```

这不是默认步骤。保持响应状态、头和正文，不能替换课程内容，不能路由认证、评分、进度接口或 WebSocket。若仍失败，停止堆叠补丁，依据具体错误恢复。

### 超时与运行时重置

定位器超时先限制在约 5 秒；失败就读新 UI。外层预算要大于内部等待之和，例如 15 秒等待加 5 秒定位不应放进 20 秒工具上限。生成/播放 60–80 秒音频可用 90–110 秒预算，并使用宿主的异步让出与进度通知。

运行时重置会丢失 page 句柄、辅助函数和事件监听。重新连接已知浏览器、重新核对目标页，释放可能残留的 Space，恢复只读监听与本轮状态。页面内的虚拟麦克风可能仍在，先检查后再决定；不要默认重开评估。

### 翻译、按钮与弹窗

- 权限授予会自动推进 UI，旧“允许使用麦克风”按钮可能已消失。
- 结束确认可能先显示 `End roleplay / Resume`，随后变为“结束角色扮演 / 继续”。等待弹窗稳定并重新读取文字。
- Tooltip 可能扩展 accessible name，导致精确 role/name 定位失败。检查当前按钮实际文本；限定到当前弹窗，验证候选唯一且可见，再点击。例如在已观察到文字后使用 `dialog.locator('button').filter({ hasText: /^结束角色扮演$/ })`，不要盲用 `nth()`。
- “课程已完成”模态框可能遮挡“查看分析”；先处理顶部模态框。
- “查看分析”可能是 `target="_blank"` 的链接。先检查是否已创建新页；没有时读取该链接实际 `href`，核对为当前分析页后打开。不得猜测 session ID 或拼接臆测 URL。

## 评分与完成状态

结束对话与评分写入分开。观察到 task `progress=100`、`passed=false`、course `progress=0` 时先等待评分，不把它当成最终失败，也不能宣称完成。

优先查看分析页与课程完成提示，必要时读取页面正常发出的 GET `/api/courses/{courseId}/progress/` 响应。ID 和实际结构来自当前页面请求；不将旧会话 ID、评分项数量或嵌套路径写死。

最终核对当前必修测评的 passed、task progress、course progress、completed_at，以及总分与及格线。可选 support 任务为 0 或 cheatsheet 被禁用时，若当前必修测评通过且课程汇总 100，不为把每一行刷满而扩大任务。

等待应有界：例如每 5–10 秒检查一次已有 UI 或正常只读结果，约 2 分钟仍未确认则保留“已结束、评分待确认”状态并报告观察到的事实。这个窗口是排障起点，不是服务承诺，也不授权重写状态。需要继续等待时根据用户目标与页面提示判断，不高频轰炸接口。

## 公开内容边界

可发布：脱敏错误、通用流程、合成测试、兼容性修复。不得发布账号、课程/task/session UUID、实际完成时间、内部 playbook、答案和对话记录、截图、完整进度 JSON、认证信息或本机 profile 路径。案例数字必须按用户提供材料或官方来源核实；只保留“参考结果不能保证复制”的方法，不把内部案例复制到此仓库。
