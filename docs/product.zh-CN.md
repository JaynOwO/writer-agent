# 连接、验证与阅读报告 — Siglum v0.0.8

[English](product.md) | [简体中文](product.zh-CN.md)

## 1. 入口与兼容

下面命令的 workspace 是**独立写作工作区**，不是源码仓库；已有目录不要重新初始化。命令中的 RUN_ID 和 DOC_ID 必须换成真实 ID，编号向导不需要手抄它们。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:product
pnpm siglum product doctor
pnpm siglum product guide ../existing-writing --lang en
pnpm siglum product guide ../existing-writing --lang zh-CN
```

Windows PowerShell 可用 `pnpm.cmd`，不要为此放宽系统安全策略。`demo:product` 创建一次性工作区，运行本仓库的虚构 MCP 程序、假模型 HTTP 和**内存假凭据后端**；结束标记 `PRODUCT_DEMO_OK`。它实际使用官方 SDK，但不是第三方互操作、真实 OS 凭据或真实模型效果测试。

本版工作区保持 schema6，不因为更新代码而升级私人数据库；旧工作区需要原有功能升级时仍先展示备份迁移。新增的连接元数据单独在用户级 `connections.sqlite`（schema1）保存。旧任务没有 `navigationSummary`／`connectionRefs` 时保持原有行为。读取旧报告不会补写新的凭据、SDK或摘要使用声明。

## 2. 具名连接与密钥

产品向导支持新增、替换、停用连接，以及将预设明确绑定到已有任务。原改稿／审稿向导和工作流的新建模型选择也能直接选保存的模型。选择预设不是发送许可；仍需准确预览和批准。

预设可以是模型、固定 Tavily 搜索接口，或已注册 MCP 配置。模型地址、模型 ID、输出上限和超时保存为普通配置，密钥单独选择以下一种来源，**不自动互相回退**：

- 系统凭据库：Windows Credential Manager、macOS Keychain，Linux 明确指定 Secret Service；不退回 kernel keyring、明文文件或所谓自带解密钥匙的加密文件。
- 环境变量：保存变量**名称**，只在使用时从本机进程环境读取值。
- 会话：密钥只在当前进程内存中，退出后不可用；再次打开这个预设会说明凭据缺失，不自动另找一把 Key。
- 无凭据：只用于不需要认证的服务。

密钥通过遮蔽输入录入，不作为命令参数、普通 JSON、URL、日志或模型数据保存。输入结束／Ctrl+C 不会默许保存。系统后端可能不可用、锁定或拒绝权限，缺失不是空凭据成功。密钥在获准的应用进程使用期间仍是可读内存，不能承诺 JavaScript 字符串完全擦除或抵抗被控制的本机。

用户配置位置：Windows `%LOCALAPPDATA%\Siglum`；macOS `~/Library/Application Support/Siglum`；Linux `$XDG_CONFIG_HOME/siglum` 或 `~/.config/siglum`。不把目录放入 Git 或公开报告。配置文件本身不是密钥库，也不加密稿件与备份。系统凭据命名空间为 `Siglum/credentials/v1`。

替换建立新版本，旧任务要重新选择并授权。旧 Key 不会被偷偷转移到新域名。OS 库与配置库没有跨库原子事务：先记录随机新条目操作，保存新引用，失败只补偿本次新条目；“恢复未引用凭据操作”仅处理 Siglum 自己的记录。旧版本的未引用 Key 可以明确清理。停用并移除**本机** Key 不等于在服务商撤销 Key。

工作区中出现一个凭据引用并不能自行读取本机 Key。作者必须建立本机任务／端点绑定；复制来的任务、伪造引用或改变端点会停止。预设 Key 更新也会使旧版本引用失效。stdio 的 Key 仍通过明确列出的环境变量处理，不把 HTTP 系统令牌偷偷注入进程；stdio 预设本身只允许无 HTTP 凭据模式。

## 3. 官方 MCP SDK 与旧连接

实际锁定 `@modelcontextprotocol/client@2.0.0`。SDK负责协议、生命周期和客户端请求；宿主保留受限 stdio 帧／字节读取、HTTP 响应保护、schema 子集、权限与预算。没有原生协议执行回退。支持表见[扩展协议](extensions-protocol.md)。

SDK 变更包含连接身份。**旧 v0.0.7 注册的 MCP 连接不能直接继承信任执行**。扩展向导的服务菜单可“重新注册当前程序／SDK”，显示配置再建立新记录，之后分别信任、发现、在任务里选择新目录并授权。旧连接、目录和任务历史保留。非交互等价命令：

```sh
pnpm siglum mcp renew ../existing-writing OLD_SERVER_ID
pnpm siglum mcp renew ../existing-writing OLD_SERVER_ID --apply
pnpm siglum extensions guide ../existing-writing --lang zh-CN
```

renew 默认只预览，apply 也只是建立新连接，不信任、不启动、不自动改任务。对于系统凭据认证的 HTTP MCP，在产品向导中选择“使用预设发现并保存 MCP 工具列表”；它要求配置完全匹配且已信任的注册连接，读取 Key 后只对该端点发现。随后任务选择确切工具参数，再绑定该预设。

没有 OAuth、任意回调、自动重连、隐式协议降级、二进制工具结果或系统沙箱。仅提供文本工具／资源；SDK有某种能力不等于 Siglum 已批准它。工具注解不是安全证明。本地受信任程序仍可能读磁盘或自行联网。关闭的是受管直接子进程和管道，不承诺限制其任意后代进程。

## 4. 三层验证与恢复

`product doctor` 默认只读取本地元数据、查找包入口；它不验证账户、不解析外网 DNS、不加载并读出 Key、不解锁、不启动第三方程序。`passed` 的包检查只说明入口可找到，不说明远端可用。

真实验证在产品向导单独选择：

- 模型：合成短句的两次以内改稿／审稿请求，使用正常运行器和提案检查，不采用正文；实际模型是否改变文字由其输出决定。
- 搜索：一次固定的 Tavily basic 查询，不请求自动答案或提高搜索深度。
- MCP：连接／启动所选服务，发现工具和资源，不调用业务工具；发现本身也可能有外部行为或费用。
- 凭据：随机命名的一项虚构测试凭据，创建、读回、替换、删除并核对缺失；不读取其他应用 Key。未完成清理的自建项留下可明确恢复的操作记录。

预览固定服务、模型、合成材料、超时、次数／输出上限和启动指纹，确认后才执行。结果区分 `passed`、`failed`、`not-run`、`not-configured`、`unsupported`、`cancelled` 与 `outcome-unknown`。未派发取消不算请求成功；已可能发送的失败保守保留未知，不偷偷重试。日志不保存远端错误正文或密钥，已返回 token／credit 可显示，金额缺价格就为未知。

验证记录保存于本机配置，保留 OS、Node、SDK版本和时间。固定合成模型试用结束后删除其一次性工作区，只留非秘密结果摘要；不能拿它恢复一份私人稿件。对真正写作任务的恢复使用原有运行器：

```sh
pnpm siglum product recovery ../existing-writing RUN_ID
pnpm siglum workflow guide ../existing-writing --lang zh-CN
```

恢复说明列出保存产物、状态、配额和是否可能重复计费，不自动执行恢复操作。权限和输入变更仍需新授权；关窗口不是后台继续运行。

## 5. 可选导航摘要

产品向导对新稿任务开启 `navigationSummary` 会刷新捕获并撤销旧授权。研究阶段在已经选定的**原文片段**上最多生成一份成功导航摘要；失败／重试仍计模型尝试。它不会扫描整库、用私人要求规划公开查询或给每个块都调用模型。

摘要固定原文片段与坐标、模型／提示版本、输入／输出、遗漏和已返回用量，标为 `derived-navigation-not-evidence`。用于大纲及后续章节时仍带着原文；多来源摘要只有全部相关来源都在该章证据包里才附上，不能留一半依据却隐藏另一半。精确引文必须匹配已发送的原文。

**这版是保守的导航辅助，不是保证缩短上下文的压缩器。** 它保留原来的选定证据，所以可能增加输入、时间和费用。没有真实推理对照就不能声称省钱或提高准确率。源选择、问题、模型或版本变化会改变缓存身份；已保存且请求匹配的摘要可以在后续失败恢复时复用，不重复调用。不做递归“摘要的摘要”。

没有开启时不增加摘要任务。摘要不批准文字、不启用偏好、不认证事实；不能引用摘要来冒充原始报告。相关原文回取失败、引文不匹配或超限时停止或保留待核查，不编造证据。

## 6. 私人静态 HTML 阅读报告

向导可以导出文稿、任务或仅元数据诊断报告。非交互示例：

```sh
pnpm siglum product report ../existing-writing run RUN_ID ../reading.html --text --sources --guidance --lang zh-CN
pnpm siglum product report ../existing-writing document DOC_ID ../document.html --text --lang en
pnpm siglum product report ../existing-writing run RUN_ID ../metadata-only.html --lang zh-CN
```

这是**时间点只读快照**，不是 GUI 编辑器，不读取后来数据库变化。显示候选、精确前后原文（不是最小 word diff）、模型意见／作者反馈、来源范围、已用指导和截至生成时的恢复状态。不会重新调用模型，也没有接受／撤回／继续执行按钮。

默认不带原文；`--text`、`--sources`、`--guidance` 分别允许结构化正文组、来源组和指导组。未选字段根本不写进文件，不是放在隐藏 DOM。然而正文或模型评论本来就可能复述来源／偏好：这些开关不是语义保密检测器。分享前审查成品；仅元数据模式更适合排错。

原始 Markdown／HTML 按文本转义显示，不执行标签；全页无 JavaScript、外部样式／字体／图片／表单，受限 CSP 作为补充。来源链接仅在主动点击时打开 HTTP(S)，不预取、不转发 referrer。需要已有输出目录、文件不能存在，使用同目录临时文件与不覆盖的原子就位；不支持硬链接的目标文件系统会报错，不降级成覆盖。较大报告会明确拒绝，不静默剪掉历史。

浏览器阅读／打印效果与文件打开策略分别验证：开发环境可测试精确 HTML 的 Chromium 渲染，但 `file://` 可能受管理员策略限制；不教用户为此关闭保护，不把浏览器组件测试当成 Windows/Edge 实测。

## 7. 验证边界

用户返回的 Windows Node24.18.0 准备报告证明 SDK基本 stdio 与 keyring2.1.0 绑定的隔离读写／重开／清理成功；**不是完整 v0.0.8 Windows 应用测试**。本版回归和演示默认自建 HTTP/MCP服务与假凭据后端，官方 SDK服务夹具是 SDK-to-SDK，不是独立第三方互操作认证。

Linux Secret Service 无登录会话时可能无法使用，macOS 与真实 Windows应用行为分开记录；不把 fake 后端通过算作这些系统实际存储成功。真实 Tavily账户、真实模型、独立 MCP服务和摘要质量均需你另行选定试用，软件不附送凭据或余额。

见[依赖清单](dependencies.md)、[扩展兼容](extensions-protocol.md)、[架构](architecture.md)、[安全](security-model.md)和[限制](limitations.md)。
