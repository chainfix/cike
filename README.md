<p align="center">
  <img src="electron/assets/icon.png" width="112" alt="CIKE 图标">
</p>

<h1 align="center">CIKE</h1>

<p align="center">本地多环境浏览器 · 独立会话 · 代理管理 · 自动化 API</p>

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
- **浏览器参数配置**：设置操作系统标识、分辨率、语言、时区、CPU 核数、内存和随机种子，支持可选的 Canvas 噪声与 WebRTC 策略。
- **内核管理**：在设置页下载 Chromium，后续启动复用已安装内核。
- **本地自动化 API**：通过 Token 鉴权管理环境、代理及浏览器进程，默认关闭外部调试端口；需要 CDP 接入时，启动应用前显式设置 `LFB_EXPOSE_DEBUGGER=1`。

## v0.5.15 下载修复

环境浏览器中完成的下载会自动保存到 Mac 的「下载」文件夹，保留网站提供的文件名。同名文件自动添加数字后缀，不覆盖已有文件；已完成保存的文件在关闭环境、退出应用或删除环境后仍保留。

请等待下载完成后再关闭浏览器窗口；直接关闭窗口仍可能取消未完成的下载。通过管理界面关闭环境时会等待正在保存的下载结束。旧版本已经被清理的临时文件无法恢复。

## v0.5.14 更新与使用说明

### 环境批量管理与自动编号

- 每个环境左侧提供勾选框，支持跨页保留选择，再点击「打开选中」或「删除选中」。
- 「全选筛选结果」选择当前搜索与分组范围内的全部环境，包含其他分页。切换筛选后，之前的勾选仍保留；操作前请核对已选数量。
- 批量删除前会统一确认，正在运行的环境先关闭，再删除配置及会话数据。操作结束显示成功与失败数量，失败项保留勾选以便重试。
- 新建环境自动使用数字名称，按创建顺序排在后面。序号持久保存，删除后不复用，重启后继续递增。已有环境名称保持不变，编辑时仍可修改名称。

### 代理管理与连接方式

- 代理列表支持逐项勾选、跨页全选、批量检测和批量删除。
- 在设置中启用「SOCKS5 代理通过系统代理连接」后，已配置的 SOCKS5 环境使用：**浏览器 → 本机中转 → Mac 系统代理 → 目标 SOCKS5 → 网站**。
- 关闭该开关时直接连接已配置的代理；无代理环境不会因这个开关而启用本机中转。Mac 自身的 VPN、系统代理和网络路由仍会影响实际出口。
- 系统代理和目标 SOCKS5 地址相同时仅连接一次。启用两跳后系统代理不可用会报错，不应静默回退直连。
- 本机中转仅支持 TCP，相关环境会阻止 WebRTC 的 UDP 绕行；检测网站可能显示 WebRTC 禁用或超时。

### 内核、更新与启动

设置页可下载 Chromium、查看本地 API 信息，并检查 GitHub 最新版本。安装更新会下载并核对校验和，替换应用时可能请求管理员权限。环境数据独立保存，更新前建议备份。

此版本默认不暴露外部调试端口，并过滤自动化启动标记。保留现有指纹参数不意味着网站一定放行；是否可访问仍应结合实际网络和网站测试确认。

## 指纹检测与测试截图

可在环境浏览器中打开以下网站自行检查：

- [BrowserScan](https://www.browserscan.net/)
- [Yalala](https://www.yalala.com/)
- [ToDetect](https://www.todetect.cn/)

以下截图由用户提供，展示不同测试条件下的检测结果，包括 96% 和 100% 的评分。各网站评分规则不同，截图不是本项目对所有设备、代理或网站的通过率承诺；高分也不代表一定通过 Cloudflare、Google 或 Oracle 的访问检查。

![用户提供的指纹检测结果示例一](docs/images/fingerprint-sample-1.png)

![用户提供的指纹检测结果示例二](docs/images/fingerprint-sample-2.png)

![用户提供的指纹检测结果示例三](docs/images/fingerprint-sample-3.png)

## 软件预览

以下为桌面版实际界面，截图中的版本号及部分文字可能与最新版本不同。

### 新建环境

名称自动按数字递增，无需填写；配置分组、操作系统、分辨率、代理和指纹选项，支持创建后直接打开。

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

发布流程会检查应用图标、应用签名和 DMG 完整性，并提供 `SHA256SUMS.txt` 供核对下载文件。

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
3. **创建环境**：进入「新建环境」，自动分配数字名称，选择分组、操作系统和分辨率，按需关联代理及调整其他选项。
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

需要 Node.js 22 或以上版本。

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
npm run smoke
```

## 打包 Windows 版

Windows x64 支持两种产物（Electron 44）：

```powershell
npm ci

npm run pack:win-x64   # 免安装目录版 -> dist\CIKE-win32-x64\，双击 CIKE.exe
npm run dist:win       # asar + NSIS 安装程序 -> dist-installer\CIKE-Setup-0.5.15-x64.exe
npm run dist:win:dir   # 只出 asar 的免安装目录 -> dist-installer\win-unpacked\
```

安装程序（`electron-builder` 的 `nsis` target，配置在 `electron-builder.yml`）就是常见的向导式安装包：可选安装目录、建开始菜单快捷方式（桌面快捷方式在向导里勾选）、写入「应用和功能」的卸载项，默认装到 `%LOCALAPPDATA%\Programs\CIKE` 所以不弹 UAC；卸载会保留 `%USERPROFILE%\.local-fingerprint-browser` 里的环境和内核。支持静默安装：`CIKE-Setup-0.5.15-x64.exe /S /D=D:\CIKE`。

`asar: true` 会把 `src/`、`electron/` 与生产依赖打成一个 `resources\app.asar`（约 18 MB），Electron 直接从中加载主进程与渲染进程代码；内核不在 asar 内，仍是设置页下载到用户目录的外部 Chromium。

图标由 `electron/assets/icon.png` 生成：`python electron/assets/make-ico.py`（需要 Pillow），生成的 `electron/assets/icon.ico` 已随仓库提供。

Windows 版与 macOS 版的差异：

- 内核同样在设置页一次性下载（Playwright CDN 的 Chrome for Testing，约 200 MB），解压优先用系统自带的 `tar.exe`，缺失时回退到 `unzip` 或 PowerShell `Expand-Archive`；
- 下载文件保存在系统「下载」文件夹；
- 在线更新不做静默替换：点「下载并安装」会打开发布页，下载新版安装包覆盖安装即可；
- 未做代码签名，首次运行可能出现 SmartScreen 提示，选择「更多信息 → 仍要运行」。

`windows-latest` 上的自动化构建见 `.github/workflows/release-win.yml`（手动触发，产出 `CIKE-Setup-版本号-x64.exe`、`CIKE-版本号-win-x64.zip` 与 `SHA256SUMS.txt`）。

## 能力范围

CIKE 提供独立会话、环境参数配置和 JavaScript 层面的指纹调整，未对 Chromium 内核进行定制。它不会修改 TLS/JA3 握手特征，也不保证通过所有指纹检测或实现完全匿名。

Canvas 噪声默认关闭，是否启用取决于实际用途；开启噪声并不意味着检测结果一定更好。界面中的操作系统选项调整的是浏览器暴露的相关参数，不会将宿主系统变成另一种操作系统。

## 问题反馈

请在 [Issues](https://github.com/chainfix/cike/issues) 中提供应用版本、macOS 版本、芯片型号、复现方式和报错截图。截图或日志中请遮盖 API Token、代理密码及个人信息。
