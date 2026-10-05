import { writeNote, testConnection } from "./ignis-client.js";
import { loadSettings } from "./settings-store.js";
import { ensurePermissionsForSettings } from "./permissions.js";

const els = {
  modeBadge: document.getElementById("modeBadge"),
  title: document.getElementById("title"),
  body: document.getElementById("body"),
  status: document.getElementById("status"),
  btnSave: document.getElementById("btnSave"),
  btnTest: document.getElementById("btnTest"),
  btnPing: document.getElementById("btnPing"),
  openOptions: document.getElementById("openOptions"),
};

/** @type {import('./ignis-client.js').CaptureSettings | null} */
let settings = null;

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

function updateModeBadge() {
  if (!settings) return;
  els.modeBadge.textContent = settings.connectionMode === "proxy" ? "docker proxy" : "direct";
}

async function refreshSettings() {
  settings = await loadSettings();
  updateModeBadge();
}

async function withPermission(fn) {
  if (!settings) await refreshSettings();
  const ok = await ensurePermissionsForSettings(settings);
  if (!ok) {
    throw new Error("Host-permissie geweigerd — open Instellingen en keur de URL goed.");
  }
  return fn(settings);
}

async function onSave() {
  clearStatus();
  if (!els.body.value.trim() && !els.title.value.trim()) {
    setStatus("err", "Vul minimaal titel of inhoud in.");
    return;
  }
  setBusy(true);
  try {
    const { path } = await withPermission((s) => writeNote(s, els.title.value, els.body.value));
    setStatus("ok", "Opgeslagen: " + path);
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
  setBusy(true);
  try {
    const { path } = await withPermission((s) =>
      writeNote(
        s,
        "Extension test",
        "Testnotitie vanuit Chrome-extensie.\n\n" + new Date().toLocaleString("nl-NL") + "\n",
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
    setStatus(
      result.found ? "ok" : "info",
      `Ignis ${result.ignisVer}, Obsidian ${result.obsVer}. Vault "${result.vault}": ${
        result.found ? "gevonden" : "niet gevonden"
      }.`,
    );
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
      " — TLS/certificaat? Open Ignis eenmalig in een tab en vertrouw het certificaat. " +
      "Anders: zet in Instellingen modus Docker proxy."
    );
  }
  return msg;
}

els.btnSave.addEventListener("click", onSave);
els.btnTest.addEventListener("click", onTest);
els.btnPing.addEventListener("click", onPing);
els.openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refreshSettings();
