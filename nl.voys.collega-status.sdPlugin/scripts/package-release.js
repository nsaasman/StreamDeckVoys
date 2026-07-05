const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");

const pluginDir = path.join(__dirname, "..");
const distDir = path.join(pluginDir, "..", "dist");
const pluginName = "nl.voys.collega-status.sdPlugin";
const outputPath = path.join(distDir, "voys-collega-status.streamDeckPlugin");
const docsOutputPath = path.join(distDir, "handleiding.html");

const exclude = [
  "node_modules",
  "scripts",
  "dist",
  ".git",
  ".gitignore",
  "package-lock.json",
  "package.json",
  "plugin.log",
  "run_debug.bat",
];

const SENSITIVE_PATTERNS = [
  /c8a4eb1f-8ad4-43f3-9b36-5fcad1f355b9/i,
  /\b331969\b/,
  /37946d0fd45cd52e334e6fb873fb52bc32d95c09/i,
];

function copyRecur(src, dst) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const sourcePath = path.join(src, entry.name);
    const destPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecur(sourcePath, destPath);
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

function verifyStage(stageDir) {
  const sensitiveHits = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.(js|html|json|bat|log|txt|md|css|sh)$/i.test(entry.name)) continue;

      const rel = path.relative(stageDir, fullPath);
      const content = fs.readFileSync(fullPath, "utf8");

      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(content)) {
          sensitiveHits.push(rel);
          break;
        }
      }
    }
  }

  walk(stageDir);

  if (sensitiveHits.length > 0) {
    throw new Error(`Privacy check failed in: ${sensitiveHits.join(", ")}`);
  }
}

function addDir(zip, dir, zipBase) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = zipBase ? path.posix.join(zipBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      addDir(zip, fullPath, relPath);
    } else {
      zip.addLocalFile(fullPath, path.posix.dirname(relPath));
    }
  }
}

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const tmpDir = path.join(os.tmpdir(), "vpak-release");
try {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}

const stageDir = path.join(tmpDir, pluginName);
fs.mkdirSync(stageDir, { recursive: true });
copyRecur(pluginDir, stageDir);
verifyStage(stageDir);

console.log(`Staged: ${stageDir}`);

const zip = new AdmZip();
addDir(zip, stageDir, pluginName);
zip.writeZip(outputPath);

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}

const stat = fs.statSync(outputPath);
console.log(`Public package: ${outputPath} (${(stat.size / 1024).toFixed(1)} KB)`);

const handleidingSrc = path.join(pluginDir, "docs", "handleiding.html");
if (fs.existsSync(handleidingSrc)) {
  fs.copyFileSync(handleidingSrc, docsOutputPath);
  console.log(`Documentation: ${docsOutputPath}`);
}
