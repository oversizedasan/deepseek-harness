# 文档扫描仪（实验）

[English](doc-scanner.md) | 中文

本指南说明如何运行带本批盘的 Mock 文档扫描仪演示：采集后附上草稿，再经 Composer **`/`** 选技能提问；以及 CZUR 硬拍静帧落在哪里。若尚不熟悉能力缝，请先完成[基础插件路径](../basic/index.zh.md)与[三种角色能力教程](index.zh.md)。

## 为何这样拆

课堂采集需要高拍仪，但不能 fork agent-loop，也不能把 CZUR WebSocket 埋进 Chat UI。实验栈对齐语音输入：Service Definition、可替换提供方、Host Remote、Client UI，以及显式 bundle patch。连接状态是进程本地 live 状态；取景帧走独立的 `preview` 流；只有之后进入请求的静帧才可能经附件进入持久 Session 历史。批改等业务走 Harness 现有 Composer `/` 技能，不另做芯片条（与 `/` 清单形态一致）。决策依据：[Agent Note](../../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.zh.md)。扩展点地图：[架构](../../../architecture.zh.md#where-new-behavior-goes)。

这不是批改一体机。豆包教师技能与 CZUR AI 作业产品在采集之后再设科目、版式与判分；DSH 把批改留给 `/` 技能与后续消费 `attachmentId` 的流程。

## 包拓扑

```text
client-ui-doc-scanner  --Typert-->  api-doc-scanner  -->  doc-scanner
     | chip + menu + right tab                           ^
                                              doc-scanner-mock (demo)
                                              doc-scanner-czur (Command + Video WS)
doc-scanner-skills  -->  ctx.skills  (Composer / catalog)
```

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-doc-scanner` | `ctx.docScanner` |
| `@deepseek-ai/dsh-doc-scanner-mock` | Mock 提供方 + 预览帧 |
| `@deepseek-ai/dsh-doc-scanner-czur` | CZUR Command WS + Video WS 提供方 |
| `@deepseek-ai/dsh-doc-scanner-skills` | 演示技能 `homework-grade` / `wrong-book`（仅 `/`） |
| `@deepseek-ai/dsh-api-doc-scanner` | Remote `docScanner.*`（含 `preview` 与 `followStills`） |
| `@deepseek-ai/dsh-client-ui-doc-scanner` | 状态芯片、+ 菜单入口、实时预览标签、本批盘与附上 |
| `@deepseek-ai/dsh-doc-scanner-bundle` | `--patch` 组装 |

## 运行 Mock 演示

```sh
pnpm install
pnpm run build:artifacts
pnpm dsh web --patch packages/experimental/doc-scanner-bundle/cordis.patch.yml
```

Web UI 中的教师路径（三层：**本批相册 → 附件轨 → `/` 意图**）：

1. 从 + 菜单「添加」下的 **文档相机**，或点击 Composer 状态芯片打开右侧标签；需要时会自动连接。状态文案主语为高拍仪（如「高拍仪已连接」）。
2. 在实时取景中对边（Mock 循环演示帧）。用画面上的叠层 **连接并预览** / **拍一张** 快门；角上可断开。
3. 静帧进入取景器上的 **本批条**；点缩略图可看大图，糊了就删。Host 同时归档到**当前 Session 工作区** `Captures/<batchId>/`；点 **在文件中查看** 打开最新一张。
4. Composer 芯片显示 **附上本批 · N**：点标签静默附上本批图片到附件轨，并尽量插入 `@` 目录芯片（对人显示「本批扫描 · 今天 HH:MM（N 张）」；归档路径为 `Captures/<YYYY-MM-DD_HHmmss>/`），然后聚焦输入框；点左侧状态点可再打开文档相机（单次上限与 Composer 一致，默认 20 张）。同一批重复附上不会再追加已附过的图片，也不会再插目录芯片；本批新增静帧仍会只附上增量。附件轨可再点缩略图看原图；点目录芯片优先打开该批归档中的一张图，本批无匹配时打开 Files 并尽量列出归档后打开其中一张。刷新页面后浏览器附件会失效，但若草稿仍保留 `@Captures/<batchId>/` 芯片且工作区归档还在，会自动从磁盘重灌附件轨预览；打开失败时给出明确提示。
5. 在输入框输入 `/`：空查询时演示技能 **`homework-grade`** / **`wrong-book`** 排在前部（主行仍是 ASCII `name`，副文案为中文）；也可键入 `/name`。按需改文案后 **发送** — 图片仅在此时对模型可见。不自动发送；Composer 上方**没有**本批技能芯片条。

## 连接阶段

| 阶段 | 含义（UI 文案主语为高拍仪） |
|---|---|
| `disconnected` | 无活动设备 |
| `connecting` / `opening` | 进行中 |
| `device_missing` | Runtime 可达但无设备（硬件提供方） |
| `ready` | 允许拍照与预览 |
| `capturing` | 拍照进行中 |
| `error` | 可恢复失败并带说明 |

不要把这些阶段写成 Session 事件。预览帧也不是 Session 事件。

<a id="phase-2-czur-hardware"></a>
## 第二阶段：CZUR（真机）

`@deepseek-ai/dsh-doc-scanner-czur` 已实现 Command WS 拍照与 Video WS → `preview()`（[清单](../../../../packages/experimental/doc-scanner-czur/README.zh.md#phase-2-checklist)）。官方流程：`auth.create_session` → `device.list` → `device.open` → `capture.take`（[CZUR Open Platform](https://open.czur.com/docs/reference/sdk-open/)）。

真机配置以本节为准，各包 README 链接到这里。开始前请确认：

1. CZUR SDK Runtime 监听在 `wss://sdk-runtime.localhost:18090`（默认 `commandWsUrl`）。其证书为自签名，所以随包 patch 设置了 `allowInsecureTls: true`；提供方自身默认值为 `false`。
2. `CZUR_API_KEY` 已配置在凭据库、启动 shell 的环境或仓库根 `.env` 中。切勿提交。
3. 上次拉取代码后执行过 `pnpm run build:artifacts`；构建过期会在插件加载时失败。
4. 文档相机已通过 USB 连接。

```sh
pnpm dsh web --patch packages/experimental/doc-scanner-bundle/cordis.czur.patch.yml
```

| 现象 | 原因 |
|---|---|
| 错误 `CZUR API token is not configured (set credentialRef or CZUR_API_KEY)` | `CZUR_API_KEY` 缺失或为空 |
| `device_missing`，`No CZUR device is connected` | Runtime 有响应，但未报告设备 |
| `error`，连接失败 | `commandWsUrl` 上无服务；启动 Runtime 或在 patch 中修改 `commandWsUrl` |

验收：连接进入 `ready`（无 USB 设备时为 `device_missing`），预览有实时帧，拍照 / 硬拍填入本批盘（带 `batchId` 时 Host 归档到 `Captures/<batchId>/`），断开回到 `disconnected`。默认 `autoCapture` 开启翻页检测。凭据放在 Config / credentials 缝。

## 不要

- 为扫描仪模式改 `agent-loop`。
- 把「已连接」或取景帧记成 Session 事件。
- 从浏览器直连 CZUR WebSocket。
- 期望本包内置批改叠图或 LMS 导出。
- 把连续拍照控件放进 + 菜单——它只作发现入口。
- 在 Composer 上方另做本批技能芯片条（与 `/` 清单重复）。

## Related

- [组合包 DETAIL](../../../../packages/experimental/doc-scanner-bundle/docs/DETAIL.md)
- [实验组地图](../../../../packages/experimental/README.zh.md)
