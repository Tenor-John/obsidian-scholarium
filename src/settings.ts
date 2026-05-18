import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import ChemELNPlugin from './main';
import type { CloudProviderType } from './cloud-sync';
import { CloudSyncManager, buildSyncConfig } from './cloud-sync';
import type { WritingProvider } from './vision-writer';

export type AIProvider = 'claude' | 'openai' | 'kimi' | 'deepseek' | 'minimax' | 'custom';

// 工作台角色预设
export type WorkspaceRole = 'undergraduate' | 'master' | 'phd' | 'advisor' | 'custom';
export type PluginFontSize = 'small' | 'medium' | 'large' | 'xlarge';
export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
    undergraduate: '本科工作台',
    master:        '硕士工作台',
    phd:           '博士工作台',
    advisor:       '导师工作台',
    custom:        '自定义',
};
export const WORKSPACE_ROLE_ICONS: Record<WorkspaceRole, string> = {
    undergraduate: '🎓',
    master:        '📖',
    phd:           '🔬',
    advisor:       '🏛️',
    custom:        '⚙️',
};

export const DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS: Record<string, string> = {
    '文献获取': '#2563EB',
    '文献管理': '#0891B2',
    '论文写作': '#7C3AED',
    '翻译润色': '#DB2777',
    'AI 助手': '#9333EA',
    '公式工具': '#EA580C',
    'PPT 与展示': '#D97706',
    '数据分析': '#16A34A',
    '绘图制图': '#0D9488',
    '开发工具': '#475569',
    '数据库': '#0284C7',
    '计算化学': '#65A30D',
    '代码工具': '#475569',
    '学校服务': '#0F766E',
    '未分类': '#64748B',
};

export interface ChemELNSettings {
    experimentsFolder: string;
    openOnStartup: boolean;
    cityName: string;
    latitude: number | null;
    longitude: number | null;
    aiProvider: AIProvider;
    aiApiKey: string;
    aiModel: string;
    aiCustomEndpoint: string; // 自定义 API 地址（用于"其他"服务商）
    aiSystemPrompt: string;   // 可自定义的系统提示词，{{date}} 会被替换为今日日期
    aiTemperature: number;    // AI 温度参数（0~1）
    // 云盘同步设置
    mineruApiKey: string;
    writingProvider: WritingProvider;
    writingApiKey: string;
    writingModel: string;
    writingCustomEndpoint: string;
    cloudProvider: CloudProviderType;
    cloudWebdavUrl: string;
    cloudWebdavUser: string;
    cloudWebdavPass: string;
    cloudWebdavPath: string;
    cloudS3Endpoint: string;
    cloudS3Bucket: string;
    cloudS3Region: string;
    cloudS3AccessKey: string;
    cloudS3SecretKey: string;
    cloudS3Prefix: string;
    cloudAutoSync: boolean;
    cloudSyncInterval: number;
    researchToolCategoryColors: Record<string, string>; // 科研库分类颜色
    // 主题颜色
    themeAccent:   string;   // 主色 hex，如 '#FF7043'
    themeGradient: string;   // 渐变结束色 hex，如 '#E64A19'
    themeAlpha:    number;   // 背景透明度 0.05–0.25
    // 插件个性化
    workspaceRole:      WorkspaceRole;  // 角色预设
    pluginDisplayName:  string;         // 顶部 Logo 显示名称
    notebookLabel:      string;         // 实验记录/笔记栏标签（自定义时使用）
    workspaceTabLabel:  string;         // 工作台 Tab 自定义标签（仅 custom 模式）
    fontSize:           PluginFontSize; // 插件界面字号
}

// 默认系统提示词（{{date}} 在运行时被替换为今日日期）
export const DEFAULT_AI_SYSTEM_PROMPT =
`你是化学实验室的记录助手。把研究者口述的实验内容整理成简洁、规范的实验记录。

今天日期：{{date}}

【输出规范】
- 先用 1~2 句话确认你理解的实验内容，使用简洁的学术口吻，不要有"我帮您整理了""以下是整理结果"等套话
- 若发现化学错误或安全隐患，直接一句话点出
- 步骤用阿拉伯数字编号，每步一行，去除废话
- 结果只写关键数据（产率、外观、熔点/沸点、纯度等），不加修饰
- SMILES 只在确定时填写，否则留空字符串 ""
- 每次回复末尾必须附上 json_experiment 数据块，格式如下：

\`\`\`json_experiment
{
  "title": "简洁实验名称（不超过20字）",
  "date": "{{date}}",
  "status": "completed",
  "smiles": "",
  "reagents": ["试剂1", "试剂2"],
  "results": "产率 xx%，外观描述，关键物性数据",
  "steps": "1. 步骤一\\n2. 步骤二\\n3. 步骤三",
  "notes": "注意事项或关键操作细节（如无则留空）"
}
\`\`\``;

