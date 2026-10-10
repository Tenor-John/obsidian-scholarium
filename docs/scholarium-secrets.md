# Scholarium 密钥与服务地址

插件首次加载时会自动创建一个用户级文件：

```text
%USERPROFILE%\Scholarium\scholarium-secrets.json
```

也可以通过环境变量 `SCHOLARIUM_SECRETS_FILE` 指定路径。该文件位于 Vault 外，避免被 Obsidian Sync、Git 或 Vault 备份意外分享。

在「设置 → Scholarium」顶部可以看到完整路径并点击「打开文件」编辑，也可以点击「选择保存位置」让用户选择一个文件夹；插件会在该文件夹中自动生成固定文件名 `scholarium-secrets.json`。更换位置时会自动复制现有配置，不会丢失密钥；「恢复默认位置」会回到当前用户的 Scholarium 文件夹。

插件设置页中的 API Key、AI 自定义端点、MinerU、WebDAV、S3 和文献服务地址都与该文件双向同步；直接编辑后约 2 秒内生效。

旧版本 `data.json` 中的密钥会在第一次加载时自动迁移并清空；`Scholarium/secrets/openalex-api-key.txt` 也会迁移到 `openalex.apiKey`。迁移成功后可删除旧文件，但不要把新的 `scholarium-secrets.json` 放回 Vault。

文件示例：

```json
{
  "assistant": { "apiKey": "", "endpoint": "" },
  "writing": { "apiKey": "", "endpoint": "" },
  "literatureSummary": { "apiKey": "", "endpoint": "" },
  "openalex": { "apiKey": "", "email": "" },
  "mineru": { "apiKey": "", "mode": "scanned" },
  "cloudSync": {
    "webdavUrl": "",
    "webdavUser": "",
    "webdavPassword": "",
    "s3Endpoint": "",
    "s3Bucket": "",
    "s3Region": "us-east-1",
    "s3AccessKey": "",
    "s3SecretKey": ""
  },
  "unpaywall": { "email": "" }
}
```
