import {
  writeNote,
  testConnection,
  fetchVaultFolders,
  formatFolderLabel,
  connectionModeLabel,
} from "./capture-api.js";
import { buildVaultTagIndex } from "./tag-index.js";
import { loadTagIndexCache, saveTagIndexCache, isTagCacheStale } from "./tag-cache.js";
import { loadSettings } from "./settings-store.js";
import { ensurePermissionsForSettings } from "./permissions.js";

const els = {
  modeBadge: document.getElementById("modeBadge"),
  title: document.getElementById("title"),
  body: document.getElementById("body"),
  status: document.getElementById("status"),
  saveFolder: document.getElementById("saveFolder"),
  btnSave: document.getElementById("btnSave"),
  btnTest: document.getElementById("btnTest"),
  btnPing: document.getElementById("btnPing"),
  btnPickFolder: document.getElementById("btnPickFolder"),
  btnResetFolder: document.getElementById("btnResetFolder"),
  btnInsertTask: document.getElementById("btnInsertTask"),
  openOptions: document.getElementById("openOptions"),
  folderModal: document.getElementById("folderModal"),
  folderModalBackdrop: document.getElementById("folderModalBackdrop"),
  btnCloseFolderModal: document.getElementById("btnCloseFolderModal"),
  folderTree: document.getElementById("folderTree"),
  folderTreeLoading: document.getElementById("folderTreeLoading"),
  folderTreeError: document.getElementById("folderTreeError"),
  tagFilter: document.getElementById("tagFilter"),
  tagChips: document.getElementById("tagChips"),
  tagMeta: document.getElementById("tagMeta"),
  btnRefreshTags: document.getElementById("btnRefreshTags"),
};

/** @type {import('./ignis-client.js').CaptureSettings | null} */
let settings = null;

/** Map for the next save (defaults to settings.folder / Inbox). */
let saveFolder = "";

/** @type {import('./tag-cache.js').TagIndexCache | null} */
let tagIndex = null;
let tagsLoading = false;

function defaultFolder() {
  return (settings?.folder ?? "Inbox").trim();
}

function setStatus(kind, message) {
  els.status.className = "status show " + kind;
  els.status.textContent = message;
}

function clearStatus() {
  els.status.className = "status";
  els.status.textContent = "";
}

function setBusy(busy) {
  els.btnSave.disabled = busy;
  els.btnTest.disabled = busy;
  els.btnPing.disabled = busy;
  els.btnPickFolder.disabled = busy;
  if (!tagsLoading) els.btnRefreshTags.disabled = busy;
}

function updateModeBadge() {
  if (!settings) return;
  els.modeBadge.textContent = connectionModeLabel(settings);
}

function updateSaveFolderUi() {
  const label = formatFolderLabel(saveFolder);
  els.saveFolder.textContent = label;
  els.saveFolder.title = saveFolder === "" ? "Vault root" : saveFolder;
}

function resetSaveFolderToDefault() {
  saveFolder = defaultFolder();
  updateSaveFolderUi();
}

async function refreshSettings() {
  settings = await loadSettings();
  updateModeBadge();
  resetSaveFolderToDefault();
  void refreshTags(false);
}

async function withPermission(fn) {
  if (!settings) await refreshSettings();
  const ok = await ensurePermissionsForSettings(settings);
  if (!ok) {
    throw new Error("Host-permissie geweigerd — open Instellingen en keur de URL goed.");
  }
  return fn(settings);
}

function folderDepth(path) {
  if (!path) return 0;
  return path.split("/").length;
}

function depthClass(depth) {
  const d = Math.min(depth, 5);
  return d > 0 ? `depth-${d}` : "";
}

