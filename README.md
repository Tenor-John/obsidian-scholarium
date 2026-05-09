# Scholarium — Obsidian Plugin

*Scholarium* (from Latin *scholaris*, "of scholars") is your all-in-one research workspace inside Obsidian.

Most researchers juggle a dozen disconnected tools — a spreadsheet for experiments, a reference manager for literature, a notes app for tasks, a cloud drive for files. **Scholarium brings it all into one place**, built on top of the vault you already use and the plain Markdown files you already own.

At its core is a structured **electronic lab notebook** that lets you capture, search, and review every experiment you run. Layer on an **AI writing assistant** that turns rough spoken notes into formatted records in seconds. Open the **research canvas** to drag your literature notes onto a spatial map and draw the connections that matter. Store protocols, images, and PDFs in the **material library**, synced to whatever cloud storage you use. And when you need to manage the rest of your research life — focus sessions, tasks, habits, submissions — the built-in **productivity workspace** has a module for each.

Scholarium adapts to where you are in your career. Choose a preset for undergraduate, master's, PhD, or faculty work, or rename every label to suit your own discipline and workflow. Nothing is locked to chemistry, biology, or any single field.

Your notes stay in plain Markdown. Your files stay in your vault. No subscription, no server, no lock-in.

> 📖 **中文简介** 见下方 / Chinese documentation below.

---

## Features

### 📋 Experiment Records
- Create and manage lab notes stored as standard Markdown files
- Rich frontmatter: date, status, reagents, results, SMILES structures, Excalidraw drawings
- Status labels: Completed ✅ · In Progress 🔄 · Planned 📋 · Failed ❌
- Quick delete with confirmation directly from the list view
- Bookmarking, full-text search, and date-group filtering
- Inline editing without leaving the dashboard

### 🤖 AI Assistant
- Describe your experiment in natural language — the AI fills in the full record
- Structured output with title, date, reagents, steps, results, and SMILES
- Supports Claude (Anthropic), OpenAI, Kimi, DeepSeek, MiniMax, and custom OpenAI-compatible endpoints
- Fully configurable system prompt; all API calls go directly from your device

### 🗺️ Research Canvas
- Drag-and-drop canvas for literature notes
- Auto-generates connection arrows from frontmatter relationships
- Manual connections: draw, label, and delete lines between any two cards
- Colour-coded zone system — create named regions to classify cards
- Pan and zoom with mouse or trackpad

### 🗂️ Material Library
- Centralised storage for PDFs, images, protocols, and data files
- Category sidebar, search, grid/list view toggle
- Cloud sync via WebDAV (Jianguoyun, Nextcloud, OneDrive) or S3-compatible storage (Aliyun OSS, Tencent COS, Qiniu)

### 📊 Productivity Workspace
A complete personal workspace that adapts to your role:

| Role | Preset |
|---|---|
| Undergraduate | 🎓 Undergraduate Workspace |
| Master's | 📖 Master's Workspace |
| PhD | 🔬 PhD Workspace |
| Advisor / Faculty | 🏛️ Advisor Workspace |

Included modules: Focus timer · Task manager · Daily schedule · Habit tracker · Mood journal · Food diary · Phone screen-time log · Submission tracker · Data dashboard

### 🎨 Theme Customisation
- Eight built-in colour presets (orange-red, academic blue, green, lavender, cyan, rose, plus 囍樂咖 / 囍樂青 from the public 囍樂 design system)
- Custom accent colour, gradient end colour, and background transparency via colour pickers
- Live preview in settings; changes apply instantly without restarting Obsidian
- **囍樂 Joyful Layer** — every panel (experiment list, AI dialog, canvas, library, productivity workspace) shares unified rounded cards, soft shadows, refined scrollbars, and a Weekly (WK) dashboard widget on the overview page

---

## Installation

### From the Community Plugin Store *(coming soon)*
1. Open Obsidian → **Settings → Community plugins → Browse**
2. Search for **Scholarium**
3. Click **Install**, then **Enable**

### Manual Installation
1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases/latest)
2. Copy the three files into `<your vault>/.obsidian/plugins/obsidian-scholarium/`
3. Reload Obsidian and enable the plugin in **Settings → Community plugins**

---

## Getting Started

1. Click the **🧪** icon in the left ribbon to open the dashboard
2. Press **＋ New Record** to create your first experiment note
3. Or click **🤖 AI Assistant** and describe your experiment in plain language

### AI Setup
Go to **Settings → Scholarium → AI Assistant** and choose a provider:

