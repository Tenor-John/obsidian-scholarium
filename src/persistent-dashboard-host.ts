// @ts-nocheck -- Legacy JavaScript port pending incremental type migration.
/* global SCHOLARIUM_LOGO_DATA_URL, schNativeWeaverHost -- Bundled logo and native Weaver host used by the dashboard. */
/* Persistent native Weaver host and its scope-checked postMessage bridge. */
import {
  schVaultBridgePorts,
  schStartAndWaitLocalRuntime,
  schRuntimeExplain,
} from "./runtime-manager";



export function installPersistentDashboardHost(_t) {
/* Last-resort mount for the enabled `scholarium` plugin.  The working
 * Research Weaver application lives in the sibling development directory. */
queueMicrotask(() =>
  window.setTimeout(() => {
    const View = typeof _t === "undefined" ? null : _t;
    if (!View?.prototype || View.prototype.__activeZhiyanZheMount) return;
    const proto = View.prototype;
    proto.__activeZhiyanZheMount = true;
    // The shared local Weaver service can be embedded by multiple vaults. An
    // opaque, stable vault key keeps each iframe's browser-persisted chat and
    // workflow state separate without exposing the filesystem path in its URL.
    const vaultScope = (view) => {
      const value = String(view?.app?.vault?.adapter?.getBasePath?.() || view?.app?.vault?.name || "default");
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `v${(hash >>> 0).toString(36)}`;
    };
    // The OS assigns both ports to the processes that actually own them. This
    // avoids Windows excluded-port ranges and the TOCTOU window of probing a
    // free port and closing it before the child binds. The per-Vault scope is
    // still the identity boundary; ports are only ephemeral transport data.
    const vaultPorts = (view) => schVaultBridgePorts(view.app);
    const serviceUrl = (ports) => {
      if (!ports?.canvasPort) throw new Error("Scholarium runtime 尚未回报 canvas 端口");
      return `http://127.0.0.1:${ports.canvasPort}/`;
    };
    // Obsidian's own theme does not follow prefers-color-scheme, so the theme
    // is passed explicitly as a URL parameter and synced live via a class
    // observer on document.body (Obsidian flips theme-dark/theme-light there).
    const resolveTheme = () =>
      document.body.classList.contains("theme-light") ? "light" : "dark";
    if (!window.__zhiyanzheThemeSync) {
      window.__zhiyanzheThemeSync = true;
      let lastTheme = resolveTheme();
      new MutationObserver(() => {
        const theme = resolveTheme();
        if (theme === lastTheme) return;
        lastTheme = theme;
        document.querySelectorAll("iframe").forEach((frameEl) => {
          try {
            const u = new URL(frameEl.src);
            if (u.hostname !== "127.0.0.1") return;
            if (u.searchParams.get("theme") === theme) return;
            u.searchParams.set("theme", theme);
            u.searchParams.set("embedded", String(Date.now()));
            frameEl.src = u.toString();
          } catch (_) {
            /* ignore foreign frames */
          }
        });
      }).observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    const runtime =
      window.__zhiyanzheRuntime ||
      (window.__zhiyanzheRuntime = { startingByScope: new Map() });
    // Survive a plugin hot-reload from an older build which stored one
    // `starting` promise instead of the per-Vault map.
    runtime.startingByScope || (runtime.startingByScope = new Map());
    const health = async (url) => {
      const ctrl = new AbortController(),
        timer = window.setTimeout(() => ctrl.abort(), 1800);
      try {
        const response = await fetch(`${url}bridge/health`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      } finally {
        window.clearTimeout(timer);
      }
    };
    const ensure = async (view, ports) => {
      if (ports.canvasPort) {
        try {
          return await health(serviceUrl(ports));
        } catch (_) {
          /* stale pidfile or stopped runtime: start a fresh local runtime */
        }
      }
      if (runtime.startingByScope.has(ports.scope)) return runtime.startingByScope.get(ports.scope);
      const starting = schStartAndWaitLocalRuntime(view.plugin, ports, () => health(serviceUrl(ports)));
      runtime.startingByScope.set(ports.scope, starting);
      try {
        return await starting;
      } catch (error) {
        // 原样的 “Failed to fetch” 对用户没有意义：附上诊断和修复步骤。
        throw new Error(schRuntimeExplain(error));
      } finally {
        runtime.startingByScope.delete(ports.scope);
      }
    };
    // The original shared 4173 page still contains this Vault's pre-isolation
    // browser state.  Copy it once into the dedicated-port iframe without ever
    // deleting the source.  The two frames accept only explicit, scope-matched
    // messages from this Obsidian host; the destination also snapshots any
    // conflicting value before replacement.
    const recoverLegacyBrowserState = (view, targetFrame, url, ports) => {
      if (view.__weaverLegacyRecoveryAttempted) return;
      view.__weaverLegacyRecoveryAttempted = true;
      const sourceOrigin = "http://127.0.0.1:4173";
      const targetOrigin = new URL(url).origin;
      const requestId = `legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const source = document.createElement("iframe");
      source.setAttribute("aria-hidden", "true");
      source.tabIndex = -1;
      source.addClass("sch-legacy-recovery-source");
      let timer;
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        source.remove();
      };
      const onMessage = (event) => {
        const data = event.data || {};
        if (data.requestId !== requestId || data.scope !== ports.scope) return;
        if (event.source === source.contentWindow && event.origin === sourceOrigin && data.type === "weaver:vault-state-export") {
          targetFrame.contentWindow?.postMessage({
            type: "weaver:import-vault-state",
            requestId,
            scope: ports.scope,
            entries: Array.isArray(data.entries) ? data.entries : [],
          }, targetOrigin);
          return;
        }
        if (event.source === targetFrame.contentWindow && event.origin === targetOrigin && data.type === "weaver:vault-state-imported") cleanup();
      };
      window.addEventListener("message", onMessage);
      timer = window.setTimeout(cleanup, 15000);
      source.addEventListener("load", () => {
        source.contentWindow?.postMessage({ type: "weaver:export-vault-state", requestId, scope: ports.scope }, sourceOrigin);
      }, { once: true });
      source.src = `${sourceOrigin}/?restore=${Date.now()}&vault=${ports.scope}&legacy=1`;
      document.body.appendChild(source);
    };
    const originalBrandBar = proto.renderBrandBar;
    proto.renderBrandBar = function (container) {
      originalBrandBar.call(this, container);
      const tab = [...container.querySelectorAll("button")].find((button) =>
        /研究推演室|Research deduction|织研者/.test(button.textContent || ""),
      );
      if (tab) {
        tab.textContent = "";
        const logo = document.createElement("img");
        logo.src = SCHOLARIUM_LOGO_DATA_URL;
        logo.alt = "织研者";
        logo.classList.add("sch-brandbar-logo-img");
        tab.appendChild(logo);
        tab.appendChild(document.createTextNode("织研者"));
        tab.setAttribute("title", "织研者：Agent、WebVPN 与文献 Pipeline");
      }
    };
    const originalRender = proto.render;
    proto.render = async function (...args) {
      const content = this.contentEl;
      content.addClass("scholarium-dashboard");
      // Both the native 织研者 and the legacy panels live in the same shell.
      /* SCHOLARIUM_UNIFIED_PANEL_FRAME_V1 */
      // Keeping the outer leaf flush prevents the two versions of the shared
      // Scholarium brand bar from moving by Obsidian's default content inset;
      // the persistent panels below provide the single, common inset instead.
      const weaverActive = this.activePanel === "deduction";
      content.toggleClass("sch-weaver-active", weaverActive);
      content.addClass("scholarium-persistent-content");
      this.plugin?.applyThemeAttributes?.(content);
      // Keep Weaver and the legacy Scholarium panels as two persistent sibling
      // hosts.  The old switchTab -> render -> content.empty chain destroyed the
      // iframe, which erased the tracker and, more seriously, killed the browser
      // orchestrator between two Bridge skill stages.  Switching panels now
      // only toggles visibility; the iframe and its live Pipeline stay mounted.
      let shell = this.__scholariumPersistentShell;
      if (!shell || !shell.isConnected || shell.parentElement !== content) {
        content.empty();
        shell = content.createDiv({ cls: "scholarium-persistent-shell" });
        shell.addClass("sch-persistent-shell-layout");
        this.__scholariumPersistentShell = shell;
        this.__scholariumLegacyHost = shell.createDiv({ cls: "scholarium-persistent-panel scholarium-legacy-host" });
        this.__scholariumWeaverHost = shell.createDiv({ cls: "scholarium-persistent-panel scholarium-weaver-host" });
        for (const host of [this.__scholariumLegacyHost, this.__scholariumWeaverHost]) {
          host.addClass("sch-persistent-panel-layout");
        }
      }

      const legacyHost = this.__scholariumLegacyHost;
      const weaverHost = this.__scholariumWeaverHost;
      window.__scholariumDashboardView = this;
      try { typeof schNativeWeaverHost !== "undefined" && schNativeWeaverHost.registerCommand(this.plugin); } catch (_) { /* commands are optional */ }
      if (this.activePanel !== "deduction") {
        weaverHost.setCssStyles({visibility: "hidden"});
        weaverHost.setCssStyles({pointerEvents: "none"});
        weaverHost.setCssStyles({zIndex: "0"});
        legacyHost.setCssStyles({visibility: "visible"});
        legacyHost.setCssStyles({pointerEvents: "auto"});
        legacyHost.setCssStyles({zIndex: "1"});
        // originalRender is written against this.contentEl. Redirect it into
        // the legacy sibling so its own empty() cannot touch the live iframe.
        const realContent = this.contentEl;
        this.contentEl = legacyHost;
        try { return await originalRender.apply(this, args); }
        finally { this.contentEl = realContent; }
      }

      legacyHost.setCssStyles({visibility: "hidden"});
      legacyHost.setCssStyles({pointerEvents: "none"});
      legacyHost.setCssStyles({zIndex: "0"});
      weaverHost.setCssStyles({visibility: "visible"});
      weaverHost.setCssStyles({pointerEvents: "auto"});
      weaverHost.setCssStyles({zIndex: "1"});
      /* SCHOLARIUM_NATIVE_WEAVER_HOOK_BEGIN */
      if (schNativeWeaverHost.render(this, weaverHost, { vaultPorts, ensure, serviceUrl })) return;
      /* SCHOLARIUM_NATIVE_WEAVER_HOOK_END */
      if (this.__weaverFrame && this.__weaverFrame.isConnected) return;

      weaverHost.empty();
      this.renderBrandBar(weaverHost);
      // Keep only Scholarium's global navigation.  The iframe owns the entire
      // remaining workspace, including its Agent/WebVPN/Pipeline toolbar.
      const main = weaverHost.createDiv({
        cls: "scholarium-main zhiyanzhe-fullscreen-host",
      });
      main.addClass("sch-weaver-legacy-main");
      const state = main.createSpan({ text: "正在连接织研者本地服务…" });
      // Keep the bootstrap state visible until the iframe has actually loaded.
      // If a portable install cannot find Node/start-local.js, hiding this node
      // leaves an about:blank iframe with no explanation.
      state.addClass("sch-weaver-connect-status");
      const frame = main.createEl("iframe", {
        attr: {
          src: "about:blank",
          title: "织研者研究任务平台",
          sandbox:
            "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads",
        },
      });
      // 供 postMessage 监听校验消息来源（上方 __scholariumWeaverMsgBound）。
      this.__weaverFrame = frame;
      frame.addClass("sch-weaver-frame-layout");
      state.setText("正在连接织研者本地服务…");
      try {
        const ports = vaultPorts(this);
        const info = await ensure(this, ports);
        const url = serviceUrl(ports);
        state.setText(
          info.executionEnabled
            ? "织研者已连接 · 可运行任务"
            : "织研者已启动 · 执行权限未开启",
        );
        state.setCssStyles({color: "var(--color-green)"});
        frame.addEventListener("load", () => {
          state.setCssStyles({display: "none"});
          recoverLegacyBrowserState(this, frame, url, ports);
        }, { once: true });
        frame.src = `${url}?embedded=${Date.now()}&theme=${resolveTheme()}&vault=${ports.scope}&legacy=1`;
      } catch (error) {
        state.setText(`织研者启动失败：${error.message}`);
        state.setCssStyles({color: "var(--color-orange)"});
        state.setCssStyles({display: "flex"});
      }
    };
    // 织研者 iframe → 宿主的跨源请求通道（iframe 与 Obsidian 不同源，只能
    // postMessage）。目前唯一消息类型：「在文献订阅窗口打开此页」（full
    // 车道失败卡的手动下载路线）。安全边界：只接受来自当前织研者 iframe
    // 的消息（event.source 比对 contentWindow），且仅放行 http(s) URL。
    if (!window.__scholariumWeaverMsgBound) {
      window.__scholariumWeaverMsgBound = true;
      window.addEventListener("message", (event) => {
        const view = window.__scholariumDashboardView;
        const frame = view && view.__weaverFrame;
        if (!frame || event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data) return;
        if (data.type === "scholarium:set-manual-download-queue") {
          let items = (Array.isArray(data.items) ? data.items : [])
            .slice(0, 100)
            .map((item) => ({
              id: String(item && item.id || "").slice(0, 240),
              title: String(item && item.title || "待下载论文").slice(0, 500),
              doi: String(item && item.doi || "").slice(0, 240),
              url: String(item && item.url || "").slice(0, 2000),
              reason: String(item && item.reason || "自动下载未成功").slice(0, 300),
              pipelineRunId: String(item && item.pipelineRunId || "").slice(0, 120),
              workspace: String(item && item.workspace || "").slice(0, 2000),
            }))
            .filter((item) => item.id && /^https?:\/\/\S+$/i.test(item.url));
          if (data.append === true) {
            const existing = Array.isArray(view.__manualDownloadQueue)
              ? view.__manualDownloadQueue
              : Array.isArray(view.rssBoard?.manualDownloadQueue) ? view.rssBoard.manualDownloadQueue : [];
            const merged = new Map();
            for (const item of [...items, ...existing]) if (item?.id && !merged.has(item.id)) merged.set(item.id, item);
            items = [...merged.values()].slice(0, 100);
          }
          view.__manualDownloadQueue = items;
          try {
            view.rssBoard?.setManualDownloadQueue(items);
            if (data.open === true) {
              view.switchTab?.("feeds");
              setTimeout(() => {
                try {
                  if (view.rssBoard) {
                    view.rssBoard.hubTab = "pipeline";
                    if (view.rssBoard.data) view.rssBoard.data.hubTab = "pipeline";
                    view.rssBoard.save?.();
                    view.rssBoard.rerender?.();
                  }
                } catch (error) {
                  console.error("[Scholarium] open manual-download queue failed", error);
                }
              }, 250);
            }
          } catch (error) {
            console.error("[Scholarium] set-manual-download-queue failed", error);
          }
          return;
        }
        if (data.type === "scholarium:open-vault-file") {
          const target = String(data.path || "").replace(/\\/g, "/");
          if (!target || target.startsWith("/") || /^[A-Za-z]:/.test(target) || target.includes("../") || !target.toLowerCase().endsWith(".md")) return;
          Promise.resolve(view.app?.workspace?.openLinkText?.(target, "", true))
            .catch((error) => console.error("[Scholarium] open-vault-file failed", error));
          return;
        }
        if (data.type !== "scholarium:open-direct-page") return;
        const target = String(data.url || "");
        if (!/^https?:\/\/\S+$/i.test(target)) return;
        try {
          view.switchTab?.("feeds");
        } catch (_) {
          return;
        }
        // 等文献订阅面板渲染完再让 board 打开页面（openDirectPage 内部会
        // 设 directWeb 并 rerender 出内置研究浏览器）。
        setTimeout(() => {
          try {
            if (Array.isArray(view.__manualDownloadQueue))
              view.rssBoard?.setManualDownloadQueue(view.__manualDownloadQueue, false);
            view.rssBoard?.openDirectPage(target, {
              title: String(data.title || "").slice(0, 500),
              doi: String(data.doi || "").slice(0, 240),
              manualQueueId: String(data.manualQueueId || "").slice(0, 240),
              targetWorkspace: String(data.workspace || "").slice(0, 2000),
            });
          } catch (error) {
            console.error("[Scholarium] open-direct-page failed", error);
          }
        }, 800);
      });
    }
    // The legacy tab marks selection with inline colours rather than an `active`
    // class, so match it by label and re-enter the panel unconditionally.
    const deductionTab = [...document.querySelectorAll("button")].find(
      (button) =>
        /研究推演室|Research deduction|织研者/.test(button.textContent || ""),
    );
    deductionTab?.click();
  }, 1200),
);
}
