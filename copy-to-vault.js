const fs = require("fs");
const path = require("path");

// The actual path to your Obsidian vault's plugins folder
const VAULT_PLUGIN_PATH = path.join(
  "/Users/jamesrobertsscott/Desktop/Coding/Obsidian Plugins/Test Vault/.obsidian/plugins",
  "TagIT"
);

// Path for the new 'TagIT - Plugin' folder in the root directory
const ROOT_PLUGIN_PATH = path.join(__dirname, "TagIT - Plugin");

// Files to copy
const FILES_TO_COPY = ["main.js", "manifest.json", "styles.css"];

// Ensure the plugin directories exist
[VAULT_PLUGIN_PATH, ROOT_PLUGIN_PATH].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Copy files
FILES_TO_COPY.forEach((file) => {
  const src = path.join(__dirname, file);
  const vaultDest = path.join(VAULT_PLUGIN_PATH, file);
  const rootDest = path.join(ROOT_PLUGIN_PATH, file);

  if (fs.existsSync(src)) {
    // Copy to Obsidian vault
    fs.copyFileSync(src, vaultDest);
    console.log(`Copied ${file} to ${VAULT_PLUGIN_PATH}`);

    // Copy to root 'TagIT - Plugin' folder
    fs.copyFileSync(src, rootDest);
    console.log(`Copied ${file} to ${ROOT_PLUGIN_PATH}`);
  } else {
    console.log(`${file} does not exist, skipping`);
  }
});

console.log("Files copied successfully!");
