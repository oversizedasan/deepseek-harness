# Agent Note: 课堂采集用的文档扫描仪能力

Status: proposed

[English](2026-11-18-doc-scanner-capability.md) | 中文

## Problem

教师需要用高拍仪（例如 CZUR）拍摄学生试卷或作业，再进入后续批改或归档流程。该硬件对接不能逼出 agent-loop 的 fork，不能把厂商 WebSocket 细节埋进 Chat UI，也不能把「设备已连接」当成模型曾经见过的持久 Session 事实。课堂产品（豆包教师技能、CZUR AI 批改、HoverCam Flex AI）把采集当作任务输入——先预览、对边，再批改或讲解——而不是单独常驻的「设备状态」控件。

## Proposal

在 `packages/experimental/` 下新增文档扫描仪能力缝，组装方式对齐语音输入栈：

| 角色 | 包 | 职责 |
|---|---|---|
| Service Definition | `@deepseek-ai/dsh-doc-scanner` | `ctx.docScanner`：注册提供方、`snapshot` / `follow` / `followStills`、`connect` / `capture` / `preview` / `close`；可选归档到 `Captures/<batchId>/` |
| Mock Provider | `@deepseek-ai/dsh-doc-scanner-mock` | 演示连接状态机、取景帧与固定 JPEG 拍照（仅手动） |
| CZUR Provider | `@deepseek-ai/dsh-doc-scanner-czur` | Host 侧 CZUR SDK Open Command WS 拍照、Video WS → `preview()`、`autoCapture` 翻页检测、硬拍 → `subscribeStills` |
| 演示技能 | `@deepseek-ai/dsh-doc-scanner-skills` | 随包 `homework-grade` / `wrong-book`，仅经 Composer `/` |
| Host Remote | `@deepseek-ai/dsh-api-doc-scanner` | 面向 Web Client 的认证 Typert Remote（`capture` / `followStills` 可选 `batchId`） |
| Client UI | `@deepseek-ai/dsh-client-ui-doc-scanner` | Composer 状态芯片（**附上本批 · N**，N≥1 时点击附上图片并插入归档目录 `@` 芯片）；+ 菜单；右侧叠层取景 + 本批条 — **无**技能芯片条 |
| Bundle | `@deepseek-ai/dsh-doc-scanner-bundle` | 显式 `--patch` 组装；启用 Mock，禁用 CZUR |

连接态是进程本地 live 状态（`follow`）。取景帧走独立的 `preview` 流，本身不进入 Session 历史。硬件静帧经 `followStills` 推入。静帧可通过 `ctx.attachments` 持久化、按 Client `batchId` 归档，并向本批盘返回线上字节。教师用 **附上本批 · N** 附上本批（附件轨图片 + 允许时的 `@Captures/<batchId>/` 目录芯片），再用 Composer `/`（现有 `dsh-client-ui-skill` + `dsh-tool-skill`）表达批改等意图。发送仍是另一步。本阶段不向模型 `followup()`，也不为「已连接」扩展 `SessionEventMap`。

### 教师交互（本阶段）

1. 从 + 菜单「添加」下的 **文档相机**（需要时自动连接）或本批为空时的 Composer 状态芯片打开右侧 **文档相机** 标签。
2. 在实时取景中对边；用叠层快门（**连接并预览** / **拍一张**）。
3. 静帧进入取景器上的 **本批条**（手动或 CZUR 硬拍 / 翻页）；糊了就删。
4. 本批条可看大图；Host 归档到当前 Session 工作区 `Captures/<batchId>/`，可「在文件中查看」。**附上本批 · N** 标签静默附上图片到附件轨，并尽量插入 `@Captures/<batchId>/` 目录引用芯片，然后聚焦输入框；点目录芯片优先打开该批归档中的一张图，否则打开 Files；状态点可再开相机（受单次图片上限约束）。
5. 输入 `/`：空查询时 `homework-grade` / `wrong-book` 置顶（ASCII `name`，中文 description/正文）；也可选其他已安装技能。Composer 上方**没有**本批技能芯片条——与 Harness `/` 清单形态一致。
6. 教师自行发送轮次——图片仅在此时对模型可见。

### 此处应用的 Harness 思维

