import { App, Notice, TFile, TFolder } from 'obsidian';
import ChemELNPlugin from './main';
import type { ChemELNSettings } from './settings';

export type CloudProviderType = 'none' | 'webdav' | 's3';

export interface RemoteFileInfo {
    name: string;
    size: number;
    modified: string;
}

export interface SyncResult {
    success: boolean;
    uploaded: number;
    downloaded: number;
    errors: string[];
    timestamp: string;
}

export interface CloudProviderConfig {
    type: CloudProviderType;
    // WebDAV
    webdavUrl: string;       // e.g. https://dav.jianguoyun.com/dav/
    webdavUser: string;
    webdavPass: string;
    webdavPath: string;      // 远端路径前缀, e.g. "ChemELN/"
    // S3
    s3Endpoint: string;       // e.g. https://oss-cn-hangzhou.aliyuncs.com
    s3Bucket: string;
    s3Region: string;
    s3AccessKey: string;
    s3SecretKey: string;
    s3Prefix: string;        // 路径前缀, e.g. "ChemELN/"
    // 通用
    autoSync: boolean;       // 添加文件后自动同步
    syncInterval: number;    // 定时同步间隔（分钟，0=不定时）
}

// ─────────────────────────────────────────────
// WebDAV Provider
// ─────────────────────────────────────────────
class WebDAVProvider {
    constructor(private cfg: CloudProviderConfig) {}

    async testConnection(): Promise<{ ok: boolean; message: string }> {
        try {
            const response = await fetch(this.buildUrl(''), {
                method: 'PROPFIND',
                headers: {
                    ...this.authHeader(),
                    'Depth': '0'
                }
            });
            if (response.ok || response.status === 207) {
                return { ok: true, message: '✅ 连接成功' };
            }
            return { ok: false, message: `❌ 服务器返回 ${response.status}` };
        } catch (e) {
            return { ok: false, message: `❌ 连接失败：${(e as Error).message}` };
        }
    }

    async ensureDir(remotePath: string): Promise<void> {
        const dirPath = remotePath.endsWith('/') ? remotePath : remotePath + '/';
        try {
            const response = await fetch(this.buildUrl(dirPath), {
                method: 'MKCOL',
                headers: this.authHeader()
            });
            // MKCOL 失败时（如目录已存在）忽略
            if (!response.ok && response.status !== 405) {
                console.warn('[WebDAV] MKCOL failed:', response.status);
            }
        } catch (e) {
            console.warn('[WebDAV] ensureDir error:', e);
        }
    }

    async upload(remotePath: string, data: ArrayBuffer, contentType = 'application/octet-stream'): Promise<void> {
        const response = await fetch(this.buildUrl(remotePath), {
            method: 'PUT',
            headers: {
                ...this.authHeader(),
                'Content-Type': contentType
            },
            body: data
        });
        if (!response.ok) {
            throw new Error(`WebDAV upload failed: ${response.status} ${response.statusText}`);
        }
    }

    async download(remotePath: string): Promise<ArrayBuffer> {
        const response = await fetch(this.buildUrl(remotePath), {
            method: 'GET',
            headers: this.authHeader()
        });
        if (!response.ok) {
            throw new Error(`WebDAV download failed: ${response.status}`);
        }
        return response.arrayBuffer();
    }

    async list(remoteDir: string): Promise<RemoteFileInfo[]> {
        const dirPath = remoteDir.endsWith('/') ? remoteDir : remoteDir + '/';
        try {
            const response = await fetch(this.buildUrl(dirPath), {
                method: 'PROPFIND',
                headers: {
                    ...this.authHeader(),
                    'Depth': '1'
                }
            });
            if (!response.ok && response.status !== 207) {
                return [];
            }
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'application/xml');
            const results: RemoteFileInfo[] = [];

            const responses = doc.querySelectorAll('response');
            responses.forEach((resp, idx) => {
                if (idx === 0) return; // 跳过父目录
                const href = resp.querySelector('href')?.textContent ?? '';
                const propstat = resp.querySelector('propstat');
                if (!propstat) return;

                const displayName = propstat.querySelector('displayname')?.textContent ?? '';
                const contentLength = propstat.querySelector('getcontentlength')?.textContent ?? '0';
                const lastModified = propstat.querySelector('getlastmodified')?.textContent ?? '';

                if (displayName && !href.endsWith('/')) {
                    results.push({
                        name: displayName,
                        size: parseInt(contentLength, 10),
                        modified: lastModified
                    });
                }
            });
            return results;
        } catch (e) {
            console.warn('[WebDAV] list error:', e);
            return [];
        }
    }

    async delete(remotePath: string): Promise<void> {
        const response = await fetch(this.buildUrl(remotePath), {
            method: 'DELETE',
            headers: this.authHeader()
        });
        if (!response.ok) {
            throw new Error(`WebDAV delete failed: ${response.status}`);
        }
    }

    private buildUrl(remotePath: string): string {
        let base = this.cfg.webdavUrl;
        if (!base.endsWith('/')) base += '/';
        let path = this.cfg.webdavPath;
        if (!path.endsWith('/')) path += '/';
        return base + path + remotePath;
    }

    private authHeader(): Record<string, string> {
        const credentials = btoa(this.cfg.webdavUser + ':' + this.cfg.webdavPass);
        return { 'Authorization': `Basic ${credentials}` };
    }
}

