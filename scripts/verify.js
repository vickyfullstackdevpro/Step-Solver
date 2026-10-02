// scripts/verify.js
// Master automated regression & syntax verification runner
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("\n=======================================================");
console.log("  🔍 STEP SOLVER - AUTOMATED REGRESSION & INTEGRITY CHECK");
console.log("=======================================================\n");

let hasErrors = false;

// 1. Validate manifest.json
process.stdout.write("1. Checking manifest.json integrity... ");
try {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifestContent = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent);
  if (!manifest.name || !manifest.version || !manifest.manifest_version) {
    throw new Error("Missing required manifest keys (name, version, manifest_version)");
  }
  console.log(`✓ OK (v${manifest.version})`);
} catch (err) {
  console.log(`❌ FAILED: ${err.message}`);
  hasErrors = true;
}

// 2. Syntax check core JavaScript files
process.stdout.write("2. Checking JavaScript syntax (node -c)... ");
const jsFiles = [
  "background.js",
  "auth.js",
  "content.js",
  "popup.js",
  "page_protection.js",
  "youtube_loop.js"
];

for (const file of jsFiles) {
  try {
    const fullPath = path.join(__dirname, "..", file);
    if (fs.existsSync(fullPath)) {
      execSync(`node -c "${fullPath}"`, { stdio: "pipe" });
    }
  } catch (err) {
    console.log(`\n   ❌ Syntax Error in ${file}:`);
    console.log(err.stderr?.toString() || err.message);
    hasErrors = true;
  }
}
if (!hasErrors) {
  console.log("✓ OK (All 5 core scripts valid)");
}

// 3. Execute Automated Regression Tests
console.log("3. Running Automated Test Suite (Trial, Parser, Lifecycle)...");
try {
  const testOutput = execSync("node --test test/**/*.test.js", {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });
  console.log(testOutput);
  console.log("   ✓ All regression tests passed successfully!\n");
} catch (err) {
  console.log("   ❌ REGRESSION TEST FAILED:");
  console.log(err.stdout || err.message);
  hasErrors = true;
}

// Final Verdict
console.log("=======================================================");
if (hasErrors) {
  console.log("  ❌ STATUS: VERIFICATION FAILED! DO NOT RELEASE!");
  console.log("  Please fix the issues reported above before committing.");
  console.log("=======================================================\n");
  process.exit(1);
} else {
  console.log("  ✅ STATUS: ALL CHECKS & TESTS PASSED! CODEBASE IS HEALTHY.");
  console.log("=======================================================\n");
  process.exit(0);
}
