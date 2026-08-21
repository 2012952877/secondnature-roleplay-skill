---
name: "secondnature-roleplay"
description: "完成并通过 Second Nature AI 语音 Role Play：读取场景与评分标准、稳定注入合成语音、逐轮理解角色回应并自适应作答、结束后检查评分并确认课程 100% 完成。触发词：Second Nature、role play、角色扮演、语音模拟、帮我完成这个对话、Ocean 课程、AI conversation simulation。"
---

# Second Nature Role Play

用于完成 Second Nature / ocean.secondnature.ai 的 AI 语音角色扮演，并以真实可见的 UI 对话获得及格分数。默认目标不是“把时长跑完”，而是覆盖评分标准、通过评估并验证课程状态。

## 硬性边界

- 用户必须自行完成登录、密码输入与 MFA；绝不索取、读取或代填密码。
- 只通过正常课程 UI 和真实对话完成任务；禁止直接修改后端分数、课程进度或伪造完成状态。
- 可以只读查看页面、网络响应和前端运行状态，以理解场景、当前对话和结果；不得篡改评分或进度状态。
- 不替用户填写个人反思、价值判断、承诺、签名或合规证明；遇到这类内容时暂停并请用户本人处理。
- 不承诺“零风险”或编造产品能力。围绕风险、证据和权衡作答。
- 只有同时确认角色扮演通过、任务 progress=100 且课程 progress=100 后，才报告完成。

## 标准流程

### 1. 登录与预读

1. 用 Playwright 打开用户给出的课程或 task URL。
2. 若跳到登录页，明确让用户在浏览器中自行登录和完成 MFA，然后等待用户确认。
3. 登录后读取以下页面：场景背景、评估条件、成功提示。
4. 如果背景内容以图片呈现或 UI 文本不足，查看课程网络请求：
   - `GET /api/courses/{courseId}/`
   - 找到当前 practice task、前置 image/richtext task 的 `alt_text`、`variables`、`CustomConversationContext`、`CustomConversationBackgroundInformation`、`PersonaConcerns`。
5. 记录及格分数和评分清单。常见六项：
   - Discovery and Questioning
   - Establish scenario relevance
   - Clarify business and risk challenges
   - Map sovereignty needs to cloud approach
   - Objection handling
   - Define next steps

### 2. 建立可靠的浏览器虚拟麦克风

优先使用 Web Audio 虚拟麦克风，避免依赖用户真人发声或扬声器回录。

1. 在进入模拟前用 `browser_run_code_unsafe` + `context.addInitScript` 覆盖 `navigator.mediaDevices.getUserMedia`。
2. 创建 `AudioContext`、`MediaStreamDestination` 和静音 oscillator，保持音轨持续 live。
3. 每次 `getUserMedia` 调用都返回 destination audio track 的 **clone**；不要重复返回同一条 track，否则页面停止旧 stream 时会把后续麦克风一起结束。
4. 根据请求的 deviceId 为 clone 补充稳定的 `label`、`getSettings()` 和 `getConstraints()`，让页面的设备选择器正常工作。
5. 在页面暴露只含音频播放能力的 `window.__fakeMic.playBase64(base64)`，将 WAV 解码后连接到 destination。
6. reload 页面使补丁在应用初始化前生效。
7. 选择语言，点“开始模拟”，选择任意显示的麦克风设备。
8. 生成一句短测试音频（如“你好，我在”），通过虚拟麦克风播放。确认“加入”按钮从禁用变为可用后再加入。

实现注意事项：

- Windows 可用 `System.Speech.Synthesis.SpeechSynthesizer` 生成所选语言 WAV；中文优先选择已安装的中文 voice。
- 音频文件放在当前会话临时目录或执行目录的临时子目录，不硬编码用户主目录。
- 可启动绑定 `127.0.0.1` 的临时 `python -m http.server`，再用 `page.request.get()` 读取音频并转 base64；`browser_run_code_unsafe` 环境不保证可用 `require()`。
- 必须先做一次录音自检：用 `MediaRecorder` 录制虚拟麦克风，同时播放测试音；确认输出 RMS 明显大于零且音轨 `readyState=live`。
- 物理扬声器回录只作为最后兜底。兜底时启用 noisy mode，并在整段 TTS 前后持续按住 Space。

### 3. 每轮对话循环

