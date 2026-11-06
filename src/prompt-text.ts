// @ts-nocheck
/* SCHOLARIUM_PROMPT_SHIM
 * Small Obsidian-native text prompt shared by the recovered feature modules. */
export function schPromptText(message, value) {
  const { Modal } = require("obsidian");
  return new Promise((resolve) => {
    let done = false;
    const modal = new Modal(window.app);
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
      modal.close();
    };
    modal.onOpen = () => {
      modal.titleEl.setText(String(message || "").replace(/[：:]\s*$/, ""));
      const input = modal.contentEl.createEl("input", { type: "text", attr: { style: "width:100%;" } });
      input.value = value == null ? "" : String(value);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); finish(input.value); }
        else if (event.key === "Escape") { event.preventDefault(); finish(null); }
      });
      const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
      row.createEl("button", { text: "取消" }).addEventListener("click", () => finish(null));
      row.createEl("button", { text: "确定", cls: "mod-cta" }).addEventListener("click", () => finish(input.value));
      window.setTimeout(() => { input.focus(); input.select(); }, 30);
    };
    modal.onClose = () => {
      modal.contentEl.empty();
      if (!done) { done = true; resolve(null); }
    };
    modal.open();
  });
}
