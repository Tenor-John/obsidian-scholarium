export type AIProvider = 'gpt' | 'claude' | 'gemini' | 'deepseek' | 'kimi' | 'minimax';

export interface ProviderDefaultConfig {
    baseUrl: string;
    model: string;
    protocol: 'openai' | 'anthropic' | 'gemini';
}

export const PROVIDER_DEFAULTS: Record<AIProvider, ProviderDefaultConfig> = {
    gpt: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        protocol: 'openai',
    },
    claude: {
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-3-5-sonnet-latest',
        protocol: 'anthropic',
    },
    gemini: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-1.5-pro',
        protocol: 'gemini',
    },
    deepseek: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        protocol: 'openai',
    },
    kimi: {
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'moonshot-v1-8k',
        protocol: 'openai',
    },
    minimax: {
        baseUrl: 'https://api.minimax.chat/v1',
        model: 'MiniMax-Text-01',
        protocol: 'openai',
    },
};

export function providerLabel(provider: AIProvider): string {
    const labels: Record<AIProvider, string> = {
        gpt: 'OpenAI GPT',
        claude: 'Anthropic Claude',
        gemini: 'Google Gemini',
        deepseek: 'DeepSeek',
        kimi: 'Moonshot Kimi',
        minimax: 'MiniMax',
    };
    return labels[provider];
}