// ─────────────────────────────────────────────
// S3 Provider
// ─────────────────────────────────────────────
class S3Provider {
    constructor(private cfg: CloudProviderConfig) {}

    async testConnection(): Promise<{ ok: boolean; message: string }> {
        try {
            const key = this.cfg.s3Prefix + '.test';
            const testData = new TextEncoder().encode('test');
            await this.upload(key, testData);
            await this.delete(key);
            return { ok: true, message: '✅ 连接成功' };
        } catch (e) {
            return { ok: false, message: `❌ 连接失败：${(e as Error).message}` };
        }
    }

    async upload(key: string, data: ArrayBuffer, contentType = 'application/octet-stream'): Promise<void> {
        const method = 'PUT';
        const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Host': new URL(this.cfg.s3Endpoint).hostname
        };
        const signedHeaders = await this.signRequest(method, '/' + key, headers, data);

        const response = await fetch(this.cfg.s3Endpoint + '/' + key, {
            method,
            headers: signedHeaders,
            body: data
        });

        if (!response.ok) {
            throw new Error(`S3 upload failed: ${response.status}`);
        }
    }

    async download(key: string): Promise<ArrayBuffer> {
        const method = 'GET';
        const headers: Record<string, string> = {
            'Host': new URL(this.cfg.s3Endpoint).hostname
        };
        const signedHeaders = await this.signRequest(method, '/' + key, headers, null);

        const response = await fetch(this.cfg.s3Endpoint + '/' + key, {
            method,
            headers: signedHeaders
        });

        if (!response.ok) {
            throw new Error(`S3 download failed: ${response.status}`);
        }
        return response.arrayBuffer();
    }

    async list(prefix: string): Promise<RemoteFileInfo[]> {
        try {
            const method = 'GET';
            const path = `/?prefix=${encodeURIComponent(prefix)}&list-type=2`;
            const headers: Record<string, string> = {
                'Host': new URL(this.cfg.s3Endpoint).hostname
            };
            const signedHeaders = await this.signRequest(method, path, headers, null);

            const response = await fetch(this.cfg.s3Endpoint + path, {
                method,
                headers: signedHeaders
            });

            if (!response.ok) {
                return [];
            }

            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'application/xml');
            const results: RemoteFileInfo[] = [];

            doc.querySelectorAll('Contents').forEach(cont => {
                const key = cont.querySelector('Key')?.textContent ?? '';
                const size = cont.querySelector('Size')?.textContent ?? '0';
                const modified = cont.querySelector('LastModified')?.textContent ?? '';
                if (key) {
                    const fileName = key.split('/').pop() ?? '';
                    results.push({
                        name: fileName,
                        size: parseInt(size, 10),
                        modified
                    });
                }
            });
            return results;
        } catch (e) {
            console.warn('[S3] list error:', e);
            return [];
        }
    }

    async delete(key: string): Promise<void> {
        const method = 'DELETE';
        const headers: Record<string, string> = {
            'Host': new URL(this.cfg.s3Endpoint).hostname
        };
        const signedHeaders = await this.signRequest(method, '/' + key, headers, null);

        const response = await fetch(this.cfg.s3Endpoint + '/' + key, {
            method,
            headers: signedHeaders
        });

        if (!response.ok) {
            throw new Error(`S3 delete failed: ${response.status}`);
        }
    }

    private async signRequest(
        method: string,
        path: string,
        headers: Record<string, string>,
        body: ArrayBuffer | null
    ): Promise<Record<string, string>> {
        const now = new Date();
        const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d+Z$/, 'Z');
        const datestamp = amzDate.substring(0, 8);

        const canonicalRequest = this.buildCanonicalRequest(method, path, headers, body, amzDate);
        const canonicalRequestHash = await this.sha256(canonicalRequest);

        const credentialScope = `${datestamp}/${this.cfg.s3Region}/s3/aws4_request`;
        const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

        const kDate = await this.hmacSHA256('AWS4' + this.cfg.s3SecretKey, datestamp);
        const kRegion = await this.hmacSHA256(kDate, this.cfg.s3Region);
        const kService = await this.hmacSHA256(kRegion, 's3');
        const kSigning = await this.hmacSHA256(kService, 'aws4_request');
        const signature = this.toHex(await this.hmacSHA256(kSigning, stringToSign));

        const authHeader = `AWS4-HMAC-SHA256 Credential=${this.cfg.s3AccessKey}/${credentialScope}, SignedHeaders=host, Signature=${signature}`;

        return {
            ...headers,
            'Authorization': authHeader,
            'X-Amz-Date': amzDate
        };
    }

    private buildCanonicalRequest(
        method: string,
        path: string,
        headers: Record<string, string>,
        body: ArrayBuffer | null,
        amzDate: string
    ): string {
        const canonicalHeaders = Object.entries(headers)
            .sort(([k1], [k2]) => k1.toLowerCase().localeCompare(k2.toLowerCase()))
            .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
            .join('\n');
        const signedHeaders = Object.keys(headers)
            .map(k => k.toLowerCase())
            .sort()
            .join(';');

        const bodyHash = body ? this.toHex(new Uint8Array(body)) : this.toHex(new TextEncoder().encode(''));

        return `${method}\n${path}\n\n${canonicalHeaders}\n\n${signedHeaders}\n${bodyHash}`;
    }

    private async hmacSHA256(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
        const keyBuf = typeof key === 'string' ? new TextEncoder().encode(key) : key;
        const cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
    }

    private async sha256(data: ArrayBuffer | string): Promise<string> {
        const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        return this.toHex(await crypto.subtle.digest('SHA-256', buf));
    }

    private toHex(buffer: ArrayBuffer): string {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

// ─────────────────────────────────────────────
// CloudSyncManager 主类
// ─────────────────────────────────────────────
export class CloudSyncManager {
    private lastResult: SyncResult | null = null;
    private syncTimer: number | null = null;

    constructor(
        private app: App,
        private plugin: ChemELNPlugin,
        private cfg: CloudProviderConfig
    ) {}

    async testConnection(): Promise<{ ok: boolean; message: string }> {
        const provider = this.getProvider();
        if (!provider) {
            return { ok: false, message: '未配置云存储' };
        }
        return provider.testConnection();
    }

    async fullSync(): Promise<SyncResult> {
        const result: SyncResult = {
            success: false,
            uploaded: 0,
            downloaded: 0,
            errors: [],
            timestamp: new Date().toISOString()
        };

        const provider = this.getProvider();
        if (!provider) {
            result.errors.push('未配置云存储');
            return result;
        }

        try {
            await this.ensureRemoteRoot();

            // 1. 列出本地 Materials/ 文件夹的文件
            const localFolder = this.app.vault.getAbstractFileByPath('Materials');
            const localFiles: TFile[] = [];
            if (localFolder instanceof TFolder) {
                localFolder.children.forEach(f => {
                    if (f instanceof TFile) {
                        localFiles.push(f);
                    }
                });
            }

            // 2. 列出云端文件
            const remotePrefix = this.cfg.type === 'webdav' ? this.cfg.webdavPath : this.cfg.s3Prefix;
            const remoteDir = remotePrefix.endsWith('/') ? remotePrefix + 'Materials/' : remotePrefix + '/Materials/';
            const remoteFiles = await (provider as WebDAVProvider | S3Provider).list(remoteDir);

            // 构建云端文件名集合
            const remoteNames = new Set<string>();
            remoteFiles.forEach(f => remoteNames.add(f.name));

            // 3. 上传本地有但云端没有的文件
            for (const file of localFiles) {
                if (!remoteNames.has(file.name)) {
                    try {
                        const data = await this.app.vault.readBinary(file);
                        const remotePath = remoteDir + file.name;

                        if (this.cfg.type === 'webdav') {
                            await (provider as WebDAVProvider).upload(remotePath, data);
                        } else {
                            await (provider as S3Provider).upload(remotePath, data);
                        }
                        result.uploaded++;
                    } catch (e) {
                        result.errors.push(`上传 ${file.name} 失败：${(e as Error).message}`);
                    }
                }
            }

            // 4. 同步元数据
            await this.syncMetadata(provider as any);

            result.success = true;
        } catch (e) {
            result.errors.push((e as Error).message);
        }

        this.lastResult = result;
        return result;
    }

    async uploadFile(vaultPath: string): Promise<void> {
        const provider = this.getProvider();
        if (!provider) return;

        try {
            const file = this.app.vault.getAbstractFileByPath(vaultPath);
            if (!(file instanceof TFile)) return;

            const data = await this.app.vault.readBinary(file);
            const remotePrefix = this.cfg.type === 'webdav' ? this.cfg.webdavPath : this.cfg.s3Prefix;
            const remoteDir = remotePrefix.endsWith('/') ? remotePrefix : remotePrefix + '/';
            const remotePath = remoteDir + vaultPath;

            if (this.cfg.type === 'webdav') {
                await (provider as WebDAVProvider).upload(remotePath, data);
            } else {
                await (provider as S3Provider).upload(remotePath, data);
            }
        } catch (e) {
            console.warn('[CloudSync] uploadFile error:', e);
        }
    }

    getLastResult(): SyncResult | null {
        return this.lastResult;
    }

    startAutoSync(): void {
        if (!this.cfg.autoSync || this.cfg.syncInterval <= 0) return;

        this.syncTimer = window.setInterval(() => {
            this.fullSync().catch(e => console.warn('[CloudSync] auto sync error:', e));
        }, this.cfg.syncInterval * 60 * 1000);
    }

    stopAutoSync(): void {
        if (this.syncTimer !== null) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
    }

    destroy(): void {
        this.stopAutoSync();
    }

    private getProvider(): WebDAVProvider | S3Provider | null {
        if (this.cfg.type === 'webdav') {
            return new WebDAVProvider(this.cfg);
        } else if (this.cfg.type === 's3') {
            return new S3Provider(this.cfg);
        }
        return null;
    }

    private async ensureRemoteRoot(): Promise<void> {
        const provider = this.getProvider();
        if (!provider) return;

        const remotePrefix = this.cfg.type === 'webdav' ? this.cfg.webdavPath : this.cfg.s3Prefix;
        if (this.cfg.type === 'webdav') {
            await (provider as WebDAVProvider).ensureDir(remotePrefix);
            await (provider as WebDAVProvider).ensureDir(remotePrefix + 'Materials/');
        }
        // S3 不需要预先创建目录
    }

    private async syncMetadata(provider: WebDAVProvider | S3Provider): Promise<void> {
        try {
            const pluginData = (await this.plugin.loadData() as Record<string, unknown>) || {};
            const matData = pluginData.materialLibrary;
            const jsonStr = JSON.stringify(matData, null, 2);
            const jsonBuf = new TextEncoder().encode(jsonStr);

            const remotePrefix = this.cfg.type === 'webdav' ? this.cfg.webdavPath : this.cfg.s3Prefix;
            const metaPath = (remotePrefix.endsWith('/') ? remotePrefix : remotePrefix + '/') + 'metadata.json';

            if (this.cfg.type === 'webdav') {
                await (provider as WebDAVProvider).upload(metaPath, jsonBuf, 'application/json');
            } else {
                await (provider as S3Provider).upload(metaPath, jsonBuf, 'application/json');
            }
        } catch (e) {
            console.warn('[CloudSync] syncMetadata error:', e);
        }
    }
}

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────
export function buildSyncConfig(settings: ChemELNSettings): CloudProviderConfig {
    return {
        type: settings.cloudProvider,
        webdavUrl: settings.cloudWebdavUrl,
        webdavUser: settings.cloudWebdavUser,
        webdavPass: settings.cloudWebdavPass,
        webdavPath: settings.cloudWebdavPath || 'ChemELN/',
        s3Endpoint: settings.cloudS3Endpoint,
        s3Bucket: settings.cloudS3Bucket,
        s3Region: settings.cloudS3Region || 'us-east-1',
        s3AccessKey: settings.cloudS3AccessKey,
        s3SecretKey: settings.cloudS3SecretKey,
        s3Prefix: settings.cloudS3Prefix || 'ChemELN/',
        autoSync: settings.cloudAutoSync,
        syncInterval: settings.cloudSyncInterval
    };
}
