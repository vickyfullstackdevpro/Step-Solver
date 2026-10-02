// scripts/package.js
// Safe, automated 1-click packager for Step Solver extension
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("\n=======================================================");
console.log("  📦 STEP SOLVER - SAFE AUTOMATED RELEASE PACKAGER");
console.log("=======================================================\n");

// Step 1: Run complete verification suite
console.log("Step 1: Running pre-package regression verification...");
try {
  execSync("node scripts/verify.js", {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit"
  });
} catch (err) {
  console.error("\n❌ PACKAGING ABORTED: Tests or verification failed! Refusing to build broken package.\n");
  process.exit(1);
}

// Step 2: Read Version
const manifestPath = path.join(__dirname, "..", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = manifest.version;
const zipName = `step-solver-edge-v${version}.zip`;
const targetZip = path.join(__dirname, "..", zipName);
const releaseDir = path.join(__dirname, "..", "releases", `v${version}`);
const releaseZip = path.join(releaseDir, zipName);

console.log(`Step 2: Packaging Version v${version}...`);

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

// Step 3: Compress extension files
const filesToPack = [
  "manifest.json",
  "background.js",
  "auth.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.js",
  "popup.css",
  "page_protection.js",
  "youtube_loop.js",
  "icons"
];

const fileListString = filesToPack.map(f => `'${f}'`).join(",");
const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path ${fileListString} -DestinationPath '${targetZip}' -Force; Copy-Item '${targetZip}' -Destination '${releaseZip}' -Force"`;

try {
  execSync(psCmd, { cwd: path.join(__dirname, ".."), stdio: "inherit" });
  const stats = fs.statSync(targetZip);
  const sizeKb = (stats.size / 1024).toFixed(1);

  console.log("\n=======================================================");
  console.log(`  🎉 SUCCESS: v${version} PACKAGED SAFELY!`);
  console.log(`  📁 Root Package:    ${zipName} (${sizeKb} KB)`);
  console.log(`  📁 Release Archive: releases/v${version}/${zipName}`);
  console.log("=======================================================\n");
} catch (err) {
  console.error("❌ Failed to create zip package:", err.message);
  process.exit(1);
}
