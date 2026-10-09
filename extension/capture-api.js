import {
  writeNote as writeNoteIgnis,
  testConnection as testConnectionIgnis,
  fetchVaultTree,
  listSelectableFolders,
} from "./ignis-client.js";
import {
  isRestConnectionMode,
  writeNoteRest,
  testConnectionRest,
  listSelectableFoldersRest,
  fetchVaultTagsRest,
  effectiveRestBase,
} from "./rest-client.js";

/** @param {import('./ignis-client.js').CaptureSettings} settings */
export function isRestMode(settings) {
  return isRestConnectionMode(settings.connectionMode);
}

/** @param {import('./ignis-client.js').CaptureSettings} settings */
export function connectionModeLabel(settings) {
  switch (settings.connectionMode) {
    case "proxy":
      return "ignis proxy";
    case "rest":
      return "local REST";
    case "rest-proxy":
      return "REST proxy";
    default:
      return "ignis direct";
  }
}

/** @param {import('./ignis-client.js').CaptureSettings} settings @param {string} [folderOverride] */
export async function writeNote(settings, title, body, folderOverride) {
  if (isRestMode(settings)) {
    return writeNoteRest(settings, title, body, folderOverride);
  }
  return writeNoteIgnis(settings, title, body, folderOverride);
}

/** @param {import('./ignis-client.js').CaptureSettings} settings */
export async function testConnection(settings) {
  if (isRestMode(settings)) {
    const r = await testConnectionRest(settings);
    return {
      rest: true,
      service: r.service,
      authenticated: r.authenticated,
      obsVer: r.obsidianVersion,
      endpoint: effectiveRestBase(settings),
    };
  }
  const r = await testConnectionIgnis(settings);
  return { rest: false, ...r };
}

/** @param {import('./ignis-client.js').CaptureSettings} @returns {Promise<string[]>} */
export async function fetchVaultFolders(settings) {
  if (isRestMode(settings)) {
    return listSelectableFoldersRest(settings);
  }
  const tree = await fetchVaultTree(settings);
  return listSelectableFolders(tree);
}

/** @param {import('./ignis-client.js').CaptureSettings} */
export async function fetchVaultTags(settings) {
  if (isRestMode(settings)) {
    return fetchVaultTagsRest(settings);
  }
  return null;
}

export { formatFolderLabel } from "./ignis-client.js";
