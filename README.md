# Scholarium — Obsidian Plugin

**Scholarium** is a fully-featured electronic lab notebook (ELN) for [Obsidian](https://obsidian.md). Designed for researchers at every stage — undergraduate, master's, PhD, and faculty — it brings together experiment records, AI-assisted writing, a research canvas, a material library, and a personal productivity workspace, all in one plugin.

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
- Six built-in colour presets (orange-red, academic blue, green, lavender, cyan, rose)
- Custom accent colour, gradient end colour, and background transparency via colour pickers
- Live preview in settings; changes apply instantly without restarting Obsidian

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

# 中文文档 · Scholarium 电子实验记录本

**Scholarium** 是一款适用于 [Obsidian](https://obsidian.md) 的全功能电子实验记录本（ELN）插件，面向本科生、硕士、博士研究生与导师群体。集实验记录管理、AI 辅助撰写、研究画布、素材库与个人工作台于一体。

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