export const DEFAULT_SETTINGS: ChemELNSettings = {
    experimentsFolder: 'Experiments',
    openOnStartup: false,
    cityName: '',
    latitude: null,
    longitude: null,
    aiProvider: 'claude',
    aiApiKey: '',
    aiModel: 'claude-sonnet-4-6',
    aiCustomEndpoint: '',
    aiSystemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
    aiTemperature: 0.7,
    mineruApiKey: '',
    writingProvider: 'deepseek',
    writingApiKey: '',
    writingModel: '',
    writingCustomEndpoint: '',
    cloudProvider: 'none',
    cloudWebdavUrl: '',
    cloudWebdavUser: '',
    cloudWebdavPass: '',
    cloudWebdavPath: 'ChemELN/',
    cloudS3Endpoint: '',
    cloudS3Bucket: '',
    cloudS3Region: 'us-east-1',
    cloudS3AccessKey: '',
    cloudS3SecretKey: '',
    cloudS3Prefix: 'ChemELN/',
    cloudAutoSync: false,
    cloudSyncInterval: 0,
    researchToolCategoryColors: DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS,
    themeAccent:   '#FF7043',
    themeGradient: '#E64A19',
    themeAlpha:    0.10,
    workspaceRole:      'phd',
    pluginDisplayName:  '🧪 实验记录本',
    notebookLabel:      '实验记录',
    workspaceTabLabel:  '工作台',
    fontSize:           'medium',
};

// 各服务商配置（端点、默认模型、Key 格式提示、文档链接）
export const PROVIDER_CONFIG: Record<AIProvider, {
    label: string;
    baseUrl: string;         // API 基础地址（不含路径），供 ai-assistant-modal 使用
    endpoint: string;
    defaultModel: string;
    keyPlaceholder: string;
    keyDesc: string;
    docsUrl: string;
    docsLabel: string;
    isOpenAICompat: boolean; // 是否兼容 OpenAI 格式
}> = {
    claude: {
        label: 'Claude（Anthropic）',
        baseUrl: 'https://api.anthropic.com/v1',
        endpoint: 'https://api.anthropic.com/v1/messages',
        defaultModel: 'claude-sonnet-4-6',
        keyPlaceholder: 'sk-ant-...',
        keyDesc: 'Anthropic API Key',
        docsUrl: 'https://console.anthropic.com/',
        docsLabel: '→ 获取 Anthropic API Key',
        isOpenAICompat: false,
    },
    openai: {
        label: 'OpenAI / ChatGPT',
        baseUrl: 'https://api.openai.com/v1',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-4o',
        keyPlaceholder: 'sk-...',
        keyDesc: 'OpenAI API Key',
        docsUrl: 'https://platform.openai.com/api-keys',
        docsLabel: '→ 获取 OpenAI API Key',
        isOpenAICompat: true,
    },
    kimi: {
        label: 'Kimi（月之暗面）',
        baseUrl: 'https://api.moonshot.cn/v1',
        endpoint: 'https://api.moonshot.cn/v1/chat/completions',
        defaultModel: 'moonshot-v1-32k',
        keyPlaceholder: 'sk-...',
        keyDesc: 'Moonshot API Key',
        docsUrl: 'https://platform.moonshot.cn/',
        docsLabel: '→ 获取 Kimi API Key',
        isOpenAICompat: true,
    },
    deepseek: {
        label: 'DeepSeek（深度求索）',
        baseUrl: 'https://api.deepseek.com',
        endpoint: 'https://api.deepseek.com/chat/completions',
        defaultModel: 'deepseek-chat',
        keyPlaceholder: 'sk-...',
        keyDesc: 'DeepSeek API Key',
        docsUrl: 'https://platform.deepseek.com/',
        docsLabel: '→ 获取 DeepSeek API Key',
        isOpenAICompat: true,
    },
    minimax: {
        label: 'MiniMax（海螺 AI）',
        baseUrl: 'https://api.minimax.chat/v1',
        endpoint: 'https://api.minimax.chat/v1/chat/completions',
        defaultModel: 'abab6.5s-chat',
        keyPlaceholder: '填写 API Key',
        keyDesc: 'MiniMax API Key',
        docsUrl: 'https://platform.minimaxi.com/',
        docsLabel: '→ 获取 MiniMax API Key',
        isOpenAICompat: true,
    },
    custom: {
        label: '其他（自定义）',
        baseUrl: '',
        endpoint: '',
        defaultModel: '',
        keyPlaceholder: '填写 API Key',
        keyDesc: 'API Key',
        docsUrl: '',
        docsLabel: '',
        isOpenAICompat: true,
    },
};

