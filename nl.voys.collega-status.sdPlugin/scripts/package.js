const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const pluginDir = path.join(__dirname, "..");
const distDir = path.join(pluginDir, "..", "dist");
const pluginName = "nl.voys.collega-status.sdPlugin";
const outputPath = path.join(distDir, pluginName.replace(".sdPlugin", ".streamDeckPlugin"));

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const exclude = ["node_modules", "scripts", "dist", ".git", ".gitignore", "package-lock.json"];

// Work in local temp to avoid UNC issues
const os = require("os");
const tmpDir = path.join(os.tmpdir(), "vpak2");
try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
const stageDir = path.join(tmpDir, pluginName);
fs.mkdirSync(stageDir, { recursive: true });

function copyRecur(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyRecur(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

copyRecur(pluginDir, stageDir);
console.log(`Staged: ${stageDir}`);

const zip = new AdmZip();

function addDir(zip, dir, zipBase) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = zipBase ? path.posix.join(zipBase, e.name) : e.name;
    if (e.isDirectory()) {
      addDir(zip, full, rel);
    } else {
      zip.addLocalFile(full, path.posix.dirname(rel));
    }
  }
}

addDir(zip, stageDir, pluginName);
zip.writeZip(outputPath);

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

const stat = fs.statSync(outputPath);
console.log(`Package: ${outputPath} (${(stat.size / 1024).toFixed(1)} KB)`);
