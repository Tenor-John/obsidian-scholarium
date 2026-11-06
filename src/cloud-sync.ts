import { App, Notice, TFile, TFolder } from 'obsidian';
import ChemELNPlugin from './main';
import type { ChemELNSettings } from './settings';
import { fetchWithTimeout, requestUrlWithTimeout } from './utils/network';
import { schMaterialsRoot } from './folders';

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
            const response = await this.requestWebDav('', {
                method: 'PROPFIND',
                headers: {
                    'Depth': '0'
                }
            });
            if (this.isOk(response.status)) {
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
            const response = await this.requestWebDav(dirPath, {
                method: 'MKCOL'
            });
            // MKCOL 失败时（如目录已存在）忽略
            if (!this.isOk(response.status) && response.status !== 405) {
                console.warn('[WebDAV] MKCOL failed:', response.status);
            }
        } catch (e) {
            console.warn('[WebDAV] ensureDir error:', e);
        }
    }

    async upload(remotePath: string, data: ArrayBuffer, contentType = 'application/octet-stream'): Promise<void> {
        const response = await this.requestWebDav(remotePath, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType
            },
            body: data
        });
        if (!this.isOk(response.status)) {
            throw new Error(`WebDAV upload failed: ${response.status}`);
        }
    }

    async download(remotePath: string): Promise<ArrayBuffer> {
        const response = await this.requestWebDav(remotePath, {
            method: 'GET'
        });
        if (!this.isOk(response.status)) {
            throw new Error(`WebDAV download failed: ${response.status}`);
        }
        return response.arrayBuffer;
    }

    async list(remoteDir: string): Promise<RemoteFileInfo[]> {
        const dirPath = remoteDir.endsWith('/') ? remoteDir : remoteDir + '/';
        try {
            const response = await this.requestWebDav(dirPath, {
                method: 'PROPFIND',
                headers: {
                    'Depth': '1'
                }
            });
            if (!this.isOk(response.status)) {
                return [];
            }
            const text = response.text;
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'application/xml');
            const results: RemoteFileInfo[] = [];

            const responses = this.elementsByLocalName(doc, 'response');
            responses.forEach((resp, idx) => {
                if (idx === 0) return; // 跳过父目录
                const href = this.firstText(resp, 'href');
                const displayName = this.firstText(resp, 'displayname') || decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '');
                const contentLength = this.firstText(resp, 'getcontentlength') || '0';
                const lastModified = this.firstText(resp, 'getlastmodified');

                if (displayName && !href.endsWith('/')) {
                    results.push({
                        name: displayName,
                        size: parseInt(contentLength, 10) || 0,
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
        const response = await this.requestWebDav(remotePath, {
            method: 'DELETE'
        });
        if (!this.isOk(response.status)) {
            throw new Error(`WebDAV delete failed: ${response.status}`);
        }
    }

    private async requestWebDav(
        remotePath: string,
        options: { method: string; headers?: Record<string, string>; body?: ArrayBuffer | string }
    ) {
        return requestUrlWithTimeout({
            url: this.buildUrl(remotePath),
            method: options.method,
            headers: {
                ...this.authHeader(),
                ...options.headers
            },
            body: options.body
        });
    }

    private isOk(status: number): boolean {
        return (status >= 200 && status < 300) || status === 207;
    }

    private buildUrl(remotePath: string): string {
        const base = this.cfg.webdavUrl.trim().replace(/\/+$/, '');
        const path = this.cfg.webdavPath.trim().replace(/^\/+|\/+$/g, '');
        const suffix = remotePath.replace(/^\/+/, '');
        return [base, path, suffix]
            .filter(Boolean)
            .join('/')
            .replace(/([^:]\/)\/+/g, '$1');
    }

    private authHeader(): Record<string, string> {
        const credentials = btoa(this.cfg.webdavUser + ':' + this.cfg.webdavPass);
        return { 'Authorization': `Basic ${credentials}` };
    }

    private firstText(root: Element, localName: string): string {
        return this.elementsByLocalName(root, localName)[0]?.textContent ?? '';
    }

    private elementsByLocalName(root: ParentNode, localName: string): Element[] {
        return Array.from(root.querySelectorAll('*')).filter((el) => el.localName === localName);
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

        const response = await fetchWithTimeout(this.cfg.s3Endpoint + '/' + key, {
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

        const response = await fetchWithTimeout(this.cfg.s3Endpoint + '/' + key, {
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

            const response = await fetchWithTimeout(this.cfg.s3Endpoint + path, {
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

        const response = await fetchWithTimeout(this.cfg.s3Endpoint + '/' + key, {
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

    private materialRoot(): string {
        return schMaterialsRoot(this.plugin);
    }

    private normalizeVaultPath(value: string): string {
        const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const parts = normalized.split('/');
        if (!normalized || parts.some(part => !part || part === '.' || part === '..')) {
            throw new Error(`无效的 Vault 路径：${value}`);
        }
        return parts.join('/');
    }

    private remotePath(vaultPath: string): string {
        const normalized = this.normalizeVaultPath(vaultPath);
        if (this.cfg.type === 'webdav') return normalized;
        const configuredPrefix = String(this.cfg.s3Prefix || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const prefix = configuredPrefix ? this.normalizeVaultPath(configuredPrefix) : '';
        return prefix ? `${prefix}/${normalized}` : normalized;
    }

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
            const root = this.materialRoot();
            const localFolder = this.app.vault.getAbstractFileByPath(root);
            const localFiles: TFile[] = [];
            const collectFiles = (folder: TFolder): void => {
                folder.children.forEach(child => {
                    if (child instanceof TFile) localFiles.push(child);
                    else if (child instanceof TFolder) collectFiles(child);
                });
            };
            if (localFolder instanceof TFolder) collectFiles(localFolder);

            const ensured = new Set<string>();
            for (const file of localFiles) {
                try {
                    const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : root;
                    if (parent !== root && !ensured.has(parent)) {
                        await this.ensureFolder(parent);
                        ensured.add(parent);
                    }
                    const data = await this.app.vault.readBinary(file);
                    await provider.upload(this.remotePath(file.path), data);
                    result.uploaded++;
                } catch (e) {
                    result.errors.push(`上传 ${file.path} 失败：${(e as Error).message}`);
                }
            }

            await this.syncMetadata(provider);
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
            const normalized = this.normalizeVaultPath(vaultPath);
            const file = this.app.vault.getAbstractFileByPath(normalized);
            if (!(file instanceof TFile)) return;
            const data = await this.app.vault.readBinary(file);
            await provider.upload(this.remotePath(normalized), data);
        } catch (e) {
            console.warn('[CloudSync] uploadFile error:', e);
        }
    }

    async ensureFolder(t: string): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
        const provider = this.getProvider();
        if (!provider) return { ok: false, skipped: true, message: '未配置云存储' };
        const normalized = this.normalizeVaultPath(t);
        const root = this.materialRoot();
        if (normalized !== root && !normalized.startsWith(root + '/')) {
            throw new Error(`云端目录必须位于 ${root} 内`);
        }

        if (this.cfg.type === 'webdav') {
            let current = '';
            for (const part of normalized.split('/')) {
                current += `${part}/`;
                await (provider as WebDAVProvider).ensureDir(current);
            }
        } else {
            await provider.upload(`${this.remotePath(normalized)}/`, new ArrayBuffer(0), 'application/x-directory');
        }
        return { ok: true };
    }

    async moveFile(t: string, e: string): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
        const provider = this.getProvider();
        if (!provider) return { ok: false, skipped: true, message: '未配置云存储' };
        const oldPath = this.normalizeVaultPath(t);
        const targetPath = this.normalizeVaultPath(e);
        const root = this.materialRoot();
        if ((!oldPath.startsWith(root + '/') && oldPath !== root) || (!targetPath.startsWith(root + '/') && targetPath !== root)) {
            throw new Error(`云端移动必须位于 ${root} 内`);
        }
        const file = this.app.vault.getAbstractFileByPath(targetPath);
        if (!(file instanceof TFile)) throw new Error('移动后的 Vault 文件不存在');
        const parent = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : root;
        await this.ensureFolder(parent);
        const bytes = await this.app.vault.readBinary(file);
        await provider.upload(this.remotePath(targetPath), bytes);
        try {
            await provider.delete(this.remotePath(oldPath));
        } catch (error) {
            if (!/404/.test(String((error as Error)?.message || error))) throw error;
        }
        await this.syncMetadata(provider);
        return { ok: true };
    }

    async deletePaths(paths: string[]): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
        const provider = this.getProvider();
        if (!provider) return { ok: false, skipped: true, message: '未配置云存储' };
        const analysisRoot = `${this.materialRoot()}/_analysis/`;
        for (const path of Array.from(new Set(paths || []))) {
            const normalized = this.normalizeVaultPath(path);
            if (!normalized.startsWith(analysisRoot)) {
                throw new Error(`拒绝删除 ${this.materialRoot()}/_analysis 之外的云端文件`);
            }
            try {
                await provider.delete(this.remotePath(normalized));
            } catch (error) {
                if (!/404/.test(String((error as Error)?.message || error))) throw error;
            }
        }
        return { ok: true };
    }

    getLastResult(): SyncResult | null {
        return this.lastResult;
    }

    startAutoSync(): void {
        if (!this.cfg.autoSync || this.cfg.syncInterval <= 0) return;

        this.syncTimer = this.plugin.registerInterval(window.setInterval(() => {
            this.fullSync().catch(e => console.warn('[CloudSync] auto sync error:', e));
        }, this.cfg.syncInterval * 60 * 1000));
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
        if (!provider || this.cfg.type !== 'webdav') return;
        // WebDAVProvider 会统一添加 webdavPath，这里只传相对目录，避免重复前缀。
        await (provider as WebDAVProvider).ensureDir('');
        await (provider as WebDAVProvider).ensureDir(this.materialRoot() + '/');
    }

    private async syncMetadata(provider: WebDAVProvider | S3Provider): Promise<void> {
        try {
            const pluginData = (await this.plugin.loadData() as Record<string, unknown>) || {};
            const matData = pluginData.materialLibrary;
            const jsonStr = JSON.stringify(matData, null, 2);
            const jsonBuf = new TextEncoder().encode(jsonStr);
            await provider.upload(this.remotePath('metadata.json'), jsonBuf, 'application/json');
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