| Provider | Recommended Model |
|---|---|
| Claude (Anthropic) | `claude-sonnet-4-6` |
| OpenAI | `gpt-4o` |
| DeepSeek | `deepseek-chat` |
| Kimi (Moonshot) | `moonshot-v1-32k` |
| Custom | Any OpenAI-compatible endpoint |

Your API key is stored locally in Obsidian's data file and never sent to any third-party server.

### Cloud Sync Setup
Go to **Settings → Scholarium → Cloud Sync**, choose WebDAV or S3, and enter your credentials. Click **Test Connection** to verify before saving.

---

## Plugin Customisation

The plugin display name, notebook tab label, and workspace tab label are all configurable under **Settings → Scholarium → Personalisation**. The plugin works for any research discipline — not just chemistry or biology.

---

## Requirements

- Obsidian **0.15.0** or later
- Desktop or mobile (no desktop-only APIs used)
- An API key is required to use the AI assistant feature

---

## Privacy

- All experiment notes are standard `.md` files stored inside your vault
- AI requests are made directly from your device to the chosen provider — no proxy server
- Cloud sync credentials are stored locally in `data.json` inside your vault

---

## Contributing

Issues and pull requests are welcome. Please open an issue before submitting large changes.

---

## License

[MIT](LICENSE)

---
---

# 中文文档 · Scholarium

**Scholarium**（拉丁语"学者之所"）是一款运行于 [Obsidian](https://obsidian.md) 的全能科研工作台。

大多数研究者需要在十几个工具之间来回切换——表格记实验、文献管理器整理论文、任务软件管进度、网盘存文件。Scholarium 把这一切整合进你已经在用的 Obsidian vault，所有数据以标准 Markdown 存储，完全属于你自己。

核心是一本结构化的**电子实验记录本**，配以 **AI 写作助手**（口述即可生成规范记录）、可拖拽连线的**研究画布**、带云同步的**素材库**，以及涵盖专注计时、任务管理、习惯打卡、投稿跟踪的**个人工作台**。支持本科 / 硕士 / 博士 / 导师四种角色预设，不限专业，标签完全可自定义。

本地存储，无订阅，无服务器，数据永远在你手里。

## 核心功能

### 📋 实验记录
- 笔记以标准 Markdown 文件存储，支持日期、状态、试剂、结果、SMILES 结构式等 frontmatter 字段
- 状态快速切换：已完成 / 进行中 / 计划中 / 未成功
- 列表悬停即可删除，带二次确认弹窗防止误操作
- 支持收藏、全文搜索、按日期分组展示、内联编辑

### 🤖 AI 实验助手
- 口述实验内容，AI 自动整理为规范记录格式（标题、日期、试剂、步骤、结果、SMILES）
- 支持 Claude、OpenAI、Kimi、DeepSeek、MiniMax 及自定义 OpenAI 兼容接口
- 系统提示词完全可自定义；API 请求从本地直接发出，不经过任何中间服务器

### 🗺️ 研究画布
- 可拖拽的文献卡片画布，自动生成 frontmatter 关联箭头
- 支持手动连线、连线标注、悬停删除连线
- 自定义分区（命名区域 + 七色配色），卡片拖入自动归类
- 支持鼠标缩放与平移

### 🗂️ 素材库
- 集中管理实验图片、PDF、协议文件等素材
- 支持 WebDAV（坚果云、Nextcloud、OneDrive）和 S3 兼容云存储（阿里云 OSS、腾讯 COS、七牛云）同步

### 📊 工作台
涵盖专注计时、任务管理、起居考勤、习惯打卡、情绪日志、投稿管理、数据看板等模块，支持本科 / 硕士 / 博士 / 导师四种角色预设，所有显示标签均可自定义。

### 🎨 主题配色
六套预设配色（橙红、学术蓝、翠绿、薰衣草、青色、玫瑰粉），支持主色调、渐变色及背景透明度自定义，修改后即时生效。

## 安装方式

### 社区插件市场（即将上线）
设置 → 社区插件 → 浏览，搜索 **Scholarium**，安装并启用。

### 手动安装
1. 从 [Releases 页面](../../releases/latest) 下载 `main.js`、`styles.css`、`manifest.json`
2. 复制到 `<库路径>/.obsidian/plugins/obsidian-scholarium/`
3. 在 Obsidian 中重载并启用插件

## 隐私说明
- 所有笔记存储在本地 vault 中，格式为标准 `.md` 文件
- AI 请求从本地设备直接发至所选服务商，不经过任何中间服务器
- 云同步凭据仅保存在本地 `data.json` 中
