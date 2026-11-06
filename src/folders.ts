// @ts-nocheck
/* Canonical user-configured Vault folders shared by materials and literature. */
export function schMaterialFolderFromPath(path, root = "Materials") {
  const normalized = String(path || "").replace(/\\/g, "/");
  const prefix = String(root || "Materials").replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  if (!normalized.startsWith(prefix)) return "";
  const relative = normalized.slice(prefix.length);
  const slash = relative.lastIndexOf("/");
  return slash > -1 ? relative.slice(0, slash) : "";
}
export function schMaterialSafeFolder(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[<>:"|?*\x00-\x1f]/.test(part)))
    throw new Error("文件夹名称不能包含 ..、< > : \" | ? * 等字符");
  return parts.join("/");
}
export function schConfiguredFolder(plugin, key, fallback) {
  const value = String(plugin?.settings?.[key] || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!value || value === "." || value === ".." || value.split("/").some((part) => part === ".." || /[<>:"|?*\x00-\x1f]/.test(part))) return fallback;
  return value;
}
export function schMaterialsRoot(plugin) { return schConfiguredFolder(plugin, "materialsFolder", "Materials"); }
export function schLiteratureRoot(plugin) { return schConfiguredFolder(plugin, "literatureFolder", "Literature/Zotero"); }
export function schSubscriptionRoot(plugin) { return schConfiguredFolder(plugin, "subscriptionFolder", "Literature/Subscriptions"); }
