const fs = require("fs");
const path = require("path");

// The actual path to your Obsidian vault's plugins folder
const VAULT_PLUGIN_PATH = path.join(
  "/Users/jamesrobertsscott/Desktop/Coding/Obsidian Plugins/Test Vault/.obsidian/plugins",
  "TagIT"
);

// Files to copy
const FILES_TO_COPY = ["main.js", "manifest.json", "styles.css"];

// Ensure the plugin directory exists
if (!fs.existsSync(VAULT_PLUGIN_PATH)) {
  fs.mkdirSync(VAULT_PLUGIN_PATH, { recursive: true });
}

// Copy files
FILES_TO_COPY.forEach((file) => {
  const src = path.join(__dirname, file);
  const dest = path.join(VAULT_PLUGIN_PATH, file);

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file} to ${VAULT_PLUGIN_PATH}`);
  } else {
    console.log(`${file} does not exist, skipping`);
  }
});

console.log("Files copied successfully!");