function renderFolderTree(folders) {
  els.folderTree.innerHTML = "";
  for (const path of folders) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = depthClass(folderDepth(path));
    btn.textContent = formatFolderLabel(path);
    btn.dataset.path = path;
    if (path === saveFolder) {
      btn.classList.add("selected");
    }
    btn.addEventListener("click", () => {
      saveFolder = path;
      updateSaveFolderUi();
      closeFolderModal();
      setStatus("info", "Opslaglocatie: " + formatFolderLabel(path));
    });
    li.appendChild(btn);
    els.folderTree.appendChild(li);
  }
}

function openFolderModal() {
  els.folderModal.hidden = false;
  els.folderModal.setAttribute("aria-hidden", "false");
}

function closeFolderModal() {
  els.folderModal.hidden = true;
  els.folderModal.setAttribute("aria-hidden", "true");
  els.folderTreeError.hidden = true;
  els.folderTreeLoading.hidden = true;
}

async function onPickFolder() {
  clearStatus();
  openFolderModal();
  els.folderTree.innerHTML = "";
  els.folderTreeError.hidden = true;
  els.folderTreeLoading.hidden = false;
  setBusy(true);
  try {
    const folders = await withPermission((s) => fetchVaultFolders(s));
    renderFolderTree(folders);
    if (folders.length === 0) {
      els.folderTreeError.hidden = false;
      els.folderTreeError.textContent = "Geen mappen gevonden in deze vault.";
    }
  } catch (e) {
    els.folderTreeError.hidden = false;
    els.folderTreeError.textContent = formatError(e);
  } finally {
    els.folderTreeLoading.hidden = true;
    setBusy(false);
  }
}

function updateTagMeta() {
  if (!tagIndex) {
    els.tagMeta.textContent = "Nog niet geladen — klik Vernieuwen.";
    return;
  }
  let msg = `${tagIndex.tags.length} tags uit ${tagIndex.filesScanned} notities`;
  if (tagIndex.truncated) {
    msg += ` (eerste ${tagIndex.filesScanned} van ${tagIndex.markdownTotal})`;
  }
  msg += ` · ${new Date(tagIndex.scannedAt).toLocaleString("nl-NL")}`;
  els.tagMeta.textContent = msg;
}

function renderTagChips() {
  els.tagChips.innerHTML = "";
  const filter = els.tagFilter.value.trim().toLowerCase();
  const list = (tagIndex?.tags || [])
    .filter((entry) => !filter || entry.tag.toLowerCase().includes(filter))
    .slice(0, 100);

  if (!list.length) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = tagIndex ? "Geen tags voor deze zoekterm." : "Scan de vault om tags te tonen.";
    els.tagChips.appendChild(hint);
    return;
  }

  for (const { tag, count } of list) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = count > 1 ? `#${tag} (${count})` : `#${tag}`;
    btn.title = `Invoegen als #${tag} (${count}× in vault)`;
    btn.addEventListener("click", () => insertTag(tag));
    els.tagChips.appendChild(btn);
  }
}

function insertTag(tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`#${escaped}(?:[\\s/#]|$)`, "i").test(els.body.value)) {
    setStatus("info", `#${tag} staat al in de notitie`);
    return;
  }
  insertSnippet(`#${tag} `);
}

function insertSnippet(snippet) {
  const ta = els.body;
  const val = ta.value;
  const start = ta.selectionStart ?? val.length;
  const end = ta.selectionEnd ?? start;
  let insert = snippet;
  if (val.length > 0 && start > 0) {
    const last = val[start - 1];
    if (last !== "\n" && last !== " ") {
      insert = " " + snippet;
    }
  }
  ta.setRangeText(insert, start, end, "end");
  ta.focus();
}

