// @ts-nocheck -- Legacy JavaScript port pending incremental type migration.
/* global schNativeWeaverHost -- Provided by the bundled native Weaver host for material anchors. */
/* Complete Material Library, including generated-plot discovery, folder import,
 * version ownership checks, safe deletion and all reviewed modal surfaces. */
import * as De from "obsidian";
import { schMaterialsRoot, schMaterialFolderFromPath, schMaterialSafeFolder } from "./folders";
import {
  schMaterialIsTiff,
  schMaterialNeedsNormalization,
  schMaterialOpenTiff,
  schMaterialPlotVersions,
  schOpenMaterialNormalization,
  schOpenMaterialWorkbench,
  installMaterialPlotting,
} from "./material-plotting";

var De = require("obsidian"),
  Il = {
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    svg: "image",
    webp: "image",
    bmp: "image",
    tif: "image",
    tiff: "image",
    xlsx: "spreadsheet",
    xls: "spreadsheet",
    csv: "spreadsheet",
    ods: "spreadsheet",
    tsv: "spreadsheet",
    pdf: "pdf",
    txt: "text",
    md: "text",
    json: "text",
    xml: "text",
    py: "text",
    js: "text",
    ts: "text",
    html: "text",
    zip: "archive",
    rar: "archive",
    "7z": "archive",
    tar: "archive",
    gz: "archive",
  },
  Ll = {
    image: "\u{1F5BC}\uFE0F",
    spreadsheet: "\u{1F4CA}",
    pdf: "\u{1F4D1}",
    text: "\u{1F4C4}",
    archive: "\u{1F5DC}\uFE0F",
    other: "\u{1F4CE}",
  },
  En = {
    image: "#29B6F6",
    spreadsheet: "#66BB6A",
    pdf: "#EF5350",
    text: "#78909C",
    archive: "#AB47BC",
    other: "#FF8A65",
  };
