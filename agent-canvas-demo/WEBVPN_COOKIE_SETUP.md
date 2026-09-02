# WebVPN / CARSI 论文下载稳定方案

这份文件是 `paper-downloader` 的长期规则。以后不管换哪个 AI、换哪个会话，都按这里执行。

## 结论

不要逆向任何学校 WebVPN 的主机加密算法。

不要把 `wrdvpnisthebest!`、加密 host、某个样本 URL 当作稳定接口。

稳定方案是：

```text
用户本人登录 WebVPN/CARSI
→ Scholarium 使用持久浏览器资料夹复用这个登录态
→ 用真实浏览器打开 DOI / 出版商页面 / PDF 链接
→ 成功则保存 PDF
→ 失败则返回明确状态和截图
```

这比导出 cookie 文本更稳定，因为它保留了真实浏览器环境、跳转链、WebVPN/CARSI 会话和出版社脚本行为。

## 一次性安装

在插件目录执行：

```powershell
cd <插件目录>\agent-canvas-demo
npm install
```

如果浏览器启动失败，再执行：

```powershell
npx playwright install chrome
```

默认使用本机 Chrome。Chrome 已安装时，一般不需要下载额外浏览器。

## 自动登录（首选路径）

若你的机构提供兼容的本地自动登录脚本，Scholarium 可通过 `paper-downloader` 调它。默认公开包不附带机构专用登录实现；推荐优先使用下面的手动浏览器登录。

```json
{ "mode": "auto_login", "timeoutSec": 300 }
```

调用点有三处，优先级从高到低：

1. 「登录/刷新 WebVPN」按钮先试自动登录，失败才回落到手动浏览器登录。
2. Pipeline 第 5 步：机构通道报 `needs_login` 时自动触发一次，成功后重跑该步。整轮不需要人。
3. 手动直接调用。

成功与否不看脚本自己的输出，而是脚本退出后再跑一次 `_validate_session(load_config())`——机构通道每批之前用的就是这个检查。

账号密码不经过 Scholarium。任何机构专用脚本都应在仓库外自行读取凭据；公开包不定义用户名、密码或机构域名。

代价要说清楚：`webvpn_credentials.json` 是明文存密码的。它在仓库之外，不会被提交，但以你的账号运行的任何程序都能读到。这也是本项目其余部分仍然一个密码都不存的原因。

## 第一次登录或登录过期时（手动兜底）

通过 `paper-downloader` 运行：

```json
{
  "mode": "login",
  "url": "https://<your-institution-webvpn>/",
  "waitMs": 180000
}
```

然后在弹出的浏览器里手动登录 WebVPN/CARSI。不要把账号密码写进任何配置文件或聊天窗口。

**登录完成后不需要关掉浏览器窗口**，会话验证通过后窗口会自己关闭。

判定必须同时满足三条，每 2 秒轮询：机构 ticket cookie 存在 + 当前页仍在机构 WebVPN 门户而不是 CAS/SSO 登录页 + 重新打开门户仍然停在该门户（主动探测）。

两条便宜的信号单独用都会骗人，方向还相反：

1. **URL 子串不能用。** 中科大 CAS 认证成功后的落地页是 `https://wvpn.ustc.edu.cn/login?cas_login=true`，本身就带 `login`，「URL 不含 login/cas/sso」永远不会触发。scansci-pdf 自带的 `browser_login.open_login_browser` 踩的就是这个坑——登录明明成功了，它一直空转到 `max_wait=600` 秒，用户关掉窗口后反而报「Browser closed by user」，一个 cookie 都不保存。
2. **只看 ticket cookie 也不能用。** 这张 cookie 的寿命比签发它的 CAS 会话长得多，会话早就死了 cookie 还在。只认 cookie 的话，登录窗口会一闪而过、报告成功、然后把一份死会话导出去——比不导出更糟，因为机构通道会以为自己有 cookie，于是逐篇失败而不是干脆报 `needs_login`。

登录状态保存在：

```text
<workspace>\Scholarium\runtime\webvpn-browser-profile
```

同时会导出一份给 `scansci-institutional` 用（`scansci_pdf.sources.instsci` 读这三个文件）：

```text
~\.scansci-pdf\cache\instsci-cookies.json
~\.scansci-pdf\cache\instsci-cookies.txt
~\.scansci-pdf\cache\browser_state.json
```

路径遵循 `SCANSCI_PDF_DATA_DIR` 以及 `~\.scansci-pdf\config.json` 里的 `cache_dir` / `vpnsci_cookie_file` / `instsci_cookie_file`。没有拿到 ticket cookie 时不会写入，避免用一份已登出的状态覆盖掉还有效的会话。

这两个目录都已被 `.gitignore` 排除，不能提交到 Git。

## 正常下载

输入 DOI、出版商页面或 PDF 链接：

```json
{
  "urls": [
    "https://doi.org/10.xxxx/example",
    "https://www.nature.com/articles/example"
  ],
  "headless": false
}
```

输出位置：

```text
<workspace>\literature\downloaded-pdfs
<workspace>\Scholarium\runtime\download-logs
<workspace>\Scholarium\runtime\download-screenshots
```

## 状态解释

| 状态 | 含义 | 处理 |
| --- | --- | --- |
| `downloaded` | PDF 已保存，并通过 `%PDF` 文件头检查 | 可进入 `nature-reader` / `pdf` 证据卡片步骤 |
| `needs_login` | 登录态过期，页面进入 WebVPN/CAS/登录页 | 重新运行 `mode=login` |
| `manual_required` | 页面能打开，但自动找不到 PDF | 查看截图；手动复制真实 PDF 链接后重跑 |
| `missing_playwright` | 依赖未安装 | 在 `agent-canvas-demo` 运行 `npm install` |
| `browser_launch_failed` | Chrome/Playwright 启动失败 | 安装 Chrome 或运行 `npx playwright install chrome` |
| `blocked_policy` | 命中 Sci-Hub/LibGen 等非法镜像 | 换合法 DOI/出版商/机构访问链接 |
| `timeout` | 出版商页面长时间无响应 | 稍后重试或手动确认页面 |
| `failed` | 其他异常 | 查看 JSON 日志和截图 |

## 旧 cookie 文本方案

旧方案仍保留，但只作为后备：

```json
{
  "mode": "direct_cookie_jar",
  "urls": ["https://publisher.example/file.pdf"]
}
```

它读取：

```text
<workspace>\Scholarium\secrets\webvpn-cookies.txt
```

这个方案只适合已知直链 PDF，不再作为 WebVPN/CARSI 的主路径。

## 写死规则

1. 任何下载 Agent 都必须优先调用 `paper-downloader` 的浏览器持久会话模式。
2. 不允许把 WebVPN host 加密逆向作为主实现。
3. 不允许使用盗版镜像作为 fallback。
4. 没有读到 PDF 原文时，后续 `deep-research` 和 `nature-writing` 只能写“文献线索”，不能写强证据结论。
5. 出现 `needs_login` 时，只能要求用户手动重新登录；不能自动保存或尝试账号密码。
6. 出现 `manual_required` 时，必须保留截图和页面 URL，便于人工复核。
