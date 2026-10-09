import {
  buildMarkdown,
  buildNoteFilename,
  buildNotePath,
  isHiddenVaultPath,
  normalizeBase,
} from "./ignis-client.js";

/** @typedef {import('./ignis-client.js').CaptureSettings & { restApiUrl?: string, restApiKey?: string }} RestCaptureSettings */

export function isRestConnectionMode(connectionMode) {
  return connectionMode === "rest" || connectionMode === "rest-proxy";
}

/** @param {RestCaptureSettings} settings */
export function effectiveRestBase(settings) {
  if (settings.connectionMode === "rest-proxy") {
    return `${normalizeBase(settings.proxyBaseUrl)}/obsidian-rest`;
  }
  return normalizeBase(settings.restApiUrl || "https://127.0.0.1:27124");
}

/** @param {string} relPath vault-relative path */
export function encodeVaultUrlPath(relPath) {
  if (!relPath) return "";
  return relPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** @param {RestCaptureSettings} settings */
function authHeaders(settings) {
  const key = (settings.restApiKey || "").trim();
  if (!key) {
    throw new Error("Vul de Local REST API key in (Instellingen → Obsidian plugin).");
  }
  return { Authorization: `Bearer ${key}` };
}

/** @param {RestCaptureSettings} settings @param {string} apiPath e.g. /vault/Inbox/note.md */
async function restFetch(settings, method, apiPath, init = {}) {
  const base = effectiveRestBase(settings);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const url = `${base}${path}`;
  const headers = { ...authHeaders(settings), ...(init.headers || {}) };
  const res = await fetch(url, { ...init, method, headers });
  return res;
}

/** @param {Response} res */
async function readErrorMessage(res) {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data.message || data.error || text;
  } catch {
    return text || res.statusText;
  }
}

/** @param {RestCaptureSettings} settings @param {string} apiPath */
async function restJson(settings, method, apiPath, init = {}) {
  const res = await restFetch(settings, method, apiPath, init);
  if (res.status === 204) return {};
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const detail = data.message || data.error || (typeof data.raw === "string" ? data.raw : null);
    throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
  }
  return data;
}

/** @param {RestCaptureSettings} settings @param {string} relPath */
async function vaultFileExists(settings, relPath) {
  const res = await restFetch(settings, "GET", `/vault/${encodeVaultUrlPath(relPath)}`);
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`HTTP ${res.status}: ${await readErrorMessage(res)}`);
}

/** @param {RestCaptureSettings} settings @param {string} title @param {string} folder */
async function allocateNotePath(settings, title, folder) {
  for (let i = 0; i < 50; i++) {
    const filename = buildNoteFilename(title, i);
    const path = buildNotePath(folder, filename);
    if (!(await vaultFileExists(settings, path))) return path;
  }
  throw new Error("Kon geen unieke bestandsnaam vinden (te veel duplicaten).");
}

/** @param {RestCaptureSettings} settings @param {string} [folderOverride] */
export async function writeNoteRest(settings, title, body, folderOverride) {
  const folder =
    folderOverride !== undefined && folderOverride !== null
      ? folderOverride
      : settings.folder;
  const path = await allocateNotePath(settings, title, folder);
  const content = buildMarkdown(title, body, "obsidian-local-rest-api");
  const res = await restFetch(settings, "PUT", `/vault/${encodeVaultUrlPath(path)}`, {
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });
  if (res.status !== 204 && !res.ok) {
    throw new Error(`HTTP ${res.status}: ${await readErrorMessage(res)}`);
  }
  return { path };
}

/** @param {RestCaptureSettings} settings */
export async function testConnectionRest(settings) {
  const data = await restJson(settings, "GET", "/");
  return {
    service: data.service || data.status || "Local REST API",
    authenticated: data.authenticated !== false,
    obsidianVersion: data.obsidianVersion || data.obsidian || "?",
  };
}

/** @param {RestCaptureSettings} settings @param {string} dirPath */
async function listDirectoryFiles(settings, dirPath) {
  const encoded = dirPath ? `${encodeVaultUrlPath(dirPath)}/` : "";
  const suffix = encoded ? `/${encoded}` : "/";
  const data = await restJson(settings, "GET", `/vault${suffix}`);
  return Array.isArray(data.files) ? data.files : [];
}

/** @param {RestCaptureSettings} settings @returns {Promise<string[]>} */
export async function listSelectableFoldersRest(settings) {
  /** @type {Set<string>} */
  const folders = new Set([""]);

  async function walk(prefix) {
    let entries;
    try {
      entries = await listDirectoryFiles(settings, prefix);
    } catch (e) {
      if (prefix === "") throw e;
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith("/")) continue;
      const name = entry.slice(0, -1);
      const full = prefix ? `${prefix}/${name}` : name;
      if (isHiddenVaultPath(full)) continue;
      folders.add(full);
      await walk(full);
    }
  }

  await walk("");
  return [...folders].sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

/** @param {RestCaptureSettings} settings @returns {Promise<{ tag: string, count: number }[]>} */
export async function fetchVaultTagsRest(settings) {
  const data = await restJson(settings, "GET", "/tags/");
  const list = Array.isArray(data.tags) ? data.tags : [];
  return list
    .map((t) => ({ tag: t.name, count: t.count ?? 0 }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" });
    });
}
