# Scholarium

Scholarium is an Obsidian plugin for building a local-first research workspace. It combines an electronic lab notebook, AI-assisted experiment writing, a productivity dashboard, a material library, and an academic tool library inside the vault you already use.

Your notes stay as Markdown. Your files stay in your Obsidian vault. External AI and cloud services are optional and configured by you.

## What Scholarium Can Do

### Experiment Records

- Create structured experiment notes as Markdown files.
- Track experiment status: planned, in progress, completed, or failed.
- Store metadata such as date, reagents, results, SMILES, and linked drawing files.
- Search experiments by title, reagent, result, or note content.
- Browse experiments in a dashboard with list and detail views.
- Open and edit records directly from the Scholarium panel.

### AI Experiment Assistant

- Turn natural-language experiment descriptions into structured records.
- Generate fields such as title, date, status, reagents, steps, results, notes, and SMILES.
- Customize the system prompt used for experiment writing.
- Use Claude, OpenAI, Kimi, DeepSeek, MiniMax, or a custom OpenAI-compatible endpoint.
- Send requests directly from your device to the selected provider.

### Image-to-Experiment Workflow

- Use OCR-assisted image import for handwritten or screenshot-based experiment notes.
- Extract text from images with MinerU.
- Rewrite OCR output into a cleaner experiment record with the configured writing model.
- Keep the workflow inside Obsidian without copying text between apps.

### Productivity Workspace

Scholarium includes a role-aware research workspace for daily planning and self-management.

- Role presets for undergraduate, master, PhD, advisor, or custom workflows.
- Daily overview for tasks, focus time, mood, meals, phone usage, and submissions.
- Focus sessions and task tracking.
- Habit logs, check-ins, and personal notes.
- Submission and project tracking for longer research cycles.

### Material Library

- Store frequently used research files inside the vault.
- Manage PDFs, images, spreadsheets, protocols, archives, and other files.
- Organize files by custom categories.
- Search by file name or category.
- Preview images and open vault files from the library.
- Optional cloud sync through WebDAV or S3-compatible storage.

### Academic Tool Library

The academic tool library is a shortcut hub for research websites, software, and databases.

- Add custom tool cards manually.
- Set a tool name, URL, icon, category, and description.
- Browse tools by grouped categories.
- Use a left-side category navigation panel to jump between sections.
- Open external links directly from Obsidian.
- Customize category colors in the plugin settings.
- Includes a curated starter set of tools for literature search, reference management, AI assistants, formulas, slides, data analysis, plotting, databases, and computational chemistry.

### Theme and Personalization

- Rename the plugin display name, notebook label, and workspace label.
- Choose role-based presets or set custom labels.
- Adjust interface font size.
- Pick accent colors, gradient colors, and background transparency.
- Customize academic tool category colors.

## Installation

### Manual Installation

1. Download `manifest.json`, `main.js`, and `styles.css` from the latest release.
2. Create this folder in your vault:

```text
<your-vault>/.obsidian/plugins/scholarium/
```

3. Copy the three files into that folder.
4. Reload Obsidian.
5. Enable **Scholarium** in **Settings -> Community plugins**.

### From Source

```bash
npm install
npm run build
```

The production build writes `main.js` to the plugin root.

## Basic Setup

1. Open the Scholarium dashboard from the ribbon icon or command palette.
2. Set your experiment note folder in **Settings -> Scholarium -> Basic settings**.
3. Optional: configure an AI provider in **Settings -> Scholarium -> AI experiment assistant**.
4. Optional: configure MinerU and a writing model for image-to-experiment workflows.
5. Optional: configure WebDAV or S3 if you want material library sync.

## Privacy

- Experiment notes are stored as local Markdown files in your vault.
- Material library files are stored in your vault.
- AI API keys and sync credentials are stored in the plugin data file inside your vault.
- AI requests are sent directly from your device to the provider you configure.
- Scholarium does not include hidden telemetry.

## Requirements

- Obsidian 0.15.0 or later.
- Node.js is only required if building from source.
- AI features require your own provider API key.
- Cloud sync requires your own WebDAV or S3-compatible account.

## Release Assets

Each release should include:

- `manifest.json`
- `main.js`
- `styles.css`

## License

MIT. See [LICENSE](LICENSE).

---

# Scholarium 中文说明

Scholarium 是一款面向科研工作流的 Obsidian 插件。它把实验记录、AI 实验助手、个人工作台、素材库和科研工具库整合到一个本地优先的研究空间中。

你的笔记仍然是 Markdown，你的文件仍然保存在 Obsidian 库中。AI 和云同步都是可选功能，由你自己配置。

## 主要功能

### 实验记录

- 新建结构化实验笔记，并以 Markdown 文件保存。
- 记录实验日期、状态、试剂、结果、SMILES 和关联绘图文件。
- 支持计划中、进行中、已完成、未成功等状态。
- 支持标题、试剂、结果和内容搜索。
- 在仪表盘中查看实验列表和详情。

### AI 实验助手

- 用自然语言描述实验，AI 自动整理成规范实验记录。
- 可生成标题、日期、状态、试剂、步骤、结果、备注和 SMILES。
- 支持自定义系统提示词。
- 支持 Claude、OpenAI、Kimi、DeepSeek、MiniMax 和自定义 OpenAI 兼容接口。
- 请求直接从本地设备发往你选择的服务商。

### 图片识别生成实验记录

- 支持从图片、截图或手写记录中提取实验文本。
- 使用 MinerU 进行 OCR。
- 使用配置的 AI 重写模型整理为实验记录。

### 科研工作台

- 支持本科、硕士、博士、导师和自定义角色预设。
- 包含任务、专注、习惯、情绪、饮食、手机使用、投稿等模块。
- 适合做每日科研计划和长期项目追踪。

### 素材库

- 管理 PDF、图片、表格、协议文件和压缩包等科研素材。
- 支持分类、搜索、图片预览和文件打开。
- 可选 WebDAV 或 S3 兼容云同步。

### 科研库

- 保存常用科研网站、软件、数据库和辅助工具。
- 每个工具可以设置名称、网址、图标、分类和介绍。
- 按分类分组展示，并通过左侧分类导航快速跳转。
- 点击卡片即可打开外部链接。
- 支持在设置中自定义每个分类的颜色。
- 内置一批常用科研工具，覆盖文献获取、文献管理、论文写作、翻译润色、AI 助手、公式工具、PPT 展示、数据分析、绘图制图、数据库和计算化学。

### 外观与个性化

- 可修改插件显示名称、笔记标签和工作台标签。
- 可调整界面字号。
- 可设置主题主色、渐变色和背景透明度。
- 可为科研库分类单独设置颜色。

## 安装方式

1. 从最新 release 下载 `manifest.json`、`main.js`、`styles.css`。
2. 放入：

```text
<你的库>/.obsidian/plugins/scholarium/
```

3. 重载 Obsidian。
4. 在 **设置 -> 社区插件** 中启用 Scholarium。

## 隐私说明

- 实验笔记以 Markdown 保存在本地 vault。
- 素材文件保存在本地 vault。
- API Key 和同步凭据保存在插件本地数据中。
- AI 请求直接从你的设备发往你配置的服务商。
- 插件不包含隐藏遥测。

## 许可证

MIT。详见 [LICENSE](LICENSE)。
