# Siglum Updater 0.2.0 开发预览

[English](README.md) | [简体中文](README.zh-CN.md)

这是开发者的**源码集成工具**，不是桌面写作程序，也不是普通用户安装器。独立认证本地浏览器面板；打开、选包或查看 Release 不会写 GitHub。

## 首次设置

将 bootstrap ZIP 解压到独立文件夹，不要解压进仓库或覆盖旧 v0.1.2。终端用已有 Node22.16+ 运行 bootstrap.mjs（你现有 Node24 适用）。开发者仍使用 Git、pnpm10.11 和 GitHub CLI；复用 gh 登录，不复制 token 到配置。引导器将校验后的版本复制进用户固定目录，创建 Windows 桌面／开始菜单入口，不关闭系统保护、不安装后台服务、不请求管理员权限。只运行你信任的包；哈希是完整性检查，不是发布者签名。

```text
node bootstrap.mjs
```

固定目录为 Windows Known Folder LocalApplicationData/SiglumUpdater（Linux 为 XDG state home/siglum-updater）。版本化 current.json/start.mjs 在加载程序前验证文件哈希，保留旧程序和配置备份。不要在任务中覆盖更新器。后续更新器版本需要另行明确引导／迁移，不进行任意后台自更新。

面板首次确认已有仓库根目录。常见 Downloads/v0.1 布局只提供路径提示；其他位置可一次填入根目录。预览核对 Git 与批准的数字仓库身份。自定义 pushurl、SSH 别名、不可达旧名或 origin 身份不同会要求核查，不全局替换。不会接管其他 Git 仓库。

以后使用 Siglum Updater 快捷方式。关闭浏览器不停止宿主，请用「退出」。临时本地会话链接含权限，运行期间不要分享；刷新只复用本地浏览器会话，不保存 GitHub 密钥。

## 集成源码 ZIP

拖入／选择**源码 delivery 包**，文件名带 `(1)` 也可；按清单、固定仓库身份、精确基线和完整 SHA-256 识别，不按下载时间猜包。原 ZIP 复制到固定哈希缓存，新下载不会替换进行中任务。

预览后选择全流程或仅 PR。这个明确决定授权可信项目的安装／构建／测试、分支上传和 PR；全流程再包含 CI 门禁后的固定 head 合并与安全本地收尾。测试会执行项目代码，worktree 不是 OS 沙箱，不导入陌生不可信项目包。

独立任务分支／worktree 保留日常目录和 index。每阶段记录导入／验证／提交／推送／PR／CI／合并／本地同步；外部结果未知先查询，不直接重发。源码或锁文件变化需重验，不将失败变成成功。每次前台继续最多等待15分钟，之后保留进度再点继续。受信任矩阵为 Ubuntu／Windows × Node22／24，不是任意绿色勾。锁定 PR head 并再查 base，不能替代服务端严格分支规则的原子门禁。

远端合并后，原目录只有在批准的 main、干净且可快进时才同步，否则区分远端成功／本地待同步。不自动 stash/reset/clean/强推。清理只移除确定归属且未变化的任务 ref/worktree；忽略的构建输出可能导致 Git 拒绝删除，此时保留并警告，不伪装合并失败或强删目录。这些保留目录会占空间，首版不会递归清理未知产物。

续跑使用记录的任务／包身份；同版本补丁也是不同包。不手改清单，不运行旧修复脚本。任务目录里有未知变化就保留诊断，不自动三方覆盖；替换中断任务的补丁可能需要新的明确验证任务。v0.1.2 不完整历史不会盲目当成新版本记录接管。

## 更名与身份

本项目固定 github.com repository1370967185／node R_kgDOUbdMkQ／owner255999131，当前名称 JaynOwO/writer-agent。每次外部操作按同一 ID 解析当前名字和 URL；同所有者正常更名、owner 登录名变化保留任务、PR、缓存和 Release 关联。fork、同名新库、不同 ownerID、不可达／归档目标或 base 改动会停止。名称只是展示／历史信息，本机配置／worktree／凭据不随 slug 改变，旧包字节也不改写。

首次身份绑定明确确认。已绑定的 v0.2 项目能在旧名被复用后按原 ID 寻址；未绑定的旧 origin 指向不同库时不能仅凭共享提交放行。自定义 origin/pushurl/SSH 配置保留而非改写。没有使用生产库改名来验收；工具不自动改仓库名，也不能修复所有外部硬编码链接。

## 公开 Release 下载

还没有上传的新代码仍使用本地 delivery，不制造循环。Release 面板只读取绑定仓库公开发布，其中需要带 GitHub digest 的 `siglum-release.json` 标明源码／更新器／桌面资产。没有描述就显示不识别，不把 main/tag 猜成安装包。正式／预发布及两个产品版本流分开。

描述格式：

```json
{"format":1,"repositoryId":"1370967185","products":[{"product":"siglum","kind":"source-delivery","version":"0.0.9","assetId":123456789,"sha256":"REPLACE_WITH_THE_ACTUAL_ASSET_SHA256"}]}
```

以上仅为文档占位示例，不可发布。之后经授权的发布者应使用**实际上传资产 ID 和实际文件哈希**生成描述；本版不发布 Release。类型有 source-delivery、updater-bootstrap、desktop-portable、desktop-installer，product 为 siglum 或 siglum-updater，错配拒绝。桌面包只下载，不自动安装；实际安装由应用另行确认。资产 ID／摘要／大小／更新时刻会重查，公开下载跳转不携带 GitHub token。首版不支持私有认证资产下载。

## 诊断与边界

元数据诊断排除普通路径及源码／私稿，但项目 stdout 自己可能输出敏感文字，分享日志前核对。完整状态／缓存数据库不是公开诊断附件。main 合并、本地同步、清理、CI、Release 发布和桌面安装是不同事实；失败不意味着可以绕过保护。

测试使用真实临时 Git 仓库和假 GitHub。浏览器联合测试模拟作者确认及验证步骤，不证明真实改名／Release／CI／Windows 引导行为。Linux 和 Windows 分别记录。Apache-2.0 保持不变，分发保留 LICENSE。


## Windows 重命名修正（winfix1）

针对 Windows 返回 `EPERM` 的引导自检失败，临时版本目录和 `current.json` 的发布最多进行 11 次 rename 尝试（10 次等待，共 5.5 秒；不包含文件系统操作耗时）。仅对 `EPERM`、`EACCES`、`EBUSY` 等可能暂时的拒绝进行等待；这不代表已经确定错误由杀毒软件或索引程序造成。

每次尝试都重新核对文件清单和目标状态。若有其他程序创建目标目录、修改当前指针或改变已校验的程序文件，则停止；不会删除现有正式目录/指针来强制成功。持续拒绝访问仍然返回失败，原有检查全部保留。重试仅针对本地 rename，不重跑 GitHub 请求或整套安装。

已安装并能打开的 v0.2 面板可以直接导入 `writer-agent-v0.0.9-delivery-winfix1.zip`。同版本修正版按新包哈希建立一个未授权任务，核对并批准后使用新的独立 worktree；旧失败任务和缓存保持不动。不要把新字节覆盖进旧任务的已批准缓存，也不要点旧任务的“继续”来期待它使用修正版。桌面程序、依赖锁文件与私人文稿不受本修正影响。