function Hi(o) {
  var t;
  return ((t = o.split(".").pop()) != null ? t : "").toLowerCase();
}
function es(o) {
  var t;
  return (t = Il[Hi(o)]) != null ? t : "other";
}
function Sn(o) {
  return Ll[es(o)];
}
function Ml() {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

var Vs = class {
    constructor(t, e) {
      this.app = t;
      this.plugin = e;
      this.data = { items: [], categories: [] };
      this.currentCategory = "all";
      this.searchText = "";
      this.viewMode = "grid";
      this.filteredItems = [];
      this.generatedItems = [];
      this.currentFolder = "all";
      this.selectedDataItemId = null;
      this.container = null;
      this.syncManager = null;
    }
    materialRoot() { return schMaterialsRoot(this.plugin); }
    setSyncManager(t) {
      this.syncManager = t;
    }
    async load() {
      try {
        let t = await this.plugin.loadData();
        if (t != null && t.materialLibrary) {
          let e = t.materialLibrary;
          this.data = { items: e.items || [], categories: e.categories || [], folders: e.folders || [] };
        } else this.data = { items: [], categories: [], folders: [] };
        await this.loadGeneratedImages();
      } catch (t) {
        console.error("[MaterialLibrary] \u52A0\u8F7D\u5931\u8D25:", t),
          (this.data = { items: [], categories: [], folders: [] });
      }
    }
    async loadGeneratedImages() {
      const registered = new Set(this.data.items.map((item) => item.path));
      const found = new Map();
      const root = this.materialRoot();
      const manifests = this.app.vault.getFiles().filter((file) => file.path.startsWith(root + "/_analysis/") && /\/plot-manifest\.json$/i.test(file.path));
      for (const manifestFile of manifests) {
        try {
          const manifest = JSON.parse(await this.app.vault.adapter.read(manifestFile.path));
          for (const output of manifest.outputs || []) {
            const file = this.app.vault.getAbstractFileByPath(output);
            if (file instanceof De.TFile && es(file.path) === "image" && !registered.has(file.path)) {
              const sourceName = String(manifest.source?.path || "").split("/").pop() || "未知数据源";
              const plotTitle = String(manifest.plot?.title || "生成图表");
              found.set(file.path, { id: `generated:${file.path}`, name: file.name, displayName: `${plotTitle} · ${sourceName}`, path: file.path, sourcePath: manifest.source?.path || "", manifestPath: manifestFile.path, manifest, category: "生成图表", addedAt: manifest.created_at || new Date(file.stat.mtime).toISOString(), generated: true });
            }
          }
        } catch (_) { /* Partial manifests are not previewable assets. */ }
      }
      this.generatedItems = Array.from(found.values()).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
    }
    allItems() {
      return this.data.items.slice();
    }
    plotsFor(item) {
      return item ? this.generatedItems.filter((plot) => plot.sourcePath === item.path) : [];
    }
    async save() {
      try {
        await this.plugin.updateData((t) => {
          t.materialLibrary = this.data;
        });
      } catch (t) {
        console.error("[MaterialLibrary] \u4FDD\u5B58\u5931\u8D25:", t);
      }
    }
    rerender() {
      this.container && this.render(this.container);
    }
    render(t) {
      (this.container = t), t.empty(), t.addClass("mat-root");
      let browser = t.createDiv({ cls: "mat-browser" }),
          hero = browser.createDiv({ cls: "mat-hero" }),
          heroLeft = hero.createDiv({ cls: "mat-hero-left" }),
          titleRow = heroLeft.createDiv({ cls: "mat-hero-title" });
      titleRow.replaceChildren(De.sanitizeHTMLToDom(String('<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" style="width:22px;height:22px;min-width:22px;min-height:22px;max-width:22px;max-height:22px;flex-shrink:0;display:inline-block;vertical-align:middle"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>素材库' ?? "")));
      heroLeft.createEl("div", {
        text: "集中管理 PDF / 图片 / 协议 / 数据文件，随云端同步",
        cls: "mat-hero-sub",
      });
      let chips = heroLeft.createDiv({ cls: "mat-hero-chips" }),
        allMaterialItems = this.allItems(),
        n = allMaterialItems.length,
        a = allMaterialItems.filter((C) => es(C.path) === "image").length,
        sp = allMaterialItems.filter((C) => es(C.path) === "spreadsheet").length,
        l = allMaterialItems.filter((C) => es(C.path) === "pdf").length;
      function makeChip(label, count, dotColor) {
        let c = chips.createDiv({ cls: "mat-stat-chip" });
        c.createDiv({ cls: "dot", attr: { style: "background:" + dotColor } });
        c.createSpan({ text: label });
        c.createSpan({ text: String(count), attr: { style: "margin-left:2px;font-weight:600" } });
        return c;
      }
      makeChip("全部", n, "var(--accent)");
      makeChip("图片", a, "var(--clr-image,#29B6F6)");
      makeChip("数据", sp, "var(--clr-spreadsheet,#66BB6A)");
      makeChip("图表", this.generatedItems.length, "#7C5CFC");
      makeChip("PDF", l, "var(--clr-pdf,#EF5350)");
      let p = browser.createDiv({ cls: "mat-toolbar" }),
        g = p
          .createDiv({ cls: "mat-search-wrap" })
          .createEl("input", {
            cls: "mat-search-input",
            attr: {
              placeholder: "搜索名称、分类、文件类型...",
              type: "text",
            },
          });
      g.value = this.searchText;
      let m = p.createDiv({ cls: "mat-view-toggle" }),
        v = m.createEl("button", { text: "\u229E", cls: "mat-view-btn" }),
        f = m.createEl("button", { text: "\u2630", cls: "mat-view-btn" });
      if (
        (this.viewMode === "grid" ? v.addClass("active") : f.addClass("active"),
        (v.onclick = () => {
          (this.viewMode = "grid"),
            v.addClass("active"),
            f.removeClass("active"),
            this.renderGallery(y);
        }),
        (f.onclick = () => {
          (this.viewMode = "list"),
            f.addClass("active"),
            v.removeClass("active"),
            this.renderGallery(y);
        }),
        p.createEl("button", { cls: "mat-add-btn" }).replaceChildren(De.sanitizeHTMLToDom(String('<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><path d="M12 5v14M5 12h14"/></svg><span>添加素材</span>' ?? ""))),
        p.querySelector(".mat-add-btn").onclick = () => this.showImportDialog(),
        p.createEl("button", { cls: "mat-folder-btn", text: "📁 新建文件夹", attr: { title: "在 Vault 与已配置网盘中建立素材文件夹" } }).onclick = () => this.showNewFolderDialog(),
        this.plugin.settings.cloudProvider !== "none")
      ) {
        let C = p.createEl("button", {
          text: "\u2601\uFE0F \u540C\u6B65",
          cls: "mat-sync-btn",
        });
        C.onclick = async () => {
          var k;
          (C.textContent = "\u23F3 \u540C\u6B65\u4E2D\u2026"),
            (C.disabled = !0);
          let S = await ((k = this.syncManager) == null
            ? void 0
            : k.fullSync());
          (C.disabled = !1),
            S != null && S.success
              ? ((C.textContent = `\u2705 ${S.uploaded}\u2191 ${S.downloaded}\u2193`),
                setTimeout(() => {
                  C.textContent = "\u2601\uFE0F \u540C\u6B65";
                }, 3e3))
              : ((C.textContent = "\u274C \u5931\u8D25"),
                setTimeout(() => {
                  C.textContent = "\u2601\uFE0F \u540C\u6B65";
                }, 3e3));
        };
      }
      let w = browser.createDiv({ cls: "mat-main" }),
        b = w.createDiv({ cls: "mat-sidebar" }),
        contentSplit = w.createDiv({ cls: "mat-content-split" }),
        y = contentSplit.createDiv({ cls: "mat-gallery" });
      this.galleryHost = y;
      this.detailHost = contentSplit.createDiv({ cls: "mat-data-detail" });
      g.addEventListener("input", () => {
        (this.searchText = g.value), this.renderGallery(y);
      }),
        this.renderSidebar(b, y),
        this.renderGallery(y);
      this.workbenchHost = t.createDiv({ cls: "mat-workbench", attr: { "aria-label": "素材工作台" } });
    }
    renderSidebar(t, e) {
      t.empty();
      t.createDiv({ cls: "mat-sb-section-label", text: "文件夹" });
      let catColors = ["#FF7043","#42A5F5","#66BB6A","#AB47BC","#29B6F6","#EC407A","#FF8A65","#4DB6AC"];
      let getColor = (name, idx) => catColors[idx % catColors.length];
      let s = (n, a, l, colorIdx, onSelect = null) => {
        let c = t.createDiv({ cls: "mat-sb-item" });
        ((a.startsWith("__folder__:") && this.currentFolder === a.slice(11)) || (a === "all" && this.currentFolder === "all" && this.currentCategory === "all") || (!a.startsWith("__folder__:") && a !== "all" && this.currentCategory === a)) && c.addClass("active");
        let bar = c.createDiv({ cls: "mat-sb-bar", attr: { style: "background:" + getColor(a, colorIdx) } });
        let dot = c.createDiv({ cls: "mat-sb-dot", attr: { style: "background:" + getColor(a, colorIdx) } });
        let label = n.startsWith("\u{1F4C1}") ? n.replace(/^📁\s*/, "") : n;
        c.createEl("span", { text: label, cls: "mat-sb-label" }),
          c.createEl("span", { text: String(l), cls: "mat-sb-count" });
        return (
          (c.onclick = () => {
            t
              .querySelectorAll(".mat-sb-item")
              .forEach((u) => u.removeClass("active")),
              c.addClass("active"),
              onSelect ? onSelect() : ((this.currentFolder = "all"), (this.currentCategory = a)),
              this.renderGallery(e);
          }),
          c
        );
      };
      s("\u{1F4C1} \u5168\u90E8", "all", this.allItems().length, 0, () => { this.currentFolder = "all"; this.currentCategory = "all"; });
      const folders = new Set(this.data.folders || []);
      const root = this.materialRoot();
      this.data.items.forEach((item) => { const folder = schMaterialFolderFromPath(item.path, root); folder && !folder.startsWith("_analysis") && folders.add(folder); });
      let folderIndex = 1;
      for (const folder of Array.from(folders).sort((a, b) => a.localeCompare(b))) {
        const count = this.data.items.filter((item) => schMaterialFolderFromPath(item.path, root) === folder).length;
        const row = s(`📁 ${folder}`, `__folder__:${folder}`, count, folderIndex++, () => { this.currentFolder = folder; this.currentCategory = "all"; });
        row.addEventListener("dragover", (event) => { event.preventDefault(); row.addClass("mat-folder-drop-target"); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; });
        row.addEventListener("dragleave", () => row.removeClass("mat-folder-drop-target"));
        row.addEventListener("drop", async (event) => {
          event.preventDefault(); event.stopPropagation(); row.removeClass("mat-folder-drop-target");
          const id = event.dataTransfer?.getData("application/x-scholarium-material");
          const item = this.data.items.find((entry) => entry.id === id);
          if (item) await this.moveItemToFolder(item, folder);
          else for (const file of Array.from(event.dataTransfer?.files || [])) await this.handleDroppedFile(file, folder);
        });
      }
      t.createEl("button", { text: "+ 新建文件夹", cls: "mat-sb-add mat-sb-folder-add" }).onclick = () => this.showNewFolderDialog();
      t.createDiv({ cls: "mat-sb-divider" });
      t.createDiv({ cls: "mat-sb-section-label", text: "标签分类" });
      let ci = 1;
      for (let n of this.data.categories) {
        let a = this.data.items.filter((c) => c.category === n).length,
          l = s(`\u{1F4C1} ${n}`, n, a, ci);
        l.addEventListener("contextmenu", (c) => {
          c.preventDefault(), this.showCategoryMenu(l, n, t, e);
        });
        ci++;
      }
      let i = this.data.items.filter((n) => !n.category).length;
      i > 0 && s("\u{1F4C1} \u672A\u5206\u7C7B", "__uncategorized__", i, ci),
        t.createDiv({ cls: "mat-sb-divider" });
      let r = t.createEl("button", {
        text: "+ \u65B0\u5EFA\u5206\u7C7B",
        cls: "mat-sb-add",
      });
      r.onclick = () => this.showNewCategoryDialog(t, e);
    }
    renderGallery(t) {
      t.empty(), t.addClass("mat-gallery");
      let e = this.allItems();
      if (
        (this.currentFolder !== "all" &&
          (e = e.filter((item) => !item.generated && schMaterialFolderFromPath(item.path, this.materialRoot()) === this.currentFolder)),
        this.currentCategory !== "all" &&
          (this.currentCategory === "__uncategorized__"
            ? (e = e.filter((i) => !i.category))
            : (e = e.filter((i) => i.category === this.currentCategory))),
        this.searchText)
      ) {
        let i = this.searchText.toLowerCase();
        e = e.filter(
          (r) =>
            String(r.name || "").toLowerCase().includes(i) ||
            String(r.category || "").toLowerCase().includes(i) ||
            String(r.path || "").toLowerCase().includes(i),
        );
      }
      if (((this.filteredItems = e), this.setupDragDrop(t), e.length === 0)) {
        let i = t.createDiv({ cls: "mat-empty" });
        i.createEl("div", { cls: "mat-empty-icon", text: "\u{1F4C2}" }),
          i.createEl("p", {
            text: "\u5C06\u6587\u4EF6\u62D6\u5165\u6B64\u5904",
          }),
          i.createEl("p", {
            cls: "mat-empty-hint",
            text: "\u652F\u6301\u56FE\u7247\u3001CSV\u3001Excel\u3001TXT\u3001PDF \u7B49\u6240\u6709\u683C\u5F0F",
          });
        this.renderDataPlotPanel();
        return;
      }
      let s = t.createDiv({
        cls: `mat-grid ${this.viewMode === "grid" ? "mat-grid-mode" : "mat-list-mode"}`,
      });
      for (let i of e) this.createCard(s, i);
      this.renderDataPlotPanel();
    }
    createCard(t, e) {
      const relatedPlots = this.plotsFor(e);
      const latestPlot = relatedPlots[0];
      let s = t.createDiv({ cls: `mat-card${this.selectedDataItemId === e.id ? " mat-card-selected" : ""}`, attr: { "data-type": es(e.path), draggable: "true", "data-sch-anchor": "sch:material/items/" + (typeof schNativeWeaverHost !== "undefined" && schNativeWeaverHost.escapeAnchorPart ? schNativeWeaverHost.escapeAnchorPart(String(e.id)) : encodeURIComponent(String(e.id))), title: "Alt+点击：把这条素材发给织研者" } }),
        i = es(e.path),
        r = this.app.vault.getAbstractFileByPath(e.path),
        n = s.createDiv({ cls: "mat-card-thumb" });
      {
        s.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("application/x-scholarium-material", e.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          s.addClass("mat-card-dragging");
        });
        s.addEventListener("dragend", () => s.removeClass("mat-card-dragging"));
      }
      if (((i === "image" && !schMaterialIsTiff(e)) || (i === "spreadsheet" && latestPlot)) && r instanceof De.TFile) {
        const previewFile = latestPlot ? this.app.vault.getAbstractFileByPath(latestPlot.path) : r;
        let g = previewFile instanceof De.TFile ? this.app.vault.getResourcePath(previewFile) : "";
        n.createEl("img", {
          cls: "mat-card-img",
          attr: { src: g, alt: latestPlot?.displayName || e.name },
        });
        if (latestPlot) n.createEl("span", { cls: "mat-card-plot-count", text: `${relatedPlots.length} 张图` });
      } else {
        n.addClass("mat-card-file-thumb");
        let kindColor = En[i] || En.other;
        n.style.setProperty("--kind-color", kindColor);
        n.style.background = "linear-gradient(135deg, color-mix(in srgb, " + kindColor + " 8%, var(--bg-panel, #F2F1EE)), var(--bg-panel, #F2F1EE))";
        n.style.color = kindColor;
        n.createDiv({ cls: "bg-pattern" });
        let iconWrap = n.createDiv({ cls: "mat-card-file-icon", attr: { style: "background:color-mix(in srgb," + kindColor + " 14%,transparent)" } });
        let svgMap = {
          spreadsheet: '<svg viewBox="0 0 24 24" stroke="' + kindColor + '" fill="none" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
          pdf: '<svg viewBox="0 0 24 24" stroke="' + kindColor + '" fill="none" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
          text: '<svg viewBox="0 0 24 24" stroke="' + kindColor + '" fill="none" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
          archive: '<svg viewBox="0 0 24 24" stroke="' + kindColor + '" fill="none" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
          image: '<svg viewBox="0 0 24 24" stroke="' + kindColor + '" fill="none" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
        };
        iconWrap.replaceChildren(De.sanitizeHTMLToDom(String((svgMap[i] || svgMap.text) ?? "")));
        n.createEl("div", {
          text: Hi(e.path).toUpperCase(),
          cls: "mat-card-file-ext",
          attr: { style: "color:" + kindColor },
        });
        n.createEl("div", {
          text: r instanceof De.TFile ? r.name : String(e.path || "").split("/").pop() || e.name,
          cls: "mat-card-file-name",
          attr: { title: r instanceof De.TFile ? r.name : e.name },
        });
      }
      let l = n
          .createDiv({ cls: "mat-card-overlay" })
          .createDiv({ cls: "mat-card-actions" }),
        c = l.createEl("button", {
          text: schMaterialIsTiff(e) ? "↗" : i === "image" ? "\u{1F50D}" : i === "spreadsheet" ? "📊" : "ℹ",
          cls: "mat-action-btn",
          attr: {
            title: schMaterialIsTiff(e) ? "用系统默认程序打开 TIFF" : i === "image" ? "放大预览" : i === "spreadsheet" ? "查看关联图表" : "文件信息",
          },
        });
      c.onclick = async (g) => {
        if ((g.stopPropagation(), schMaterialIsTiff(e))) {
          await schMaterialOpenTiff(this.app, e.path);
        } else if (i === "image") {
          let m = this.filteredItems.indexOf(e);
          this.showLightbox(this.filteredItems, m);
        } else if (i === "spreadsheet") this.selectDataItem(e);
        else new De.Notice(e.path);
      };
      let copy = l.createEl("button", { text: "⧉", cls: "mat-action-btn", attr: { title: "复制文件地址" } });
      copy.onclick = (event) => { event.stopPropagation(); this.copyFileAddress(e.path); };
      {
      let h = l.createEl("button", {
        text: "\u270F\uFE0F",
        cls: "mat-action-btn",
        attr: { title: "\u6539\u540D" },
      });
      h.onclick = (g) => {
        g.stopPropagation(), this.showRenameDialog(e);
      };
      let d = l.createEl("button", {
        text: "\u{1F4C1}",
        cls: "mat-action-btn",
        attr: { title: "移动到文件夹" },
      });
      d.onclick = (g) => {
        g.stopPropagation(), this.showMoveFolderDialog(e);
      };
      let del = l.createEl("button", {
        text: "\u{1F5D1}\uFE0F",
        cls: "mat-action-btn",
        attr: { title: "\u5220\u9664" },
      });
      del.onclick = (g) => {
        g.stopPropagation(), this.deleteItem(e);
      };
      }
      let u = s.createDiv({ cls: "mat-card-info" });
      u.createEl("div", {
        text: r instanceof De.TFile ? r.name : String(e.path || "").split("/").pop() || e.name,
        cls: "mat-card-name",
        attr: { title: r instanceof De.TFile ? r.name : e.name },
      });
      const displayName = e.name && r instanceof De.TFile && e.name !== r.name ? e.name : "";
      if (displayName)
        u.createEl("div", { text: displayName, cls: "mat-card-display-name", attr: { title: `素材说明：${displayName}` } });
      u.createEl("div", { text: e.path, cls: "mat-card-path", attr: { title: e.path } });
      let meta = u.createDiv({ cls: "mat-card-meta" });
      if (e.category) {
        let badge = meta.createEl("span", { text: e.category, cls: "mat-badge" });
        let catCol = this.catColor(e.category);
        badge.setCssStyles({ background: "color-mix(in srgb, " + catCol + " 15%, transparent)", color: catCol });
      }
      if (e.addedAt) {
        let dt = new Date(e.addedAt);
        let mm = String(dt.getMonth() + 1).padStart(2, "0");
        let dd = String(dt.getDate()).padStart(2, "0");
        meta.createEl("span", { text: mm + "-" + dd, cls: "mat-card-date" });
      }
      if (r instanceof De.TFile) {
        let sz = r.stat.size;
        let szStr = sz < 1024 ? sz + " B" : sz < 1048576 ? (sz / 1024).toFixed(1) + " KB" : (sz / 1048576).toFixed(1) + " MB";
        meta.createEl("span", { text: szStr, cls: "mat-card-size" });
      }
      if (i === "spreadsheet") s.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!(target && target.closest("button"))) this.selectDataItem(e);
      });
      if (schMaterialIsTiff(e)) s.addEventListener("click", async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!(target && target.closest("button"))) await schMaterialOpenTiff(this.app, e.path);
      });
    }
    selectDataItem(item) {
      this.selectedDataItemId = item.id;
      if (this.galleryHost) this.renderGallery(this.galleryHost);
      else this.renderDataPlotPanel();
    }
    renderDataPlotPanel() {
      const host = this.detailHost;
      if (!host) return;
      host.empty();
      const item = this.data.items.find((entry) => entry.id === this.selectedDataItemId && es(entry.path) === "spreadsheet");
      host.classList.toggle("mat-data-detail-open", !!item);
      if (!item) return;
      const plots = this.plotsFor(item);
      const file = this.app.vault.getAbstractFileByPath(item.path);
      const head = host.createDiv({ cls: "mat-data-detail-head" });
      const headCopy = head.createDiv({ cls: "mat-data-detail-title" });
      headCopy.createEl("strong", { text: file instanceof De.TFile ? file.name : item.name });
      headCopy.createEl("span", { text: `${plots.length} 个图表版本 · ${item.path}` });
      const close = head.createEl("button", { text: "✕", cls: "mat-data-detail-close", attr: { title: "关闭图表列表" } });
      close.onclick = () => { this.selectedDataItemId = null; this.renderGallery(this.galleryHost); };
      if (schMaterialNeedsNormalization(item)) {
        const empty = host.createDiv({ cls: "mat-data-detail-empty" });
        empty.createEl("strong", { text: "此文件需先规范化为 CSV" });
        empty.createEl("span", { text: "工作簿不会直接绘图：选哪个工作表、哪一行当表头、公式取缓存值还是保留公式，都是必须留痕的决定。先生成带源哈希的 UTF-8 CSV，再由你明确打开绘图。" });
        const normalize = empty.createEl("button", { text: "选择工作表并规范化", cls: "mod-cta" });
        normalize.onclick = () => schOpenMaterialNormalization(this, item);
        return;
      }
      if (!plots.length) {
        const empty = host.createDiv({ cls: "mat-data-detail-empty" });
        empty.createEl("strong", { text: "这个数据还没有生成图表" });
        empty.createEl("span", { text: "点击数据卡片上的绘图按钮进入画图面板。" });
        const draw = empty.createEl("button", { text: "开始绘图", cls: "mod-cta" });
        draw.onclick = () => schOpenMaterialWorkbench(this, item);
        return;
      }
      const list = host.createDiv({ cls: "mat-data-plot-list" });
      plots.forEach((plot, index) => {
        const card = list.createDiv({ cls: "mat-data-plot-card" });
        const imageWrap = card.createDiv({ cls: "mat-data-plot-image" });
        const imageFile = this.app.vault.getAbstractFileByPath(plot.path);
        if (imageFile instanceof De.TFile)
          imageWrap.createEl("img", { attr: { src: this.app.vault.getResourcePath(imageFile), alt: plot.displayName } });
        imageWrap.onclick = () => this.showLightbox(plots, index);
        const body = card.createDiv({ cls: "mat-data-plot-body" });
        body.createEl("strong", { text: String(plot.manifest?.plot?.title || plot.name) });
        body.createEl("span", { text: `${String(plot.addedAt || "").replace("T", " ").slice(0, 19)} · ${plot.name}` });
        body.createEl("code", { text: plot.path, attr: { title: plot.path } });
        const actions = card.createDiv({ cls: "mat-data-plot-actions" });
        actions.createEl("button", { text: "放大" }).onclick = () => this.showLightbox(plots, index);
        actions.createEl("button", { text: "修改" }).onclick = () => schOpenMaterialWorkbench(this, item, { file: plot.manifestPath, manifest: plot.manifest });
        actions.createEl("button", { text: "复制地址" }).onclick = () => this.copyFileAddress(plot.path);
        const remove = actions.createEl("button", { text: "删除", cls: "mat-data-plot-delete" });
        remove.onclick = () => this.deleteGeneratedVersion(item, plot);
      });
    }
    async deleteGeneratedVersion(item, plot) {
      const manifestPath = String(plot.manifestPath || "").replace(/\\/g, "/");
      const dirPath = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
      const materialRoot = this.materialRoot();
      if (!manifestPath.startsWith(materialRoot + "/_analysis/") || !manifestPath.endsWith("/plot-manifest.json") || plot.manifest?.source?.path !== item.path) {
        new De.Notice("❌ 无法验证该图表版本的归属，已拒绝删除");
        return;
      }
      if (!confirm(`删除图表版本“${plot.manifest?.plot?.title || plot.name}”？\n\n${dirPath}\n\n原始数据不会删除。`)) return;
      try {
        const target = this.app.vault.getAbstractFileByPath(dirPath);
        if (!(target instanceof De.TFolder) || !target.path.startsWith(materialRoot + "/_analysis/")) throw new Error("图表版本目录不存在或越界");
        const remotePaths = Array.from(new Set([...(plot.manifest?.outputs || []), manifestPath]));
        if (typeof this.app.vault.trash === "function") await this.app.vault.trash(target, true);
        else await this.app.vault.delete(target, true);
        let cloudMessage = "";
        if (this.syncManager && this.plugin.settings.cloudProvider !== "none") {
          try { await this.syncManager.deletePaths(remotePaths); cloudMessage = "，网盘副本已删除"; }
          catch (error) { cloudMessage = `；但网盘删除失败：${error.message || error}`; }
        }
        await this.loadGeneratedImages();
        this.renderGallery(this.galleryHost);
        new De.Notice(`✅ 图表版本已删除${cloudMessage}；原始数据未改动`);
      } catch (error) { new De.Notice(`❌ 删除图表失败：${error.message || error}`); }
    }
    setupDragDrop(t) {
      let e = 0;
      t.addEventListener("dragenter", (s) => {
        s.preventDefault(), e++, t.addClass("mat-drag-over");
      }),
        t.addEventListener("dragover", (s) => {
          s.preventDefault(),
            s.dataTransfer && (s.dataTransfer.dropEffect = "copy");
        }),
        t.addEventListener("dragleave", () => {
          e--, e <= 0 && ((e = 0), t.removeClass("mat-drag-over"));
        }),
        t.addEventListener("drop", async (s) => {
          var r, n;
          s.preventDefault(), (e = 0), t.removeClass("mat-drag-over");
          let i = Array.from(
            (n = (r = s.dataTransfer) == null ? void 0 : r.files) != null
              ? n
              : [],
          );
          if (i.length !== 0) for (let a of i) await this.handleDroppedFile(a, this.currentFolder === "all" ? "" : this.currentFolder);
        });
    }
    async copyMaterialFile(t, folder = "") {
      folder = schMaterialSafeFolder(folder);
      const targetRoot = folder ? `${this.materialRoot()}/${folder}` : this.materialRoot();
      await this.ensureVaultFolder(targetRoot);
      let bytes = await t.arrayBuffer(),
        target = `${targetRoot}/${t.name}`,
        index = 1;
      for (; this.app.vault.getAbstractFileByPath(target); ) {
        let dot = t.name.lastIndexOf("."),
          stem = dot >= 0 ? t.name.slice(0, dot) : t.name,
          extension = dot >= 0 ? t.name.slice(dot) : "";
        target = `${targetRoot}/${stem}_${index}${extension}`;
        index++;
      }
      await this.app.vault.createBinary(target, bytes);
      if (this.syncManager && this.plugin.settings.cloudAutoSync) {
        this.syncManager.uploadFile(target).catch((error) => console.warn("[CloudSync]", error));
      }
      return target;
    }
    async handleDroppedFile(t, folder = "", category = "") {
      try {
        const path = await this.copyMaterialFile(t, folder);
        // The category chosen in the import dialog pre-fills the detail form,
        // so the single-file path records the same thing the folder path does.
        this.showAddDialog(t, path, category);
      } catch (e) {
        console.error("[MaterialLibrary] \u4E0A\u4F20\u5931\u8D25:", e),
          new De.Notice(
            "\u274C \u6587\u4EF6\u4E0A\u4F20\u5931\u8D25\uFF1A" + e.message,
          );
      }
    }
    async importMaterialFolder(files, destination = "", category = "") {
      const imported = [];
      for (const file of Array.from(files || [])) {
        const relative = String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/");
        const parts = relative.split("/").filter((part) => part && part !== "." && part !== "..");
        if (!parts.length) continue;
        const folder = schMaterialSafeFolder([destination, ...parts.slice(0, -1)].filter(Boolean).join("/"));
        const path = await this.copyMaterialFile(file, folder);
        imported.push({ file, path });
      }
      if (!imported.length) return;
      for (const { file, path } of imported) {
        const dot = String(file.name || "").lastIndexOf(".");
        this.data.items.push({
          id: Ml(), path, name: dot > 0 ? file.name.slice(0, dot) : file.name,
          // Carried from the import dialog rather than left blank: the category
          // is what chose the destination folder, so recording it keeps the two
          // consistent instead of requiring a second pass to tag everything.
          category: String(category || ""), addedAt: new Date().toISOString(),
        });
      }
      if (category && !(this.data.categories || []).includes(category)) {
        this.data.categories = [...(this.data.categories || []), category];
      }
      await this.save();
      this.rerender();
      new De.Notice(`✅ 已添加 ${imported.length} 个素材文件；文件夹结构已保留。`);
    }
    showImportDialog() {
      const modal = new De.Modal(this.app);
      modal.onOpen = () => {
        const root = modal.contentEl;
        root.empty(); root.addClass("mat-modal");
        root.createEl("h2", { text: "添加素材", cls: "mat-modal-title" });
        root.createEl("p", { text: "选择单个文件会继续显示名称与分类；选择文件夹会保留子目录并以默认分类批量加入素材库。", cls: "setting-item-description" });
        root.createEl("label", { text: "分类", cls: "mat-modal-label" });
        const category = root.createEl("select", { cls: "mat-modal-select", attr: { "aria-label": "选择素材分类" } });
        category.createEl("option", { text: "不分类", attr: { value: "" } });
        Array.from(new Set(this.data.categories || [])).sort().forEach((name) => category.createEl("option", { text: name, attr: { value: name } }));
        root.createEl("label", { text: "导入到素材文件夹", cls: "mat-modal-label" });
        const destination = root.createEl("select", { cls: "mat-modal-select", attr: { "aria-label": "选择素材导入文件夹" } });
        const destinationHint = root.createEl("p", { cls: "setting-item-description" });
        const rebuildDestinations = () => {
          const keep = destination.value;
          destination.empty();
          destination.createEl("option", { text: `${this.materialRoot()} 根目录`, attr: { value: "" } });
          // The chosen category is offered as a destination even when no such
          // folder exists yet, so "which category" and "where the file lives"
          // stop being two unrelated facts about the same material.
          const folders = new Set(this.data.folders || []);
          if (category.value) folders.add(category.value);
          Array.from(folders).sort().forEach((folder) => destination.createEl("option", { text: folder, attr: { value: folder } }));
          destination.value = keep;
        };
        rebuildDestinations();
        if (this.currentFolder && this.currentFolder !== "all") destination.value = this.currentFolder;
        const syncDestination = (followCategory) => {
          rebuildDestinations();
          if (followCategory && category.value) destination.value = category.value;
          const exists = (this.data.folders || []).includes(destination.value);
          destinationHint.setText(
            !destination.value
              ? "文件会放在素材根目录。"
              : exists
                ? `文件会放在 ${this.materialRoot()}/${destination.value}/。`
                : `将新建 ${this.materialRoot()}/${destination.value}/ 并把文件放进去。`,
          );
        };
        category.onchange = () => syncDestination(true);
        destination.onchange = () => syncDestination(false);
        syncDestination(true);
        const actions = root.createDiv({ cls: "mat-modal-actions" });
        actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
        const choose = (directory) => {
          const input = document.createElement("input");
          input.type = "file";
          if (directory) {
            input.multiple = true;
            input.setAttribute("webkitdirectory", "");
            input.setAttribute("directory", "");
          }
          input.onchange = async () => {
            const files = Array.from(input.files || []);
            if (!files.length) return;
            try {
              if (directory) await this.importMaterialFolder(files, destination.value, category.value);
              else await this.handleDroppedFile(files[0], destination.value, category.value);
              modal.close();
            } catch (error) {
              new De.Notice(`❌ 添加素材失败：${error?.message || error}`);
            }
          };
          input.click();
        };
        actions.createEl("button", { text: "选择文件", cls: "mod-cta" }).onclick = () => choose(false);
        actions.createEl("button", { text: "选择文件夹" }).onclick = () => choose(true);
      };
      modal.onClose = () => modal.contentEl.empty();
      modal.open();
    }
    showAddDialog(t, e, presetCategory = "") {
      new Ri(this.app, t, e, this.data, async (s) => {
        this.data.items.push(s),
          s.category &&
            !this.data.categories.includes(s.category) &&
            this.data.categories.push(s.category),
          await this.save(),
          new De.Notice("\u2705 \u7D20\u6750\u5DF2\u6DFB\u52A0"),
          this.rerender();
      }, presetCategory).open();
    }
    showRenameDialog(t) {
      new $i(this.app, t, async (e) => {
        (t.name = e), await this.save(), this.rerender();
      }).open();
    }
    showMoveCategoryDialog(t) {
      new _i(this.app, t, this.data.categories, async (e) => {
        (t.category = e), await this.save(), this.rerender();
      }).open();
    }
    async ensureVaultFolder(path) {
      let current = "";
      for (const part of String(path).split("/").filter(Boolean)) {
        current = current ? `${current}/${part}` : part;
        const existing = this.app.vault.getAbstractFileByPath(current);
        if (existing && !(existing instanceof De.TFolder)) throw new Error(`${current} 已存在且不是文件夹`);
        if (!existing) await this.app.vault.createFolder(current);
      }
    }
    copyFileAddress(path) {
      const base = this.app.vault.adapter.getBasePath?.();
      const value = base ? `${String(base).replace(/[\\/]$/, "")}\\${String(path).replace(/\//g, "\\")}` : path;
      try {
        const write = navigator.clipboard?.writeText?.(value);
        if (!write) throw new Error("clipboard unavailable");
        write.then(() => new De.Notice(`已复制文件地址：${value}`)).catch(() => new De.Notice(`复制失败，请手动复制：${value}`));
      } catch (_) { new De.Notice(`复制失败，请手动复制：${value}`); }
    }
    showNewFolderDialog() {
      const modal = new De.Modal(this.app);
      modal.onOpen = () => {
        const root = modal.contentEl; root.empty(); root.addClass("mat-modal");
        root.createEl("h2", { text: "新建素材文件夹", cls: "mat-modal-title" });
        root.createEl("p", { text: `将在 Vault 的 ${this.materialRoot()} 下创建；已配置网盘时同步创建对应目录。支持用 / 建立子目录。`, cls: "setting-item-description" });
        const input = root.createEl("input", { cls: "mat-modal-input", attr: { type: "text", placeholder: "例如：HPLC/2026-08" } });
        const actions = root.createDiv({ cls: "mat-modal-actions" });
        actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
        const create = actions.createEl("button", { text: "创建文件夹", cls: "mod-cta" });
        const submit = async () => {
          try {
            const folder = schMaterialSafeFolder(input.value);
            if (!folder) throw new Error("请输入文件夹名称");
            create.disabled = true;
            await this.ensureVaultFolder(`${this.materialRoot()}/${folder}`);
            this.data.folders ||= [];
            if (!this.data.folders.includes(folder)) this.data.folders.push(folder);
            await this.save();
            let cloudMessage = "";
            if (this.syncManager && this.plugin.settings.cloudProvider !== "none") {
              try { await this.syncManager.ensureFolder(`${this.materialRoot()}/${folder}`); cloudMessage = "，网盘目录已创建"; }
              catch (error) { cloudMessage = `；但网盘创建失败：${error.message || error}`; }
            }
            modal.close(); this.rerender(); new De.Notice(`✅ 文件夹 ${this.materialRoot()}/${folder} 已创建${cloudMessage}`);
          } catch (error) { create.disabled = false; new De.Notice(`❌ ${error.message || error}`); }
        };
        create.onclick = submit;
        input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
        input.focus();
      };
      modal.onClose = () => modal.contentEl.empty();
      modal.open();
    }
    showMoveFolderDialog(item) {
      const modal = new De.Modal(this.app);
      modal.onOpen = () => {
        const root = modal.contentEl; root.empty(); root.addClass("mat-modal");
        root.createEl("h2", { text: "移动到文件夹", cls: "mat-modal-title" });
        root.createEl("p", { text: this.app.vault.getAbstractFileByPath(item.path)?.name || item.name, cls: "setting-item-description" });
        const select = root.createEl("select", { cls: "mat-modal-select" });
        select.createEl("option", { text: `${this.materialRoot()} 根目录`, attr: { value: "" } });
        Array.from(new Set(this.data.folders || [])).sort().forEach((folder) => select.createEl("option", { text: folder, attr: { value: folder } }));
        const actions = root.createDiv({ cls: "mat-modal-actions" });
        actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
        actions.createEl("button", { text: "移动", cls: "mod-cta" }).onclick = async () => { modal.close(); await this.moveItemToFolder(item, select.value); };
      };
      modal.onClose = () => modal.contentEl.empty(); modal.open();
    }
    async moveItemToFolder(item, folder) {
      try {
        folder = schMaterialSafeFolder(folder);
        const file = this.app.vault.getAbstractFileByPath(item.path);
        if (!(file instanceof De.TFile)) throw new Error("源文件不存在");
        const targetRoot = folder ? `${this.materialRoot()}/${folder}` : this.materialRoot();
        await this.ensureVaultFolder(targetRoot);
        const targetPath = `${targetRoot}/${file.name}`;
        if (targetPath === item.path) return;
        if (this.app.vault.getAbstractFileByPath(targetPath)) throw new Error(`目标位置已存在 ${file.name}`);
        const oldPath = item.path;
        await this.app.vault.rename(file, targetPath);
        item.path = targetPath;
        await this.updatePlotSourcePaths(oldPath, targetPath);
        await this.save();
        let cloudMessage = "";
        if (this.syncManager && this.plugin.settings.cloudProvider !== "none") {
          try { await this.syncManager.moveFile(oldPath, targetPath); cloudMessage = "，网盘文件已同步移动"; }
          catch (error) { cloudMessage = `；但网盘移动失败：${error.message || error}`; }
        }
        this.rerender(); new De.Notice(`✅ 已移动到 ${targetRoot}${cloudMessage}`);
      } catch (error) { new De.Notice(`❌ 移动失败：${error.message || error}`); }
    }
    async updatePlotSourcePaths(oldPath, newPath) {
      const root = this.materialRoot();
      const manifests = this.app.vault.getFiles().filter((file) => file.path.startsWith(root + "/_analysis/") && /\/plot-manifest\.json$/i.test(file.path));
      for (const file of manifests) {
        try {
          const manifest = JSON.parse(await this.app.vault.adapter.read(file.path));
          if (manifest?.source?.path === oldPath) {
            manifest.source.path = newPath;
            await this.app.vault.adapter.write(file.path, JSON.stringify(manifest, null, 2));
          }
        } catch (_) { /* Do not mutate malformed provenance files. */ }
      }
    }
    showNewCategoryDialog(t, e) {
      new Bi(this.app, this.data.categories, async (s) => {
        this.data.categories.includes(s) ||
          (this.data.categories.push(s), await this.save(), this.rerender());
      }).open();
    }
    showCategoryMenu(t, e, s, i) {
      document.querySelectorAll(".mat-ctx-menu").forEach((l) => l.remove());
      let r = document.body.createDiv({ cls: "mat-ctx-menu" }),
        n = t.getBoundingClientRect();
      r.setCssStyles({
        position: "fixed",
        left: `${n.right + 4}px`,
        top: `${n.top}px`,
      }),
        (r.createEl("div", {
          text: "\u270F\uFE0F \u91CD\u547D\u540D",
          cls: "mat-ctx-item",
        }).onclick = () => {
          r.remove(),
            new Fi(this.app, e, this.data.categories, async (l) => {
              this.data.items.forEach((h) => {
                h.category === e && (h.category = l);
              });
              let c = this.data.categories.indexOf(e);
              c >= 0 && (this.data.categories[c] = l),
                this.currentCategory === e && (this.currentCategory = l),
                await this.save(),
                this.rerender();
            }).open();
        }),
        (r.createEl("div", {
          text: "\u{1F5D1}\uFE0F \u5220\u9664",
          cls: "mat-ctx-item mat-ctx-danger",
        }).onclick = () => {
          r.remove(),
            confirm(
              `\u5220\u9664\u5206\u7C7B\u300C${e}\u300D\uFF1F\u8BE5\u5206\u7C7B\u4E0B\u7684\u7D20\u6750\u5C06\u53D8\u4E3A\u672A\u5206\u7C7B\u3002`,
            ) &&
              (this.data.items.forEach((l) => {
                l.category === e && (l.category = "");
              }),
              (this.data.categories = this.data.categories.filter(
                (l) => l !== e,
              )),
              this.currentCategory === e && (this.currentCategory = "all"),
              this.save().then(() => this.rerender()));
        });
      let a = (l) => {
        r.contains(l.target) ||
          (r.remove(), document.removeEventListener("mousedown", a));
      };
      setTimeout(() => document.addEventListener("mousedown", a), 0);
    }
    deleteItem(t) {
      if (
        !confirm(
          `\u786E\u8BA4\u5220\u9664\u7D20\u6750\u300C${t.name}\u300D\uFF1F`,
        )
      )
        return;
      let e = this.app.vault.getAbstractFileByPath(t.path);
      e instanceof De.TFile && this.app.vault.delete(e),
        (this.data.items = this.data.items.filter((s) => s !== t)),
        this.save().then(() => this.rerender());
    }
    showLightbox(t, e) {
      let s = t.filter((n) => es(n.path) === "image" && !schMaterialIsTiff(n)),
        i = t[e],
        r = i ? s.indexOf(i) : 0;
      new Oi(this.app, s, Math.max(0, r)).open();
    }
    catColor(t) {
      var i;
      let e = [
          "#FF7043",
          "#FF8A65",
          "#66BB6A",
          "#4DB6AC",
          "#29B6F6",
          "#42A5F5",
          "#AB47BC",
          "#EC407A",
        ],
        s = 0;
      for (let r = 0; r < t.length; r++)
        (s = (s << 5) - s + t.charCodeAt(r)), (s |= 0);
      return (i = e[Math.abs(s) % e.length]) != null ? i : "#FF7043";
    }
    destroy() {
      document.querySelectorAll(".mat-ctx-menu").forEach((t) => t.remove());
    }
  },
  Ri = class extends De.Modal {
    constructor(e, s, i, r, n, presetCategory = "") {
      super(e);
      this.file = s;
      this.path = i;
      this.data = r;
      this.onConfirm = n;
      // Chosen in the import dialog, where it also decided the destination
      // folder. Pre-filling it here keeps the category on the record without
      // making the researcher pick the same thing twice.
      this.presetCategory = String(presetCategory || "");
    }
    onOpen() {
      let { contentEl: e } = this;
      e.addClass("mat-modal"),
        e.createEl("h2", {
          text: "\u6DFB\u52A0\u7D20\u6750",
          cls: "mat-modal-title",
        });
      let s = e.createDiv({ cls: "mat-modal-preview" }),
        i = es(this.path);
      if (i === "image") {
        let p = URL.createObjectURL(this.file);
        s.createEl("img", {
          cls: "mat-modal-img",
          attr: { src: p, alt: this.file.name },
        }),
          setTimeout(() => URL.revokeObjectURL(p), 6e4);
      } else {
        s.addClass("mat-modal-file-preview"),
          s.style.setProperty("--kind-color", En[i]),
          s.createEl("div", {
            text: Sn(this.path),
            cls: "mat-modal-file-icon",
          }),
          s.createEl("div", {
            text: this.file.name,
            cls: "mat-modal-file-label",
          });
        let p = (this.file.size / 1024).toFixed(1);
        s.createEl("div", {
          text: `${Hi(this.path).toUpperCase()} \xB7 ${p} KB`,
          cls: "mat-modal-file-size",
        });
      }
      e.createEl("label", { text: "\u540D\u79F0", cls: "mat-modal-label" });
      let r = e.createEl("input", {
          cls: "mat-modal-input",
          attr: { type: "text", placeholder: "\u7D20\u6750\u540D\u79F0" },
        }),
        n = this.file.name.lastIndexOf(".");
      (r.value = n >= 0 ? this.file.name.slice(0, n) : this.file.name),
        e.createEl("label", { text: "\u5206\u7C7B", cls: "mat-modal-label" });
      let a = e.createEl("select", { cls: "mat-modal-select" });
      a.createEl("option", {
        text: "\u672A\u5206\u7C7B",
        attr: { value: "" },
      }).selected = !0;
      for (let p of this.data.categories)
        a.createEl("option", { text: p, attr: { value: p } });
      a.createEl("option", {
        text: "\uFF0B \u65B0\u5EFA\u5206\u7C7B\u2026",
        attr: { value: "__new__" },
      });
      // Pre-select whatever the import dialog chose. That choice already
      // decided the destination folder, so leaving this blank would produce a
      // file sitting in Materials/TEM/ with no category recorded - the two
      // facts the folder layout is meant to keep together.
      if (this.presetCategory && this.data.categories.includes(this.presetCategory)) {
        a.value = this.presetCategory;
      }
      let l = e.createDiv({ cls: "mat-modal-newcat-wrap" });
      l.addClass("sch-static-style-63"),
        l.createEl("label", {
          text: "\u65B0\u5206\u7C7B\u540D\u79F0",
          cls: "mat-modal-label",
        });
      let c = l.createEl("input", {
        cls: "mat-modal-input",
        attr: {
          type: "text",
          placeholder: "\u8F93\u5165\u65B0\u5206\u7C7B\u540D\u79F0",
        },
      });
      a.addEventListener("change", () => {
        l.setCssStyles({ display: a.value === "__new__" ? "block" : "none" }),
          a.value === "__new__" && c.focus();
      });
      let h = e.createDiv({ cls: "mat-modal-buttons" });
      h.createEl("button", {
        text: "\u53D6\u6D88",
        cls: "mat-modal-btn",
      }).onclick = () => this.close();
      let d = h.createEl("button", {
        text: "\u786E\u8BA4\u6DFB\u52A0",
        cls: "mat-modal-btn mat-modal-btn-primary",
      });
      (d.onclick = () => {
        let p = r.value.trim() || this.file.name,
          u = a.value;
        if (u === "__new__" && ((u = c.value.trim()), !u)) {
          new De.Notice("\u274C \u8BF7\u8F93\u5165\u5206\u7C7B\u540D\u79F0");
          return;
        }
        this.onConfirm({
          id: Ml(),
          path: this.path,
          name: p,
          category: u,
          addedAt: new Date().toISOString(),
        }),
          this.close();
      }),
        e.addEventListener("keydown", (p) => {
          p.key === "Enter" && !p.isComposing && d.click();
        });
    }
    onClose() {
      this.contentEl.empty();
    }
  },
  $i = class extends De.Modal {
    constructor(e, s, i) {
      super(e);
      this.item = s;
      this.onConfirm = i;
    }
    onOpen() {
      let { contentEl: e } = this;
      e.addClass("mat-modal"),
        e.createEl("h2", {
          text: "\u91CD\u547D\u540D\u7D20\u6750",
          cls: "mat-modal-title",
        });
      let s = e.createEl("input", {
        cls: "mat-modal-input",
        attr: { type: "text" },
      });
      s.value = this.item.name;
      let i = e.createDiv({ cls: "mat-modal-buttons" });
      i.createEl("button", {
        text: "\u53D6\u6D88",
        cls: "mat-modal-btn",
      }).onclick = () => this.close();
      let r = i.createEl("button", {
        text: "\u786E\u8BA4",
        cls: "mat-modal-btn mat-modal-btn-primary",
      });
      (r.onclick = () => {
        let n = s.value.trim();
        n && (this.onConfirm(n), this.close());
      }),
        s.addEventListener("keydown", (n) => {
          n.key === "Enter" && r.click();
        }),
        setTimeout(() => {
          s.select();
        }, 50);
    }
    onClose() {
      this.contentEl.empty();
    }
  },
  _i = class extends De.Modal {
    constructor(e, s, i, r) {
      super(e);
      this.item = s;
      this.categories = i;
      this.onConfirm = r;
    }
    onOpen() {
      let { contentEl: e } = this;
      e.addClass("mat-modal"),
        e.createEl("h2", {
          text: "\u79FB\u52A8\u5206\u7C7B",
          cls: "mat-modal-title",
        }),
        e.createEl("p", {
          text: `\u7D20\u6750\uFF1A${this.item.name}`,
          cls: "mat-modal-sub",
        });
      let s = e.createEl("select", { cls: "mat-modal-select" });
      s.createEl("option", {
        text: "\u672A\u5206\u7C7B",
        attr: { value: "" },
      }).selected = !this.item.category;
      for (let r of this.categories) {
        let n = s.createEl("option", { text: r, attr: { value: r } });
        r === this.item.category && (n.selected = !0);
      }
      let i = e.createDiv({ cls: "mat-modal-buttons" });
      (i.createEl("button", {
        text: "\u53D6\u6D88",
        cls: "mat-modal-btn",
      }).onclick = () => this.close()),
        (i.createEl("button", {
          text: "\u786E\u8BA4",
          cls: "mat-modal-btn mat-modal-btn-primary",
        }).onclick = () => {
          this.onConfirm(s.value), this.close();
        });
    }
    onClose() {
      this.contentEl.empty();
    }
  },
  Bi = class extends De.Modal {
    constructor(e, s, i) {
      super(e);
      this.categories = s;
      this.onConfirm = i;
    }
    onOpen() {
      let { contentEl: e } = this;
      e.addClass("mat-modal"),
        e.createEl("h2", {
          text: "\u65B0\u5EFA\u5206\u7C7B",
          cls: "mat-modal-title",
        });
      let s = e.createEl("input", {
          cls: "mat-modal-input",
          attr: { type: "text", placeholder: "\u5206\u7C7B\u540D\u79F0" },
        }),
        i = e.createDiv({ cls: "mat-modal-buttons" });
      i.createEl("button", {
        text: "\u53D6\u6D88",
        cls: "mat-modal-btn",
      }).onclick = () => this.close();
      let r = i.createEl("button", {
        text: "\u786E\u8BA4",
        cls: "mat-modal-btn mat-modal-btn-primary",
      });
      (r.onclick = () => {
        let n = s.value.trim();
        if (!n) {
          new De.Notice("\u274C \u8BF7\u8F93\u5165\u5206\u7C7B\u540D\u79F0");
          return;
        }
        if (this.categories.includes(n)) {
          new De.Notice("\u274C \u5206\u7C7B\u5DF2\u5B58\u5728");
          return;
        }
        this.onConfirm(n), this.close();
      }),
        s.addEventListener("keydown", (n) => {
          n.key === "Enter" && r.click();
        }),
        setTimeout(() => s.focus(), 50);
    }
    onClose() {
      this.contentEl.empty();
    }
  },
  Fi = class extends De.Modal {
    constructor(e, s, i, r) {
      super(e);
      this.oldName = s;
      this.categories = i;
      this.onConfirm = r;
    }
    onOpen() {
      let { contentEl: e } = this;
      e.addClass("mat-modal"),
        e.createEl("h2", {
          text: "\u91CD\u547D\u540D\u5206\u7C7B",
          cls: "mat-modal-title",
        });
      let s = e.createEl("input", {
        cls: "mat-modal-input",
        attr: { type: "text" },
      });
      s.value = this.oldName;
      let i = e.createDiv({ cls: "mat-modal-buttons" });
      i.createEl("button", {
        text: "\u53D6\u6D88",
        cls: "mat-modal-btn",
      }).onclick = () => this.close();
      let r = i.createEl("button", {
        text: "\u786E\u8BA4",
        cls: "mat-modal-btn mat-modal-btn-primary",
      });
      (r.onclick = () => {
        let n = s.value.trim();
        if (!n) {
          new De.Notice("\u274C \u8BF7\u8F93\u5165\u540D\u79F0");
          return;
        }
        if (n !== this.oldName && this.categories.includes(n)) {
          new De.Notice("\u274C \u5206\u7C7B\u5DF2\u5B58\u5728");
          return;
        }
        this.onConfirm(n), this.close();
      }),
        s.addEventListener("keydown", (n) => {
          n.key === "Enter" && r.click();
        }),
        setTimeout(() => {
          s.select();
        }, 50);
    }
    onClose() {
      this.contentEl.empty();
    }
  },
  Oi = class extends De.Modal {
    constructor(e, s, i) {
      super(e);
      this.items = s;
      this.lbImg = null;
      this.lbTitle = null;
      this.lbMeta = null;
      this.lbCounter = null;
      this.idx = i;
    }
    onOpen() {
      let { contentEl: e, modalEl: s } = this;
      s.addClass("mat-lightbox-dialog"), e.addClass("mat-lightbox-modal");
      let i = e.createEl("button", { text: "\u2715", cls: "mat-lb-close" });
      i.onclick = () => this.close();
      this.lbCounter = e.createEl("div", { cls: "mat-lb-counter" });
      if (
        ((this.lbImg = e.createEl("img", { cls: "mat-lb-img" })),
        (this.lbTitle = e.createEl("div", { cls: "mat-lb-title" })),
        (this.lbMeta = e.createEl("div", { cls: "mat-lb-meta" })),
        this.items.length > 1)
      ) {
        let n = e.createEl("button", {
            text: "\u25C0",
            cls: "mat-lb-nav mat-lb-prev",
          }),
          a = e.createEl("button", {
            text: "\u25B6",
            cls: "mat-lb-nav mat-lb-next",
          });
        (n.onclick = () => {
          (this.idx = (this.idx - 1 + this.items.length) % this.items.length),
            this.refresh();
        }),
          (a.onclick = () => {
            (this.idx = (this.idx + 1) % this.items.length), this.refresh();
          });
      }
      this.refresh();
    }
    refresh() {
      let e = this.items[this.idx];
      const file = e ? this.app.vault.getAbstractFileByPath(e.path) : null;
      !e ||
        !this.lbImg ||
        !this.lbTitle ||
        !this.lbMeta ||
        (this.lbImg.setAttribute("src", e.src || (file instanceof De.TFile ? this.app.vault.getResourcePath(file) : "")),
        this.lbTitle.setText(e.manifest?.plot?.title || e.displayName || (file instanceof De.TFile ? file.name : e.name || "")),
        this.lbMeta.setText(e.path || ""),
        this.lbCounter?.setText(this.items.length > 1 ? `${this.idx + 1} / ${this.items.length}` : ""));
    }
    onClose() {
      this.contentEl.empty();
    }
  };

installMaterialPlotting(Vs);
export { Vs as MaterialLibrary };
export type MaterialLibrary = InstanceType<typeof Vs>;
