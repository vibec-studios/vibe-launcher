#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILES = ["config.json", "tokenizer.json", "weights.bin"];
const TAG = "vibefix-model";
const REPO = "vibec-studios/vibe-launcher";
const DEFAULT_KEY = path.join(os.homedir(), ".vibefix", "model-signing.key");
const SAFE = /^[A-Za-z0-9._-]+$/;

const HELP = `VibeFix-Modell als Release-Assets vorbereiten

  node scripts/vibefix-model/release.mjs keygen [--key DATEI]
      Neues ed25519-Schlüsselpaar. Der private Schlüssel landet nur in DATEI
      (Standard ${DEFAULT_KEY}), ausgegeben wird nur der öffentliche Schlüssel.

  node scripts/vibefix-model/release.mjs pack --export ORDNER --out ORDNER [--version V] [--key DATEI]
      Kopiert config.json, tokenizer.json und weights.bin als vibefix-v<V>-<datei>,
      schreibt manifest.json und die Signatur manifest.json.sig. V = "version" aus config.json.

  node scripts/vibefix-model/release.mjs verify --out ORDNER [--pubkey BASE64 | --key DATEI]
      Prüft Signatur, Größen und SHA-256 der Assets in ORDNER.

  node scripts/vibefix-model/release.mjs pubkey [--key DATEI]
      Öffentlichen Schlüssel zum privaten Schlüssel ausgeben.`;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} braucht einen Wert`);
      out[a.slice(2)] = v;
      i++;
    } else out._.push(a);
  }
  return out;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readKey(file) {
  if (!fs.existsSync(file)) throw new Error(`Schlüssel ${file} fehlt (erst „keygen“ ausführen)`);
  return crypto.createPrivateKey(fs.readFileSync(file));
}

function rawPublic(key) {
  const der = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("base64");
}

function publicFromRaw(b64) {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("Öffentlicher Schlüssel muss 32 Bytes haben");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: "der", type: "spki" });
}

function keygen(opts) {
  const file = path.resolve(opts.key ?? DEFAULT_KEY);
  if (fs.existsSync(file)) throw new Error(`${file} gibt es schon – nicht überschrieben`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  console.log(`Privater Schlüssel: ${file}`);
  console.log(`Öffentlicher Schlüssel (base64): ${rawPublic(privateKey)}`);
}

function version(exportDir, given) {
  if (given) return given;
  const config = JSON.parse(fs.readFileSync(path.join(exportDir, "config.json"), "utf8"));
  if (!Number.isInteger(config.version)) throw new Error("config.json ohne ganzzahlige version");
  return String(config.version);
}

function pack(opts) {
  if (!opts.export || !opts.out) throw new Error("pack braucht --export und --out");
  const src = path.resolve(opts.export);
  const out = path.resolve(opts.out);
  const v = version(src, opts.version);
  if (!SAFE.test(v)) throw new Error(`Ungültige Version „${v}“`);
  const key = readKey(path.resolve(opts.key ?? DEFAULT_KEY));
  const config = JSON.parse(fs.readFileSync(path.join(src, "config.json"), "utf8"));
  fs.mkdirSync(out, { recursive: true });
  const files = FILES.map((name) => {
    const data = fs.readFileSync(path.join(src, name));
    const asset = `vibefix-v${v}-${name}`;
    fs.writeFileSync(path.join(out, asset), data);
    return { name, asset, size: data.length, sha256: sha256(data) };
  });
  const manifest = { schema: 1, name: "vibefix", version: v, format: config.version, published: new Date().toISOString(), files };
  const body = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(out, "manifest.json"), body);
  const sig = crypto.sign(null, body, key).toString("base64");
  fs.writeFileSync(path.join(out, "manifest.json.sig"), sig + "\n");
  console.log(`VibeFix v${v} (Format ${manifest.format}) nach ${out}:`);
  for (const f of files) console.log(`  ${f.asset}  ${f.size} B  ${f.sha256}`);
  console.log("  manifest.json, manifest.json.sig");
  console.log(`Öffentlicher Schlüssel (base64): ${rawPublic(key)}`);
  console.log(`\nVeröffentlichen:\n  gh release upload ${TAG} --repo ${REPO} --clobber ${[...files.map((f) => f.asset), "manifest.json", "manifest.json.sig"].map((n) => `"${path.join(out, n)}"`).join(" ")}`);
}

function verify(opts) {
  if (!opts.out) throw new Error("verify braucht --out");
  const out = path.resolve(opts.out);
  const pub = opts.pubkey ? publicFromRaw(opts.pubkey) : crypto.createPublicKey(readKey(path.resolve(opts.key ?? DEFAULT_KEY)));
  const body = fs.readFileSync(path.join(out, "manifest.json"));
  const sig = Buffer.from(fs.readFileSync(path.join(out, "manifest.json.sig"), "utf8").trim(), "base64");
  if (!crypto.verify(null, body, pub, sig)) throw new Error("Signatur ungültig");
  const manifest = JSON.parse(body.toString("utf8"));
  for (const f of manifest.files) {
    if (!SAFE.test(f.asset)) throw new Error(`Ungültiger Asset-Name ${f.asset}`);
    const data = fs.readFileSync(path.join(out, f.asset));
    if (data.length !== f.size || sha256(data) !== f.sha256) throw new Error(`${f.asset} passt nicht zum Manifest`);
  }
  console.log(`OK: VibeFix v${manifest.version}, ${manifest.files.length} Dateien, Signatur gültig`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  if (cmd === "keygen") return keygen(opts);
  if (cmd === "pack") return pack(opts);
  if (cmd === "verify") return verify(opts);
  if (cmd === "pubkey") return console.log(rawPublic(readKey(path.resolve(opts.key ?? DEFAULT_KEY))));
  console.log(HELP);
  if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
}

try {
  main();
} catch (e) {
  console.error(`Fehler: ${e.message}`);
  process.exitCode = 1;
}
