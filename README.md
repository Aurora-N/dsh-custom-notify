# dsh-custom-notify

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）用的通知插件：**需要你审核、需要你回答、执行完成、执行出错**时提醒你，点通知直接跳回对应会话。

> A notification plugin for DeepSeek Harness. It raises a notification when a tool
> needs approval, the agent asks you a question, or a turn settles or fails —
> clicking it focuses the window and opens that Session.

---

## 功能

- **四类提醒**：需要审核 / 需要你回答 / 执行完成 / 执行出错
- **点击跳转**：点通知聚焦窗口并切到那条会话
- **Dock 角标**：离开期间累计条数，回到窗口自动清零
- **页内提示条**：系统横幅可能不弹时（例如 App 在前台）在窗口角落补一条，可点击、可堆叠
- **通知时机可选**：任何时候 / 离开当前会话时 / App 不在前台时
- **子代理分控**：子会话的「审核/提问」和「完成/出错」可以分别开关
- **设置面板**：设置 → 通知，改动即时生效，并持久化

## 要求

- DSH 0.2.x（桌面版，或 `dsh web` 打开的页面）
- **必须有 Web 界面在运行**：通知由页面发出，纯 CLI、没有打开页面的 Host 不会提醒

## 安装

```bash
git clone https://github.com/Aurora-N/dsh-custom-notify.git
```

然后在 DSH 里安装这个目录（任选一种）：

**A. 插件管理器界面**：设置 → 插件 → 安装本地 bundle → 选择克隆下来的目录。

**B. 手动挂到 profile**（界面没有入口时）：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-custom-notify": "link:/绝对路径/dsh-custom-notify"
  },
  "dsh": {
    "profile": {
      "bundles": ["...已有条目", "dsh-custom-notify"]
    }
  }
}
```

```bash
pnpm install --dir ~/.dsh/profiles/<profile>
```

重载插件（或重启 DSH）后，**设置 → 通知**里应该出现这一页。

> 注意：本包与作者本地的 `dsh-notify` 是**两份独立实现**，路由前缀分别是
> `/dsh-custom-notify/*` 和 `/dsh-notify/*`。同时启用会收到两套通知，请只保留一个。

## 验证

设置页里点「发送测试通知」，或者在终端里：

```bash
TOKEN=$(curl -s http://127.0.0.1:<端口>/dsh-custom-notify/settings | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -H 'x-dsh-notify: 1' "http://127.0.0.1:<端口>/dsh-custom-notify/test?token=$TOKEN"
```

返回 `{"ok":true,"channel":"browser"...}` 并弹出一条通知即表示链路正常。

## 设置项

| 键 | 默认 | 说明 |
|---|---|---|
| `approval` | `true` | 工具调用请求授权时提醒 |
| `question` | `true` | 模型向你提问时提醒 |
| `turnEnd` | `true` | 一轮结束时提醒 |
| `error` | `true` | 一轮以错误结束时提醒 |
| `subagentApproval` | `false` | 子代理会话的审核/提问也提醒 |
| `subagentDone` | `false` | 子代理会话的完成/出错也提醒 |
| `sound` | `true` | 是否播放系统提示音 |
| `when` | `away-session` | `always` / `away-session` / `background` |
| `toastPosition` | `bottom-right` | 页内提示条位置：四角之一 |
| `settleMs` | `1200` | 轮次结束后等多久确认「真的结束了」 |
| `coalesceMs` | `1500` | 同一条通知的合并窗口 |
| `language` | `zh` | 通知文案语言：`zh` / `en` |

面板里的选择写到 **`~/.dsh/dsh-custom-notify/settings.json`**（`DSH_HOME` 存在时以它为准），优先级：默认值 < bundle patch < 面板选择。

想改默认值，可在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: notify
  config:
    when: always
    toastPosition: top-right
```

## 工作方式

```
Host 半侧                                    页面半侧
session/event                                  EventSource
  approval/asked    ┐                           /dsh-custom-notify/events
  tool/call(提问)    ├→ 组帧 → SSE ───────────→ new Notification(...)
  turn/start/end    ┘   {kind, sessionId,          ↓ 点击
                         title, subtitle,        window.focus()
                         body, when, sound,      + openSession()
                         toastPosition}          ↓
                                              同时：Dock 角标 + 页内提示条
```

- Host 只**判断和投递**，不碰任何系统 API；
- 真正的通知由页面用 Web Notifications API 发出，所以归属是 DSH 自己，点击能带回调；
- 没有页面连接时，通知最多等待 **8 秒**等页面重连，超时丢弃；
- 审核和提问走的是**会话日志里的持久事件**（`approval/asked`、`tool/call`），所以即使别的应答者抢答了请求，通知也不会漏。

## 排障

- 日志：**`~/.dsh/dsh-custom-notify/diagnostics.log`**，记录 `notify` / `shown` / `suppressed` / `sse-open` / `mount` 等每一步；
- 页面没连上时通知会等 8 秒后丢弃（日志里 `drop kind=…`）；
- 浏览器直接打开 `dsh web` 时，需要在首次交互后允许通知权限；Electron 桌面版默认已授权；
- macOS 上同一 App 连续两条通知，后一条可能顶掉前一条横幅——页内提示条会分别显示，作为兜底；
- 插件被**停用**时不产生任何通知（包括“重新启用插件”这次审批本身，因为那时插件还没加载）。

## 开发

```
index.js           组合根（装配）
host/config.js     默认值、文案、设置读写
host/diagnostics.js 日志
host/notifier.js   组帧、订阅者、等待缓冲
host/routes.js     SSE / report / test / settings 路由
host/signals.js    事件 → 通知的判断
host/util.js       小工具
client.js          页面半侧（单文件，按 12 段组织）
```

```bash
npm run check    # 语法检查（node --check）
```

页面半侧必须保持为**单个经典脚本**：client 模块系统每个包只发一个 `./client`，
`factory(require)` 只解析平台种子（如 `react`）与已注册的包 id，不支持相对导入。

## 卸载

1. 从 profile 的 `bundles` 里移除并重载（或插件管理器里卸载）；
2. 需要的话删除 `~/.dsh/dsh-custom-notify/`。

## License

MIT © Aurora-N
