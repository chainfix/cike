<p align="center">
  <img src="electron/assets/icon.png" width="112" alt="CIKE 图标">
</p>

<h1 align="center">CIKE</h1>

<p align="center">本地多环境浏览器 · 独立会话 · 代理管理 · 自动化 API</p>

## Windows 版本说明

当前正式发布仅提供 Apple 芯片版 macOS 安装包。维护者目前没有可用于完整测试的 Windows 设备，因此暂不合并和发布未经实际验证的 Windows 构建，避免提供无法确认能否安装、启动和更新的版本。

当前已提交的 Windows 相关 Pull Request 不会被合并，包括 Windows 安装包、打包流程和相关运行时改动；这些改动可以保留在各自的独立分支中。

需要 Windows 版本的用户请基于当前代码另行建立分支进行改造、构建和测试。暂不接受将这类改动合并到主分支，也不将其纳入正式发布。



发布流程会检查应用图标、应用签名和 DMG 完整性，并提供 `SHA256SUMS.txt` 供核对下载文件。

<p align="center">
  <a href="https://github.com/chainfix/cike/releases/latest">下载 macOS 版</a> ·
  <a href="#软件预览">软件预览</a> ·
  <a href="#安装与首次打开">安装说明</a> ·
  <a href="https://github.com/chainfix/cike/issues">反馈问题</a>
</p>

CIKE 是基于 Electron、Chromium 和 Playwright 的本地多环境浏览器。你可以为不同任务创建独立浏览器环境，分别保存登录状态、配置代理和浏览器参数，也可以通过本地 API 接入自动化脚本。

环境配置和浏览器会话保存在本机，无需注册账号或连接厂商管理后台。浏览器访问网站、代理检测和内核下载仍需要相应的网络连接。

## 功能特点

- **独立浏览器环境**：每个环境使用独立数据目录，持久保存 Cookie、本地存储和缓存，支持多个环境同时运行。
- **环境管理**：自动数字命名、创建、编辑、分组和搜索；支持跨页勾选、批量打开及批量删除，在列表中查看运行状态。
- **代理管理**：批量导入代理、检测连接及出口信息，支持跨页全选、批量删除，并为不同环境绑定代理。
- **原生一致策略**：CPU、内存、UA/Client Hints、Canvas、Audio 和 GPU 使用 Chromium 原生值，避免只修改页面却遗漏 Worker；可配置窗口、语言、时区和 WebRTC 的 UDP 限制。
- **内核管理**：在设置页下载 Chromium，后续启动复用已安装内核。
- **本地自动化 API**：通过 Token 鉴权管理环境、代理及浏览器进程，默认关闭外部调试端口；需要 CDP 接入时，启动应用前显式设置 `LFB_EXPOSE_DEBUGGER=1`。

## v0.7.0 环境管理更新

- **紧凑分栏列表**：分别展示环境名称与状态、代理/出口 IP、创建与最后打开时间，减少上下留白；环境每页12条、代理每页15条，支持跨页选择。
- **单环境代理编辑**：点击卡片中的蓝色 IP 或代理地址即可修改；打开编辑窗口时自动解析剪贴板中的代理，支持保存并检测，不影响引用同一代理的其他环境。
- **环境生命周期**：关闭最后一个浏览器窗口会退出该环境进程，启动中可以取消；关闭保留配置、Cookie和站点数据。
- **默认环境检测页**：通过当前浏览器网络检测出口 IP、地区、时区、语言与运营商，支持重新检测。沿用 api.ipify.org 和 ipwho.is，暂不提供家宽/机房 IP 性质分类。
- **独立序号图标**：macOS 环境图标顶部显示大号序号，下方为 CIKE 标志，采用铺满背景；修复 Dock 显示 Chrome Test 图标的问题，已有图标缓存会自动重建。

从0.6.0升级沿用原环境数据。首次生成每环境应用副本需要额外启动时间；APFS优先使用写时复制，下载的原内核保持不变。详细验收步骤见[环境管理验收说明](docs/LOCAL-ACCEPTANCE.md)。

## v0.6.0 安全与一致性更新