1. 等角色说完，读取当前字幕。
2. 若字幕暂时不在 DOM，可只读检查 React fiber/state：遍历组件和 hooks，寻找形如 `{ action, text, persona, state }` 的当前 persona 消息对象，读取 `text`；不得修改 state。不要依赖固定组件名或固定 hook index。
3. 暂停模拟后组织下一轮，避免浪费计时或触发空闲结束。
4. 根据角色最新回答和未覆盖评分点，生成自然、顾问式、30–70 秒的回答。
5. 继续模拟，按住 Space；提前约 250ms 开始按键，播放 WAV，结束后约 700ms 再释放 Space。
6. 等待 15–25 秒，直到角色新回复稳定，再读取下一轮。
7. 每轮只解决当前问题并推进一层，不机械重复整套话术。

### 4. 高分对话结构

#### 第一轮：需求发现，不急着卖产品

应覆盖：

- 谁在推动主权议题：监管机构、法务、审计、管理层或客户。
- 具体触发事件与必须满足的时间节点。
- 哪些国家、数据类型、用户和工作负载受影响。
- 主要风险：数据驻留、处理地点、运营商访问、强制访问、控制权、审计、业务连续性。
- 对审批周期、审计成本、创新速度、收入或业务韧性的影响。

#### 第二轮：把风险转成可验证的决策标准

追问：

- 存储、处理、备份和 AI 推理是否都需要在境内或区域内。
- 正常、支持、紧急 break-glass 和强制访问分别允许什么。
- 审计需要哪些证据：授权、限时、日志、复核、例外处理。
- 关键系统的 RTO/RPO、可接受中断和事件决策权。
- 先选 2–3 个代表性工作负载，按敏感度和关键性分类。

#### 第三轮：高层映射 Microsoft 主权方法

只讲概念和权衡，不深入 SKU 或最终架构：

- 技术控制：数据边界、身份与最小权限、客户管理密钥、机密计算、限时支持访问和审计。
- 合同控制：数据驻留、访问和责任承诺。
- 运营控制：人员与操作边界、审批、事件升级、连续性和客户决策权。
- 主权云连续体：公有云、混合、本地、断连或更强隔离模式，按工作负载选择。
- **必须提到伙伴生态**：专业合作伙伴可支持主权需求梳理、架构、实施和运营验证，也是连续体的一部分。
- 明确权衡：控制越强，可能带来更高成本、更多客户运维责任、更少服务选择或较慢创新。

#### 第四轮：处理至少一个明确异议

- 先承认担忧合理，不回避。
- 直接回应角色提出的风险，而不是背产品清单。
- 说明“风险可治理、可验证，但不会归零”。
- 访问异议可用：默认拒绝、审批、最小权限、限时、记录、客户复核、客户密钥。
- 连续性异议可用：分层部署、恢复目标、切换流程、演练、事件决策权。
- 用审计证据或测试证明，而不是要求客户相信承诺。

#### 第五轮：明确行动号召

推荐：

- 90 分钟主权需求发现研讨会。
- 参与人：业务负责人、法务、合规、安全、业务连续性、应用负责人，必要时加入专业伙伴。
- 会前选择 2–3 个代表性工作负载。
- 输出：风险—控制矩阵、工作负载分类、责任所有者、审计证据要求、连续性目标、未决法规问题和小范围验证计划。
- 解释价值：减少重复评审、提高审计信心、恢复决策速度，同时不提前锁定架构。
- 结尾必须是清晰的确认请求，例如：“你是否同意我们今天先确认参与人和三项工作负载，并安排下周研讨会？”

### 5. 结束、评分与重试

1. 只有当角色明确接受后续步骤，或对话已充分覆盖评分清单时，才结束角色扮演。
2. 确认结束并打开“查看分析”。
3. 读取总分、及格线、六项分数和培训师反馈。
4. 若低于及格线，或关键项明显偏低，按反馈立即重试；最多连续尝试 3 次，避免无休止循环。
5. 常见补强：
   - 云方案映射低：补充公有/混合/本地/断连连续体、伙伴生态和权衡。
   - 下一步低：给出参与人、输入、产出、时间和明确确认请求。
   - 场景相关性低：多引用客户刚提到的地区、数据、流程、KPI 和触发事件。
   - 异议处理低：先复述具体异议，再给控制、证据和限制。
6. 最终读取 `GET /api/courses/{courseId}/progress/`，确认：
   - 当前 task `passed=true`
   - 当前 task `progress=100`
   - course `progress=100`
   - `completed_at` 非空
   - `total_score` 达到及格线
7. 清理临时 WAV、停止本地 HTTP server。
8. 向用户只报告最终分数、及格线和 100% 完成状态。若用户还要求 Viva/LMS 闭环，再调用 `viva-training` skill 做下游只读验证。