async function refreshTags(force) {
  if (tagsLoading) return;
  if (!settings) {
    settings = await loadSettings();
    updateModeBadge();
    resetSaveFolderToDefault();
  }
  const vault = settings.vaultId.trim();

  if (!force) {
    const cached = await loadTagIndexCache(vault);
    if (cached?.tags) {
      tagIndex = cached;
      updateTagMeta();
      renderTagChips();
      if (!isTagCacheStale(cached)) return;
    }
  }

  tagsLoading = true;
  els.btnRefreshTags.disabled = true;
  els.tagMeta.textContent = "Tags scannen…";
  try {
    tagIndex = await withPermission((s) =>
      buildVaultTagIndex(s, (done, total) => {
        els.tagMeta.textContent = `Tags scannen… ${done}/${total}`;
      }),
    );
    await saveTagIndexCache(vault, tagIndex);
    updateTagMeta();
    renderTagChips();
    setStatus("ok", `${tagIndex.tags.length} tags gevonden in vault.`);
  } catch (e) {
    els.tagMeta.textContent = "Tag-scan mislukt.";
    setStatus("err", formatError(e));
  } finally {
    tagsLoading = false;
    els.btnRefreshTags.disabled = false;
  }
}

function insertTaskLine() {
  const ta = els.body;
  const val = ta.value;
  const start = ta.selectionStart ?? val.length;
  const before = val.slice(0, start);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  insertSnippet((needsLeadingNewline ? "\n" : "") + "- [ ] ");
}

async function onSave() {
  clearStatus();
  if (!els.body.value.trim() && !els.title.value.trim()) {
    setStatus("err", "Vul minimaal titel of inhoud in.");
    return;
  }
  setBusy(true);
  try {
    const { path } = await withPermission((s) =>
      writeNote(s, els.title.value, els.body.value, saveFolder),
    );
    setStatus("ok", "Opgeslagen: " + path);
    els.body.value = "";
    els.title.value = "";
    resetSaveFolderToDefault();
    els.title.focus();
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

async function onTest() {
  clearStatus();
  setBusy(true);
  try {
    const { path } = await withPermission((s) =>
      writeNote(
        s,
        "Extension test",
        "Testnotitie vanuit Chrome-extensie.\n\n" + new Date().toLocaleString("nl-NL") + "\n",
        saveFolder,
      ),
    );
    setStatus("ok", "Test OK: " + path);
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

async function onPing() {
  clearStatus();
  setBusy(true);
  try {
    const result = await withPermission((s) => testConnection(s));
    if (result.rest) {
      setStatus(
        result.authenticated ? "ok" : "info",
        `${result.service} bereikbaar (${result.endpoint}). Obsidian ${result.obsVer}.`,
      );
    } else {
      setStatus(
        result.found ? "ok" : "info",
        `Ignis ${result.ignisVer}, Obsidian ${result.obsVer}. Vault "${result.vault}": ${
          result.found ? "gevonden" : "niet gevonden"
        }.`,
      );
    }
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

function formatError(e) {
  const msg = e?.message || String(e);
  if (/Failed to fetch|NetworkError|ERR_CERT/i.test(msg)) {
    return (
      msg +
      " — TLS/certificaat? Open de API-URL in een tab en vertrouw het certificaat, " +
      "of gebruik HTTP (poort 27123) in de Local REST API-plugin. Bij Ignis: Docker proxy-modus."
    );
  }
  if (/401|403/.test(msg)) {
    return msg + " — Controleer de API key in Obsidian → Local REST API.";
  }
  return msg;
}

els.btnSave.addEventListener("click", onSave);
els.btnTest.addEventListener("click", onTest);
els.btnPing.addEventListener("click", onPing);
els.btnPickFolder.addEventListener("click", onPickFolder);
els.btnResetFolder.addEventListener("click", () => {
  resetSaveFolderToDefault();
  setStatus("info", "Opslaglocatie: " + formatFolderLabel(saveFolder));
});
els.btnInsertTask.addEventListener("click", insertTaskLine);
els.btnRefreshTags.addEventListener("click", () => refreshTags(true));
els.tagFilter.addEventListener("input", renderTagChips);
els.btnCloseFolderModal.addEventListener("click", closeFolderModal);
els.folderModalBackdrop.addEventListener("click", closeFolderModal);
els.openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refreshSettings();