- **浏览器沙盒**：明确启用 Chromium sandbox 和站点进程隔离；不再允许 `LFB_EXTRA_ARGS` 绕过沙盒或代理设置。删除页面级 stealth、Canvas/Audio 噪声及 CPU、内存、平台、UA-CH 补丁，避免跨上下文矛盾和专用注入标记。
- **代理失败即停止**：每次打开代理环境前，由后端检查所选路由；丢失绑定、连接或认证失败均拒绝启动。被环境引用的代理不可直接删除。运行中代理断开时不自动改为直连；浏览器不绕过代理访问 loopback，QUIC 和直连 WebRTC UDP 受到限制。
- **语言与时区**：有代理时自动设置只采用当前代理出口检测结果，无法确定时提示手动配置；没有代理时使用系统原生值，不查询宿主公网地区、不回退纽约。显式语言同时应用于 Chromium 启动参数，覆盖 Worker。
- **凭据与管理窗口**：桌面版使用 Electron safeStorage（macOS 钥匙串支持）加密保存代理密码；数据目录0700、配置文件0600，写入原子化。管理窗口启用沙盒、CSP和IPC来源校验。API仅接受 `x-api-token` 请求头，不再接受URL Token，也不打印Token。
- **代理转发**：修复 SOCKS 中转的 Cookie、HTTP响应头与分块内容传输；代理检测通过HTTPS，并通过标准输入传递认证，避免凭据出现在curl命令行。
- **依赖与内核**：升级Electron到44.10.0，锁定Playwright 1.64.1；内核状态显示实际版本，更新通过HTTPS下载到独立目录并验证版本后切换，不再修改内核图标。Playwright测试内核归档不提供可用的完整macOS包资源签名，本流程不宣称Developer ID身份校验，也不会自行重签来掩盖这一限制。

### 从 0.5.x 升级

**旧环境不会自动转换，也不能直接启动。** 在「编辑」中阅读并勾选转换说明后保存，程序保留原数据目录、Cookie、站点数据、代理和窗口设置，原指纹字段留存于 `previousFingerprint` 供参考。转换取消旧系统、CPU、内存、Canvas和Audio伪装，网站观察到的指纹会改变；请逐个处理已有账号。

旧版“禁用 WebRTC”转换为“限制直连 UDP”。这使用Chromium原生网络策略，不宣称彻底禁用PeerConnection；可能影响音视频通话。默认自动策略也限制直连UDP，绑定代理时无法通过选择“默认”解除这一保护。

桌面首次启动会迁移凭据保护和权限。macOS可能请求钥匙串访问许可；由于当前应用使用ad-hoc签名，重新构建或升级后也可能再次提示，CIKE不会自动批准系统授权。请先关闭旧版并备份数据目录；旧版不能读取新加密格式，回退需要升级前备份。系统安全存储不可用时桌面版报错，不会降级保存明文。独立Node API没有Electron安全存储，使用0600文件保存密码，并拒绝读取桌面加密文件；请使用单独的 `LFB_DATA` 目录。

代理检测会经所选代理访问 `https://api.ipify.org` 和 `https://ipwho.is/<出口IP>`，服务可见该出口地址。检测服务不可用也会阻止代理环境启动；手动指定语言与时区可避免对地区信息的依赖，但仍需通过连接检测。

## v0.5.16 下载修复

环境浏览器使用 Chromium 原生下载管理，直接保存到 Mac 的「下载」文件夹，保留网站提供的文件名，浏览器下载记录也指向永久文件。同名文件自动添加数字后缀，不覆盖已有文件；下载完成后，关闭环境、退出应用或删除环境都不会删除文件。

请等待下载完成后再关闭环境或退出应用，关闭环境可能取消未完成的下载。旧版本已经被清理的临时文件无法恢复。0.5.15 使用临时文件加复制的方式，下载记录仍指向临时目录；0.5.16 移除了这条复制链路。

## v0.5.14 更新与使用说明

### 环境批量管理与自动编号

- 每个环境左侧提供勾选框，支持跨页保留选择，再点击「打开选中」或「删除选中」。
- 「全选筛选结果」选择当前搜索与分组范围内的全部环境，包含其他分页。切换筛选后，之前的勾选仍保留；操作前请核对已选数量。
- 批量删除前会统一确认，正在运行的环境先关闭，再删除配置及会话数据。操作结束显示成功与失败数量，失败项保留勾选以便重试。
- 新建环境自动使用数字名称，按创建顺序排在后面。序号持久保存，删除后不复用，重启后继续递增。已有环境名称保持不变，编辑时仍可修改名称。

### 代理管理与连接方式

- 代理列表支持逐项勾选、跨页全选、批量检测和批量删除。
- 在设置中启用「SOCKS5 代理通过系统代理连接」后，已配置的 SOCKS5 环境使用：**浏览器 → 本机中转 → Mac 系统代理 → 目标 SOCKS5 → 网站**。
- 关闭该开关时直接连接已配置的代理；无代理环境使用系统默认网络。开启开关但没有填写代理时，会解析并验证系统代理，若返回直连则报错。
- 启用两跳后系统代理不可用会报错，不会静默回退直连。
- 本机中转仅支持 TCP，相关环境限制 WebRTC 的直连 UDP；这不等于完全禁用 WebRTC。

