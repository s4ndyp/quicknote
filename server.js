"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { Client } = require("ssh2");
require("dotenv").config();

const PORT = Number(process.env.PORT) || 3456;
const SSH_HOST = process.env.SSH_HOST || "10.5.0.134";
const SSH_PORT = Number(process.env.SSH_PORT) || 22;
const SSH_USER = process.env.SSH_USER || "";
const SSH_PRIVATE_KEY_PATH = process.env.SSH_PRIVATE_KEY_PATH || "";
const SSH_PRIVATE_KEY = process.env.SSH_PRIVATE_KEY || "";
const SSH_PASSPHRASE = process.env.SSH_PASSPHRASE || undefined;
const VAULT_PATH = (process.env.VAULT_PATH || "").replace(/\/+$/, "");
const DEFAULT_FOLDER = (process.env.NOTE_FOLDER || "Inbox").replace(/^\/+|\/+$/g, "");
const CAPTURE_API_TOKEN = process.env.CAPTURE_API_TOKEN || "";

const app = express();
app.use(express.json({ limit: "512kb" }));

function readPrivateKey() {
  if (SSH_PRIVATE_KEY.trim()) {
    return SSH_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (SSH_PRIVATE_KEY_PATH.trim()) {
    return fs.readFileSync(SSH_PRIVATE_KEY_PATH, "utf8");
  }
  return null;
}

function requireConfig() {
  const missing = [];
  if (!SSH_USER) missing.push("SSH_USER");
  if (!VAULT_PATH) missing.push("VAULT_PATH");
  const key = readPrivateKey();
  if (!key) missing.push("SSH_PRIVATE_KEY_PATH or SSH_PRIVATE_KEY");
  if (missing.length) {
    const err = new Error("Serverconfig ontbreekt: " + missing.join(", "));
    err.status = 503;
    throw err;
  }
  return key;
}

function sshConnectConfig(privateKey) {
  return {
    host: SSH_HOST,
    port: SSH_PORT,
    username: SSH_USER,
    privateKey,
    passphrase: SSH_PASSPHRASE,
    readyTimeout: 20000,
  };
}

function withSftp(fn) {
  const privateKey = requireConfig();
  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn
      .on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }
          Promise.resolve(fn(sftp))
            .then(resolve)
            .catch(reject)
            .finally(() => conn.end());
        });
      })
      .on("error", reject)
      .connect(sshConnectConfig(privateKey));
  });
}

function mkdirp(sftp, remoteDir) {
  const normalized = remoteDir.replace(/\\/g, "/");
  return new Promise((resolve, reject) => {
    sftp.mkdir(normalized, (err) => {
      if (!err) return resolve();
      if (err.code === 4) return resolve();

      const parent = path.posix.dirname(normalized);
      if (parent === normalized || normalized === "/") {
        return reject(err);
      }

      mkdirp(sftp, parent)
        .then(() => {
          sftp.mkdir(normalized, (err2) => {
            if (err2 && err2.code !== 4) reject(err2);
            else resolve();
          });
        })
        .catch(reject);
    });
  });
}

function writeRemoteFile(sftp, remotePath, content) {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { encoding: "utf8" });
    stream.on("error", reject);
    stream.on("close", resolve);
    stream.end(content, "utf8");
  });
}

function assertSafeRelative(rel) {
  if (!rel || typeof rel !== "string") {
    const err = new Error("Ongeldig pad");
    err.status = 400;
    throw err;
  }
  if (rel.includes("\0")) {
    const err = new Error("Ongeldig pad");
    err.status = 400;
    throw err;
  }
  const normalized = path.posix.normalize(rel.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    const err = new Error("Pad traversal niet toegestaan");
    err.status = 400;
    throw err;
  }
  return normalized;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestampSlug() {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function slugify(title) {
  const t = (title || "").trim() || "notitie";
  const cleaned = t
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "notitie";
}

function buildMarkdown(title, body) {
  const now = new Date().toISOString();
  return [
    "---",
    "created: " + now,
    "source: vault-quick-capture",
    "---",
    "",
    "# " + ((title || "").trim() || "Notitie"),
    "",
    (body || "").trim(),
    "",
  ].join("\n");
}

function authMiddleware(req, res, next) {
  if (!CAPTURE_API_TOKEN) return next();
  const token = req.get("X-Capture-Token") || "";
  if (token !== CAPTURE_API_TOKEN) {
    return res.status(401).json({ error: "Ongeldige API-token" });
  }
  next();
}

app.use("/api", authMiddleware);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    sshHost: SSH_HOST,
    vaultPath: VAULT_PATH || null,
    authRequired: Boolean(CAPTURE_API_TOKEN),
  });
});

app.get("/api/connection", async (_req, res) => {
  try {
    requireConfig();
    await withSftp(async (sftp) => {
      await new Promise((resolve, reject) => {
        sftp.stat(VAULT_PATH, (err, stats) => {
          if (err) reject(err);
          else if (!stats.isDirectory()) reject(new Error("VAULT_PATH is geen map"));
          else resolve();
        });
      });
    });
    res.json({
      ok: true,
      message: `SSH OK — vault bereikbaar op ${VAULT_PATH}`,
      sshHost: SSH_HOST,
      vaultPath: VAULT_PATH,
    });
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message || String(e),
    });
  }
});

app.post("/api/notes", async (req, res) => {
  try {
    requireConfig();
    const title = req.body?.title ?? "";
    const body = req.body?.body ?? "";
    const folderRaw = (req.body?.folder ?? DEFAULT_FOLDER).trim().replace(/^\/+|\/+$/g, "");

    if (!String(title).trim() && !String(body).trim()) {
      return res.status(400).json({ error: "Vul minimaal titel of inhoud in" });
    }

    const filename = `${timestampSlug()} ${slugify(title)}.md`;
    const relPath = folderRaw ? `${folderRaw}/${filename}` : filename;
    const safeRel = assertSafeRelative(relPath);
    const remotePath = path.posix.join(VAULT_PATH.replace(/\\/g, "/"), safeRel);
    const content = buildMarkdown(title, body);

    await withSftp(async (sftp) => {
      const remoteDir = path.posix.dirname(remotePath);
      await mkdirp(sftp, remoteDir);
      await writeRemoteFile(sftp, remotePath, content);
    });

    res.json({ ok: true, path: safeRel, remotePath });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

app.get(["/", "/index.html"], (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`[capture] http://0.0.0.0:${PORT}`);
  console.log(`[capture] SSH → ${SSH_USER || "?"}@${SSH_HOST}:${SSH_PORT}`);
  console.log(`[capture] Vault: ${VAULT_PATH || "(VAULT_PATH niet gezet)"}`);
});
