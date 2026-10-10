/* settings-core.js — 设置中心的纯逻辑层：凭据注册表、掩码、.env 解析。
 * 保持 DOM-free，与 research-chat-core.js 同一约定，便于 node --test 覆盖。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.weaverSettingsCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /* 每个可配置凭据都必须回答用户的三个问题：这是什么？没有它能用吗？去哪弄？
   * cost 取值：free（免费）/ free-quota（免费额度）/ institution（机构订阅）/ paid（付费）。
   * fallback：未配置时的降级说明，让用户清楚损失了什么能力。 */
  const CREDENTIAL_REGISTRY = [
    {
      envVar: 'HF_TOKEN',
      label: 'Hugging Face',
      purpose: '云端多语种 Embedding，用于论文向量化、语义检索和混合 RAG',
      cost: 'free-quota',
      applyUrl: 'https://huggingface.co/settings/tokens',
      fallback: '未配置或云端不可用时明确降级为本地 BM25；不会把未生成的向量标记为成功。',
      legacyConfigField: 'huggingFaceToken',
      validate: (v) => /^hf_[A-Za-z0-9]{20,}$/.test(v) || '应为 hf_ 开头的 Hugging Face Token，请核对是否复制完整',
    },
    {
      envVar: 'MINERU_API_KEY',
      label: 'MinerU',
      purpose: '高精度 PDF 解析（表格、公式、版面），用于文献精读与证据卡',
      cost: 'free-quota',
      applyUrl: 'https://mineru.net/apiManage',
      fallback: '未配置时 PDF 解析退回本地基础解析，复杂表格与公式可能丢失。',
      legacyConfigField: 'mineruApiKey',
      validate: (v) => /^eyJ[\w.-]{20,}$/.test(v) || v.length >= 20 || '密钥长度异常，请核对是否复制完整',
    },
    {
      envVar: 'SEMANTIC_SCHOLAR_API_KEY',
      label: 'Semantic Scholar',
      purpose: '文献检索加速与更高调用限额（可选，无 Key 也能用公共限额）',
      cost: 'free',
      applyUrl: 'https://www.semanticscholar.org/product/api#api-key',
      fallback: '未配置时使用公共限额，高频检索时可能被限速。',
      /* 原来是 /^[A-Za-z0-9]{20,}$/ —— 不允许连字符。而 Semantic Scholar 现行
       * 的 key 形如 s2k-XXXXXXXX…，带横线，于是合法的 key 被判为非法、根本存
       * 不进去，用户看到的是"填了没反应"。
       *
       * 密钥格式是服务方说了算、且会变的东西，这里的校验只该拦住明显的手滑
       * （空值、粘贴不全、误贴了别的东西），不该替服务方定义什么叫合法。所以
       * 放宽到"20 位以上，且只含密钥常见字符"。 */
      validate: (v) => /^[A-Za-z0-9_-]{20,}$/.test(v) || '应为 20 位以上字母数字（可含 - 或 _），请核对是否复制完整',
    },
    {
      envVar: 'SCOPUS_API_KEY',
      label: 'Scopus (Elsevier)',
      purpose: 'Scopus 文献库检索（覆盖最全的文摘库之一）',
      cost: 'institution',
      applyUrl: 'https://dev.elsevier.com/',
      fallback: '未配置时检索仅使用开放数据源（OpenAlex / PubMed / Semantic Scholar）。',
      validate: (v) => /^[0-9a-f]{32}$/i.test(v) || '应为 32 位十六进制，请核对',
    },
    {
      envVar: 'UNPAYWALL_EMAIL',
      label: 'Unpaywall',
      purpose: '开放获取 PDF 定位（仅需邮箱，无需密钥）',
      cost: 'free',
      applyUrl: 'https://unpaywall.org/products/api',
      fallback: '未配置时无法通过 Unpaywall 定位开放获取版本。',
      validate: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || '请填写有效邮箱地址',
    },
    {
      envVar: 'OPENALEX_EMAIL',
      label: 'OpenAlex',
      purpose: '开放文献检索（免密钥，邮箱用于 polite pool 获得更稳定限额）',
      cost: 'free',
      applyUrl: 'https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication',
      fallback: '未配置时仍可检索，但共用匿名限额，高峰期可能变慢。',
      validate: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || '请填写有效邮箱地址',
    },
    {
      envVar: 'NCBI_API_KEY',
      label: 'PubMed / NCBI',
      purpose: 'PubMed 检索提速（无 Key 也可用，Key 将限额从 3/s 提升到 10/s）',
      cost: 'free',
      applyUrl: 'https://www.ncbi.nlm.nih.gov/account/settings/',
      fallback: '未配置时 PubMed 检索限速 3 次/秒，大批量检索较慢。',
      validate: (v) => /^[0-9a-f]{36}$/i.test(v) || '应为 36 位十六进制，请核对',
    },
  ];

  const COST_LABEL = {
    free: '免费',
    'free-quota': '免费额度',
    institution: '机构订阅',
    paid: '付费',
  };

  function maskSecret(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 8) return '••••';
    return `${text.slice(0, 4)}••••${text.slice(-4)}`;
  }

  function parseEnvFile(raw) {
    const entries = {};
    for (const line of String(raw || '').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match && !line.trim().startsWith('#')) entries[match[1]] = match[2].trim();
    }
    return entries;
  }

  function serializeEnvFile(entries, header) {
    const lines = [header || '# Scholarium Bridge 本地凭据——本文件含密钥，禁止提交或分享。'];
    for (const [key, value] of Object.entries(entries)) lines.push(`${key}=${value}`);
    return `${lines.join('\n')}\n`;
  }

  function credentialStatus(registry, values) {
    return registry.map((item) => {
      const found = values[item.envVar];
      return {
        ...item,
        costLabel: COST_LABEL[item.cost] || item.cost,
        configured: Boolean(found && found.value),
        masked: found && found.value ? maskSecret(found.value) : '',
        source: found ? found.source : 'missing', // env | file | config | missing
      };
    });
  }

  return { CREDENTIAL_REGISTRY, COST_LABEL, maskSecret, parseEnvFile, serializeEnvFile, credentialStatus };
});