### 内核、更新与启动

设置页可下载 Chromium、查看本地 API 信息，并检查 GitHub 最新版本。安装更新会下载并核对校验和，替换应用时可能请求管理员权限。环境数据独立保存，更新前建议备份。

此版本默认不暴露外部调试端口，并过滤自动化启动标记。保留现有指纹参数不意味着网站一定放行；是否可访问仍应结合实际网络和网站测试确认。

## 指纹检测与测试截图

可在环境浏览器中打开以下网站自行检查：

- [BrowserScan](https://www.browserscan.net/)
- [Yalala](https://www.yalala.com/)
- [ToDetect](https://www.todetect.cn/)

以下截图由用户提供，来自旧版的不同测试条件，包括96%和100%的评分，并非0.6.0的验收结果。当前验证依据是本地回归测试；网站评分不代表抗关联能力、匿名性或真实账号通过率。

![用户提供的指纹检测结果示例一](docs/images/fingerprint-sample-1.png)

![用户提供的指纹检测结果示例二](docs/images/fingerprint-sample-2.png)

![用户提供的指纹检测结果示例三](docs/images/fingerprint-sample-3.png)

## 软件预览

以下为桌面版实际界面，截图中的版本号及部分文字可能与最新版本不同。

### 新建环境

名称自动按数字递增；配置分组、分辨率、代理、语言和时区，支持创建后直接打开。以下截图为旧版界面。

![CIKE 新建环境：基本信息、代理及浏览器指纹选项](docs/images/create-profile.png)

### 浏览器管理

按分组管理环境，搜索名称或分组，支持单个操作和跨页勾选后批量打开、删除。

![CIKE 浏览器管理：环境列表、分组和运行状态](docs/images/profiles.png)

### 代理管理

批量添加代理，集中检测和删除，再按需关联到浏览器环境。

![CIKE 代理管理：批量导入及检测入口](docs/images/proxies.png)

### 系统设置

查看本地 API 地址及 Token、打开数据目录，并管理 Chromium 内核。

![CIKE 系统设置：本地 API、浏览器内核及版本信息](docs/images/settings.png)

## 下载

前往 **[最新版本发布页](https://github.com/chainfix/cike/releases/latest)** 下载 DMG 安装包，也可下载 `.dmg.tar.gz` 后解压取得同一磁盘映像。

| 项目 | 当前支持情况 |
| --- | --- |
| 系统 | macOS 13 及以上 |
| 芯片 | Apple Silicon，苹果 M 系列 |
| 安装包 | `CIKE-版本号-mac-arm64.dmg` |
| Intel Mac | 当前未提供对应安装包 |
| 签名 | 免费临时签名（ad-hoc），未经过苹果公证 |

## 安装与首次打开

1. 下载并打开 DMG，将 **CIKE** 拖入「应用程序」。
2. 推出磁盘镜像，从「应用程序」启动 CIKE。
3. 如果提示「Apple 无法验证 CIKE 是否包含恶意软件」，先关闭提示，再前往 **系统设置 → 隐私与安全性**，找到 CIKE 的拦截记录，点击 **仍要打开** 并按提示确认。

这是未经过苹果开发者签名及公证的应用可能出现的提示。临时签名用于保证应用包的结构完整，不代表苹果已验证开发者身份。

<details>
<summary>仍提示“已损坏”或没有“仍要打开”按钮</summary>

确认安装包来自本仓库发布页，必要时使用发布页提供的 `SHA256SUMS.txt` 核对文件。确认信任后，可以在终端中仅移除 CIKE 的下载隔离标记：

```bash
xattr -dr com.apple.quarantine /Applications/CIKE.app
```

然后重新打开应用。无需关闭整个系统的安全检查。文件校验和用于检查下载内容是否一致，不等同于苹果公证。

</details>

## 快速开始

1. **准备内核**：进入「设置」，下载 Chromium；已安装时可以跳过。
2. **添加代理（可选）**：进入「代理管理」，点击「添加代理」，每行输入一个代理，再检测连接情况。
3. **创建环境**：进入「新建环境」，自动分配数字名称，选择分组和分辨率，按需关联代理及调整语言、时区。
4. **打开浏览器**：点击「创建并打开」，或在「浏览器管理」中打开已保存的环境。
5. **继续使用**：下次打开同一环境时，沿用该环境已经保存的浏览器数据。

代理导入支持以下形式，每行一个；行尾可添加备注：

```text
host:port
host:port:用户名:密码
socks5://用户名:密码@host:port
```

## 数据保存

默认数据目录为 `~/.local-fingerprint-browser/`，可从设置页打开。通过环境变量 `LFB_DATA` 可以指定其他目录。

这里保存环境配置、代理配置、浏览器会话数据和本地 API 凭据。备份时建议先关闭所有浏览器环境并退出应用，再复制整个数据目录；删除该目录会丢失其中保存的数据。

## 本地 API

服务仅监听 `127.0.0.1`，在 `4440–4539` 范围内选择可用端口。**以设置页显示的地址为准**，不要假定端口固定。

请求通过 `x-api-token` 请求头鉴权；API 地址和 Token 也分别保存在数据目录的 `local_api_url.txt` 与 `api_token.txt` 中。

| 接口 | 用途 |
| --- | --- |
| `GET /api/getVersion` | 查询版本 |
| `GET /api/profiles`、`POST /api/profiles` | 列出、创建环境 |
| `GET /api/profiles/:id`、`PATCH /api/profiles/:id`、`DELETE /api/profiles/:id` | 查询、修改、删除环境 |
| `GET /api/proxies`、`POST /api/proxies` | 列出、创建代理 |
| `PATCH /api/proxies/:id`、`DELETE /api/proxies/:id` | 修改、删除代理 |
| `POST /api/proxies/check` | 检测代理 |
| `POST /api/proxies/parse` | 解析整行代理文本 |
| `PUT /api/profiles/:id/proxy` | 修改单个环境的代理 |
| `POST /api/profiles/:id/checkProxy` | 检测单个环境代理并更新出口信息 |
| `POST /api/openBrowser`、`POST /api/closeBrowser` | 打开、关闭环境浏览器 |
| `GET /api/checkOpen`、`GET /api/openedList` | 查询运行状态 |
| `GET /api/settings`、`PATCH /api/settings` | 查询、保存 SOCKS5 系统代理开关 |
| `POST /api/closeAllBrowsers` | 关闭所有环境浏览器 |

示例：将地址和 Token 替换为设置页中的实际值后创建环境。

```bash
curl -X POST 'http://127.0.0.1:4440/api/profiles' \
  -H 'x-api-token: YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name":"示例环境","platform":"mac","locale":"zh-CN","timezone":"Asia/Shanghai"}'
```

使用返回的环境 ID 打开浏览器：

```bash
curl -X POST 'http://127.0.0.1:4440/api/openBrowser' \
  -H 'x-api-token: YOUR_API_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"profile_id":"替换为环境ID","headless":false}'
```

## 源码运行

需要 Node.js 22.12 或以上版本。

```bash
git clone https://github.com/chainfix/cike.git
cd cike
npm ci
```

启动桌面界面：

```bash
npm run electron
```

也可以单独启动本地 API 服务：

```bash
npx playwright install chromium
npm start
```

如需使用已有的兼容 Chromium 可执行文件，可设置 `LFB_CHROMIUM_EXECUTABLE`。运行基础功能测试：

```bash
npm test
npm run test:desktop  # macOS 图形会话，使用临时目录测试
```

测试覆盖页面/iframe/Dedicated Worker/Shared Worker/Service Worker一致性、Cookie/LocalStorage/IndexedDB/Cache/Service Worker隔离、沙盒参数、代理失效阻断、本地STUN UDP限制、SOCKS认证与响应完整性、凭据保护、升级转换和下载回归。测试仅使用临时环境与本地服务器，不调用真实账号或代理。

## 能力范围

CIKE提供独立会话、代理和环境参数管理，未定制Chromium内核。0.6.0选择原生一致性，取消不完整的页面级指纹伪装；同一机器的不同环境仍可能有相同的Canvas、Audio、GPU及硬件特征，**不提供每环境唯一硬件指纹或强抗关联保证**。

已验证的本地网络测试不等于所有代理协议、DNS路径、VPN、系统代理和网站场景均无泄漏。Chromium沙盒和独立目录也不隔离同一系统用户下的恶意程序。高价值账号需要更强的系统级隔离。

## 问题反馈

请在 [Issues](https://github.com/chainfix/cike/issues) 中提供应用版本、macOS 版本、芯片型号、复现方式和报错截图。截图或日志中请遮盖 API Token、代理密码及个人信息。
