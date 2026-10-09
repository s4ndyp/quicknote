import {
  writeNote,
  testConnection,
  fetchVaultFolders,
  formatFolderLabel,
  connectionModeLabel,
} from "./capture-api.js";

const STORAGE_KEY = "ignis-quick-capture-settings";

const els = {
  connectionMode: document.getElementById("connectionMode"),
  restApiKey: document.getElementById("restApiKey"),
  vaultId: document.getElementById("vaultId"),
  folder: document.getElementById("folder"),
  modeBadge: document.getElementById("modeBadge"),
  title: document.getElementById("title"),
  body: document.getElementById("body"),
  status: document.getElementById("status"),
  btnSave: document.getElementById("btnSave"),
  btnTest: document.getElementById("btnTest"),
  btnPing: document.getElementById("btnPing"),
  ignisBlock: document.getElementById("ignisBlock"),
  restBlock: document.getElementById("restBlock"),
};

function defaultSettings() {
  return {
    connectionMode: "rest-proxy",
    proxyBaseUrl: "",
    restApiUrl: "https://127.0.0.1:27124",
    restApiKey: "",
    vaultId: "My Vault",
    folder: "Inbox",
    ignisBaseUrl: "https://10.5.0.134",
  };
}

function loadSettings() {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return defaultSettings();
  }
}

function saveSettingsFromForm() {
  const s = {
    connectionMode: els.connectionMode.value,
    restApiKey: els.restApiKey.value.trim(),
    vaultId: els.vaultId.value.trim(),
    folder: els.folder.value.trim(),
    proxyBaseUrl: window.location.origin,
    restApiUrl: "https://127.0.0.1:27124",
    ignisBaseUrl: "https://10.5.0.134",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  return s;
}

function applySettingsToForm(s) {
  els.connectionMode.value = s.connectionMode || "rest-proxy";
  els.restApiKey.value = s.restApiKey || "";
  els.vaultId.value = s.vaultId || "My Vault";
  els.folder.value = s.folder ?? "Inbox";
  syncModeUi(s);
}

function syncModeUi(s) {
  const mode = s?.connectionMode || els.connectionMode.value;
  const rest = mode === "rest" || mode === "rest-proxy";
  els.restBlock.hidden = !rest;
  els.ignisBlock.hidden = rest;
  els.modeBadge.textContent = connectionModeLabel({ connectionMode: mode });
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
}

function formatError(e) {
  const msg = e?.message || String(e);
  if (/401|403/.test(msg)) {
    return msg + " — Controleer de API key in Obsidian → Local REST API.";
  }
  return msg;
}

async function onSave() {
  clearStatus();
  const settings = saveSettingsFromForm();
  if (!els.body.value.trim() && !els.title.value.trim()) {
    setStatus("err", "Vul minimaal een titel of inhoud in.");
    return;
  }
  setBusy(true);
  try {
    const { path } = await writeNote(settings, els.title.value, els.body.value, settings.folder);
    setStatus("ok", "Opgeslagen als: " + path);
    els.body.value = "";
    els.title.value = "";
    els.title.focus();
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

async function onTest() {
  clearStatus();
  const settings = saveSettingsFromForm();
  setBusy(true);
  try {
    const { path } = await writeNote(
      settings,
      "Quicknote test",
      "Testnotitie.\n\n" + new Date().toLocaleString("nl-NL") + "\n",
      settings.folder,
    );
    setStatus("ok", "Testnotitie opgeslagen: " + path);
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

async function onPing() {
  clearStatus();
  const settings = saveSettingsFromForm();
  setBusy(true);
  try {
    const result = await testConnection(settings);
    if (result.rest) {
      setStatus(
        result.authenticated ? "ok" : "info",
        `${result.service} OK (${result.endpoint}). Obsidian ${result.obsVer}.`,
      );
    } else {
      setStatus(
        result.found ? "ok" : "info",
        "Ignis " +
          result.ignisVer +
          ", Obsidian " +
          result.obsVer +
          '. Vault "' +
          result.vault +
          '": ' +
          (result.found ? "gevonden" : "niet in lijst") +
          ".",
      );
    }
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

["connectionMode", "restApiKey", "vaultId", "folder"].forEach((id) => {
  els[id]?.addEventListener("change", () => {
    const s = saveSettingsFromForm();
    syncModeUi(s);
  });
});

els.btnSave.addEventListener("click", onSave);
els.btnTest.addEventListener("click", onTest);
els.btnPing.addEventListener("click", onPing);

applySettingsToForm(loadSettings());
