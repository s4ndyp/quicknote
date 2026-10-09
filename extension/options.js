import { loadSettings, saveSettings } from "./settings-store.js";
import { ensurePermissionsForSettings, activeBaseUrl } from "./permissions.js";
import { isRestConnectionMode } from "./rest-client.js";

const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const connectionMode = document.getElementById("connectionMode");
const ignisFields = document.getElementById("ignisFields");
const proxyFields = document.getElementById("proxyFields");
const restFields = document.getElementById("restFields");
const vaultFields = document.getElementById("vaultFields");
const btnRequestPerm = document.getElementById("btnRequestPerm");

const fields = [
  "ignisBaseUrl",
  "proxyBaseUrl",
  "vaultId",
  "folder",
  "restApiUrl",
  "restApiKey",
];

function setStatus(kind, message) {
  statusEl.className = "status show " + kind;
  statusEl.textContent = message;
}

function syncModeUi() {
  const mode = connectionMode.value;
  const ignisDirect = mode === "direct";
  const proxy = mode === "proxy" || mode === "rest-proxy";
  const rest = isRestConnectionMode(mode);

  ignisFields.hidden = !ignisDirect;
  proxyFields.hidden = !proxy;
  restFields.hidden = !rest || mode === "rest-proxy";
  vaultFields.hidden = rest;
}

connectionMode.addEventListener("change", syncModeUi);

async function populateForm() {
  const s = await loadSettings();
  connectionMode.value = s.connectionMode || "rest";
  for (const id of fields) {
    const el = document.getElementById(id);
    if (el) el.value = s[id] ?? "";
  }
  syncModeUi();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const partial = {
    connectionMode: connectionMode.value,
    vaultId: document.getElementById("vaultId").value.trim(),
    folder: document.getElementById("folder").value.trim(),
    ignisBaseUrl: document.getElementById("ignisBaseUrl").value.trim(),
    proxyBaseUrl: document.getElementById("proxyBaseUrl").value.trim(),
    restApiUrl: document.getElementById("restApiUrl").value.trim(),
    restApiKey: document.getElementById("restApiKey").value.trim(),
  };
  await saveSettings(partial);
  const ok = await ensurePermissionsForSettings(partial);
  setStatus(
    ok ? "ok" : "info",
    ok ? "Opgeslagen en host-permissie actief." : "Opgeslagen — host-permissie niet verleend.",
  );
});

btnRequestPerm.addEventListener("click", async () => {
  const s = await loadSettings();
  try {
    const ok = await ensurePermissionsForSettings(s);
    setStatus(ok ? "ok" : "err", ok ? `Toegang tot ${activeBaseUrl(s)}` : "Permissie geweigerd");
  } catch (e) {
    setStatus("err", e.message || String(e));
  }
});

populateForm();