| 习惯 | 落地 |
|---|---|
| 插件扩展，不改 loop | 扫描仪与其他插件并列；不触碰 `agent-loop` |
| 完整能力缝 | Definition、Provider、Consumer 一并交付 |
| 模型可见即已记录 | 只有之后进入请求的图片才需要 Session 事实；链路状态与取景帧不记 |
| 用 overlay 组装 | 经实验 bundle patch 启用，不进 `dsh-base` |
| 业务后置 | 批改 UI / LMS 延后；演示批改技能只经 `/` 加载 |

### 阶段边界

- **本阶段：** 本批盘 + 附上本批 · N 附上；`/` 演示技能；Host 批次落盘 + `followStills`；CZUR `autoCapture` / 硬拍；文档。默认 patch 仍走 Mock；CZUR 用 `cordis.czur.patch.yml`。
- **后续：** 消费 `attachmentId` 的更完整批改 UI；按 `attachmentId` 进草稿而不再上传。

## Alternatives considered

**为「扫描模式」改 agent-loop。** 否决：硬件对接应挂在已有文档化扩展点上，改 loop 会抬高整机契约面。

**仅做 `packages/` 外的 scratch overlay。** 对本工作否决：同事需要仓内包、测试与其他实验能力相同的隔离规则；scratch 会迫使第二次搬家。

**把连接状态写成 Session 事件。** 否决：重连与热插拔是进程本地的；记录「已连接」会伪造模型未使用过的可见历史，并加重回放负担。

**浏览器 UI 直连 CZUR Runtime WebSocket。** 否决：USB 与本地 Runtime 属于 Host；Client 消费类型化 Remote，以便提供方替换留在 `ctx.docScanner` 之后。

**把实时取景与五个中文按钮留在 `conversation.input.activity`。** 教师交互评审后否决：activity 槽是单个紧凑控件（且与语音输入争用）；课堂产品把大预览放在专用面板。Composer 保留 `conversation.input.right` 状态芯片（**附上本批 · N**）；+「添加」提供一次性 **文档相机** 入口；叠层连接 / 拍照 / 本批条放在 `sidebar.right.pane.tab`。

**把提问 / 技能芯片放在右侧相机面板内。** 否决：对话 CTA 与硬件面板同处，与 Composer 视线割裂。采集留在侧栏；业务意图走 Composer `/`。

**在 Composer 上方保留就绪卡或本批上下文技能芯片条。** 否决：Harness `/` 清单本身没有芯片条；扫描仪再挂一条会重复目录、破坏形态一致。**附上本批 · N** 负责附上；`/` 负责技能。

**照搬豆包常驻教师技能橱窗与输入框内「技能」弹层目录。** 否决：DSH 真技能已走 Composer `/` 与 `dsh-tool-skill`；课件/教案橱窗属于产品 Preset，不属于采集缝。

**优先做豆包式 MCP 工具扫描。** 延后：MCP 适合对话驱动采集；课堂教师需要 UI 驱动预览，以及模型看见试卷前的显式附上一步。后续仍可用可选工具 Provider 包装 `ctx.docScanner`。

**每次拍照自动 `followup()`。** 本阶段否决：教师必须控制什么进入模型请求；隐私与复核优先于自动化。

## Acceptance criteria

- Mock：连接后打开或可用实时预览标签；就绪时推送帧；拍照进入本批盘并可选 `attachmentId` / `workspacePath`。
- `conversation.input.dock` 上**没有**本批技能芯片条。
- Composer 芯片在 N>0 时显示 **附上本批 · N** 且点击附上；教师用 `/` 选演示技能；不自动发送。
- CZUR 硬拍 / 翻页在 `autoCapture` 开启时经 `followStills` 入盘。
- CZUR 行保持禁用且组合不崩溃。
- 同事阅读实践指南与本 Note 即可理解为何与如何演示。
- 本阶段不改 agent-loop、不为链路状态加 SessionEvent、不做真实批改/LMS 一体机 UI。

## Risks

- 实验包仍为 opt-in；忘记 `--patch` 会像功能缺失。
- 真 CZUR 需要本机 SDK Runtime 与 Host 凭据；纯 Web 部署无法驱动 USB。
- 附件持久化依赖已挂载的 `ctx.attachments`；没有时拍照仍返回预览字节供 UI。
- 加入草稿时 Client 会再次上传字节，即便 Host 已通过 `attachments` 保存（接受直至存在按 `attachmentId` 进草稿的 API）。
- 状态芯片占用 `conversation.input.right` 列表席位，以便与语音输入的 activity 占用共存。
