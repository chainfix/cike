<p align="center">
  <img src="electron/assets/icon.png" width="112" alt="CIKE 图标">
</p>

<h1 align="center">CIKE</h1>

<p align="center">本地多环境浏览器 · 独立会话 · 代理管理 · 自动化 API</p>

<p align="center">
  <a href="https://github.com/chainfix/cike/releases/latest">下载 macOS / Windows 版</a> ·
  <a href="#软件预览">软件预览</a> ·
  <a href="#安装与首次打开">安装说明</a> ·
  <a href="https://github.com/chainfix/cike/issues">反馈问题</a>
</p>

CIKE 是基于 Electron、Chromium 和 Playwright 的本地多环境浏览器。你可以为不同任务创建独立浏览器环境，分别保存登录状态、配置代理和浏览器参数，也可以通过本地 API 接入自动化脚本。

环境配置和浏览器会话保存在本机，无需注册账号或连接厂商管理后台。浏览器访问网站、代理检测和内核下载仍需要相应的网络连接。

## 功能特点

- **独立浏览器环境**：每个环境使用独立数据目录，持久保存 Cookie、本地存储和缓存，支持多个环境同时运行。
- **环境管理**：创建、编辑、分组、搜索、打开和删除环境，在列表中查看运行状态。
- **代理管理**：批量导入代理、检测连接及出口信息，并为不同环境绑定代理。
- **浏览器参数配置**：设置操作系统标识、分辨率、语言、时区、CPU 核数、内存和随机种子，支持可选的 Canvas 噪声与 WebRTC 策略。
- **内核管理**：在设置页下载 Chromium，后续启动复用已安装内核。
- **本地自动化 API**：通过 Token 鉴权管理环境、代理及浏览器进程，运行中的浏览器可通过 CDP 接入。

## 软件预览

以下为桌面版实际界面，截图中的版本号及部分文字可能与最新版本不同。

### 新建环境

集中配置环境名称、分组、操作系统、分辨率、代理和指纹选项，支持创建后直接打开。

![CIKE 新建环境：基本信息、代理及浏览器指纹选项](docs/images/create-profile.png)

### 浏览器管理

按分组管理环境，搜索名称或分组，并对单个环境执行打开、编辑和删除操作。

![CIKE 浏览器管理：环境列表、分组和运行状态](docs/images/profiles.png)

### 代理管理

批量添加代理，集中检测和删除，再按需关联到浏览器环境。

![CIKE 代理管理：批量导入及检测入口](docs/images/proxies.png)

### 系统设置

查看本地 API 地址及 Token、打开数据目录，并管理 Chromium 内核。

![CIKE 系统设置：本地 API、浏览器内核及版本信息](docs/images/settings.png)

## 下载

前往 **[最新版本发布页](https://github.com/chainfix/cike/releases/latest)** 下载对应系统的安装包。

| 项目 | macOS | Windows |
| --- | --- | --- |
| 系统 | macOS 13 及以上 | Windows 10 / 11 |
| 架构 | Apple Silicon，苹果 M 系列 | x64 |
| 安装包 | `CIKE-版本号-mac-arm64.dmg` | `CIKE-版本号-win-x64-setup.exe` |
| 免安装版 | — | `CIKE-版本号-win-x64-portable.zip` |
| 签名 | 免费临时签名（ad-hoc），未经过苹果公证 | 未进行代码签名 |

Intel Mac 当前未提供对应安装包。

安装包由 GitHub Actions 自动构建：每次推送到 `main` 或提交 Pull Request 都会编译 macOS 和 Windows 版本，可在对应运行记录的 Artifacts 中下载测试；手动运行 **Build and Release** 工作流并填写版本号后会发布正式版本。发布流程会检查应用图标、应用签名、DMG 完整性和 Windows 程序版本信息，并提供 `SHA256SUMS.txt` 供核对下载文件。

## 安装与首次打开

### macOS

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

### Windows

- **安装版**：运行 `CIKE-版本号-win-x64-setup.exe`，默认安装到当前用户目录，无需管理员权限，可在开始菜单中启动 CIKE。卸载可在「设置 → 应用」中完成。
- **免安装版**：解压 `CIKE-版本号-win-x64-portable.zip`，运行其中的 `CIKE.exe`。

安装包未进行代码签名，首次运行时如出现「Windows 已保护你的电脑」（SmartScreen）提示，确认文件来自本仓库发布页后，点击 **更多信息 → 仍要运行**。

## 快速开始

1. **准备内核**：进入「设置」，下载 Chromium；已安装时可以跳过。
2. **添加代理（可选）**：进入「代理管理」，点击「添加代理」，每行输入一个代理，再检测连接情况。
3. **创建环境**：进入「新建环境」，填写名称，选择分组、操作系统和分辨率，按需关联代理及调整其他选项。
4. **打开浏览器**：点击「创建并打开」，或在「浏览器管理」中打开已保存的环境。
5. **继续使用**：下次打开同一环境时，沿用该环境已经保存的浏览器数据。

代理导入支持以下形式，每行一个；行尾可添加备注：

```text
host:port
host:port:用户名:密码
socks5://用户名:密码@host:port
```

## 数据保存

默认数据目录为 `~/.local-fingerprint-browser/`（Windows 为 `%USERPROFILE%\.local-fingerprint-browser\`），可从设置页打开。通过环境变量 `LFB_DATA` 可以指定其他目录。

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

## 能力范围

CIKE 提供独立会话、环境参数配置和 JavaScript 层面的指纹调整，未对 Chromium 内核进行定制。它不会修改 TLS/JA3 握手特征，也不保证通过所有指纹检测或实现完全匿名。

Canvas 噪声默认关闭，是否启用取决于实际用途；开启噪声并不意味着检测结果一定更好。界面中的操作系统选项调整的是浏览器暴露的相关参数，不会将宿主系统变成另一种操作系统。

## 问题反馈

请在 [Issues](https://github.com/chainfix/cike/issues) 中提供应用版本、macOS 版本、芯片型号、复现方式和报错截图。截图或日志中请遮盖 API Token、代理密码及个人信息。
