const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// The folder where your trusted browser profile will be stored
const PERSISTENT_CONTEXT_DIR = "./persistent_context";

(async () => {
  console.log("🔧 AUTHENTICATION SETUP");

  // Check if we already have a persistent context
  if (fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.log(
      "⚠️  Found existing persistent context. Removing it for fresh start..."
    );
    fs.rmSync(PERSISTENT_CONTEXT_DIR, { recursive: true, force: true });
  }

  console.log("📋 INSTRUCTIONS:");
  console.log("1. A regular Chromium browser will open");
  console.log("2. Sign in to Google");
  console.log(
    "3. Keep the browser open and press ENTER in this terminal when ready"
  );
  console.log("4. The script will then save your authentication state");

  // Launch a regular browser without stealth plugins
  const context = await chromium.launchPersistentContext(
    PERSISTENT_CONTEXT_DIR,
    {
      headless: false,
      // Use minimal args to avoid detection
      args: [
        "--disable-blink-features=AutomationControlled",
        "--exclude-switches=enable-automation",
        "--disable-extensions-except=",
        "--disable-extensions",
        "--no-first-run",
        "--disable-default-apps",
      ],
      // Use standard viewport
      viewport: { width: 1280, height: 720 },
      // Don't override user agent - let it be natural
      locale: "en-US",
    }
  );

  // Use the existing page instead of creating a new one
  const pages = context.pages();
  const page = pages[0];

  // Minimal script injection to remove obvious automation markers
  await page.addInitScript(() => {
    // Only remove the most obvious automation indicators
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    // Remove automation command line switch
    if (window.navigator.userAgent.includes("HeadlessChrome")) {
      Object.defineProperty(navigator, "userAgent", {
        get: () => navigator.userAgent.replace("HeadlessChrome", "Chrome"),
      });
    }
  });

  try {
    await page.goto("https://www.google.com", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for user input
    await new Promise((resolve) => {
      process.stdin.once("data", () => {
        resolve();
      });
    });

    console.log(`💾 Authentication saved to ${PERSISTENT_CONTEXT_DIR}`);
    console.log("🎉 Setup complete! You can now run doodle-digger.js");
    await context.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
    await context.close();
    process.exit(1);
  }
})();