/** 返回服务商显示名称 */
export function providerLabel(provider: AIProvider): string {
    return PROVIDER_CONFIG[provider]?.label ?? provider;
}

export class ChemELNSettingTab extends PluginSettingTab {
    plugin: ChemELNPlugin;

    constructor(app: App, plugin: ChemELNPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('scholarium-settings');

        const s = this.plugin.settings;
        const roleIcon  = WORKSPACE_ROLE_ICONS[s.workspaceRole] ?? '⚙️';
        const roleName  = s.workspaceRole !== 'custom'
            ? WORKSPACE_ROLE_LABELS[s.workspaceRole]
            : (s.workspaceTabLabel || '工作台');
        containerEl.createEl('h2', { text: `${roleIcon} ${s.pluginDisplayName || '实验记录本'} — 设置` });

        // ===== 插件个性化 =====
        containerEl.createEl('h3', { text: '🎛️ 插件个性化' });
        containerEl.createEl('p', {
            text: '将本插件定制为适合你专业与角色的工作台，也可以完全自定义标签名称。',
            attr: { style: 'font-size:0.85em; color:var(--text-muted); margin-bottom:12px;' },
        });

        // ── 角色预设快速选择 ──
        const rolePresetWrap = containerEl.createDiv({ attr: { style: 'display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;' } });

        const applyRole = async (role: WorkspaceRole) => {
            s.workspaceRole = role;
            if (role !== 'custom') {
                const icon  = WORKSPACE_ROLE_ICONS[role];
                const label = WORKSPACE_ROLE_LABELS[role];
                s.pluginDisplayName = `${icon} ${label.replace('工作台', '记录本')}`;
                s.notebookLabel     = role === 'advisor' ? '指导记录' : '实验记录';
                s.workspaceTabLabel = label;
            }
            await this.plugin.saveSettings();
            this.display();
        };

        const roleDefs: Array<{ role: WorkspaceRole; desc: string }> = [
            { role: 'undergraduate', desc: '本科工作台' },
            { role: 'master',        desc: '硕士工作台' },
            { role: 'phd',           desc: '博士工作台' },
            { role: 'advisor',       desc: '导师工作台' },
        ];

        for (const { role, desc } of roleDefs) {
            const icon    = WORKSPACE_ROLE_ICONS[role];
            const isActive = s.workspaceRole === role;
            const btn = rolePresetWrap.createEl('button', {
                text: `${icon} ${desc}`,
                attr: {
                    style: `padding:6px 16px; border-radius:20px; font-size:0.85em; font-weight:600; cursor:pointer; transition:all 0.15s;
                            border:2px solid var(--celn-accent);
                            background:${isActive ? 'var(--celn-accent)' : 'transparent'};
                            color:${isActive ? '#fff' : 'var(--text-normal)'};`
                },
            });
            btn.addEventListener('click', () => void applyRole(role));
        }

        // ── 插件显示名称 ──
        new Setting(containerEl)
            .setName('插件显示名称')
            .setDesc('显示在顶部 Logo 区域的名称，可以是任意专业的记录本')
            .addText(t => t
                .setPlaceholder('🧪 实验记录本')
                .setValue(s.pluginDisplayName)
                .onChange(async v => {
                    s.pluginDisplayName  = v;
                    s.workspaceRole      = 'custom';
                    await this.plugin.saveSettings();
                }));

        // ── 笔记/实验栏标签 ──
        new Setting(containerEl)
            .setName('笔记栏标签')
            .setDesc('左侧主栏的标签文字，如"实验记录""研究笔记""指导记录"等')
            .addText(t => t
                .setPlaceholder('实验记录')
                .setValue(s.notebookLabel)
                .onChange(async v => {
                    s.notebookLabel = v;
                    s.workspaceRole = 'custom';
                    await this.plugin.saveSettings();
                }));

        // ── 工作台 Tab 标签 ──
        new Setting(containerEl)
            .setName('工作台标签')
            .setDesc('顶部切换栏中"工作台"的显示文字，如"PhD 工作台""本科工作台"等')
            .addText(t => t
                .setPlaceholder('工作台')
                .setValue(s.workspaceRole !== 'custom' ? WORKSPACE_ROLE_LABELS[s.workspaceRole] : (s.workspaceTabLabel || '工作台'))
                .onChange(async v => {
                    s.workspaceTabLabel = v;
                    s.workspaceRole     = 'custom';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('界面字号')
            .setDesc('调整本插件面板、工作台、素材库和科研库的整体字号。布局会随字号自动放宽。')
            .addDropdown(d => d
                .addOption('small', '小')
                .addOption('medium', '中')
                .addOption('large', '大')
                .addOption('xlarge', '特大')
                .setValue(s.fontSize)
                .onChange(async v => {
                    s.fontSize = v as PluginFontSize;
                    await this.plugin.saveSettings();
                }));

        // ── 当前预览 ──
        const previewBox = containerEl.createDiv({
            attr: {
                style: `margin: 8px 0 20px; padding: 12px 16px; border-radius: 10px;
                        background: rgba(var(--celn-accent-rgb), 0.08);
                        border: 1px solid rgba(var(--celn-accent-rgb), 0.25);
                        font-size: 0.85em; color: var(--text-muted); line-height: 1.8;`
            }
        });
        previewBox.createEl('div', { text: `📌 当前配置预览` , attr: { style: 'font-weight:600; color:var(--text-normal); margin-bottom:4px;' } });
        previewBox.createEl('div', { text: `顶部名称：${s.pluginDisplayName || '实验记录本'}` });
        previewBox.createEl('div', { text: `笔记栏标签：${s.notebookLabel || '实验记录'}` });
        previewBox.createEl('div', { text: `工作台 Tab：${s.workspaceRole !== 'custom' ? WORKSPACE_ROLE_LABELS[s.workspaceRole] : (s.workspaceTabLabel || '工作台')}` });

        // ===== 基础设置 =====
        containerEl.createEl('h3', { text: '📁 基础设置' });
        new Setting(containerEl)
            .setName('实验记录文件夹')
            .setDesc('新建实验笔记存放的文件夹（留空则存放在库根目录）')
            .addText(t => t.setPlaceholder('Experiments')
                .setValue(this.plugin.settings.experimentsFolder)
                .onChange(async v => { this.plugin.settings.experimentsFolder = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('启动时自动打开仪表盘')
            .addToggle(t => t.setValue(this.plugin.settings.openOnStartup)
                .onChange(async v => { this.plugin.settings.openOnStartup = v; await this.plugin.saveSettings(); }));

        // ===== 天气设置 =====
        containerEl.createEl('h3', { text: '🌤 天气设置' });
        containerEl.createEl('p', { text: '留空则根据 IP 自动定位，手动输入坐标可提高精度。', cls: 'setting-item-description' });
        new Setting(containerEl).setName('城市名称').setDesc('仅显示用')
            .addText(t => t.setPlaceholder('例如：广州').setValue(this.plugin.settings.cityName)
                .onChange(async v => { this.plugin.settings.cityName = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('纬度').setDesc('留空自动定位')
            .addText(t => t.setPlaceholder('例如：23.1291').setValue(this.plugin.settings.latitude?.toString() ?? '')
                .onChange(async v => { this.plugin.settings.latitude = v ? parseFloat(v) : null; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('经度')
            .addText(t => t.setPlaceholder('例如：113.2644').setValue(this.plugin.settings.longitude?.toString() ?? '')
                .onChange(async v => { this.plugin.settings.longitude = v ? parseFloat(v) : null; await this.plugin.saveSettings(); }));

        // ===== AI 设置 =====
        containerEl.createEl('h3', { text: '🤖 AI 实验助手' });
        containerEl.createEl('p', {
            text: '配置 AI 服务商后，点击仪表盘的"🤖 AI 助手"按钮，用自然语言描述实验即可自动填写记录。',
            cls: 'setting-item-description'
        });

        const cfg = PROVIDER_CONFIG[this.plugin.settings.aiProvider];

        // 服务商选择
        new Setting(containerEl)
            .setName('AI 服务商')
            .setDesc('国内用户推荐使用 Kimi 或 DeepSeek，速度快且价格低')
            .addDropdown(d => {
                Object.entries(PROVIDER_CONFIG).forEach(([key, val]) => d.addOption(key, val.label));
                return d.setValue(this.plugin.settings.aiProvider)
                    .onChange(async (v: string) => {
                        this.plugin.settings.aiProvider = v as AIProvider;
                        this.plugin.settings.aiModel = PROVIDER_CONFIG[v as AIProvider].defaultModel;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        // 模型名称
        const modelDesc: Record<AIProvider, string> = {
            claude:   '推荐：claude-sonnet-4-6 / claude-opus-4-6',
            openai:   '推荐：gpt-4o / gpt-4-turbo',
            kimi:     '推荐：moonshot-v1-32k（支持长文本）',
            deepseek: '推荐：deepseek-chat / deepseek-reasoner',
            minimax:  '推荐：abab6.5s-chat / abab6.5-chat',
            custom:   '填写你的服务商支持的模型名称',
        };
        new Setting(containerEl)
            .setName('模型名称')
            .setDesc(modelDesc[this.plugin.settings.aiProvider])
            .addText(t => t.setValue(this.plugin.settings.aiModel)
                .onChange(async v => { this.plugin.settings.aiModel = v; await this.plugin.saveSettings(); }));

        // 自定义 API 端点（仅 custom 显示）
        if (this.plugin.settings.aiProvider === 'custom') {
            new Setting(containerEl)
                .setName('API 端点 URL')
                .setDesc('需兼容 OpenAI Chat Completions 格式，例如：https://api.example.com/v1/chat/completions')
                .addText(t => t.setPlaceholder('https://...')
                    .setValue(this.plugin.settings.aiCustomEndpoint)
                    .onChange(async v => { this.plugin.settings.aiCustomEndpoint = v; await this.plugin.saveSettings(); }));
        }

        // API Key（密码框）
        new Setting(containerEl)
            .setName('API Key')
            .setDesc(cfg.keyDesc)
            .addText(t => {
                t.inputEl.type = 'password';
                return t.setPlaceholder(cfg.keyPlaceholder)
                    .setValue(this.plugin.settings.aiApiKey)
                    .onChange(async v => { this.plugin.settings.aiApiKey = v; await this.plugin.saveSettings(); });
            });

        // 文档链接
        if (cfg.docsUrl) {
            const p = containerEl.createEl('p', { cls: 'setting-item-description' });
            p.createEl('a', { text: cfg.docsLabel, href: cfg.docsUrl, attr: { target: '_blank' } });
        }

        containerEl.createEl('p', {
            text: '🔒 安全说明：API Key 仅存储在本地 Obsidian 库中，AI 请求直接从你的设备发出，不经过任何中间服务器。',
            cls: 'setting-item-description'
        });

        // ===== AI 提示词设置 =====
        containerEl.createEl('h3', { text: '📝 AI 提示词（System Prompt）' });
        containerEl.createEl('p', {
            text: '控制 AI 的输出风格与格式。{{date}} 会自动替换为今日日期。修改后立即生效，无需重启插件。',
            cls: 'setting-item-description'
        });

        // 提示词编辑框
        containerEl.createEl('h3', { text: '图片识别实验记录' });
        containerEl.createEl('p', {
            text: '双阶段流程：MinerU 负责 OCR 提取，AI 重写模型负责整理为实验记录。选择 DeepSeek 时可复用上方主 AI Key。',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('MinerU API Key')
            .setDesc('用于阶段 1：从图片中提取文字、表格和公式。')
            .addText(t => {
                t.inputEl.type = 'password';
                return t.setPlaceholder('MinerU API Key')
                    .setValue(this.plugin.settings.mineruApiKey)
                    .onChange(async v => {
                        this.plugin.settings.mineruApiKey = v;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('AI 重写模型')
            .setDesc('用于阶段 2：把 OCR 文本整理成实验记录。')
            .addDropdown(d => d
                .addOption('deepseek', 'DeepSeek（可复用主 Key）')
                .addOption('claude', 'Claude')
                .addOption('openai', 'OpenAI / GPT')
                .addOption('gemini', 'Gemini')
                .addOption('custom', '自定义 OpenAI 兼容端点')
                .setValue(this.plugin.settings.writingProvider)
                .onChange(async v => {
                    this.plugin.settings.writingProvider = v as WritingProvider;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(containerEl)
            .setName('重写模型 API Key')
            .setDesc('留空且选择 DeepSeek 时，会自动复用上方主 AI Key。')
            .addText(t => {
                t.inputEl.type = 'password';
                return t.setPlaceholder('留空 = 复用 DeepSeek 主 Key')
                    .setValue(this.plugin.settings.writingApiKey)
                    .onChange(async v => {
                        this.plugin.settings.writingApiKey = v;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('重写模型型号')
            .setDesc('留空则使用默认模型，如 deepseek-chat / gpt-4.1 / gemini-2.5-pro。')
            .addText(t => t
                .setPlaceholder('留空 = 默认')
                .setValue(this.plugin.settings.writingModel)
                .onChange(async v => {
                    this.plugin.settings.writingModel = v;
                    await this.plugin.saveSettings();
                }));

        if (this.plugin.settings.writingProvider === 'custom') {
            new Setting(containerEl)
                .setName('重写模型自定义端点')
                .setDesc('OpenAI Chat Completions 兼容端点。')
                .addText(t => t
                    .setPlaceholder('https://example.com/v1/chat/completions')
                    .setValue(this.plugin.settings.writingCustomEndpoint)
                    .onChange(async v => {
                        this.plugin.settings.writingCustomEndpoint = v;
                        await this.plugin.saveSettings();
                    }));
        }

        const promptWrap = containerEl.createDiv({ cls: 'scholarium-prompt-wrap' });
        const promptTextarea = promptWrap.createEl('textarea', { cls: 'scholarium-prompt-textarea' });
        promptTextarea.value = this.plugin.settings.aiSystemPrompt || DEFAULT_AI_SYSTEM_PROMPT;
        promptTextarea.rows = 18;
        promptTextarea.style.cssText = 'width:100%;font-family:var(--font-monospace);font-size:0.82em;line-height:1.6;resize:vertical;padding:10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;';

        promptTextarea.addEventListener('input', async () => {
            this.plugin.settings.aiSystemPrompt = promptTextarea.value;
            await this.plugin.saveSettings();
        });

        // 重置按钮
        const resetRow = promptWrap.createDiv();
        resetRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;align-items:center;';
        const resetBtn = resetRow.createEl('button', { text: '↩ 恢复默认提示词', cls: 'scholarium-btn' });
        resetBtn.style.cssText = 'padding:4px 12px;font-size:0.82em;';
        resetBtn.onclick = async () => {
            promptTextarea.value = DEFAULT_AI_SYSTEM_PROMPT;
            this.plugin.settings.aiSystemPrompt = DEFAULT_AI_SYSTEM_PROMPT;
            await this.plugin.saveSettings();
            new (require('obsidian').Notice)('✅ 已恢复默认提示词');
        };
        resetRow.createEl('span', {
            text: '提示：可以在这里调整输出语气、增加领域专业术语、或要求AI只输出特定格式。',
            cls: 'setting-item-description'
        }).style.cssText = 'font-size:0.8em;margin:0;';

        // ===== 科研库 =====
        containerEl.createEl('h3', { text: '🧰 科研库' });
        containerEl.createEl('p', {
            text: '设置科研库左侧分类导航和分区卡片的颜色。颜色会以高透明度显示，避免干扰阅读。',
            cls: 'setting-item-description'
        });

        const colorSettings = this.plugin.settings.researchToolCategoryColors || {};
        this.plugin.settings.researchToolCategoryColors = {
            ...DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS,
            ...colorSettings,
        };

        const colorKeys = Object.keys(this.plugin.settings.researchToolCategoryColors);
        for (const category of colorKeys) {
            new Setting(containerEl)
                .setName(`${category} 颜色`)
                .addColorPicker(cp => cp
                    .setValue(this.plugin.settings.researchToolCategoryColors[category] || DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS[category] || '#64748B')
                    .onChange(async v => {
                        this.plugin.settings.researchToolCategoryColors = {
                            ...this.plugin.settings.researchToolCategoryColors,
                            [category]: v,
                        };
                        await this.plugin.saveSettings();
                    }));
        }

        new Setting(containerEl)
            .setName('重置科研库分类颜色')
            .setDesc('恢复默认分类配色。')
            .addButton(b => b
                .setButtonText('恢复默认')
                .onClick(async () => {
                    this.plugin.settings.researchToolCategoryColors = { ...DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS };
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // ===== 云盘同步 =====
        containerEl.createEl('h3', { text: '☁️ 云盘同步' });
        containerEl.createEl('p', {
            text: '支持将素材库文件同步到 WebDAV（坚果云、Nextcloud、OneDrive）或 S3 兼容存储（阿里云 OSS、腾讯 COS 等）。',
            cls: 'setting-item-description'
        });

        // 云存储服务商选择
        new Setting(containerEl)
            .setName('云存储服务商')
            .setDesc('选择不启用则不同步')
            .addDropdown(d => {
                d.addOption('none', '不启用');
                d.addOption('webdav', 'WebDAV（坚果云、Nextcloud、OneDrive）');
                d.addOption('s3', 'S3 兼容（阿里云 OSS、腾讯 COS、七牛云）');
                return d.setValue(this.plugin.settings.cloudProvider)
                    .onChange(async (v: string) => {
                        this.plugin.settings.cloudProvider = v as CloudProviderType;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        // ===== WebDAV 设置 =====
        if (this.plugin.settings.cloudProvider === 'webdav') {
            containerEl.createEl('h4', { text: 'WebDAV 配置' });
            containerEl.createEl('p', {
                text: '坚果云用户：后台生成"应用密码"，URL 为 https://dav.jianguoyun.com/dav/你的文件夹名/',
                cls: 'setting-item-description'
            });

            new Setting(containerEl)
                .setName('WebDAV 地址')
                .setDesc('例如：https://dav.jianguoyun.com/dav/')
                .addText(t => t.setPlaceholder('https://dav.jianguoyun.com/dav/')
                    .setValue(this.plugin.settings.cloudWebdavUrl)
                    .onChange(async v => { this.plugin.settings.cloudWebdavUrl = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('账号')
                .addText(t => t.setPlaceholder('用户名或邮箱')
                    .setValue(this.plugin.settings.cloudWebdavUser)
                    .onChange(async v => { this.plugin.settings.cloudWebdavUser = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('密码/应用密码')
                .addText(t => {
                    t.inputEl.type = 'password';
                    return t.setPlaceholder('WebDAV 密码或应用密码')
                        .setValue(this.plugin.settings.cloudWebdavPass)
                        .onChange(async v => { this.plugin.settings.cloudWebdavPass = v; await this.plugin.saveSettings(); });
                });

            new Setting(containerEl)
                .setName('远端路径')
                .setDesc('云端保存的路径前缀，例如：ChemELN/')
                .addText(t => t.setPlaceholder('ChemELN/')
                    .setValue(this.plugin.settings.cloudWebdavPath)
                    .onChange(async v => { this.plugin.settings.cloudWebdavPath = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .addButton(b => b.setButtonText('🔗 坚果云文档')
                    .onClick(() => window.open('https://www.jianguoyun.com/s/zh-CN/feature/webdav')))
                .addButton(b => b.setButtonText('🔗 Nextcloud 文档')
                    .onClick(() => window.open('https://nextcloud.com/')))
                .addButton(b => b.setButtonText('测试连接')
                    .onClick(async () => {
                        b.setButtonText('⏳...');
                        const mgr = new CloudSyncManager(this.plugin.app, this.plugin, buildSyncConfig(this.plugin.settings));
                        const result = await mgr.testConnection();
                        new Notice(result.message);
                        b.setButtonText('测试连接');
                    }));
        }

        // ===== S3 设置 =====
        if (this.plugin.settings.cloudProvider === 's3') {
            containerEl.createEl('h4', { text: 'S3 兼容存储配置' });
            containerEl.createEl('p', {
                text: '支持阿里云 OSS、腾讯 COS、七牛云等 S3 兼容存储。',
                cls: 'setting-item-description'
            });

            new Setting(containerEl)
                .setName('API 端点')
                .setDesc('例如：https://oss-cn-hangzhou.aliyuncs.com')
                .addText(t => t.setPlaceholder('https://oss-cn-hangzhou.aliyuncs.com')
                    .setValue(this.plugin.settings.cloudS3Endpoint)
                    .onChange(async v => { this.plugin.settings.cloudS3Endpoint = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('Bucket 名称')
                .addText(t => t.setPlaceholder('my-bucket')
                    .setValue(this.plugin.settings.cloudS3Bucket)
                    .onChange(async v => { this.plugin.settings.cloudS3Bucket = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('Region')
                .setDesc('例如：us-east-1, cn-hangzhou, ap-chengdu')
                .addText(t => t.setPlaceholder('us-east-1')
                    .setValue(this.plugin.settings.cloudS3Region)
                    .onChange(async v => { this.plugin.settings.cloudS3Region = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('Access Key')
                .addText(t => t.setPlaceholder('your-access-key-id')
                    .setValue(this.plugin.settings.cloudS3AccessKey)
                    .onChange(async v => { this.plugin.settings.cloudS3AccessKey = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('Secret Key')
                .addText(t => {
                    t.inputEl.type = 'password';
                    return t.setPlaceholder('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
                        .setValue(this.plugin.settings.cloudS3SecretKey)
                        .onChange(async v => { this.plugin.settings.cloudS3SecretKey = v; await this.plugin.saveSettings(); });
                });

            new Setting(containerEl)
                .setName('路径前缀')
                .setDesc('对象存储中的路径前缀，例如：ChemELN/')
                .addText(t => t.setPlaceholder('ChemELN/')
                    .setValue(this.plugin.settings.cloudS3Prefix)
                    .onChange(async v => { this.plugin.settings.cloudS3Prefix = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .addButton(b => b.setButtonText('🔗 阿里云 OSS')
                    .onClick(() => window.open('https://www.aliyun.com/product/oss')))
                .addButton(b => b.setButtonText('🔗 腾讯 COS')
                    .onClick(() => window.open('https://cloud.tencent.com/product/cos')))
                .addButton(b => b.setButtonText('🔗 七牛云')
                    .onClick(() => window.open('https://www.qiniu.com/')))
                .addButton(b => b.setButtonText('测试连接')
                    .onClick(async () => {
                        b.setButtonText('⏳...');
                        const mgr = new CloudSyncManager(this.plugin.app, this.plugin, buildSyncConfig(this.plugin.settings));
                        const result = await mgr.testConnection();
                        new Notice(result.message);
                        b.setButtonText('测试连接');
                    }));
        }

        // ===== 通用设置 =====
        if (this.plugin.settings.cloudProvider !== 'none') {
            containerEl.createEl('h4', { text: '同步设置' });

            new Setting(containerEl)
                .setName('自动同步')
                .setDesc('添加素材后自动上传到云盘')
                .addToggle(t => t.setValue(this.plugin.settings.cloudAutoSync)
                    .onChange(async v => { this.plugin.settings.cloudAutoSync = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('定时同步间隔（分钟）')
                .setDesc('0 表示不启用定时同步')
                .addText(t => t.setPlaceholder('0')
                    .setValue(String(this.plugin.settings.cloudSyncInterval))
                    .onChange(async v => {
                        this.plugin.settings.cloudSyncInterval = parseInt(v, 10) || 0;
                        await this.plugin.saveSettings();
                    }));
        }

        // ═══════════════════════════
        // 主题颜色配置
        // ═══════════════════════════
        containerEl.createEl('h3', { text: '🎨 主题颜色' });
        containerEl.createEl('p', {
            text: '自定义插件主色调、渐变色与背景透明度，支持预设和手动调色盘。',
            attr: { style: 'font-size:0.85em; color: var(--text-muted); margin-bottom:12px;' },
        });

        // ── 预设按钮 ──
        const presets: Array<{ label: string; accent: string; gradient: string; alpha: number }> = [
            { label: '🟠 橙红（默认）', accent: '#FF7043', gradient: '#E64A19', alpha: 0.10 },
            { label: '🔵 学术蓝',       accent: '#1976D2', gradient: '#0D47A1', alpha: 0.10 },
            { label: '🟢 翠绿',         accent: '#2E7D32', gradient: '#1B5E20', alpha: 0.10 },
            { label: '🟣 薰衣草',       accent: '#7B1FA2', gradient: '#4A148C', alpha: 0.10 },
            { label: '🩵 青色',         accent: '#00838F', gradient: '#006064', alpha: 0.10 },
            { label: '🌸 玫瑰粉',       accent: '#C2185B', gradient: '#880E4F', alpha: 0.10 },
            { label: '🤎 岩棕（公开版）', accent: '#6B5B4D', gradient: '#3E342B', alpha: 0.10 },
            { label: '💚 松石青（公开版）', accent: '#008080', gradient: '#005454', alpha: 0.10 },
        ];

        const presetWrap = containerEl.createDiv({ attr: { style: 'display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px;' } });

        const applyPreset = async (p: typeof presets[0]) => {
            this.plugin.settings.themeAccent   = p.accent;
            this.plugin.settings.themeGradient = p.gradient;
            this.plugin.settings.themeAlpha    = p.alpha;
            await this.plugin.saveSettings();
            this.display(); // re-render settings panel to update pickers
        };

        for (const p of presets) {
            const btn = presetWrap.createEl('button', {
                text: p.label,
                attr: { style: `padding:5px 12px; border-radius:8px; border:2px solid ${p.accent}; background: ${p.accent}1a; color: var(--text-normal); cursor:pointer; font-size:0.82em; font-weight:600; transition:all 0.15s;` },
            });
            btn.addEventListener('click', () => void applyPreset(p));
        }

        // ── 主色调 ──
        new Setting(containerEl)
            .setName('主色调')
            .setDesc('侧边栏、强调色、按钮等使用的主色')
            .addColorPicker(cp => cp
                .setValue(this.plugin.settings.themeAccent)
                .onChange(async v => {
                    this.plugin.settings.themeAccent = v;
                    await this.plugin.saveSettings();
                }));

        // ── 渐变色 ──
        new Setting(containerEl)
            .setName('渐变结束色')
            .setDesc('Hero Banner / 侧边栏渐变的深色端')
            .addColorPicker(cp => cp
                .setValue(this.plugin.settings.themeGradient)
                .onChange(async v => {
                    this.plugin.settings.themeGradient = v;
                    await this.plugin.saveSettings();
                }));

        // ── 背景透明度 ──
        new Setting(containerEl)
            .setName('背景透明度')
            .setDesc(`控制彩色背景块的透明度（当前：${Math.round(this.plugin.settings.themeAlpha * 100)}%）`)
            .addSlider(sl => sl
                .setLimits(3, 30, 1)
                .setValue(Math.round(this.plugin.settings.themeAlpha * 100))
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.themeAlpha = v / 100;
                    await this.plugin.saveSettings();
                }));

        // ── 颜色预览 ──
        const preview = containerEl.createDiv({ attr: { style: 'margin-top:12px; padding:14px; border-radius:12px; border:1px solid var(--background-modifier-border);' } });
        const previewGrad = `linear-gradient(135deg, ${this.plugin.settings.themeAccent}, ${this.plugin.settings.themeGradient})`;
        preview.createDiv({ attr: { style: `height:40px; border-radius:8px; background:${previewGrad}; margin-bottom:8px;` } });
        preview.createEl('span', {
            text: `主色 ${this.plugin.settings.themeAccent}  ·  渐变色 ${this.plugin.settings.themeGradient}  ·  透明度 ${Math.round(this.plugin.settings.themeAlpha * 100)}%`,
            attr: { style: 'font-size:0.78em; color:var(--text-muted);' },
        });
    }
}
