'use strict';

var obsidian = require('obsidian');

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const DEFAULT_SETTINGS = {
    inheritanceMode: "immediate",
    excludedFolders: [],
    showFolderIcons: true,
    autoApplyTags: true,
    debugMode: false,
    showBatchConversionWarning: true,
};
class TagItPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.folderTags = {};
        this.isInitialLoad = true;
        this.newFolderQueue = [];
        this.moveTimeout = null;
    }
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.loadSettings();
                yield this.loadFolderTags();
            }
            catch (error) {
                console.error("Error loading plugin data, initializing with defaults:", error);
                yield this.initializeDataFile();
            }
            console.log("loading TagIt plugin");
            // Delayed initialization
            setTimeout(() => {
                this.isInitialLoad = false;
                this.registerEvent(this.app.vault.on("create", (file) => {
                    if (file instanceof obsidian.TFolder) {
                        this.handleFolderCreation(file);
                    }
                    else if (file instanceof obsidian.TFile) {
                        this.handleFileCreation(file);
                    }
                }));
                // Process the queue every 2 seconds
                this.registerInterval(window.setInterval(() => this.processNewFolderQueue(), 2000));
                // Add event listener for file movement
                this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
                    if (file instanceof obsidian.TFile) {
                        this.handleFileMove(file, oldPath);
                    }
                }));
            }, 2000); // 2 second delay
            // Add command to open tag modal for current folder
            this.addCommand({
                id: "open-folder-tag-modal",
                name: "Add/Edit tags for current folder",
                callback: () => {
                    const activeFile = this.app.workspace.getActiveFile();
                    const folder = activeFile ? activeFile.parent : null;
                    this.openFolderTagModal(folder);
                },
            });
            // Add command to remove all tags from current folder
            this.addCommand({
                id: "remove-folder-tags",
                name: "Remove all tags from current folder",
                callback: () => {
                    const activeFile = this.app.workspace.getActiveFile();
                    const folder = activeFile ? activeFile.parent : null;
                    this.removeFolderTags(folder);
                },
            });
            // Add command to apply file tags to folder
            this.addCommand({
                id: "apply-file-tags-to-folder",
                name: "Apply file tags to folder",
                callback: () => {
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile) {
                        this.applyFileTagsToFolder(activeFile);
                    }
                    else {
                        new obsidian.Notice("No active file");
                    }
                },
            });
            // Add command to convert inline tags to YAML
            this.addCommand({
                id: "convert-inline-tags-to-yaml",
                name: "Convert inline tags to YAML",
                callback: () => {
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile) {
                        this.convertInlineTagsToYAML(activeFile);
                    }
                    else {
                        new obsidian.Notice("No active file");
                    }
                },
            });
            // Register context menu events
            this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source) => {
                if (file instanceof obsidian.TFile && file.extension.toLowerCase() === "md") {
                    menu.addItem((item) => {
                        item
                            .setTitle("Convert to YAML")
                            .setIcon("tag")
                            .onClick(() => {
                            this.batchConvertWithConfirmation([file]);
                        });
                    });
                }
                // Add folder conversion option
                if (file instanceof obsidian.TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle("Convert All Notes to YAML")
                            .setIcon("tag")
                            .onClick(() => {
                            const files = file.children.filter((child) => child instanceof obsidian.TFile &&
                                child.extension.toLowerCase() === "md");
                            this.batchConvertWithConfirmation(files);
                        });
                    });
                }
            }));
            // This adds a settings tab so the user can configure various aspects of the plugin
            this.addSettingTab(new TagItSettingTab(this.app, this));
            this.registerEvent(this.app.vault.on("delete", (file) => {
                if (file instanceof obsidian.TFolder) {
                    this.handleFolderDeletion(file);
                }
            }));
            // Update folder icons when the plugin loads
            this.app.workspace.onLayoutReady(() => {
                this.updateFolderIcons();
            });
            // Update folder icons when files are created, deleted, or renamed
            this.registerEvent(this.app.vault.on("create", () => this.updateFolderIcons()));
            this.registerEvent(this.app.vault.on("delete", () => this.updateFolderIcons()));
            this.registerEvent(this.app.vault.on("rename", () => this.updateFolderIcons()));
            // Add this line to update tags when the plugin loads
            this.app.workspace.onLayoutReady(() => this.updateObsidianTagCache());
            // Update folder icons based on the showFolderIcons setting
            this.app.workspace.onLayoutReady(() => {
                if (this.settings.showFolderIcons) {
                    this.updateFolderIcons();
                }
            });
        });
    }
    onunload() {
        console.log("unloading TagIt plugin");
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const data = (yield this.loadData());
                if (data) {
                    this.settings = Object.assign(Object.assign({}, DEFAULT_SETTINGS), data.settings);
                    this.folderTags = data.folderTags || {};
                }
                else {
                    this.settings = DEFAULT_SETTINGS;
                    this.folderTags = {};
                }
            }
            catch (error) {
                console.error("Failed to load plugin data:", error);
                this.settings = DEFAULT_SETTINGS;
                this.folderTags = {};
            }
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = {
                settings: this.settings,
                folderTags: this.folderTags,
                version: "1.0.0",
            };
            yield this.saveData(data);
        });
    }
    loadFolderTags() {
        return __awaiter(this, void 0, void 0, function* () {
            // This method is now redundant as we're loading both settings and folderTags in loadSettings
            // Keeping it for backwards compatibility
            console.log("Folder tags loaded in loadSettings method");
        });
    }
    saveFolderTags() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = {
                settings: this.settings,
                folderTags: this.folderTags,
                version: "1.0.0",
            };
            yield this.saveData(data);
        });
    }
    handleFolderCreation(folder) {
        if (!this.isInitialLoad) {
            new FolderTagModal(this.app, folder, this, true).open();
        }
    }
    setFolderTags(folderPath, tags) {
        const uniqueTags = this.removeDuplicateTags(tags);
        this.folderTags[folderPath] = uniqueTags;
        this.saveFolderTags();
        this.updateFolderIcons();
        this.updateObsidianTagCache();
    }
    getFolderTags(folderPath) {
        return this.folderTags[folderPath] || [];
    }
    openFolderTagModal(folder) {
        if (folder) {
            new FolderTagModal(this.app, folder, this).open();
        }
        else {
            new obsidian.Notice("No folder selected");
        }
    }
    removeFolderTags(folder) {
        if (folder) {
            this.setFolderTags(folder.path, []);
            new obsidian.Notice(`Removed all tags from folder: ${folder.path}`);
        }
        else {
            new obsidian.Notice("No folder selected");
        }
    }
    handleFileCreation(file) {
        return __awaiter(this, void 0, void 0, function* () {
            // Add more thorough file type checking
            if (!(file instanceof obsidian.TFile) ||
                !file.extension.toLowerCase().match(/^(md|markdown)$/)) {
                return;
            }
            if (!this.settings.autoApplyTags) {
                return; // Don't apply tags if the setting is off
            }
            const folder = file.parent;
            if (folder) {
                const folderTags = this.getFolderTagsWithInheritance(folder.path);
                if (folderTags.length > 0) {
                    yield this.addTagsToFile(file, folderTags);
                    this.updateObsidianTagCache();
                }
            }
        });
    }
    handleFileMove(file, oldPath) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`File moved: ${oldPath} -> ${file.path}`);
            const oldFolderPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
            const newFolder = file.parent;
            console.log(`Old folder path: ${oldFolderPath}, New folder: ${newFolder === null || newFolder === void 0 ? void 0 : newFolder.path}`);
            if (oldFolderPath !== (newFolder === null || newFolder === void 0 ? void 0 : newFolder.path)) {
                const oldFolderTags = this.getFolderTagsWithInheritance(oldFolderPath);
                const newFolderTags = this.getFolderTagsWithInheritance((newFolder === null || newFolder === void 0 ? void 0 : newFolder.path) || "");
                // Only proceed if the tags are different
                if (JSON.stringify(oldFolderTags.sort()) !==
                    JSON.stringify(newFolderTags.sort())) {
                    console.log(`Old folder tags: ${oldFolderTags.join(", ")}`);
                    console.log(`New folder tags: ${newFolderTags.join(", ")}`);
                    const conflictingTags = this.detectConflictingTags(file);
                    console.log(`Conflicting tags: ${conflictingTags.join(", ")}`);
                    if (conflictingTags.length > 0) {
                        new ConflictResolutionModal(this.app, file, conflictingTags, this).open();
                    }
                    else {
                        new FileMovedModal(this.app, file, oldFolderTags, newFolderTags, this).open();
                    }
                }
                else {
                    console.log("Folder tags are the same, no update needed");
                }
            }
            else {
                console.log("File not moved between folders or folders are the same");
            }
        });
    }
    addTagsToFile(file, tagsToAdd) {
        return __awaiter(this, void 0, void 0, function* () {
            const content = yield this.app.vault.read(file);
            const existingTags = this.extractTagsFromContent(content);
            // Only add tags that don't already exist
            const newTags = tagsToAdd.filter((tag) => !existingTags.includes(tag));
            const allTags = [...existingTags, ...newTags];
            // Only update if there are new tags to add
            if (newTags.length > 0) {
                const updatedContent = this.updateTagsInContent(content, allTags);
                yield this.app.vault.modify(file, updatedContent);
                this.updateObsidianTagCache();
                if (this.settings.debugMode) {
                    console.log(`Added new tags to ${file.name}:`, newTags);
                }
            }
            else if (this.settings.debugMode) {
                console.log(`No new tags to add to ${file.name}`);
            }
        });
    }
    updateFileTags(file, oldFolderTags, newFolderTags) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Updating tags for file: ${file.name}`);
            console.log(`Old folder tags: ${oldFolderTags.join(", ")}`);
            console.log(`New folder tags: ${newFolderTags.join(", ")}`);
            const content = yield this.app.vault.read(file);
            const existingTags = this.extractTagsFromContent(content);
            console.log(`Existing tags: ${existingTags.join(", ")}`);
            // Remove old folder tags and keep manual tags
            const manualTags = existingTags.filter((tag) => !oldFolderTags.includes(tag));
            // Add new folder tags
            const updatedTags = [...new Set([...manualTags, ...newFolderTags])];
            console.log(`Manual tags: ${manualTags.join(", ")}`);
            console.log(`Updated tags: ${updatedTags.join(", ")}`);
            const updatedContent = this.updateTagsInContent(content, updatedTags);
            if (content !== updatedContent) {
                yield this.app.vault.modify(file, updatedContent);
                console.log(`Tags updated for file: ${file.name}`);
            }
            else {
                console.log(`No changes needed for file: ${file.name}`);
            }
        });
    }
    updateTagsInContent(content, tags) {
        // Ensure tags are unique while preserving order
        const uniqueTags = [...new Set(tags)];
        if (uniqueTags.length === 0) {
            return this.removeYamlFrontMatter(content);
        }
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        // Create the tags section in YAML format
        const tagSection = uniqueTags.map((tag) => `  - ${tag}`).join("\n");
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            // Remove existing tags section while preserving other frontmatter
            const cleanedFrontmatter = frontmatter
                .replace(/tags:[\s\S]*?(?=\n[^\s]|\n$)/m, "")
                .replace(/\n+/g, "\n")
                .trim();
            // Add new tags section
            const updatedFrontmatter = cleanedFrontmatter
                ? `${cleanedFrontmatter}\ntags:\n${tagSection}`
                : `tags:\n${tagSection}`;
            return content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---`);
        }
        else {
            return `---\ntags:\n${tagSection}\n---\n\n${content}`;
        }
    }
    addTagsToContent(content, tags) {
        if (tags.length === 0) {
            return content;
        }
        const tagSection = tags.map((tag) => `  - ${tag}`).join("\n");
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            const updatedFrontmatter = `${frontmatter.trim()}\ntags:\n${tagSection}`;
            return content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---`);
        }
        else {
            return `---\ntags:\n${tagSection}\n---\n\n${content}`;
        }
    }
    removeTagsFromContent(content, tagsToRemove) {
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            const existingTags = frontmatter.match(/tags:\s*\[(.*?)\]/);
            if (existingTags) {
                const currentTags = existingTags[1].split(",").map((tag) => tag.trim());
                const updatedTags = currentTags.filter((tag) => !tagsToRemove.includes(tag));
                const updatedFrontmatter = frontmatter.replace(/tags:\s*\[.*?\]/, `tags: [${updatedTags.join(", ")}]`);
                return content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---`);
            }
        }
        return content;
    }
    applyFileTagsToFolder(file) {
        return __awaiter(this, void 0, void 0, function* () {
            const folder = file.parent;
            if (!folder) {
                new obsidian.Notice("File is not in a folder");
                return;
            }
            const content = yield this.app.vault.read(file);
            const fileTags = this.extractTagsFromContent(content);
            console.log(`Extracted tags from file: ${fileTags.join(", ")}`);
            if (fileTags.length === 0) {
                new obsidian.Notice("No tags found in the file");
                return;
            }
            // Get tags only from the immediate parent folder
            const folderTags = this.getFolderTags(folder.path);
            const newTags = [...new Set([...folderTags, ...fileTags])];
            const addedTags = newTags.filter((tag) => !folderTags.includes(tag));
            console.log(`Existing folder tags: ${folderTags.join(", ")}`);
            console.log(`New tags to add: ${addedTags.join(", ")}`);
            if (addedTags.length === 0) {
                new obsidian.Notice("No new tags to add to the folder");
                return;
            }
            new TagSelectionModal(this.app, `Select tags to add from the file "${file.name}" to the folder "${folder.name}":`, addedTags, (selectedTags) => {
                const updatedTags = [...new Set([...folderTags, ...selectedTags])];
                this.setFolderTags(folder.path, updatedTags);
                new obsidian.Notice(`Applied ${selectedTags.length} tags from file to folder: ${folder.name}`);
            }).open();
        });
    }
    extractTagsFromContent(content) {
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        let tags = [];
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            // Match both array-style and list-style YAML tags
            const yamlTags = frontmatter.match(/tags:\s*(\[.*?\]|(\n\s*-\s*.+)+)/);
            if (yamlTags) {
                const tagContent = yamlTags[1];
                if (tagContent.startsWith("[")) {
                    // Array-style tags
                    tags = tagContent
                        .slice(1, -1)
                        .split(",")
                        .map((tag) => tag.trim());
                }
                else {
                    // List-style tags
                    tags = tagContent
                        .split("\n")
                        .map((line) => line.replace(/^\s*-\s*/, "").trim())
                        .filter((tag) => tag);
                }
            }
        }
        // Extract inline tags
        const inlineTags = content.match(/#[^\s#]+/g);
        if (inlineTags) {
            tags = [...tags, ...inlineTags.map((tag) => tag.substring(1))];
        }
        return [...new Set(tags)]; // Remove duplicates
    }
    convertInlineTagsToYAML(file) {
        return __awaiter(this, void 0, void 0, function* () {
            const content = yield this.app.vault.read(file);
            const inlineTags = content.match(/#[^\s#]+/g);
            if (!inlineTags) {
                new obsidian.Notice("No inline tags found in the file");
                return;
            }
            const newTags = inlineTags.map((tag) => tag.substring(1));
            new ConfirmationModal(this.app, `This will convert ${newTags.length} inline tags to YAML front matter and remove them from the content. Are you sure you want to proceed?`, () => __awaiter(this, void 0, void 0, function* () {
                new TagSelectionModal(this.app, `Select inline tags to convert to YAML front matter:`, newTags, (selectedTags) => __awaiter(this, void 0, void 0, function* () {
                    if (selectedTags.length === 0) {
                        new obsidian.Notice("No tags selected for conversion");
                        return;
                    }
                    // Extract existing YAML tags
                    const existingTags = this.extractTagsFromContent(content);
                    // Combine existing and new tags, removing duplicates
                    const allTags = [...new Set([...existingTags, ...selectedTags])];
                    let updatedContent = this.addTagsToContent(content, allTags);
                    // Remove selected inline tags from the content
                    selectedTags.forEach((tag) => {
                        const regex = new RegExp(`#${tag}\\b`, "g");
                        updatedContent = updatedContent.replace(regex, "");
                    });
                    yield this.app.vault.modify(file, updatedContent);
                    new obsidian.Notice(`Converted ${selectedTags.length} inline tags to YAML front matter`);
                })).open();
            })).open();
        });
    }
    handleFolderDeletion(folder) {
        delete this.folderTags[folder.path];
        this.saveFolderTags();
    }
    applyFolderTagsToContents(folder) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!folder) {
                console.error("Folder is null or undefined");
                return;
            }
            const folderTags = this.getFolderTags(folder.path);
            const files = folder.children.filter((child) => child instanceof obsidian.TFile);
            let updatedCount = 0;
            for (const file of files) {
                if (file instanceof obsidian.TFile) {
                    const content = yield this.app.vault.read(file);
                    const existingTags = this.extractTagsFromContent(content);
                    const newTags = folderTags.filter((tag) => !existingTags.includes(tag));
                    if (newTags.length > 0) {
                        yield this.addTagsToFile(file, newTags);
                        updatedCount++;
                    }
                }
            }
            if (updatedCount > 0) {
                new obsidian.Notice(`Updated tags for ${updatedCount} file(s)`);
            }
            else {
                new obsidian.Notice("No files needed tag updates");
            }
        });
    }
    initializeDataFile() {
        return __awaiter(this, void 0, void 0, function* () {
            const initialData = {
                settings: DEFAULT_SETTINGS,
                folderTags: {},
            };
            this.settings = Object.assign({}, DEFAULT_SETTINGS);
            this.folderTags = {};
            yield this.saveData(initialData);
            console.log("Initialized data file with default values");
        });
    }
    queueNewFolder(folder) {
        // Ensure we have the most up-to-date folder object
        const updatedFolder = this.app.vault.getAbstractFileByPath(folder.path);
        if (updatedFolder instanceof obsidian.TFolder) {
            this.newFolderQueue.push(updatedFolder);
        }
        else {
            console.error(`Failed to get updated folder object for path: ${folder.path}`);
        }
    }
    processNewFolderQueue() {
        return __awaiter(this, void 0, void 0, function* () {
            for (const folder of this.newFolderQueue) {
                yield this.promptForFolderTags(folder);
            }
            this.newFolderQueue = []; // Clear the queue
        });
    }
    promptForFolderTags(folder) {
        return __awaiter(this, void 0, void 0, function* () {
            new FolderTagModal(this.app, folder, this, true).open();
        });
    }
    getFolderTagsWithInheritance(folderPath) {
        if (this.settings.inheritanceMode === "none") {
            return this.getFolderTags(folderPath);
        }
        let tags = [];
        let currentPath = folderPath;
        while (currentPath) {
            if (!this.settings.excludedFolders.includes(currentPath)) {
                tags = [...new Set([...tags, ...this.getFolderTags(currentPath)])];
            }
            if (this.settings.inheritanceMode === "immediate" &&
                currentPath !== folderPath) {
                break;
            }
            const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
            if (parentPath === currentPath) {
                break; // We've reached the root
            }
            currentPath = parentPath;
        }
        return tags;
    }
    updateFolderIcons() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.settings.showFolderIcons) {
                // Remove all folder icons if the setting is off
                this.app.workspace.getLeavesOfType("file-explorer").forEach((leaf) => {
                    const fileExplorerView = leaf.view;
                    const fileItems = fileExplorerView.fileItems;
                    for (const [, item] of Object.entries(fileItems)) {
                        if (item && typeof item === "object" && "el" in item) {
                            const folderEl = item.el;
                            const iconEl = folderEl.querySelector(".nav-folder-title-content");
                            if (iconEl) {
                                iconEl.removeClass("tagged-folder");
                                iconEl.removeAttribute("aria-label");
                            }
                        }
                    }
                });
                return;
            }
            const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
            if (!fileExplorer)
                return;
            const fileExplorerView = fileExplorer.view;
            const fileItems = fileExplorerView.fileItems;
            for (const [path, item] of Object.entries(fileItems)) {
                if (item &&
                    typeof item === "object" &&
                    "el" in item &&
                    "file" in item &&
                    item.file instanceof obsidian.TFolder) {
                    const folderTags = this.getFolderTagsWithInheritance(path);
                    const folderEl = item.el;
                    const iconEl = folderEl.querySelector(".nav-folder-title-content");
                    if (iconEl) {
                        if (folderTags.length > 0) {
                            iconEl.addClass("tagged-folder");
                            iconEl.setAttribute("aria-label", `Tagged folder: ${folderTags.join(", ")}`);
                        }
                        else {
                            iconEl.removeClass("tagged-folder");
                            iconEl.removeAttribute("aria-label");
                        }
                    }
                    else {
                        console.warn(`Could not find icon element for folder: ${path}`);
                    }
                }
            }
        });
    }
    // Add this new method
    updateObsidianTagCache() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Trigger metadata cache update
                this.app.metadataCache.trigger("changed");
                // Try to refresh the tag pane if it exists
                const tagPaneLeaves = this.app.workspace.getLeavesOfType("tag");
                if (tagPaneLeaves.length > 0) {
                    // Use the workspace trigger instead of directly calling refresh
                    this.app.workspace.trigger("tags-updated");
                }
            }
            catch (error) {
                if (this.settings.debugMode) {
                    console.error("Failed to update tag cache:", error);
                }
            }
        });
    }
    // Add this new method
    getAllFolderTags() {
        const allTags = new Set();
        for (const tags of Object.values(this.folderTags)) {
            tags.forEach((tag) => allTags.add(tag));
        }
        return Array.from(allTags);
    }
    replaceAllTags(file, newTags) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Replacing all tags for file: ${file.name}`);
            console.log(`New tags: ${newTags.join(", ")}`);
            const content = yield this.app.vault.read(file);
            // Remove all existing tags from the content
            let updatedContent = this.removeAllTagsFromContent(content);
            // Add new tags
            if (newTags.length > 0) {
                const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
                const frontmatterMatch = updatedContent.match(frontmatterRegex);
                if (frontmatterMatch) {
                    const frontmatter = frontmatterMatch[1];
                    const newTagsSection = `tags:\n${newTags
                        .map((tag) => `  - ${tag}`)
                        .join("\n")}`;
                    const updatedFrontmatter = `${frontmatter.trim()}\n${newTagsSection}`;
                    updatedContent = updatedContent.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---`);
                }
                else {
                    const newTagsSection = `tags:\n${newTags
                        .map((tag) => `  - ${tag}`)
                        .join("\n")}`;
                    updatedContent = `---\n${newTagsSection}\n---\n\n${updatedContent}`;
                }
            }
            yield this.app.vault.modify(file, updatedContent);
            this.updateObsidianTagCache();
            new obsidian.Notice(`Tags replaced for file: ${file.name}`);
        });
    }
    removeAllTagsFromContent(content) {
        const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
        return content.replace(frontmatterRegex, "");
    }
    mergeTags(file, oldTags, newTags) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Merging tags for file: ${file.name}`);
            console.log(`Old tags: ${oldTags.join(", ")}`);
            console.log(`New tags: ${newTags.join(", ")}`);
            const content = yield this.app.vault.read(file);
            const existingTags = this.extractTagsFromContent(content);
            console.log(`Existing tags: ${existingTags.join(", ")}`);
            // Remove old folder tags
            const manualTags = existingTags.filter((tag) => !oldTags.includes(tag));
            // Merge manual tags with new folder tags, ensuring no duplicates
            const mergedTags = [...new Set([...manualTags, ...newTags])];
            console.log(`Merged tags: ${mergedTags.join(", ")}`);
            if (JSON.stringify(existingTags.sort()) !== JSON.stringify(mergedTags.sort())) {
                const updatedContent = this.updateTagsInContent(content, mergedTags);
                yield this.app.vault.modify(file, updatedContent);
                this.updateObsidianTagCache();
                new obsidian.Notice(`Tags merged for file: ${file.name}`);
            }
            else {
                console.log(`No changes needed for file: ${file.name}`);
            }
        });
    }
    applyFolderTagsToNotes(folder) {
        return __awaiter(this, void 0, void 0, function* () {
            const currentFolderTags = this.getFolderTags(folder.path);
            console.log(`Current folder tags: ${currentFolderTags.join(", ")}`);
            if (currentFolderTags.length === 0) {
                new obsidian.Notice("This folder has no tags to apply.");
                return;
            }
            const files = folder.children.filter((child) => child instanceof obsidian.TFile);
            let updatedCount = 0;
            for (const file of files) {
                try {
                    console.log(`Processing file: ${file.name}`);
                    const content = yield this.app.vault.read(file);
                    const existingTags = this.extractTagsFromContent(content);
                    // Get the current folder's existing tags in the file
                    const existingFolderTags = existingTags.filter((tag) => this.getFolderTags(folder.path).includes(tag));
                    // Get manually added tags (tags that aren't from the folder)
                    const manualTags = existingTags.filter((tag) => !existingFolderTags.includes(tag));
                    // Combine manual tags with current folder tags
                    const updatedTags = [...manualTags, ...currentFolderTags];
                    // Only update if there are changes
                    if (JSON.stringify(existingTags.sort()) !==
                        JSON.stringify(updatedTags.sort())) {
                        console.log(`Existing tags: ${existingTags.join(", ")}`);
                        console.log(`Manual tags: ${manualTags.join(", ")}`);
                        console.log(`Updated tags: ${updatedTags.join(", ")}`);
                        const updatedContent = this.updateTagsInContent(content, updatedTags);
                        yield this.app.vault.modify(file, updatedContent);
                        updatedCount++;
                        console.log(`Updated tags for file: ${file.name}`);
                    }
                    else {
                        console.log(`No changes needed for file: ${file.name}`);
                    }
                }
                catch (error) {
                    console.error(`Error processing file ${file.name}:`, error);
                    new obsidian.Notice(`Error updating tags for file: ${file.name}`);
                }
            }
            if (updatedCount > 0) {
                new obsidian.Notice(`Updated tags for ${updatedCount} file(s) in ${folder.name}`);
            }
            else {
                new obsidian.Notice(`No files needed tag updates in ${folder.name}`);
            }
        });
    }
    // Add this helper method to check if a tag is used by any folder
    isAnyFolderTag(tag) {
        return Object.values(this.folderTags).some((folderTags) => folderTags.includes(tag));
    }
    removeTagsFromFile(file, tagsToRemove) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Removing folder tags from file: ${file.name}`);
            console.log(`Tags to remove: ${tagsToRemove.join(", ")}`);
            const content = yield this.app.vault.read(file);
            const existingTags = this.extractTagsFromContent(content);
            console.log(`Existing tags: ${existingTags.join(", ")}`);
            // Keep all tags that are not in tagsToRemove
            const updatedTags = existingTags.filter((tag) => !tagsToRemove.includes(tag));
            console.log(`Updated tags: ${updatedTags.join(", ")}`);
            // Use updateTagsInContent to update the file's content
            let updatedContent;
            if (updatedTags.length > 0) {
                updatedContent = this.updateTagsInContent(content, updatedTags);
            }
            else {
                // If no tags remain, remove the entire YAML front matter
                updatedContent = this.removeYamlFrontMatter(content);
            }
            // Only modify the file if the content has changed
            if (content !== updatedContent) {
                yield this.app.vault.modify(file, updatedContent);
                console.log(`Updated content for file: ${file.name}`);
                this.updateObsidianTagCache();
                new obsidian.Notice(`Removed folder tags from file: ${file.name}`);
            }
            else {
                console.log(`No changes needed for file: ${file.name}`);
            }
        });
    }
    removeYamlFrontMatter(content) {
        const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
        return content.replace(frontmatterRegex, "");
    }
    detectConflictingTags(file) {
        const parentFolders = this.getParentFolders(file);
        const allTags = parentFolders.flatMap((folder) => this.getFolderTags(folder.path));
        return allTags.filter((tag, index, self) => self.indexOf(tag) !== index);
    }
    getParentFolders(file) {
        const folders = [];
        let currentFolder = file.parent;
        while (currentFolder) {
            folders.push(currentFolder);
            currentFolder = currentFolder.parent;
        }
        return folders;
    }
    removeDuplicateTags(tags) {
        return [...new Set(tags)];
    }
    removeFolderIcons() {
        // Current implementation might miss some elements
        // Add more robust element selection and cleanup
        this.app.workspace.getLeavesOfType("file-explorer").forEach((leaf) => {
            const fileExplorerView = leaf.view;
            const fileItems = fileExplorerView.fileItems;
            for (const [, item] of Object.entries(fileItems)) {
                if (item && typeof item === "object" && "el" in item) {
                    const folderEl = item.el;
                    const iconEl = folderEl.querySelector(".nav-folder-title-content");
                    if (iconEl) {
                        iconEl.removeClass("tagged-folder");
                        iconEl.removeAttribute("aria-label");
                        // Also remove any other custom classes or attributes
                        iconEl.removeAttribute("data-tagit");
                    }
                }
            }
        });
    }
    handleFileMovement(file) {
        return __awaiter(this, void 0, void 0, function* () {
            // Add debouncing to prevent multiple rapid file movements from causing issues
            if (this.moveTimeout) {
                clearTimeout(this.moveTimeout);
            }
            this.moveTimeout = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                // Existing file movement logic
            }), 300);
        });
    }
    migrateSettings(oldData) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("Migrating settings from old version");
            // For now, just return the default settings merged with any valid old settings
            return Object.assign(Object.assign({}, DEFAULT_SETTINGS), {
                inheritanceMode: oldData.inheritanceMode || DEFAULT_SETTINGS.inheritanceMode,
                excludedFolders: oldData.excludedFolders || DEFAULT_SETTINGS.excludedFolders,
                showFolderIcons: oldData.showFolderIcons || DEFAULT_SETTINGS.showFolderIcons,
                autoApplyTags: oldData.autoApplyTags || DEFAULT_SETTINGS.autoApplyTags,
                debugMode: oldData.debugMode || DEFAULT_SETTINGS.debugMode,
            });
        });
    }
    checkAndRemoveDuplicateTags(folder) {
        return __awaiter(this, void 0, void 0, function* () {
            const files = folder.children.filter((child) => child instanceof obsidian.TFile);
            let processedCount = 0;
            let duplicatesFound = 0;
            for (const file of files) {
                try {
                    console.log(`Checking file: ${file.name}`);
                    const content = yield this.app.vault.read(file);
                    // Extract YAML front matter
                    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
                    const frontmatterMatch = content.match(frontmatterRegex);
                    if (frontmatterMatch) {
                        const frontmatter = frontmatterMatch[1];
                        const existingTags = this.extractTagsFromContent(content);
                        // Check for duplicates by comparing lengths
                        const uniqueTags = [...new Set(existingTags)];
                        if (uniqueTags.length < existingTags.length) {
                            console.log(`Found duplicates in file: ${file.name}`);
                            console.log(`Original tags: ${existingTags.join(", ")}`);
                            console.log(`Unique tags: ${uniqueTags.join(", ")}`);
                            // Create new YAML front matter with unique tags
                            const updatedContent = this.updateTagsInContent(content, uniqueTags);
                            yield this.app.vault.modify(file, updatedContent);
                            duplicatesFound++;
                            console.log(`Removed duplicate tags from file: ${file.name}`);
                        }
                    }
                    processedCount++;
                }
                catch (error) {
                    console.error(`Error processing file ${file.name}:`, error);
                }
            }
            if (duplicatesFound > 0) {
                new obsidian.Notice(`Removed duplicates from ${duplicatesFound} out of ${processedCount} files.`);
            }
            else {
                new obsidian.Notice(`No duplicates found in ${processedCount} files.`);
            }
        });
    }
    batchConvertInlineTagsToYAML(files) {
        return __awaiter(this, void 0, void 0, function* () {
            let processedCount = 0;
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            for (const file of files) {
                try {
                    if (file.extension.toLowerCase() !== "md") {
                        continue;
                    }
                    console.log(`Processing file: ${file.name}`);
                    const content = yield this.app.vault.read(file);
                    // Skip YAML front matter if it exists
                    const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
                    const frontmatterMatch = content.match(frontmatterRegex);
                    const contentWithoutYaml = frontmatterMatch
                        ? content.slice(frontmatterMatch[0].length)
                        : content;
                    // Get first three lines after YAML
                    const firstThreeLines = contentWithoutYaml.split("\n", 3).join("\n");
                    const inlineTags = firstThreeLines.match(/#[^\s#]+/g);
                    if (!inlineTags) {
                        console.log(`No inline tags found in first three lines of: ${file.name}`);
                        continue;
                    }
                    const newTags = inlineTags.map((tag) => tag.substring(1));
                    const existingTags = this.extractTagsFromContent(content);
                    const allTags = [...new Set([...existingTags, ...newTags])];
                    // Remove inline tags from first three lines while preserving YAML
                    let updatedContent = content;
                    if (frontmatterMatch) {
                        const contentLines = contentWithoutYaml.split("\n");
                        for (let i = 0; i < Math.min(3, contentLines.length); i++) {
                            contentLines[i] = contentLines[i].replace(/#[^\s#]+/g, "").trim();
                        }
                        updatedContent =
                            frontmatterMatch[0] + this.cleanEmptyLines(contentLines.join("\n"));
                    }
                    else {
                        const contentLines = content.split("\n");
                        for (let i = 0; i < Math.min(3, contentLines.length); i++) {
                            contentLines[i] = contentLines[i].replace(/#[^\s#]+/g, "").trim();
                        }
                        updatedContent = this.cleanEmptyLines(contentLines.join("\n"));
                    }
                    // Add tags to YAML front matter
                    updatedContent = this.updateTagsInContent(updatedContent, allTags);
                    yield this.app.vault.modify(file, updatedContent);
                    successCount++;
                    console.log(`Successfully converted tags in: ${file.name}`);
                }
                catch (error) {
                    console.error(`Error processing file ${file.name}:`, error);
                    errorCount++;
                    errors.push(file.name);
                }
                processedCount++;
            }
            // Show summary popup
            new BatchConversionResultModal(this.app, processedCount, successCount, errorCount, errors).open();
        });
    }
    batchConvertWithConfirmation(files) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.settings.showBatchConversionWarning) {
                new BatchConversionWarningModal(this.app, files, this).open();
            }
            else {
                yield this.batchConvertInlineTagsToYAML(files);
            }
        });
    }
    cleanEmptyLines(content) {
        return content
            .split("\n")
            .filter((line, index, array) => {
            // Keep non-empty lines
            if (line.trim())
                return true;
            // Keep single empty lines between content
            if (index > 0 && index < array.length - 1) {
                const prevLine = array[index - 1].trim();
                const nextLine = array[index + 1].trim();
                return prevLine && nextLine;
            }
            return false;
        })
            .join("\n");
    }
}
class FolderTagModal extends obsidian.Modal {
    constructor(app, folder, plugin, isNewFolder = false) {
        super(app);
        this.tags = "";
        this.folder = folder;
        this.plugin = plugin;
        this.isNewFolder = isNewFolder;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Add/Edit Folder Tags" });
        // Folder name field
        new obsidian.Setting(contentEl).setName("Folder Name").addText((text) => {
            this.folderNameInput = text;
            text.setValue(this.folder.name);
            text.inputEl.addEventListener("keydown", this.handleEnter.bind(this));
            return text;
        });
        // Tags field
        new obsidian.Setting(contentEl).setName("Tags").addText((text) => {
            this.tagsInput = text;
            const existingTags = this.plugin.getFolderTags(this.folder.path);
            this.tags = existingTags.join(", ");
            text.setValue(this.tags);
            text.setPlaceholder("Enter tags, comma-separated").onChange((value) => {
                this.tags = value;
            });
            text.inputEl.addEventListener("keydown", this.handleEnter.bind(this));
            return text;
        });
        // Cancel and Save buttons (order swapped)
        new obsidian.Setting(contentEl)
            .addButton((btn) => btn.setButtonText("Cancel").onClick(() => {
            this.close();
        }))
            .addButton((btn) => btn
            .setButtonText("Save")
            .setCta()
            .onClick(() => {
            this.saveFolderTags();
        }));
    }
    handleEnter(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            this.saveFolderTags();
        }
    }
    saveFolderTags() {
        return __awaiter(this, void 0, void 0, function* () {
            const newFolderName = this.folderNameInput.getValue();
            let folderPath = this.folder.path;
            if (newFolderName !== this.folder.name) {
                try {
                    const newPath = this.folder.parent
                        ? `${this.folder.parent.path}/${newFolderName}`
                        : newFolderName;
                    yield this.app.fileManager.renameFile(this.folder, newPath);
                    console.log(`Renamed folder from ${this.folder.name} to ${newFolderName}`);
                    // Wait for a short time to allow the file system to update
                    yield new Promise((resolve) => setTimeout(resolve, 100));
                    // Update folder reference and path
                    const newFolder = this.app.vault.getAbstractFileByPath(newPath);
                    if (newFolder instanceof obsidian.TFolder) {
                        this.folder = newFolder;
                        folderPath = newPath;
                    }
                    else {
                        console.warn(`Could not get new folder object, using new path: ${newPath}`);
                        folderPath = newPath;
                    }
                }
                catch (error) {
                    console.error(`Failed to rename folder: ${error}`);
                    new obsidian.Notice(`Failed to rename folder: ${error}`);
                    // Continue with the original folder name and path
                }
            }
            // Ensure folderPath doesn't start with '//'
            folderPath = folderPath.replace(/^\/+/, "");
            const tagArray = this.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag !== "");
            // Check for number-only tags
            const numberOnlyTags = tagArray.filter((tag) => /^\d+$/.test(tag));
            if (numberOnlyTags.length > 0) {
                new obsidian.Notice(`Error: Number-only tags are not allowed. Please remove: ${numberOnlyTags.join(", ")}`);
                return;
            }
            this.plugin.setFolderTags(folderPath, tagArray);
            console.log(`Saved tags for folder ${folderPath}: ${tagArray.join(", ")}`);
            new obsidian.Notice(`Tags saved for folder: ${folderPath}`);
            if (this.isNewFolder) {
                yield this.plugin.applyFolderTagsToContents(this.folder);
                console.log(`Applied tags to contents of new folder: ${folderPath}`);
            }
            this.close();
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
class TagItSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        // Add logo container with specific styling
        const logoContainer = containerEl.createDiv("tagit-logo-container");
        logoContainer.innerHTML = `
      <div style="text-align: center; margin-bottom: 2em;">
        <svg width="52" height="21" viewBox="0 0 52 21" fill="none" xmlns="http://www.w3.org/2000/svg"> 
          <path fill-rule="evenodd" clip-rule="evenodd" d="M1.04763 4.1508C0.382688 4.72075 0 5.5528 0 6.42857V17.0488C0 18.7056 1.34315 20.0488 3 20.0488H11C12.6569 20.0488 14 18.7056 14 17.0488V6.42857C14 5.5528 13.6173 4.72075 12.9524 4.1508L8.95237 0.72223C7.82891 -0.240743 6.1711 -0.240744 5.04763 0.72223L1.04763 4.1508ZM7.10318 13.6092L6.67568 16.0488H8.64706L9.07801 13.6092H10.5548V11.9659H9.36829L9.54915 10.942H11V9.31141H9.8372L10.2369 7.04877H8.25278L7.85629 9.31141H6.842L7.23529 7.04877H5.27663L4.87694 9.31141H3.45787V10.942H4.5889L4.40803 11.9659H3V13.6092H4.11775L3.6868 16.0488H5.67091L6.09496 13.6092H7.10318ZM7.39113 11.9659L7.57055 10.942H6.55856L6.38059 11.9659H7.39113Z" fill="currentColor"/>
          <path d="M35.6983 15.4424C35.1143 15.4424 34.5943 15.3344 34.1383 15.1184C33.6903 14.9024 33.3303 14.5984 33.0583 14.2064L33.7543 13.4984C33.9863 13.7944 34.2623 14.0184 34.5823 14.1704C34.9023 14.3304 35.2823 14.4104 35.7223 14.4104C36.3063 14.4104 36.7663 14.2544 37.1023 13.9424C37.4463 13.6384 37.6183 13.2264 37.6183 12.7064V11.2904L37.8103 10.0064L37.6183 8.73438V7.23438H38.6983V12.7064C38.6983 13.2504 38.5703 13.7264 38.3143 14.1344C38.0663 14.5424 37.7143 14.8624 37.2583 15.0944C36.8103 15.3264 36.2903 15.4424 35.6983 15.4424ZM35.6983 12.8384C35.1783 12.8384 34.7103 12.7144 34.2943 12.4664C33.8863 12.2184 33.5623 11.8784 33.3223 11.4464C33.0823 11.0064 32.9623 10.5144 32.9623 9.97038C32.9623 9.42638 33.0823 8.94238 33.3223 8.51838C33.5623 8.08638 33.8863 7.74638 34.2943 7.49838C34.7103 7.24238 35.1783 7.11438 35.6983 7.11438C36.1463 7.11438 36.5423 7.20238 36.8863 7.37838C37.2303 7.55438 37.5023 7.80238 37.7023 8.12238C37.9103 8.43438 38.0223 8.80238 38.0383 9.22638V10.7384C38.0143 11.1544 37.8983 11.5224 37.6903 11.8424C37.4903 12.1544 37.2183 12.3984 36.8743 12.5744C36.5303 12.7504 36.1383 12.8384 35.6983 12.8384ZM35.9143 11.8184C36.2663 11.8184 36.5743 11.7424 36.8383 11.5904C37.1103 11.4384 37.3183 11.2264 37.4623 10.9544C37.6063 10.6744 37.6783 10.3504 37.6783 9.98238C37.6783 9.61438 37.6023 9.29438 37.4503 9.02238C37.3063 8.74238 37.1023 8.52638 36.8383 8.37438C36.5743 8.21438 36.2623 8.13438 35.9023 8.13438C35.5423 8.13438 35.2263 8.21438 34.9543 8.37438C34.6823 8.52638 34.4663 8.74238 34.3063 9.02238C34.1543 9.29438 34.0783 9.61038 34.0783 9.97038C34.0783 10.3304 34.1543 10.6504 34.3063 10.9304C34.4663 11.2104 34.6823 11.4304 34.9543 11.5904C35.2343 11.7424 35.5543 11.8184 35.9143 11.8184Z" fill="currentColor"/>
          <path d="M28.774 13.0544C28.254 13.0544 27.782 12.9264 27.358 12.6704C26.934 12.4064 26.598 12.0504 26.35 11.6024C26.11 11.1544 25.99 10.6504 25.99 10.0904C25.99 9.53038 26.11 9.02638 26.35 8.57838C26.598 8.13038 26.93 7.77438 27.346 7.51038C27.77 7.24638 28.246 7.11438 28.774 7.11438C29.206 7.11438 29.59 7.20638 29.926 7.39038C30.27 7.56638 30.546 7.81438 30.754 8.13438C30.962 8.44638 31.078 8.81038 31.102 9.22638V10.9424C31.078 11.3504 30.962 11.7144 30.754 12.0344C30.554 12.3544 30.282 12.6064 29.938 12.7904C39.602 12.9664 29.214 13.0544 28.774 13.0544ZM28.954 12.0344C29.49 12.0344 29.922 11.8544 30.25 11.4944C30.578 11.1264 30.742 10.6584 30.742 10.0904C30.742 9.69838 30.666 9.35838 30.514 9.07038C30.37 8.77438 30.162 8.54638 29.89 8.38638C29.618 8.21838 29.302 8.13438 28.942 8.13438C28.582 8.13438 28.262 8.21838 27.982 8.38638C27.71 8.55438 27.494 8.78638 27.334 9.08238C27.182 9.37038 27.106 9.70238 27.106 10.0784C27.106 10.4624 27.182 10.8024 27.334 11.0984C27.494 11.3864 27.714 11.6144 27.994 11.7824C28.274 11.9504 28.594 12.0344 28.954 12.0344ZM30.67 12.9344V11.3984L30.874 10.0064L30.67 8.62638V7.23438H31.762V12.9344H30.67Z" fill="currentColor"/>
          <path d="M22.832 12.9344V4.84638H23.96V12.9344H22.832ZM20 5.63838V4.60638H26.78V5.63838H20Z" fill="currentColor"/>
          <path d="M40.6983 12.9964V4.45239H43.0983V12.9964H40.6983Z" fill="currentColor"/>
          <path d="M46.6543 12.9964V4.45239H49.0543V12.9964H46.6543ZM44.0983 6.49239V4.45239H51.6223V6.49239H44.0983Z" fill="currentColor"/>
        </svg>
      </div>
    `;
        // Rest of your settings code...
        // Rest of your settings...
        new obsidian.Setting(containerEl)
            .setName("Tag Inheritance Mode")
            .setDesc("Choose how tags are inherited in nested folders")
            .addDropdown((dropdown) => dropdown
            .addOption("none", "No inheritance")
            .addOption("immediate", "Inherit from immediate parent")
            .addOption("all", "Inherit from all parents")
            .setValue(this.plugin.settings.inheritanceMode)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.inheritanceMode = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Excluded Folders")
            .setDesc("Enter folder paths to exclude from tag inheritance (one per line)")
            .addTextArea((text) => text
            .setPlaceholder("folder1\nfolder2/subfolder")
            .setValue(this.plugin.settings.excludedFolders.join("\n"))
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.excludedFolders = value
                .split("\n")
                .filter((f) => f.trim() !== "");
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Show Folder Icons")
            .setDesc("Display icons next to folders with tags")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.showFolderIcons)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showFolderIcons = value;
            yield this.plugin.saveSettings();
            if (value) {
                this.plugin.updateFolderIcons();
            }
            else {
                this.plugin.removeFolderIcons();
            }
        })));
        new obsidian.Setting(containerEl)
            .setName("Auto-apply Tags")
            .setDesc("Automatically apply folder tags to new files")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.autoApplyTags)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.autoApplyTags = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Debug Mode")
            .setDesc("Enable detailed logging for troubleshooting")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.debugMode)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.debugMode = value;
            yield this.plugin.saveSettings();
        })));
        // Add this new setting section
        new obsidian.Setting(containerEl)
            .setName("Batch Conversion Warning")
            .setDesc("Re-enable the warning when converting inline tags to YAML")
            .addButton((button) => button.setButtonText("Reset Warning").onClick(() => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showBatchConversionWarning = true;
            yield this.plugin.saveSettings();
            new obsidian.Notice("Batch conversion warning has been re-enabled");
        })));
    }
}
class ConfirmationModal extends obsidian.Modal {
    constructor(app, message, onConfirm) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("p", { text: this.message });
        new obsidian.Setting(contentEl)
            .addButton((btn) => btn.setButtonText("Cancel").onClick(() => {
            this.close();
        }))
            .addButton((btn) => btn
            .setButtonText("Confirm")
            .setCta()
            .onClick(() => {
            this.close();
            this.onConfirm();
        }));
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
class TagSelectionModal extends obsidian.Modal {
    constructor(app, message, tags, onConfirm) {
        super(app);
        this.message = message;
        this.tags = tags;
        this.onConfirm = onConfirm;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("p", { text: this.message });
        const tagContainer = contentEl.createDiv("tag-container");
        this.tags.forEach((tag) => {
            const tagEl = tagContainer.createEl("div", { cls: "tag" });
            tagEl.createSpan({ text: tag });
            const removeButton = tagEl.createEl("button", { text: "X" });
            removeButton.onclick = () => {
                this.tags = this.tags.filter((t) => t !== tag);
                tagEl.remove();
            };
        });
        new obsidian.Setting(contentEl)
            .addButton((btn) => btn.setButtonText("Cancel").onClick(() => {
            this.close();
        }))
            .addButton((btn) => btn
            .setButtonText("Confirm")
            .setCta()
            .onClick(() => {
            this.close();
            this.onConfirm(this.tags);
        }));
    }
    onClose() {
        this.contentEl.empty();
        this.titleEl.empty();
    }
}
class FileMovedModal extends obsidian.Modal {
    constructor(app, file, oldTags, newTags, plugin) {
        super(app);
        this.file = file;
        this.oldTags = oldTags;
        this.newTags = newTags;
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "File Moved" });
        contentEl.createEl("p", {
            text: `File "${this.file.name}" has been moved.`,
        });
        contentEl.createEl("p", { text: "How would you like to handle the tags?" });
        new obsidian.Setting(contentEl)
            .setName("Replace All")
            .setDesc("Replace all existing tags with new folder tags")
            .addButton((btn) => btn
            .setButtonText("Replace All")
            .setCta()
            .onClick(() => {
            this.plugin.replaceAllTags(this.file, this.newTags);
            this.close();
        }));
        new obsidian.Setting(contentEl)
            .setName("Merge")
            .setDesc("Keep existing tags and add new folder tags")
            .addButton((btn) => btn
            .setButtonText("Merge")
            .setCta()
            .onClick(() => {
            this.plugin.mergeTags(this.file, this.oldTags, this.newTags);
            this.close();
        }));
        new obsidian.Setting(contentEl)
            .setName("No Action")
            .setDesc("Keep tags as they are")
            .addButton((btn) => btn.setButtonText("No Action").onClick(() => {
            this.close();
        }));
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
class ConflictResolutionModal extends obsidian.Modal {
    constructor(app, file, conflictingTags, plugin) {
        super(app);
        this.file = file;
        this.conflictingTags = conflictingTags;
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Tag Conflict Detected" });
        contentEl.createEl("p", {
            text: `The following tags are assigned by multiple parent folders:`,
        });
        const tagList = contentEl.createEl("ul");
        this.conflictingTags.forEach((tag) => {
            tagList.createEl("li", { text: tag });
        });
        contentEl.createEl("p", {
            text: "How would you like to handle these conflicts?",
        });
        new obsidian.Setting(contentEl)
            .setName("Keep All")
            .setDesc("Keep all instances of conflicting tags")
            .addButton((btn) => btn
            .setButtonText("Keep All")
            .setCta()
            .onClick(() => {
            this.resolveConflict("keepAll");
        }));
        new obsidian.Setting(contentEl)
            .setName("Keep One")
            .setDesc("Keep only one instance of each conflicting tag")
            .addButton((btn) => btn
            .setButtonText("Keep One")
            .setCta()
            .onClick(() => {
            this.resolveConflict("keepOne");
        }));
        new obsidian.Setting(contentEl)
            .setName("Remove All")
            .setDesc("Remove all instances of conflicting tags")
            .addButton((btn) => btn
            .setButtonText("Remove All")
            .setCta()
            .onClick(() => {
            this.resolveConflict("removeAll");
        }));
    }
    resolveConflict(resolution) {
        return __awaiter(this, void 0, void 0, function* () {
            const content = yield this.plugin.app.vault.read(this.file);
            const existingTags = this.plugin.extractTagsFromContent(content);
            let updatedTags;
            switch (resolution) {
                case "keepAll":
                    updatedTags = existingTags;
                    break;
                case "keepOne":
                    updatedTags = [...new Set(existingTags)];
                    break;
                case "removeAll":
                    updatedTags = existingTags.filter((tag) => !this.conflictingTags.includes(tag));
                    break;
            }
            const updatedContent = this.plugin.updateTagsInContent(content, updatedTags);
            yield this.plugin.app.vault.modify(this.file, updatedContent);
            this.plugin.updateObsidianTagCache();
            new obsidian.Notice(`Resolved tag conflicts for file: ${this.file.name}`);
            this.close();
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
class BatchConversionResultModal extends obsidian.Modal {
    constructor(app, processedCount, successCount, errorCount, errors) {
        super(app);
        this.processedCount = processedCount;
        this.successCount = successCount;
        this.errorCount = errorCount;
        this.errors = errors;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Batch Conversion Complete" });
        const statsContainer = contentEl.createDiv("stats-container");
        statsContainer.createEl("p", {
            text: `Processed: ${this.processedCount} files`,
        });
        statsContainer.createEl("p", {
            text: `Successfully converted: ${this.successCount} files`,
        });
        if (this.errorCount > 0) {
            const errorSection = contentEl.createDiv("error-section");
            errorSection.createEl("p", {
                text: `Failed to process ${this.errorCount} files:`,
                cls: "error-header",
            });
            const errorList = errorSection.createEl("ul");
            this.errors.forEach((fileName) => {
                errorList.createEl("li", { text: fileName });
            });
        }
        new obsidian.Setting(contentEl).addButton((btn) => btn
            .setButtonText("Close")
            .setCta()
            .onClick(() => {
            this.close();
        }));
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
class BatchConversionWarningModal extends obsidian.Modal {
    constructor(app, files, plugin) {
        super(app);
        this.files = files;
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Batch Convert Tags to YAML" });
        contentEl.createEl("p", {
            text: `This will convert inline tags to YAML front matter in ${this.files.length} file(s). This action cannot be automatically undone.`,
        });
        new obsidian.Setting(contentEl)
            .addToggle((toggle) => toggle
            .setValue(true)
            .setTooltip("Show this warning next time")
            .onChange((value) => {
            this.plugin.settings.showBatchConversionWarning = value;
            this.plugin.saveSettings();
        }))
            .setName("Show this warning next time");
        new obsidian.Setting(contentEl)
            .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton((btn) => btn
            .setButtonText("Proceed")
            .setCta()
            .onClick(() => __awaiter(this, void 0, void 0, function* () {
            this.close();
            yield this.plugin.batchConvertInlineTagsToYAML(this.files);
        })));
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

module.exports = TagItPlugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3RzbGliL3RzbGliLmVzNi5qcyIsIm1haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG5Db3B5cmlnaHQgKGMpIE1pY3Jvc29mdCBDb3Jwb3JhdGlvbi5cclxuXHJcblBlcm1pc3Npb24gdG8gdXNlLCBjb3B5LCBtb2RpZnksIGFuZC9vciBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUgZm9yIGFueVxyXG5wdXJwb3NlIHdpdGggb3Igd2l0aG91dCBmZWUgaXMgaGVyZWJ5IGdyYW50ZWQuXHJcblxyXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiIEFORCBUSEUgQVVUSE9SIERJU0NMQUlNUyBBTEwgV0FSUkFOVElFUyBXSVRIXHJcblJFR0FSRCBUTyBUSElTIFNPRlRXQVJFIElOQ0xVRElORyBBTEwgSU1QTElFRCBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWVxyXG5BTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsXHJcbklORElSRUNULCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgT1IgQU5ZIERBTUFHRVMgV0hBVFNPRVZFUiBSRVNVTFRJTkcgRlJPTVxyXG5MT1NTIE9GIFVTRSwgREFUQSBPUiBQUk9GSVRTLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgTkVHTElHRU5DRSBPUlxyXG5PVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SXHJcblBFUkZPUk1BTkNFIE9GIFRISVMgU09GVFdBUkUuXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqICovXHJcbi8qIGdsb2JhbCBSZWZsZWN0LCBQcm9taXNlLCBTdXBwcmVzc2VkRXJyb3IsIFN5bWJvbCwgSXRlcmF0b3IgKi9cclxuXHJcbnZhciBleHRlbmRTdGF0aWNzID0gZnVuY3Rpb24oZCwgYikge1xyXG4gICAgZXh0ZW5kU3RhdGljcyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fFxyXG4gICAgICAgICh7IF9fcHJvdG9fXzogW10gfSBpbnN0YW5jZW9mIEFycmF5ICYmIGZ1bmN0aW9uIChkLCBiKSB7IGQuX19wcm90b19fID0gYjsgfSkgfHxcclxuICAgICAgICBmdW5jdGlvbiAoZCwgYikgeyBmb3IgKHZhciBwIGluIGIpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYiwgcCkpIGRbcF0gPSBiW3BdOyB9O1xyXG4gICAgcmV0dXJuIGV4dGVuZFN0YXRpY3MoZCwgYik7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHRlbmRzKGQsIGIpIHtcclxuICAgIGlmICh0eXBlb2YgYiAhPT0gXCJmdW5jdGlvblwiICYmIGIgIT09IG51bGwpXHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNsYXNzIGV4dGVuZHMgdmFsdWUgXCIgKyBTdHJpbmcoYikgKyBcIiBpcyBub3QgYSBjb25zdHJ1Y3RvciBvciBudWxsXCIpO1xyXG4gICAgZXh0ZW5kU3RhdGljcyhkLCBiKTtcclxuICAgIGZ1bmN0aW9uIF9fKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gZDsgfVxyXG4gICAgZC5wcm90b3R5cGUgPSBiID09PSBudWxsID8gT2JqZWN0LmNyZWF0ZShiKSA6IChfXy5wcm90b3R5cGUgPSBiLnByb3RvdHlwZSwgbmV3IF9fKCkpO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fYXNzaWduID0gZnVuY3Rpb24oKSB7XHJcbiAgICBfX2Fzc2lnbiA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gX19hc3NpZ24odCkge1xyXG4gICAgICAgIGZvciAodmFyIHMsIGkgPSAxLCBuID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xyXG4gICAgICAgICAgICBzID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkpIHRbcF0gPSBzW3BdO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdDtcclxuICAgIH1cclxuICAgIHJldHVybiBfX2Fzc2lnbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZXN0KHMsIGUpIHtcclxuICAgIHZhciB0ID0ge307XHJcbiAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkgJiYgZS5pbmRleE9mKHApIDwgMClcclxuICAgICAgICB0W3BdID0gc1twXTtcclxuICAgIGlmIChzICE9IG51bGwgJiYgdHlwZW9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocyk7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmIChlLmluZGV4T2YocFtpXSkgPCAwICYmIE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChzLCBwW2ldKSlcclxuICAgICAgICAgICAgICAgIHRbcFtpXV0gPSBzW3BbaV1dO1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiB0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYykge1xyXG4gICAgdmFyIGMgPSBhcmd1bWVudHMubGVuZ3RoLCByID0gYyA8IDMgPyB0YXJnZXQgOiBkZXNjID09PSBudWxsID8gZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodGFyZ2V0LCBrZXkpIDogZGVzYywgZDtcclxuICAgIGlmICh0eXBlb2YgUmVmbGVjdCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgUmVmbGVjdC5kZWNvcmF0ZSA9PT0gXCJmdW5jdGlvblwiKSByID0gUmVmbGVjdC5kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYyk7XHJcbiAgICBlbHNlIGZvciAodmFyIGkgPSBkZWNvcmF0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoZCA9IGRlY29yYXRvcnNbaV0pIHIgPSAoYyA8IDMgPyBkKHIpIDogYyA+IDMgPyBkKHRhcmdldCwga2V5LCByKSA6IGQodGFyZ2V0LCBrZXkpKSB8fCByO1xyXG4gICAgcmV0dXJuIGMgPiAzICYmIHIgJiYgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCByKSwgcjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcGFyYW0ocGFyYW1JbmRleCwgZGVjb3JhdG9yKSB7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldCwga2V5KSB7IGRlY29yYXRvcih0YXJnZXQsIGtleSwgcGFyYW1JbmRleCk7IH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZXNEZWNvcmF0ZShjdG9yLCBkZXNjcmlwdG9ySW4sIGRlY29yYXRvcnMsIGNvbnRleHRJbiwgaW5pdGlhbGl6ZXJzLCBleHRyYUluaXRpYWxpemVycykge1xyXG4gICAgZnVuY3Rpb24gYWNjZXB0KGYpIHsgaWYgKGYgIT09IHZvaWQgMCAmJiB0eXBlb2YgZiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnVuY3Rpb24gZXhwZWN0ZWRcIik7IHJldHVybiBmOyB9XHJcbiAgICB2YXIga2luZCA9IGNvbnRleHRJbi5raW5kLCBrZXkgPSBraW5kID09PSBcImdldHRlclwiID8gXCJnZXRcIiA6IGtpbmQgPT09IFwic2V0dGVyXCIgPyBcInNldFwiIDogXCJ2YWx1ZVwiO1xyXG4gICAgdmFyIHRhcmdldCA9ICFkZXNjcmlwdG9ySW4gJiYgY3RvciA/IGNvbnRleHRJbltcInN0YXRpY1wiXSA/IGN0b3IgOiBjdG9yLnByb3RvdHlwZSA6IG51bGw7XHJcbiAgICB2YXIgZGVzY3JpcHRvciA9IGRlc2NyaXB0b3JJbiB8fCAodGFyZ2V0ID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih0YXJnZXQsIGNvbnRleHRJbi5uYW1lKSA6IHt9KTtcclxuICAgIHZhciBfLCBkb25lID0gZmFsc2U7XHJcbiAgICBmb3IgKHZhciBpID0gZGVjb3JhdG9ycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgIHZhciBjb250ZXh0ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4pIGNvbnRleHRbcF0gPSBwID09PSBcImFjY2Vzc1wiID8ge30gOiBjb250ZXh0SW5bcF07XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4uYWNjZXNzKSBjb250ZXh0LmFjY2Vzc1twXSA9IGNvbnRleHRJbi5hY2Nlc3NbcF07XHJcbiAgICAgICAgY29udGV4dC5hZGRJbml0aWFsaXplciA9IGZ1bmN0aW9uIChmKSB7IGlmIChkb25lKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IGFkZCBpbml0aWFsaXplcnMgYWZ0ZXIgZGVjb3JhdGlvbiBoYXMgY29tcGxldGVkXCIpOyBleHRyYUluaXRpYWxpemVycy5wdXNoKGFjY2VwdChmIHx8IG51bGwpKTsgfTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKDAsIGRlY29yYXRvcnNbaV0pKGtpbmQgPT09IFwiYWNjZXNzb3JcIiA/IHsgZ2V0OiBkZXNjcmlwdG9yLmdldCwgc2V0OiBkZXNjcmlwdG9yLnNldCB9IDogZGVzY3JpcHRvcltrZXldLCBjb250ZXh0KTtcclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJhY2Nlc3NvclwiKSB7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IHZvaWQgMCkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZFwiKTtcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmdldCkpIGRlc2NyaXB0b3IuZ2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LnNldCkpIGRlc2NyaXB0b3Iuc2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmluaXQpKSBpbml0aWFsaXplcnMudW5zaGlmdChfKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoXyA9IGFjY2VwdChyZXN1bHQpKSB7XHJcbiAgICAgICAgICAgIGlmIChraW5kID09PSBcImZpZWxkXCIpIGluaXRpYWxpemVycy51bnNoaWZ0KF8pO1xyXG4gICAgICAgICAgICBlbHNlIGRlc2NyaXB0b3Jba2V5XSA9IF87XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRhcmdldCkgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgY29udGV4dEluLm5hbWUsIGRlc2NyaXB0b3IpO1xyXG4gICAgZG9uZSA9IHRydWU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19ydW5Jbml0aWFsaXplcnModGhpc0FyZywgaW5pdGlhbGl6ZXJzLCB2YWx1ZSkge1xyXG4gICAgdmFyIHVzZVZhbHVlID0gYXJndW1lbnRzLmxlbmd0aCA+IDI7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGluaXRpYWxpemVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhbHVlID0gdXNlVmFsdWUgPyBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnLCB2YWx1ZSkgOiBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1c2VWYWx1ZSA/IHZhbHVlIDogdm9pZCAwO1xyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcHJvcEtleSh4KSB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHggPT09IFwic3ltYm9sXCIgPyB4IDogXCJcIi5jb25jYXQoeCk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zZXRGdW5jdGlvbk5hbWUoZiwgbmFtZSwgcHJlZml4KSB7XHJcbiAgICBpZiAodHlwZW9mIG5hbWUgPT09IFwic3ltYm9sXCIpIG5hbWUgPSBuYW1lLmRlc2NyaXB0aW9uID8gXCJbXCIuY29uY2F0KG5hbWUuZGVzY3JpcHRpb24sIFwiXVwiKSA6IFwiXCI7XHJcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGYsIFwibmFtZVwiLCB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IHByZWZpeCA/IFwiXCIuY29uY2F0KHByZWZpeCwgXCIgXCIsIG5hbWUpIDogbmFtZSB9KTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX21ldGFkYXRhKG1ldGFkYXRhS2V5LCBtZXRhZGF0YVZhbHVlKSB7XHJcbiAgICBpZiAodHlwZW9mIFJlZmxlY3QgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIFJlZmxlY3QubWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFJlZmxlY3QubWV0YWRhdGEobWV0YWRhdGFLZXksIG1ldGFkYXRhVmFsdWUpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikge1xyXG4gICAgZnVuY3Rpb24gYWRvcHQodmFsdWUpIHsgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgUCA/IHZhbHVlIDogbmV3IFAoZnVuY3Rpb24gKHJlc29sdmUpIHsgcmVzb2x2ZSh2YWx1ZSk7IH0pOyB9XHJcbiAgICByZXR1cm4gbmV3IChQIHx8IChQID0gUHJvbWlzZSkpKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gcmVqZWN0ZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3JbXCJ0aHJvd1wiXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gc3RlcChyZXN1bHQpIHsgcmVzdWx0LmRvbmUgPyByZXNvbHZlKHJlc3VsdC52YWx1ZSkgOiBhZG9wdChyZXN1bHQudmFsdWUpLnRoZW4oZnVsZmlsbGVkLCByZWplY3RlZCk7IH1cclxuICAgICAgICBzdGVwKChnZW5lcmF0b3IgPSBnZW5lcmF0b3IuYXBwbHkodGhpc0FyZywgX2FyZ3VtZW50cyB8fCBbXSkpLm5leHQoKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZ2VuZXJhdG9yKHRoaXNBcmcsIGJvZHkpIHtcclxuICAgIHZhciBfID0geyBsYWJlbDogMCwgc2VudDogZnVuY3Rpb24oKSB7IGlmICh0WzBdICYgMSkgdGhyb3cgdFsxXTsgcmV0dXJuIHRbMV07IH0sIHRyeXM6IFtdLCBvcHM6IFtdIH0sIGYsIHksIHQsIGcgPSBPYmplY3QuY3JlYXRlKCh0eXBlb2YgSXRlcmF0b3IgPT09IFwiZnVuY3Rpb25cIiA/IEl0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpO1xyXG4gICAgcmV0dXJuIGcubmV4dCA9IHZlcmIoMCksIGdbXCJ0aHJvd1wiXSA9IHZlcmIoMSksIGdbXCJyZXR1cm5cIl0gPSB2ZXJiKDIpLCB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgKGdbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSksIGc7XHJcbiAgICBmdW5jdGlvbiB2ZXJiKG4pIHsgcmV0dXJuIGZ1bmN0aW9uICh2KSB7IHJldHVybiBzdGVwKFtuLCB2XSk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHN0ZXAob3ApIHtcclxuICAgICAgICBpZiAoZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkdlbmVyYXRvciBpcyBhbHJlYWR5IGV4ZWN1dGluZy5cIik7XHJcbiAgICAgICAgd2hpbGUgKGcgJiYgKGcgPSAwLCBvcFswXSAmJiAoXyA9IDApKSwgXykgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKGYgPSAxLCB5ICYmICh0ID0gb3BbMF0gJiAyID8geVtcInJldHVyblwiXSA6IG9wWzBdID8geVtcInRocm93XCJdIHx8ICgodCA9IHlbXCJyZXR1cm5cIl0pICYmIHQuY2FsbCh5KSwgMCkgOiB5Lm5leHQpICYmICEodCA9IHQuY2FsbCh5LCBvcFsxXSkpLmRvbmUpIHJldHVybiB0O1xyXG4gICAgICAgICAgICBpZiAoeSA9IDAsIHQpIG9wID0gW29wWzBdICYgMiwgdC52YWx1ZV07XHJcbiAgICAgICAgICAgIHN3aXRjaCAob3BbMF0pIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgMDogY2FzZSAxOiB0ID0gb3A7IGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSA0OiBfLmxhYmVsKys7IHJldHVybiB7IHZhbHVlOiBvcFsxXSwgZG9uZTogZmFsc2UgfTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNTogXy5sYWJlbCsrOyB5ID0gb3BbMV07IG9wID0gWzBdOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNzogb3AgPSBfLm9wcy5wb3AoKTsgXy50cnlzLnBvcCgpOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEodCA9IF8udHJ5cywgdCA9IHQubGVuZ3RoID4gMCAmJiB0W3QubGVuZ3RoIC0gMV0pICYmIChvcFswXSA9PT0gNiB8fCBvcFswXSA9PT0gMikpIHsgXyA9IDA7IGNvbnRpbnVlOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wWzBdID09PSAzICYmICghdCB8fCAob3BbMV0gPiB0WzBdICYmIG9wWzFdIDwgdFszXSkpKSB7IF8ubGFiZWwgPSBvcFsxXTsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAob3BbMF0gPT09IDYgJiYgXy5sYWJlbCA8IHRbMV0pIHsgXy5sYWJlbCA9IHRbMV07IHQgPSBvcDsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiBfLmxhYmVsIDwgdFsyXSkgeyBfLmxhYmVsID0gdFsyXTsgXy5vcHMucHVzaChvcCk7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRbMl0pIF8ub3BzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIF8udHJ5cy5wb3AoKTsgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3AgPSBib2R5LmNhbGwodGhpc0FyZywgXyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkgeyBvcCA9IFs2LCBlXTsgeSA9IDA7IH0gZmluYWxseSB7IGYgPSB0ID0gMDsgfVxyXG4gICAgICAgIGlmIChvcFswXSAmIDUpIHRocm93IG9wWzFdOyByZXR1cm4geyB2YWx1ZTogb3BbMF0gPyBvcFsxXSA6IHZvaWQgMCwgZG9uZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fY3JlYXRlQmluZGluZyA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgbSwgaywgazIpIHtcclxuICAgIGlmIChrMiA9PT0gdW5kZWZpbmVkKSBrMiA9IGs7XHJcbiAgICB2YXIgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IobSwgayk7XHJcbiAgICBpZiAoIWRlc2MgfHwgKFwiZ2V0XCIgaW4gZGVzYyA/ICFtLl9fZXNNb2R1bGUgOiBkZXNjLndyaXRhYmxlIHx8IGRlc2MuY29uZmlndXJhYmxlKSkge1xyXG4gICAgICAgIGRlc2MgPSB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiBtW2tdOyB9IH07XHJcbiAgICB9XHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgazIsIGRlc2MpO1xyXG59KSA6IChmdW5jdGlvbihvLCBtLCBrLCBrMikge1xyXG4gICAgaWYgKGsyID09PSB1bmRlZmluZWQpIGsyID0gaztcclxuICAgIG9bazJdID0gbVtrXTtcclxufSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHBvcnRTdGFyKG0sIG8pIHtcclxuICAgIGZvciAodmFyIHAgaW4gbSkgaWYgKHAgIT09IFwiZGVmYXVsdFwiICYmICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgcCkpIF9fY3JlYXRlQmluZGluZyhvLCBtLCBwKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fdmFsdWVzKG8pIHtcclxuICAgIHZhciBzID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIFN5bWJvbC5pdGVyYXRvciwgbSA9IHMgJiYgb1tzXSwgaSA9IDA7XHJcbiAgICBpZiAobSkgcmV0dXJuIG0uY2FsbChvKTtcclxuICAgIGlmIChvICYmIHR5cGVvZiBvLmxlbmd0aCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHtcclxuICAgICAgICBuZXh0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChvICYmIGkgPj0gby5sZW5ndGgpIG8gPSB2b2lkIDA7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBvICYmIG9baSsrXSwgZG9uZTogIW8gfTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihzID8gXCJPYmplY3QgaXMgbm90IGl0ZXJhYmxlLlwiIDogXCJTeW1ib2wuaXRlcmF0b3IgaXMgbm90IGRlZmluZWQuXCIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZWFkKG8sIG4pIHtcclxuICAgIHZhciBtID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIG9bU3ltYm9sLml0ZXJhdG9yXTtcclxuICAgIGlmICghbSkgcmV0dXJuIG87XHJcbiAgICB2YXIgaSA9IG0uY2FsbChvKSwgciwgYXIgPSBbXSwgZTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgd2hpbGUgKChuID09PSB2b2lkIDAgfHwgbi0tID4gMCkgJiYgIShyID0gaS5uZXh0KCkpLmRvbmUpIGFyLnB1c2goci52YWx1ZSk7XHJcbiAgICB9XHJcbiAgICBjYXRjaCAoZXJyb3IpIHsgZSA9IHsgZXJyb3I6IGVycm9yIH07IH1cclxuICAgIGZpbmFsbHkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChyICYmICFyLmRvbmUgJiYgKG0gPSBpW1wicmV0dXJuXCJdKSkgbS5jYWxsKGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaW5hbGx5IHsgaWYgKGUpIHRocm93IGUuZXJyb3I7IH1cclxuICAgIH1cclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZCgpIHtcclxuICAgIGZvciAodmFyIGFyID0gW10sIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKVxyXG4gICAgICAgIGFyID0gYXIuY29uY2F0KF9fcmVhZChhcmd1bWVudHNbaV0pKTtcclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZEFycmF5cygpIHtcclxuICAgIGZvciAodmFyIHMgPSAwLCBpID0gMCwgaWwgPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgaWw7IGkrKykgcyArPSBhcmd1bWVudHNbaV0ubGVuZ3RoO1xyXG4gICAgZm9yICh2YXIgciA9IEFycmF5KHMpLCBrID0gMCwgaSA9IDA7IGkgPCBpbDsgaSsrKVxyXG4gICAgICAgIGZvciAodmFyIGEgPSBhcmd1bWVudHNbaV0sIGogPSAwLCBqbCA9IGEubGVuZ3RoOyBqIDwgamw7IGorKywgaysrKVxyXG4gICAgICAgICAgICByW2tdID0gYVtqXTtcclxuICAgIHJldHVybiByO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zcHJlYWRBcnJheSh0bywgZnJvbSwgcGFjaykge1xyXG4gICAgaWYgKHBhY2sgfHwgYXJndW1lbnRzLmxlbmd0aCA9PT0gMikgZm9yICh2YXIgaSA9IDAsIGwgPSBmcm9tLmxlbmd0aCwgYXI7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XHJcbiAgICAgICAgICAgIGlmICghYXIpIGFyID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSwgMCwgaSk7XHJcbiAgICAgICAgICAgIGFyW2ldID0gZnJvbVtpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdG8uY29uY2F0KGFyIHx8IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fYXdhaXQodikge1xyXG4gICAgcmV0dXJuIHRoaXMgaW5zdGFuY2VvZiBfX2F3YWl0ID8gKHRoaXMudiA9IHYsIHRoaXMpIDogbmV3IF9fYXdhaXQodik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jR2VuZXJhdG9yKHRoaXNBcmcsIF9hcmd1bWVudHMsIGdlbmVyYXRvcikge1xyXG4gICAgaWYgKCFTeW1ib2wuYXN5bmNJdGVyYXRvcikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0l0ZXJhdG9yIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgIHZhciBnID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pLCBpLCBxID0gW107XHJcbiAgICByZXR1cm4gaSA9IE9iamVjdC5jcmVhdGUoKHR5cGVvZiBBc3luY0l0ZXJhdG9yID09PSBcImZ1bmN0aW9uXCIgPyBBc3luY0l0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpLCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIsIGF3YWl0UmV0dXJuKSwgaVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0gPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzOyB9LCBpO1xyXG4gICAgZnVuY3Rpb24gYXdhaXRSZXR1cm4oZikgeyByZXR1cm4gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh2KS50aGVuKGYsIHJlamVjdCk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpZiAoZ1tuXSkgeyBpW25dID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChhLCBiKSB7IHEucHVzaChbbiwgdiwgYSwgYl0pID4gMSB8fCByZXN1bWUobiwgdik7IH0pOyB9OyBpZiAoZikgaVtuXSA9IGYoaVtuXSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gcmVzdW1lKG4sIHYpIHsgdHJ5IHsgc3RlcChnW25dKHYpKTsgfSBjYXRjaCAoZSkgeyBzZXR0bGUocVswXVszXSwgZSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gc3RlcChyKSB7IHIudmFsdWUgaW5zdGFuY2VvZiBfX2F3YWl0ID8gUHJvbWlzZS5yZXNvbHZlKHIudmFsdWUudikudGhlbihmdWxmaWxsLCByZWplY3QpIDogc2V0dGxlKHFbMF1bMl0sIHIpOyB9XHJcbiAgICBmdW5jdGlvbiBmdWxmaWxsKHZhbHVlKSB7IHJlc3VtZShcIm5leHRcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiByZWplY3QodmFsdWUpIHsgcmVzdW1lKFwidGhyb3dcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiBzZXR0bGUoZiwgdikgeyBpZiAoZih2KSwgcS5zaGlmdCgpLCBxLmxlbmd0aCkgcmVzdW1lKHFbMF1bMF0sIHFbMF1bMV0pOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jRGVsZWdhdG9yKG8pIHtcclxuICAgIHZhciBpLCBwO1xyXG4gICAgcmV0dXJuIGkgPSB7fSwgdmVyYihcIm5leHRcIiksIHZlcmIoXCJ0aHJvd1wiLCBmdW5jdGlvbiAoZSkgeyB0aHJvdyBlOyB9KSwgdmVyYihcInJldHVyblwiKSwgaVtTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfSwgaTtcclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpW25dID0gb1tuXSA/IGZ1bmN0aW9uICh2KSB7IHJldHVybiAocCA9ICFwKSA/IHsgdmFsdWU6IF9fYXdhaXQob1tuXSh2KSksIGRvbmU6IGZhbHNlIH0gOiBmID8gZih2KSA6IHY7IH0gOiBmOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jVmFsdWVzKG8pIHtcclxuICAgIGlmICghU3ltYm9sLmFzeW5jSXRlcmF0b3IpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNJdGVyYXRvciBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICB2YXIgbSA9IG9bU3ltYm9sLmFzeW5jSXRlcmF0b3JdLCBpO1xyXG4gICAgcmV0dXJuIG0gPyBtLmNhbGwobykgOiAobyA9IHR5cGVvZiBfX3ZhbHVlcyA9PT0gXCJmdW5jdGlvblwiID8gX192YWx1ZXMobykgOiBvW1N5bWJvbC5pdGVyYXRvcl0oKSwgaSA9IHt9LCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIpLCBpW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXM7IH0sIGkpO1xyXG4gICAgZnVuY3Rpb24gdmVyYihuKSB7IGlbbl0gPSBvW25dICYmIGZ1bmN0aW9uICh2KSB7IHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHYgPSBvW25dKHYpLCBzZXR0bGUocmVzb2x2ZSwgcmVqZWN0LCB2LmRvbmUsIHYudmFsdWUpOyB9KTsgfTsgfVxyXG4gICAgZnVuY3Rpb24gc2V0dGxlKHJlc29sdmUsIHJlamVjdCwgZCwgdikgeyBQcm9taXNlLnJlc29sdmUodikudGhlbihmdW5jdGlvbih2KSB7IHJlc29sdmUoeyB2YWx1ZTogdiwgZG9uZTogZCB9KTsgfSwgcmVqZWN0KTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19tYWtlVGVtcGxhdGVPYmplY3QoY29va2VkLCByYXcpIHtcclxuICAgIGlmIChPYmplY3QuZGVmaW5lUHJvcGVydHkpIHsgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvb2tlZCwgXCJyYXdcIiwgeyB2YWx1ZTogcmF3IH0pOyB9IGVsc2UgeyBjb29rZWQucmF3ID0gcmF3OyB9XHJcbiAgICByZXR1cm4gY29va2VkO1xyXG59O1xyXG5cclxudmFyIF9fc2V0TW9kdWxlRGVmYXVsdCA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgdikge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sIFwiZGVmYXVsdFwiLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2IH0pO1xyXG59KSA6IGZ1bmN0aW9uKG8sIHYpIHtcclxuICAgIG9bXCJkZWZhdWx0XCJdID0gdjtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydFN0YXIobW9kKSB7XHJcbiAgICBpZiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSByZXR1cm4gbW9kO1xyXG4gICAgdmFyIHJlc3VsdCA9IHt9O1xyXG4gICAgaWYgKG1vZCAhPSBudWxsKSBmb3IgKHZhciBrIGluIG1vZCkgaWYgKGsgIT09IFwiZGVmYXVsdFwiICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb2QsIGspKSBfX2NyZWF0ZUJpbmRpbmcocmVzdWx0LCBtb2QsIGspO1xyXG4gICAgX19zZXRNb2R1bGVEZWZhdWx0KHJlc3VsdCwgbW9kKTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydERlZmF1bHQobW9kKSB7XHJcbiAgICByZXR1cm4gKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgPyBtb2QgOiB7IGRlZmF1bHQ6IG1vZCB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEdldChyZWNlaXZlciwgc3RhdGUsIGtpbmQsIGYpIHtcclxuICAgIGlmIChraW5kID09PSBcImFcIiAmJiAhZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlByaXZhdGUgYWNjZXNzb3Igd2FzIGRlZmluZWQgd2l0aG91dCBhIGdldHRlclwiKTtcclxuICAgIGlmICh0eXBlb2Ygc3RhdGUgPT09IFwiZnVuY3Rpb25cIiA/IHJlY2VpdmVyICE9PSBzdGF0ZSB8fCAhZiA6ICFzdGF0ZS5oYXMocmVjZWl2ZXIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHJlYWQgcHJpdmF0ZSBtZW1iZXIgZnJvbSBhbiBvYmplY3Qgd2hvc2UgY2xhc3MgZGlkIG5vdCBkZWNsYXJlIGl0XCIpO1xyXG4gICAgcmV0dXJuIGtpbmQgPT09IFwibVwiID8gZiA6IGtpbmQgPT09IFwiYVwiID8gZi5jYWxsKHJlY2VpdmVyKSA6IGYgPyBmLnZhbHVlIDogc3RhdGUuZ2V0KHJlY2VpdmVyKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fY2xhc3NQcml2YXRlRmllbGRTZXQocmVjZWl2ZXIsIHN0YXRlLCB2YWx1ZSwga2luZCwgZikge1xyXG4gICAgaWYgKGtpbmQgPT09IFwibVwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBtZXRob2QgaXMgbm90IHdyaXRhYmxlXCIpO1xyXG4gICAgaWYgKGtpbmQgPT09IFwiYVwiICYmICFmKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBhY2Nlc3NvciB3YXMgZGVmaW5lZCB3aXRob3V0IGEgc2V0dGVyXCIpO1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gXCJmdW5jdGlvblwiID8gcmVjZWl2ZXIgIT09IHN0YXRlIHx8ICFmIDogIXN0YXRlLmhhcyhyZWNlaXZlcikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3Qgd3JpdGUgcHJpdmF0ZSBtZW1iZXIgdG8gYW4gb2JqZWN0IHdob3NlIGNsYXNzIGRpZCBub3QgZGVjbGFyZSBpdFwiKTtcclxuICAgIHJldHVybiAoa2luZCA9PT0gXCJhXCIgPyBmLmNhbGwocmVjZWl2ZXIsIHZhbHVlKSA6IGYgPyBmLnZhbHVlID0gdmFsdWUgOiBzdGF0ZS5zZXQocmVjZWl2ZXIsIHZhbHVlKSksIHZhbHVlO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEluKHN0YXRlLCByZWNlaXZlcikge1xyXG4gICAgaWYgKHJlY2VpdmVyID09PSBudWxsIHx8ICh0eXBlb2YgcmVjZWl2ZXIgIT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY2VpdmVyICE9PSBcImZ1bmN0aW9uXCIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHVzZSAnaW4nIG9wZXJhdG9yIG9uIG5vbi1vYmplY3RcIik7XHJcbiAgICByZXR1cm4gdHlwZW9mIHN0YXRlID09PSBcImZ1bmN0aW9uXCIgPyByZWNlaXZlciA9PT0gc3RhdGUgOiBzdGF0ZS5oYXMocmVjZWl2ZXIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hZGREaXNwb3NhYmxlUmVzb3VyY2UoZW52LCB2YWx1ZSwgYXN5bmMpIHtcclxuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdm9pZCAwKSB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZC5cIik7XHJcbiAgICAgICAgdmFyIGRpc3Bvc2UsIGlubmVyO1xyXG4gICAgICAgIGlmIChhc3luYykge1xyXG4gICAgICAgICAgICBpZiAoIVN5bWJvbC5hc3luY0Rpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNEaXNwb3NlIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgICAgICAgICAgZGlzcG9zZSA9IHZhbHVlW1N5bWJvbC5hc3luY0Rpc3Bvc2VdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZGlzcG9zZSA9PT0gdm9pZCAwKSB7XHJcbiAgICAgICAgICAgIGlmICghU3ltYm9sLmRpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuZGlzcG9zZSBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICAgICAgICAgIGRpc3Bvc2UgPSB2YWx1ZVtTeW1ib2wuZGlzcG9zZV07XHJcbiAgICAgICAgICAgIGlmIChhc3luYykgaW5uZXIgPSBkaXNwb3NlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodHlwZW9mIGRpc3Bvc2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBub3QgZGlzcG9zYWJsZS5cIik7XHJcbiAgICAgICAgaWYgKGlubmVyKSBkaXNwb3NlID0gZnVuY3Rpb24oKSB7IHRyeSB7IGlubmVyLmNhbGwodGhpcyk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIFByb21pc2UucmVqZWN0KGUpOyB9IH07XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyB2YWx1ZTogdmFsdWUsIGRpc3Bvc2U6IGRpc3Bvc2UsIGFzeW5jOiBhc3luYyB9KTtcclxuICAgIH1cclxuICAgIGVsc2UgaWYgKGFzeW5jKSB7XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyBhc3luYzogdHJ1ZSB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiB2YWx1ZTtcclxuXHJcbn1cclxuXHJcbnZhciBfU3VwcHJlc3NlZEVycm9yID0gdHlwZW9mIFN1cHByZXNzZWRFcnJvciA9PT0gXCJmdW5jdGlvblwiID8gU3VwcHJlc3NlZEVycm9yIDogZnVuY3Rpb24gKGVycm9yLCBzdXBwcmVzc2VkLCBtZXNzYWdlKSB7XHJcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuICAgIHJldHVybiBlLm5hbWUgPSBcIlN1cHByZXNzZWRFcnJvclwiLCBlLmVycm9yID0gZXJyb3IsIGUuc3VwcHJlc3NlZCA9IHN1cHByZXNzZWQsIGU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kaXNwb3NlUmVzb3VyY2VzKGVudikge1xyXG4gICAgZnVuY3Rpb24gZmFpbChlKSB7XHJcbiAgICAgICAgZW52LmVycm9yID0gZW52Lmhhc0Vycm9yID8gbmV3IF9TdXBwcmVzc2VkRXJyb3IoZSwgZW52LmVycm9yLCBcIkFuIGVycm9yIHdhcyBzdXBwcmVzc2VkIGR1cmluZyBkaXNwb3NhbC5cIikgOiBlO1xyXG4gICAgICAgIGVudi5oYXNFcnJvciA9IHRydWU7XHJcbiAgICB9XHJcbiAgICB2YXIgciwgcyA9IDA7XHJcbiAgICBmdW5jdGlvbiBuZXh0KCkge1xyXG4gICAgICAgIHdoaWxlIChyID0gZW52LnN0YWNrLnBvcCgpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXIuYXN5bmMgJiYgcyA9PT0gMSkgcmV0dXJuIHMgPSAwLCBlbnYuc3RhY2sucHVzaChyKSwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihuZXh0KTtcclxuICAgICAgICAgICAgICAgIGlmIChyLmRpc3Bvc2UpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gci5kaXNwb3NlLmNhbGwoci52YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHIuYXN5bmMpIHJldHVybiBzIHw9IDIsIFByb21pc2UucmVzb2x2ZShyZXN1bHQpLnRoZW4obmV4dCwgZnVuY3Rpb24oZSkgeyBmYWlsKGUpOyByZXR1cm4gbmV4dCgpOyB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgcyB8PSAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBmYWlsKGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChzID09PSAxKSByZXR1cm4gZW52Lmhhc0Vycm9yID8gUHJvbWlzZS5yZWplY3QoZW52LmVycm9yKSA6IFByb21pc2UucmVzb2x2ZSgpO1xyXG4gICAgICAgIGlmIChlbnYuaGFzRXJyb3IpIHRocm93IGVudi5lcnJvcjtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0KCk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbihwYXRoLCBwcmVzZXJ2ZUpzeCkge1xyXG4gICAgaWYgKHR5cGVvZiBwYXRoID09PSBcInN0cmluZ1wiICYmIC9eXFwuXFwuP1xcLy8udGVzdChwYXRoKSkge1xyXG4gICAgICAgIHJldHVybiBwYXRoLnJlcGxhY2UoL1xcLih0c3gpJHwoKD86XFwuZCk/KSgoPzpcXC5bXi4vXSs/KT8pXFwuKFtjbV0/KXRzJC9pLCBmdW5jdGlvbiAobSwgdHN4LCBkLCBleHQsIGNtKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0c3ggPyBwcmVzZXJ2ZUpzeCA/IFwiLmpzeFwiIDogXCIuanNcIiA6IGQgJiYgKCFleHQgfHwgIWNtKSA/IG0gOiAoZCArIGV4dCArIFwiLlwiICsgY20udG9Mb3dlckNhc2UoKSArIFwianNcIik7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGF0aDtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQge1xyXG4gICAgX19leHRlbmRzOiBfX2V4dGVuZHMsXHJcbiAgICBfX2Fzc2lnbjogX19hc3NpZ24sXHJcbiAgICBfX3Jlc3Q6IF9fcmVzdCxcclxuICAgIF9fZGVjb3JhdGU6IF9fZGVjb3JhdGUsXHJcbiAgICBfX3BhcmFtOiBfX3BhcmFtLFxyXG4gICAgX19lc0RlY29yYXRlOiBfX2VzRGVjb3JhdGUsXHJcbiAgICBfX3J1bkluaXRpYWxpemVyczogX19ydW5Jbml0aWFsaXplcnMsXHJcbiAgICBfX3Byb3BLZXk6IF9fcHJvcEtleSxcclxuICAgIF9fc2V0RnVuY3Rpb25OYW1lOiBfX3NldEZ1bmN0aW9uTmFtZSxcclxuICAgIF9fbWV0YWRhdGE6IF9fbWV0YWRhdGEsXHJcbiAgICBfX2F3YWl0ZXI6IF9fYXdhaXRlcixcclxuICAgIF9fZ2VuZXJhdG9yOiBfX2dlbmVyYXRvcixcclxuICAgIF9fY3JlYXRlQmluZGluZzogX19jcmVhdGVCaW5kaW5nLFxyXG4gICAgX19leHBvcnRTdGFyOiBfX2V4cG9ydFN0YXIsXHJcbiAgICBfX3ZhbHVlczogX192YWx1ZXMsXHJcbiAgICBfX3JlYWQ6IF9fcmVhZCxcclxuICAgIF9fc3ByZWFkOiBfX3NwcmVhZCxcclxuICAgIF9fc3ByZWFkQXJyYXlzOiBfX3NwcmVhZEFycmF5cyxcclxuICAgIF9fc3ByZWFkQXJyYXk6IF9fc3ByZWFkQXJyYXksXHJcbiAgICBfX2F3YWl0OiBfX2F3YWl0LFxyXG4gICAgX19hc3luY0dlbmVyYXRvcjogX19hc3luY0dlbmVyYXRvcixcclxuICAgIF9fYXN5bmNEZWxlZ2F0b3I6IF9fYXN5bmNEZWxlZ2F0b3IsXHJcbiAgICBfX2FzeW5jVmFsdWVzOiBfX2FzeW5jVmFsdWVzLFxyXG4gICAgX19tYWtlVGVtcGxhdGVPYmplY3Q6IF9fbWFrZVRlbXBsYXRlT2JqZWN0LFxyXG4gICAgX19pbXBvcnRTdGFyOiBfX2ltcG9ydFN0YXIsXHJcbiAgICBfX2ltcG9ydERlZmF1bHQ6IF9faW1wb3J0RGVmYXVsdCxcclxuICAgIF9fY2xhc3NQcml2YXRlRmllbGRHZXQ6IF9fY2xhc3NQcml2YXRlRmllbGRHZXQsXHJcbiAgICBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0OiBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0LFxyXG4gICAgX19jbGFzc1ByaXZhdGVGaWVsZEluOiBfX2NsYXNzUHJpdmF0ZUZpZWxkSW4sXHJcbiAgICBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZTogX19hZGREaXNwb3NhYmxlUmVzb3VyY2UsXHJcbiAgICBfX2Rpc3Bvc2VSZXNvdXJjZXM6IF9fZGlzcG9zZVJlc291cmNlcyxcclxuICAgIF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uOiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbixcclxufTtcclxuIiwiaW1wb3J0IHtcbiAgQXBwLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIFRGb2xkZXIsXG4gIFRGaWxlLFxuICBNb2RhbCxcbiAgVGV4dENvbXBvbmVudCxcbiAgTm90aWNlLFxuICBUQWJzdHJhY3RGaWxlLFxuICBNZW51LFxuICBNZW51SXRlbSxcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmludGVyZmFjZSBUYWdJdFNldHRpbmdzIHtcbiAgaW5oZXJpdGFuY2VNb2RlOiBcIm5vbmVcIiB8IFwiaW1tZWRpYXRlXCIgfCBcImFsbFwiO1xuICBleGNsdWRlZEZvbGRlcnM6IHN0cmluZ1tdO1xuICBzaG93Rm9sZGVySWNvbnM6IGJvb2xlYW47XG4gIGF1dG9BcHBseVRhZ3M6IGJvb2xlYW47XG4gIGRlYnVnTW9kZTogYm9vbGVhbjtcbiAgc2hvd0JhdGNoQ29udmVyc2lvbldhcm5pbmc6IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IFRhZ0l0U2V0dGluZ3MgPSB7XG4gIGluaGVyaXRhbmNlTW9kZTogXCJpbW1lZGlhdGVcIixcbiAgZXhjbHVkZWRGb2xkZXJzOiBbXSxcbiAgc2hvd0ZvbGRlckljb25zOiB0cnVlLFxuICBhdXRvQXBwbHlUYWdzOiB0cnVlLFxuICBkZWJ1Z01vZGU6IGZhbHNlLFxuICBzaG93QmF0Y2hDb252ZXJzaW9uV2FybmluZzogdHJ1ZSxcbn07XG5cbi8vIEFkZCB0aGlzIHR5cGUgZGVmaW5pdGlvblxudHlwZSBGb2xkZXJUYWdzID0geyBbZm9sZGVyUGF0aDogc3RyaW5nXTogc3RyaW5nW10gfTtcblxuaW50ZXJmYWNlIFBsdWdpbkRhdGEge1xuICBzZXR0aW5nczogVGFnSXRTZXR0aW5ncztcbiAgZm9sZGVyVGFnczogRm9sZGVyVGFncztcbiAgdmVyc2lvbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX0RBVEE6IFBsdWdpbkRhdGEgPSB7XG4gIHNldHRpbmdzOiBERUZBVUxUX1NFVFRJTkdTLFxuICBmb2xkZXJUYWdzOiB7fSxcbiAgdmVyc2lvbjogXCIxLjAuMFwiLFxufTtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGFnSXRQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogVGFnSXRTZXR0aW5ncztcbiAgZm9sZGVyVGFnczogRm9sZGVyVGFncyA9IHt9O1xuICBwcml2YXRlIGlzSW5pdGlhbExvYWQ6IGJvb2xlYW4gPSB0cnVlO1xuICBwcml2YXRlIG5ld0ZvbGRlclF1ZXVlOiBURm9sZGVyW10gPSBbXTtcbiAgcHJpdmF0ZSBtb3ZlVGltZW91dDogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgICBhd2FpdCB0aGlzLmxvYWRGb2xkZXJUYWdzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgIFwiRXJyb3IgbG9hZGluZyBwbHVnaW4gZGF0YSwgaW5pdGlhbGl6aW5nIHdpdGggZGVmYXVsdHM6XCIsXG4gICAgICAgIGVycm9yXG4gICAgICApO1xuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplRGF0YUZpbGUoKTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhcImxvYWRpbmcgVGFnSXQgcGx1Z2luXCIpO1xuXG4gICAgLy8gRGVsYXllZCBpbml0aWFsaXphdGlvblxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5pc0luaXRpYWxMb2FkID0gZmFsc2U7XG4gICAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiY3JlYXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZUZvbGRlckNyZWF0aW9uKGZpbGUpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZUZpbGVDcmVhdGlvbihmaWxlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgICAvLyBQcm9jZXNzIHRoZSBxdWV1ZSBldmVyeSAyIHNlY29uZHNcbiAgICAgIHRoaXMucmVnaXN0ZXJJbnRlcnZhbChcbiAgICAgICAgd2luZG93LnNldEludGVydmFsKCgpID0+IHRoaXMucHJvY2Vzc05ld0ZvbGRlclF1ZXVlKCksIDIwMDApXG4gICAgICApO1xuXG4gICAgICAvLyBBZGQgZXZlbnQgbGlzdGVuZXIgZm9yIGZpbGUgbW92ZW1lbnRcbiAgICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZUZpbGVNb3ZlKGZpbGUsIG9sZFBhdGgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSwgMjAwMCk7IC8vIDIgc2Vjb25kIGRlbGF5XG5cbiAgICAvLyBBZGQgY29tbWFuZCB0byBvcGVuIHRhZyBtb2RhbCBmb3IgY3VycmVudCBmb2xkZXJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi1mb2xkZXItdGFnLW1vZGFsXCIsXG4gICAgICBuYW1lOiBcIkFkZC9FZGl0IHRhZ3MgZm9yIGN1cnJlbnQgZm9sZGVyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgY29uc3QgZm9sZGVyID0gYWN0aXZlRmlsZSA/IGFjdGl2ZUZpbGUucGFyZW50IDogbnVsbDtcbiAgICAgICAgdGhpcy5vcGVuRm9sZGVyVGFnTW9kYWwoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY29tbWFuZCB0byByZW1vdmUgYWxsIHRhZ3MgZnJvbSBjdXJyZW50IGZvbGRlclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJyZW1vdmUtZm9sZGVyLXRhZ3NcIixcbiAgICAgIG5hbWU6IFwiUmVtb3ZlIGFsbCB0YWdzIGZyb20gY3VycmVudCBmb2xkZXJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFjdGl2ZUZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBjb25zdCBmb2xkZXIgPSBhY3RpdmVGaWxlID8gYWN0aXZlRmlsZS5wYXJlbnQgOiBudWxsO1xuICAgICAgICB0aGlzLnJlbW92ZUZvbGRlclRhZ3MoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY29tbWFuZCB0byBhcHBseSBmaWxlIHRhZ3MgdG8gZm9sZGVyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImFwcGx5LWZpbGUtdGFncy10by1mb2xkZXJcIixcbiAgICAgIG5hbWU6IFwiQXBwbHkgZmlsZSB0YWdzIHRvIGZvbGRlclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmIChhY3RpdmVGaWxlKSB7XG4gICAgICAgICAgdGhpcy5hcHBseUZpbGVUYWdzVG9Gb2xkZXIoYWN0aXZlRmlsZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIGFjdGl2ZSBmaWxlXCIpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbW1hbmQgdG8gY29udmVydCBpbmxpbmUgdGFncyB0byBZQU1MXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImNvbnZlcnQtaW5saW5lLXRhZ3MtdG8teWFtbFwiLFxuICAgICAgbmFtZTogXCJDb252ZXJ0IGlubGluZSB0YWdzIHRvIFlBTUxcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFjdGl2ZUZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBpZiAoYWN0aXZlRmlsZSkge1xuICAgICAgICAgIHRoaXMuY29udmVydElubGluZVRhZ3NUb1lBTUwoYWN0aXZlRmlsZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIGFjdGl2ZSBmaWxlXCIpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gUmVnaXN0ZXIgY29udGV4dCBtZW51IGV2ZW50c1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcbiAgICAgICAgXCJmaWxlLW1lbnVcIixcbiAgICAgICAgKG1lbnU6IE1lbnUsIGZpbGU6IFRBYnN0cmFjdEZpbGUsIHNvdXJjZTogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpID09PSBcIm1kXCIpIHtcbiAgICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbTogTWVudUl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAgIC5zZXRUaXRsZShcIkNvbnZlcnQgdG8gWUFNTFwiKVxuICAgICAgICAgICAgICAgIC5zZXRJY29uKFwidGFnXCIpXG4gICAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgdGhpcy5iYXRjaENvbnZlcnRXaXRoQ29uZmlybWF0aW9uKFtmaWxlXSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBBZGQgZm9sZGVyIGNvbnZlcnNpb24gb3B0aW9uXG4gICAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW06IE1lbnVJdGVtKSA9PiB7XG4gICAgICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJDb252ZXJ0IEFsbCBOb3RlcyB0byBZQU1MXCIpXG4gICAgICAgICAgICAgICAgLnNldEljb24oXCJ0YWdcIilcbiAgICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBmaWxlcyA9IGZpbGUuY2hpbGRyZW4uZmlsdGVyKFxuICAgICAgICAgICAgICAgICAgICAoY2hpbGQ6IFRBYnN0cmFjdEZpbGUpOiBjaGlsZCBpcyBURmlsZSA9PlxuICAgICAgICAgICAgICAgICAgICAgIGNoaWxkIGluc3RhbmNlb2YgVEZpbGUgJiZcbiAgICAgICAgICAgICAgICAgICAgICBjaGlsZC5leHRlbnNpb24udG9Mb3dlckNhc2UoKSA9PT0gXCJtZFwiXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgdGhpcy5iYXRjaENvbnZlcnRXaXRoQ29uZmlybWF0aW9uKGZpbGVzKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgKVxuICAgICk7XG5cbiAgICAvLyBUaGlzIGFkZHMgYSBzZXR0aW5ncyB0YWIgc28gdGhlIHVzZXIgY2FuIGNvbmZpZ3VyZSB2YXJpb3VzIGFzcGVjdHMgb2YgdGhlIHBsdWdpblxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVGFnSXRTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC52YXVsdC5vbihcImRlbGV0ZVwiLCAoZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGb2xkZXIpIHtcbiAgICAgICAgICB0aGlzLmhhbmRsZUZvbGRlckRlbGV0aW9uKGZpbGUpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBVcGRhdGUgZm9sZGVyIGljb25zIHdoZW4gdGhlIHBsdWdpbiBsb2Fkc1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKTtcbiAgICB9KTtcblxuICAgIC8vIFVwZGF0ZSBmb2xkZXIgaWNvbnMgd2hlbiBmaWxlcyBhcmUgY3JlYXRlZCwgZGVsZXRlZCwgb3IgcmVuYW1lZFxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiY3JlYXRlXCIsICgpID0+IHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKSlcbiAgICApO1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsICgpID0+IHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKSlcbiAgICApO1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsICgpID0+IHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKSlcbiAgICApO1xuXG4gICAgLy8gQWRkIHRoaXMgbGluZSB0byB1cGRhdGUgdGFncyB3aGVuIHRoZSBwbHVnaW4gbG9hZHNcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB0aGlzLnVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKSk7XG5cbiAgICAvLyBVcGRhdGUgZm9sZGVyIGljb25zIGJhc2VkIG9uIHRoZSBzaG93Rm9sZGVySWNvbnMgc2V0dGluZ1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLnNob3dGb2xkZXJJY29ucykge1xuICAgICAgICB0aGlzLnVwZGF0ZUZvbGRlckljb25zKCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHtcbiAgICBjb25zb2xlLmxvZyhcInVubG9hZGluZyBUYWdJdCBwbHVnaW5cIik7XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRhdGEgPSAoYXdhaXQgdGhpcy5sb2FkRGF0YSgpKSBhcyBQbHVnaW5EYXRhO1xuICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IHsgLi4uREVGQVVMVF9TRVRUSU5HUywgLi4uZGF0YS5zZXR0aW5ncyB9O1xuICAgICAgICB0aGlzLmZvbGRlclRhZ3MgPSBkYXRhLmZvbGRlclRhZ3MgfHwge307XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HUztcbiAgICAgICAgdGhpcy5mb2xkZXJUYWdzID0ge307XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgdG8gbG9hZCBwbHVnaW4gZGF0YTpcIiwgZXJyb3IpO1xuICAgICAgdGhpcy5zZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gICAgICB0aGlzLmZvbGRlclRhZ3MgPSB7fTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgY29uc3QgZGF0YTogUGx1Z2luRGF0YSA9IHtcbiAgICAgIHNldHRpbmdzOiB0aGlzLnNldHRpbmdzLFxuICAgICAgZm9sZGVyVGFnczogdGhpcy5mb2xkZXJUYWdzLFxuICAgICAgdmVyc2lvbjogXCIxLjAuMFwiLFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YShkYXRhKTtcbiAgfVxuXG4gIGFzeW5jIGxvYWRGb2xkZXJUYWdzKCkge1xuICAgIC8vIFRoaXMgbWV0aG9kIGlzIG5vdyByZWR1bmRhbnQgYXMgd2UncmUgbG9hZGluZyBib3RoIHNldHRpbmdzIGFuZCBmb2xkZXJUYWdzIGluIGxvYWRTZXR0aW5nc1xuICAgIC8vIEtlZXBpbmcgaXQgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5XG4gICAgY29uc29sZS5sb2coXCJGb2xkZXIgdGFncyBsb2FkZWQgaW4gbG9hZFNldHRpbmdzIG1ldGhvZFwiKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVGb2xkZXJUYWdzKCkge1xuICAgIGNvbnN0IGRhdGE6IFBsdWdpbkRhdGEgPSB7XG4gICAgICBzZXR0aW5nczogdGhpcy5zZXR0aW5ncyxcbiAgICAgIGZvbGRlclRhZ3M6IHRoaXMuZm9sZGVyVGFncyxcbiAgICAgIHZlcnNpb246IFwiMS4wLjBcIixcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEoZGF0YSk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUZvbGRlckNyZWF0aW9uKGZvbGRlcjogVEZvbGRlcikge1xuICAgIGlmICghdGhpcy5pc0luaXRpYWxMb2FkKSB7XG4gICAgICBuZXcgRm9sZGVyVGFnTW9kYWwodGhpcy5hcHAsIGZvbGRlciwgdGhpcywgdHJ1ZSkub3BlbigpO1xuICAgIH1cbiAgfVxuXG4gIHNldEZvbGRlclRhZ3MoZm9sZGVyUGF0aDogc3RyaW5nLCB0YWdzOiBzdHJpbmdbXSkge1xuICAgIGNvbnN0IHVuaXF1ZVRhZ3MgPSB0aGlzLnJlbW92ZUR1cGxpY2F0ZVRhZ3ModGFncyk7XG4gICAgdGhpcy5mb2xkZXJUYWdzW2ZvbGRlclBhdGhdID0gdW5pcXVlVGFncztcbiAgICB0aGlzLnNhdmVGb2xkZXJUYWdzKCk7XG4gICAgdGhpcy51cGRhdGVGb2xkZXJJY29ucygpO1xuICAgIHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuICB9XG5cbiAgZ2V0Rm9sZGVyVGFncyhmb2xkZXJQYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMuZm9sZGVyVGFnc1tmb2xkZXJQYXRoXSB8fCBbXTtcbiAgfVxuXG4gIG9wZW5Gb2xkZXJUYWdNb2RhbChmb2xkZXI6IFRGb2xkZXIgfCBudWxsKSB7XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgbmV3IEZvbGRlclRhZ01vZGFsKHRoaXMuYXBwLCBmb2xkZXIsIHRoaXMpLm9wZW4oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IE5vdGljZShcIk5vIGZvbGRlciBzZWxlY3RlZFwiKTtcbiAgICB9XG4gIH1cblxuICByZW1vdmVGb2xkZXJUYWdzKGZvbGRlcjogVEZvbGRlciB8IG51bGwpIHtcbiAgICBpZiAoZm9sZGVyKSB7XG4gICAgICB0aGlzLnNldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgsIFtdKTtcbiAgICAgIG5ldyBOb3RpY2UoYFJlbW92ZWQgYWxsIHRhZ3MgZnJvbSBmb2xkZXI6ICR7Zm9sZGVyLnBhdGh9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBmb2xkZXIgc2VsZWN0ZWRcIik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgaGFuZGxlRmlsZUNyZWF0aW9uKGZpbGU6IFRGaWxlKSB7XG4gICAgLy8gQWRkIG1vcmUgdGhvcm91Z2ggZmlsZSB0eXBlIGNoZWNraW5nXG4gICAgaWYgKFxuICAgICAgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8XG4gICAgICAhZmlsZS5leHRlbnNpb24udG9Mb3dlckNhc2UoKS5tYXRjaCgvXihtZHxtYXJrZG93bikkLylcbiAgICApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MuYXV0b0FwcGx5VGFncykge1xuICAgICAgcmV0dXJuOyAvLyBEb24ndCBhcHBseSB0YWdzIGlmIHRoZSBzZXR0aW5nIGlzIG9mZlxuICAgIH1cblxuICAgIGNvbnN0IGZvbGRlciA9IGZpbGUucGFyZW50O1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIGNvbnN0IGZvbGRlclRhZ3MgPSB0aGlzLmdldEZvbGRlclRhZ3NXaXRoSW5oZXJpdGFuY2UoZm9sZGVyLnBhdGgpO1xuICAgICAgaWYgKGZvbGRlclRhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICBhd2FpdCB0aGlzLmFkZFRhZ3NUb0ZpbGUoZmlsZSwgZm9sZGVyVGFncyk7XG4gICAgICAgIHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGhhbmRsZUZpbGVNb3ZlKGZpbGU6IFRGaWxlLCBvbGRQYXRoOiBzdHJpbmcpIHtcbiAgICBjb25zb2xlLmxvZyhgRmlsZSBtb3ZlZDogJHtvbGRQYXRofSAtPiAke2ZpbGUucGF0aH1gKTtcblxuICAgIGNvbnN0IG9sZEZvbGRlclBhdGggPSBvbGRQYXRoLnN1YnN0cmluZygwLCBvbGRQYXRoLmxhc3RJbmRleE9mKFwiL1wiKSk7XG4gICAgY29uc3QgbmV3Rm9sZGVyID0gZmlsZS5wYXJlbnQ7XG5cbiAgICBjb25zb2xlLmxvZyhcbiAgICAgIGBPbGQgZm9sZGVyIHBhdGg6ICR7b2xkRm9sZGVyUGF0aH0sIE5ldyBmb2xkZXI6ICR7bmV3Rm9sZGVyPy5wYXRofWBcbiAgICApO1xuXG4gICAgaWYgKG9sZEZvbGRlclBhdGggIT09IG5ld0ZvbGRlcj8ucGF0aCkge1xuICAgICAgY29uc3Qgb2xkRm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShvbGRGb2xkZXJQYXRoKTtcbiAgICAgIGNvbnN0IG5ld0ZvbGRlclRhZ3MgPSB0aGlzLmdldEZvbGRlclRhZ3NXaXRoSW5oZXJpdGFuY2UoXG4gICAgICAgIG5ld0ZvbGRlcj8ucGF0aCB8fCBcIlwiXG4gICAgICApO1xuXG4gICAgICAvLyBPbmx5IHByb2NlZWQgaWYgdGhlIHRhZ3MgYXJlIGRpZmZlcmVudFxuICAgICAgaWYgKFxuICAgICAgICBKU09OLnN0cmluZ2lmeShvbGRGb2xkZXJUYWdzLnNvcnQoKSkgIT09XG4gICAgICAgIEpTT04uc3RyaW5naWZ5KG5ld0ZvbGRlclRhZ3Muc29ydCgpKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBPbGQgZm9sZGVyIHRhZ3M6ICR7b2xkRm9sZGVyVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBOZXcgZm9sZGVyIHRhZ3M6ICR7bmV3Rm9sZGVyVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAgICAgY29uc3QgY29uZmxpY3RpbmdUYWdzID0gdGhpcy5kZXRlY3RDb25mbGljdGluZ1RhZ3MoZmlsZSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25mbGljdGluZyB0YWdzOiAke2NvbmZsaWN0aW5nVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAgICAgaWYgKGNvbmZsaWN0aW5nVGFncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgbmV3IENvbmZsaWN0UmVzb2x1dGlvbk1vZGFsKFxuICAgICAgICAgICAgdGhpcy5hcHAsXG4gICAgICAgICAgICBmaWxlLFxuICAgICAgICAgICAgY29uZmxpY3RpbmdUYWdzLFxuICAgICAgICAgICAgdGhpc1xuICAgICAgICAgICkub3BlbigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5ldyBGaWxlTW92ZWRNb2RhbChcbiAgICAgICAgICAgIHRoaXMuYXBwLFxuICAgICAgICAgICAgZmlsZSxcbiAgICAgICAgICAgIG9sZEZvbGRlclRhZ3MsXG4gICAgICAgICAgICBuZXdGb2xkZXJUYWdzLFxuICAgICAgICAgICAgdGhpc1xuICAgICAgICAgICkub3BlbigpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyhcIkZvbGRlciB0YWdzIGFyZSB0aGUgc2FtZSwgbm8gdXBkYXRlIG5lZWRlZFwiKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5sb2coXCJGaWxlIG5vdCBtb3ZlZCBiZXR3ZWVuIGZvbGRlcnMgb3IgZm9sZGVycyBhcmUgdGhlIHNhbWVcIik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYWRkVGFnc1RvRmlsZShmaWxlOiBURmlsZSwgdGFnc1RvQWRkOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgIC8vIE9ubHkgYWRkIHRhZ3MgdGhhdCBkb24ndCBhbHJlYWR5IGV4aXN0XG4gICAgY29uc3QgbmV3VGFncyA9IHRhZ3NUb0FkZC5maWx0ZXIoXG4gICAgICAodGFnOiBzdHJpbmcpID0+ICFleGlzdGluZ1RhZ3MuaW5jbHVkZXModGFnKVxuICAgICk7XG4gICAgY29uc3QgYWxsVGFncyA9IFsuLi5leGlzdGluZ1RhZ3MsIC4uLm5ld1RhZ3NdO1xuXG4gICAgLy8gT25seSB1cGRhdGUgaWYgdGhlcmUgYXJlIG5ldyB0YWdzIHRvIGFkZFxuICAgIGlmIChuZXdUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVUYWdzSW5Db250ZW50KGNvbnRlbnQsIGFsbFRhZ3MpO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgIHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuXG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy5kZWJ1Z01vZGUpIHtcbiAgICAgICAgY29uc29sZS5sb2coYEFkZGVkIG5ldyB0YWdzIHRvICR7ZmlsZS5uYW1lfTpgLCBuZXdUYWdzKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuc2V0dGluZ3MuZGVidWdNb2RlKSB7XG4gICAgICBjb25zb2xlLmxvZyhgTm8gbmV3IHRhZ3MgdG8gYWRkIHRvICR7ZmlsZS5uYW1lfWApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZUZpbGVUYWdzKFxuICAgIGZpbGU6IFRGaWxlLFxuICAgIG9sZEZvbGRlclRhZ3M6IHN0cmluZ1tdLFxuICAgIG5ld0ZvbGRlclRhZ3M6IHN0cmluZ1tdXG4gICkge1xuICAgIGNvbnNvbGUubG9nKGBVcGRhdGluZyB0YWdzIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICBjb25zb2xlLmxvZyhgT2xkIGZvbGRlciB0YWdzOiAke29sZEZvbGRlclRhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgIGNvbnNvbGUubG9nKGBOZXcgZm9sZGVyIHRhZ3M6ICR7bmV3Rm9sZGVyVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICBjb25zb2xlLmxvZyhgRXhpc3RpbmcgdGFnczogJHtleGlzdGluZ1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgLy8gUmVtb3ZlIG9sZCBmb2xkZXIgdGFncyBhbmQga2VlcCBtYW51YWwgdGFnc1xuICAgIGNvbnN0IG1hbnVhbFRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKFxuICAgICAgKHRhZykgPT4gIW9sZEZvbGRlclRhZ3MuaW5jbHVkZXModGFnKVxuICAgICk7XG5cbiAgICAvLyBBZGQgbmV3IGZvbGRlciB0YWdzXG4gICAgY29uc3QgdXBkYXRlZFRhZ3MgPSBbLi4ubmV3IFNldChbLi4ubWFudWFsVGFncywgLi4ubmV3Rm9sZGVyVGFnc10pXTtcblxuICAgIGNvbnNvbGUubG9nKGBNYW51YWwgdGFnczogJHttYW51YWxUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCB0YWdzOiAke3VwZGF0ZWRUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVUYWdzSW5Db250ZW50KGNvbnRlbnQsIHVwZGF0ZWRUYWdzKTtcblxuICAgIGlmIChjb250ZW50ICE9PSB1cGRhdGVkQ29udGVudCkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgIGNvbnNvbGUubG9nKGBUYWdzIHVwZGF0ZWQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmxvZyhgTm8gY2hhbmdlcyBuZWVkZWQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIH1cbiAgfVxuXG4gIHVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudDogc3RyaW5nLCB0YWdzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gICAgLy8gRW5zdXJlIHRhZ3MgYXJlIHVuaXF1ZSB3aGlsZSBwcmVzZXJ2aW5nIG9yZGVyXG4gICAgY29uc3QgdW5pcXVlVGFncyA9IFsuLi5uZXcgU2V0KHRhZ3MpXTtcblxuICAgIGlmICh1bmlxdWVUYWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlWWFtbEZyb250TWF0dGVyKGNvbnRlbnQpO1xuICAgIH1cblxuICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIHRhZ3Mgc2VjdGlvbiBpbiBZQU1MIGZvcm1hdFxuICAgIGNvbnN0IHRhZ1NlY3Rpb24gPSB1bmlxdWVUYWdzLm1hcCgodGFnKSA9PiBgICAtICR7dGFnfWApLmpvaW4oXCJcXG5cIik7XG5cbiAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgLy8gUmVtb3ZlIGV4aXN0aW5nIHRhZ3Mgc2VjdGlvbiB3aGlsZSBwcmVzZXJ2aW5nIG90aGVyIGZyb250bWF0dGVyXG4gICAgICBjb25zdCBjbGVhbmVkRnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlclxuICAgICAgICAucmVwbGFjZSgvdGFnczpbXFxzXFxTXSo/KD89XFxuW15cXHNdfFxcbiQpL20sIFwiXCIpXG4gICAgICAgIC5yZXBsYWNlKC9cXG4rL2csIFwiXFxuXCIpXG4gICAgICAgIC50cmltKCk7XG5cbiAgICAgIC8vIEFkZCBuZXcgdGFncyBzZWN0aW9uXG4gICAgICBjb25zdCB1cGRhdGVkRnJvbnRtYXR0ZXIgPSBjbGVhbmVkRnJvbnRtYXR0ZXJcbiAgICAgICAgPyBgJHtjbGVhbmVkRnJvbnRtYXR0ZXJ9XFxudGFnczpcXG4ke3RhZ1NlY3Rpb259YFxuICAgICAgICA6IGB0YWdzOlxcbiR7dGFnU2VjdGlvbn1gO1xuXG4gICAgICByZXR1cm4gY29udGVudC5yZXBsYWNlKFxuICAgICAgICBmcm9udG1hdHRlclJlZ2V4LFxuICAgICAgICBgLS0tXFxuJHt1cGRhdGVkRnJvbnRtYXR0ZXJ9XFxuLS0tYFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGAtLS1cXG50YWdzOlxcbiR7dGFnU2VjdGlvbn1cXG4tLS1cXG5cXG4ke2NvbnRlbnR9YDtcbiAgICB9XG4gIH1cblxuICBhZGRUYWdzVG9Db250ZW50KGNvbnRlbnQ6IHN0cmluZywgdGFnczogc3RyaW5nW10pOiBzdHJpbmcge1xuICAgIGlmICh0YWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgfVxuXG4gICAgY29uc3QgdGFnU2VjdGlvbiA9IHRhZ3MubWFwKCh0YWcpID0+IGAgIC0gJHt0YWd9YCkuam9pbihcIlxcblwiKTtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgIGNvbnN0IHVwZGF0ZWRGcm9udG1hdHRlciA9IGAke2Zyb250bWF0dGVyLnRyaW0oKX1cXG50YWdzOlxcbiR7dGFnU2VjdGlvbn1gO1xuICAgICAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZShcbiAgICAgICAgZnJvbnRtYXR0ZXJSZWdleCxcbiAgICAgICAgYC0tLVxcbiR7dXBkYXRlZEZyb250bWF0dGVyfVxcbi0tLWBcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBgLS0tXFxudGFnczpcXG4ke3RhZ1NlY3Rpb259XFxuLS0tXFxuXFxuJHtjb250ZW50fWA7XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlVGFnc0Zyb21Db250ZW50KGNvbnRlbnQ6IHN0cmluZywgdGFnc1RvUmVtb3ZlOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICBjb25zdCBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG4gICAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSBmcm9udG1hdHRlci5tYXRjaCgvdGFnczpcXHMqXFxbKC4qPylcXF0vKTtcblxuICAgICAgaWYgKGV4aXN0aW5nVGFncykge1xuICAgICAgICBjb25zdCBjdXJyZW50VGFncyA9IGV4aXN0aW5nVGFnc1sxXS5zcGxpdChcIixcIikubWFwKCh0YWcpID0+IHRhZy50cmltKCkpO1xuICAgICAgICBjb25zdCB1cGRhdGVkVGFncyA9IGN1cnJlbnRUYWdzLmZpbHRlcihcbiAgICAgICAgICAodGFnKSA9PiAhdGFnc1RvUmVtb3ZlLmluY2x1ZGVzKHRhZylcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgdXBkYXRlZEZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXIucmVwbGFjZShcbiAgICAgICAgICAvdGFnczpcXHMqXFxbLio/XFxdLyxcbiAgICAgICAgICBgdGFnczogWyR7dXBkYXRlZFRhZ3Muam9pbihcIiwgXCIpfV1gXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiBjb250ZW50LnJlcGxhY2UoXG4gICAgICAgICAgZnJvbnRtYXR0ZXJSZWdleCxcbiAgICAgICAgICBgLS0tXFxuJHt1cGRhdGVkRnJvbnRtYXR0ZXJ9XFxuLS0tYFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb250ZW50O1xuICB9XG5cbiAgYXN5bmMgYXBwbHlGaWxlVGFnc1RvRm9sZGVyKGZpbGU6IFRGaWxlKSB7XG4gICAgY29uc3QgZm9sZGVyID0gZmlsZS5wYXJlbnQ7XG4gICAgaWYgKCFmb2xkZXIpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJGaWxlIGlzIG5vdCBpbiBhIGZvbGRlclwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBmaWxlVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgIGNvbnNvbGUubG9nKGBFeHRyYWN0ZWQgdGFncyBmcm9tIGZpbGU6ICR7ZmlsZVRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgaWYgKGZpbGVUYWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbmV3IE5vdGljZShcIk5vIHRhZ3MgZm91bmQgaW4gdGhlIGZpbGVcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gR2V0IHRhZ3Mgb25seSBmcm9tIHRoZSBpbW1lZGlhdGUgcGFyZW50IGZvbGRlclxuICAgIGNvbnN0IGZvbGRlclRhZ3MgPSB0aGlzLmdldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgpO1xuICAgIGNvbnN0IG5ld1RhZ3MgPSBbLi4ubmV3IFNldChbLi4uZm9sZGVyVGFncywgLi4uZmlsZVRhZ3NdKV07XG4gICAgY29uc3QgYWRkZWRUYWdzID0gbmV3VGFncy5maWx0ZXIoKHRhZykgPT4gIWZvbGRlclRhZ3MuaW5jbHVkZXModGFnKSk7XG5cbiAgICBjb25zb2xlLmxvZyhgRXhpc3RpbmcgZm9sZGVyIHRhZ3M6ICR7Zm9sZGVyVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgY29uc29sZS5sb2coYE5ldyB0YWdzIHRvIGFkZDogJHthZGRlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgaWYgKGFkZGVkVGFncy5sZW5ndGggPT09IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBuZXcgdGFncyB0byBhZGQgdG8gdGhlIGZvbGRlclwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgVGFnU2VsZWN0aW9uTW9kYWwoXG4gICAgICB0aGlzLmFwcCxcbiAgICAgIGBTZWxlY3QgdGFncyB0byBhZGQgZnJvbSB0aGUgZmlsZSBcIiR7ZmlsZS5uYW1lfVwiIHRvIHRoZSBmb2xkZXIgXCIke2ZvbGRlci5uYW1lfVwiOmAsXG4gICAgICBhZGRlZFRhZ3MsXG4gICAgICAoc2VsZWN0ZWRUYWdzKSA9PiB7XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRUYWdzID0gWy4uLm5ldyBTZXQoWy4uLmZvbGRlclRhZ3MsIC4uLnNlbGVjdGVkVGFnc10pXTtcbiAgICAgICAgdGhpcy5zZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoLCB1cGRhdGVkVGFncyk7XG4gICAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICAgYEFwcGxpZWQgJHtzZWxlY3RlZFRhZ3MubGVuZ3RofSB0YWdzIGZyb20gZmlsZSB0byBmb2xkZXI6ICR7Zm9sZGVyLm5hbWV9YFxuICAgICAgICApO1xuICAgICAgfVxuICAgICkub3BlbigpO1xuICB9XG5cbiAgZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgIGxldCB0YWdzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgIC8vIE1hdGNoIGJvdGggYXJyYXktc3R5bGUgYW5kIGxpc3Qtc3R5bGUgWUFNTCB0YWdzXG4gICAgICBjb25zdCB5YW1sVGFncyA9IGZyb250bWF0dGVyLm1hdGNoKC90YWdzOlxccyooXFxbLio/XFxdfChcXG5cXHMqLVxccyouKykrKS8pO1xuICAgICAgaWYgKHlhbWxUYWdzKSB7XG4gICAgICAgIGNvbnN0IHRhZ0NvbnRlbnQgPSB5YW1sVGFnc1sxXTtcbiAgICAgICAgaWYgKHRhZ0NvbnRlbnQuc3RhcnRzV2l0aChcIltcIikpIHtcbiAgICAgICAgICAvLyBBcnJheS1zdHlsZSB0YWdzXG4gICAgICAgICAgdGFncyA9IHRhZ0NvbnRlbnRcbiAgICAgICAgICAgIC5zbGljZSgxLCAtMSlcbiAgICAgICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgICAgIC5tYXAoKHRhZykgPT4gdGFnLnRyaW0oKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gTGlzdC1zdHlsZSB0YWdzXG4gICAgICAgICAgdGFncyA9IHRhZ0NvbnRlbnRcbiAgICAgICAgICAgIC5zcGxpdChcIlxcblwiKVxuICAgICAgICAgICAgLm1hcCgobGluZSkgPT4gbGluZS5yZXBsYWNlKC9eXFxzKi1cXHMqLywgXCJcIikudHJpbSgpKVxuICAgICAgICAgICAgLmZpbHRlcigodGFnKSA9PiB0YWcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBpbmxpbmUgdGFnc1xuICAgIGNvbnN0IGlubGluZVRhZ3MgPSBjb250ZW50Lm1hdGNoKC8jW15cXHMjXSsvZyk7XG4gICAgaWYgKGlubGluZVRhZ3MpIHtcbiAgICAgIHRhZ3MgPSBbLi4udGFncywgLi4uaW5saW5lVGFncy5tYXAoKHRhZykgPT4gdGFnLnN1YnN0cmluZygxKSldO1xuICAgIH1cblxuICAgIHJldHVybiBbLi4ubmV3IFNldCh0YWdzKV07IC8vIFJlbW92ZSBkdXBsaWNhdGVzXG4gIH1cblxuICBhc3luYyBjb252ZXJ0SW5saW5lVGFnc1RvWUFNTChmaWxlOiBURmlsZSkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGlubGluZVRhZ3MgPSBjb250ZW50Lm1hdGNoKC8jW15cXHMjXSsvZyk7XG5cbiAgICBpZiAoIWlubGluZVRhZ3MpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBpbmxpbmUgdGFncyBmb3VuZCBpbiB0aGUgZmlsZVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBuZXdUYWdzID0gaW5saW5lVGFncy5tYXAoKHRhZykgPT4gdGFnLnN1YnN0cmluZygxKSk7XG5cbiAgICBuZXcgQ29uZmlybWF0aW9uTW9kYWwoXG4gICAgICB0aGlzLmFwcCxcbiAgICAgIGBUaGlzIHdpbGwgY29udmVydCAke25ld1RhZ3MubGVuZ3RofSBpbmxpbmUgdGFncyB0byBZQU1MIGZyb250IG1hdHRlciBhbmQgcmVtb3ZlIHRoZW0gZnJvbSB0aGUgY29udGVudC4gQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIHByb2NlZWQ/YCxcbiAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgbmV3IFRhZ1NlbGVjdGlvbk1vZGFsKFxuICAgICAgICAgIHRoaXMuYXBwLFxuICAgICAgICAgIGBTZWxlY3QgaW5saW5lIHRhZ3MgdG8gY29udmVydCB0byBZQU1MIGZyb250IG1hdHRlcjpgLFxuICAgICAgICAgIG5ld1RhZ3MsXG4gICAgICAgICAgYXN5bmMgKHNlbGVjdGVkVGFncykgPT4ge1xuICAgICAgICAgICAgaWYgKHNlbGVjdGVkVGFncy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgbmV3IE5vdGljZShcIk5vIHRhZ3Mgc2VsZWN0ZWQgZm9yIGNvbnZlcnNpb25cIik7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXh0cmFjdCBleGlzdGluZyBZQU1MIHRhZ3NcbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgICAgICAgICAgLy8gQ29tYmluZSBleGlzdGluZyBhbmQgbmV3IHRhZ3MsIHJlbW92aW5nIGR1cGxpY2F0ZXNcbiAgICAgICAgICAgIGNvbnN0IGFsbFRhZ3MgPSBbLi4ubmV3IFNldChbLi4uZXhpc3RpbmdUYWdzLCAuLi5zZWxlY3RlZFRhZ3NdKV07XG5cbiAgICAgICAgICAgIGxldCB1cGRhdGVkQ29udGVudCA9IHRoaXMuYWRkVGFnc1RvQ29udGVudChjb250ZW50LCBhbGxUYWdzKTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHNlbGVjdGVkIGlubGluZSB0YWdzIGZyb20gdGhlIGNvbnRlbnRcbiAgICAgICAgICAgIHNlbGVjdGVkVGFncy5mb3JFYWNoKCh0YWcpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKGAjJHt0YWd9XFxcXGJgLCBcImdcIik7XG4gICAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShyZWdleCwgXCJcIik7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICAgICAgIGBDb252ZXJ0ZWQgJHtzZWxlY3RlZFRhZ3MubGVuZ3RofSBpbmxpbmUgdGFncyB0byBZQU1MIGZyb250IG1hdHRlcmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICApLm9wZW4oKTtcbiAgICAgIH1cbiAgICApLm9wZW4oKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlRm9sZGVyRGVsZXRpb24oZm9sZGVyOiBURm9sZGVyKSB7XG4gICAgZGVsZXRlIHRoaXMuZm9sZGVyVGFnc1tmb2xkZXIucGF0aF07XG4gICAgdGhpcy5zYXZlRm9sZGVyVGFncygpO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlGb2xkZXJUYWdzVG9Db250ZW50cyhmb2xkZXI6IFRGb2xkZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWZvbGRlcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIkZvbGRlciBpcyBudWxsIG9yIHVuZGVmaW5lZFwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoKTtcbiAgICBjb25zdCBmaWxlcyA9IGZvbGRlci5jaGlsZHJlbi5maWx0ZXIoKGNoaWxkKSA9PiBjaGlsZCBpbnN0YW5jZW9mIFRGaWxlKTtcblxuICAgIGxldCB1cGRhdGVkQ291bnQgPSAwO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkge1xuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuICAgICAgICBjb25zdCBuZXdUYWdzID0gZm9sZGVyVGFncy5maWx0ZXIoXG4gICAgICAgICAgKHRhZzogc3RyaW5nKSA9PiAhZXhpc3RpbmdUYWdzLmluY2x1ZGVzKHRhZylcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAobmV3VGFncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5hZGRUYWdzVG9GaWxlKGZpbGUsIG5ld1RhZ3MpO1xuICAgICAgICAgIHVwZGF0ZWRDb3VudCsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHVwZGF0ZWRDb3VudCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoYFVwZGF0ZWQgdGFncyBmb3IgJHt1cGRhdGVkQ291bnR9IGZpbGUocylgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IE5vdGljZShcIk5vIGZpbGVzIG5lZWRlZCB0YWcgdXBkYXRlc1wiKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplRGF0YUZpbGUoKSB7XG4gICAgY29uc3QgaW5pdGlhbERhdGEgPSB7XG4gICAgICBzZXR0aW5nczogREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIGZvbGRlclRhZ3M6IHt9LFxuICAgIH07XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MpO1xuICAgIHRoaXMuZm9sZGVyVGFncyA9IHt9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEoaW5pdGlhbERhdGEpO1xuICAgIGNvbnNvbGUubG9nKFwiSW5pdGlhbGl6ZWQgZGF0YSBmaWxlIHdpdGggZGVmYXVsdCB2YWx1ZXNcIik7XG4gIH1cblxuICBxdWV1ZU5ld0ZvbGRlcihmb2xkZXI6IFRGb2xkZXIpIHtcbiAgICAvLyBFbnN1cmUgd2UgaGF2ZSB0aGUgbW9zdCB1cC10by1kYXRlIGZvbGRlciBvYmplY3RcbiAgICBjb25zdCB1cGRhdGVkRm9sZGVyID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZvbGRlci5wYXRoKTtcbiAgICBpZiAodXBkYXRlZEZvbGRlciBpbnN0YW5jZW9mIFRGb2xkZXIpIHtcbiAgICAgIHRoaXMubmV3Rm9sZGVyUXVldWUucHVzaCh1cGRhdGVkRm9sZGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgYEZhaWxlZCB0byBnZXQgdXBkYXRlZCBmb2xkZXIgb2JqZWN0IGZvciBwYXRoOiAke2ZvbGRlci5wYXRofWBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHJvY2Vzc05ld0ZvbGRlclF1ZXVlKCkge1xuICAgIGZvciAoY29uc3QgZm9sZGVyIG9mIHRoaXMubmV3Rm9sZGVyUXVldWUpIHtcbiAgICAgIGF3YWl0IHRoaXMucHJvbXB0Rm9yRm9sZGVyVGFncyhmb2xkZXIpO1xuICAgIH1cbiAgICB0aGlzLm5ld0ZvbGRlclF1ZXVlID0gW107IC8vIENsZWFyIHRoZSBxdWV1ZVxuICB9XG5cbiAgYXN5bmMgcHJvbXB0Rm9yRm9sZGVyVGFncyhmb2xkZXI6IFRGb2xkZXIpIHtcbiAgICBuZXcgRm9sZGVyVGFnTW9kYWwodGhpcy5hcHAsIGZvbGRlciwgdGhpcywgdHJ1ZSkub3BlbigpO1xuICB9XG5cbiAgZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShmb2xkZXJQYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuaW5oZXJpdGFuY2VNb2RlID09PSBcIm5vbmVcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXJQYXRoKTtcbiAgICB9XG5cbiAgICBsZXQgdGFnczogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgY3VycmVudFBhdGggPSBmb2xkZXJQYXRoO1xuXG4gICAgd2hpbGUgKGN1cnJlbnRQYXRoKSB7XG4gICAgICBpZiAoIXRoaXMuc2V0dGluZ3MuZXhjbHVkZWRGb2xkZXJzLmluY2x1ZGVzKGN1cnJlbnRQYXRoKSkge1xuICAgICAgICB0YWdzID0gWy4uLm5ldyBTZXQoWy4uLnRhZ3MsIC4uLnRoaXMuZ2V0Rm9sZGVyVGFncyhjdXJyZW50UGF0aCldKV07XG4gICAgICB9XG5cbiAgICAgIGlmIChcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5pbmhlcml0YW5jZU1vZGUgPT09IFwiaW1tZWRpYXRlXCIgJiZcbiAgICAgICAgY3VycmVudFBhdGggIT09IGZvbGRlclBhdGhcbiAgICAgICkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyZW50UGF0aCA9IGN1cnJlbnRQYXRoLnN1YnN0cmluZygwLCBjdXJyZW50UGF0aC5sYXN0SW5kZXhPZihcIi9cIikpO1xuICAgICAgaWYgKHBhcmVudFBhdGggPT09IGN1cnJlbnRQYXRoKSB7XG4gICAgICAgIGJyZWFrOyAvLyBXZSd2ZSByZWFjaGVkIHRoZSByb290XG4gICAgICB9XG4gICAgICBjdXJyZW50UGF0aCA9IHBhcmVudFBhdGg7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRhZ3M7XG4gIH1cblxuICBhc3luYyB1cGRhdGVGb2xkZXJJY29ucygpIHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3Muc2hvd0ZvbGRlckljb25zKSB7XG4gICAgICAvLyBSZW1vdmUgYWxsIGZvbGRlciBpY29ucyBpZiB0aGUgc2V0dGluZyBpcyBvZmZcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJmaWxlLWV4cGxvcmVyXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZUV4cGxvcmVyVmlldyA9IGxlYWYudmlldyBhcyBhbnk7XG4gICAgICAgIGNvbnN0IGZpbGVJdGVtcyA9IGZpbGVFeHBsb3JlclZpZXcuZmlsZUl0ZW1zO1xuICAgICAgICBmb3IgKGNvbnN0IFssIGl0ZW1dIG9mIE9iamVjdC5lbnRyaWVzKGZpbGVJdGVtcykpIHtcbiAgICAgICAgICBpZiAoaXRlbSAmJiB0eXBlb2YgaXRlbSA9PT0gXCJvYmplY3RcIiAmJiBcImVsXCIgaW4gaXRlbSkge1xuICAgICAgICAgICAgY29uc3QgZm9sZGVyRWwgPSBpdGVtLmVsIGFzIEhUTUxFbGVtZW50O1xuICAgICAgICAgICAgY29uc3QgaWNvbkVsID0gZm9sZGVyRWwucXVlcnlTZWxlY3RvcihcbiAgICAgICAgICAgICAgXCIubmF2LWZvbGRlci10aXRsZS1jb250ZW50XCJcbiAgICAgICAgICAgICkgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICAgICAgaWYgKGljb25FbCkge1xuICAgICAgICAgICAgICBpY29uRWwucmVtb3ZlQ2xhc3MoXCJ0YWdnZWQtZm9sZGVyXCIpO1xuICAgICAgICAgICAgICBpY29uRWwucmVtb3ZlQXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVFeHBsb3JlciA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJmaWxlLWV4cGxvcmVyXCIpWzBdO1xuICAgIGlmICghZmlsZUV4cGxvcmVyKSByZXR1cm47XG5cbiAgICBjb25zdCBmaWxlRXhwbG9yZXJWaWV3ID0gZmlsZUV4cGxvcmVyLnZpZXcgYXMgYW55O1xuICAgIGNvbnN0IGZpbGVJdGVtcyA9IGZpbGVFeHBsb3JlclZpZXcuZmlsZUl0ZW1zO1xuXG4gICAgZm9yIChjb25zdCBbcGF0aCwgaXRlbV0gb2YgT2JqZWN0LmVudHJpZXMoZmlsZUl0ZW1zKSkge1xuICAgICAgaWYgKFxuICAgICAgICBpdGVtICYmXG4gICAgICAgIHR5cGVvZiBpdGVtID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwiZWxcIiBpbiBpdGVtICYmXG4gICAgICAgIFwiZmlsZVwiIGluIGl0ZW0gJiZcbiAgICAgICAgaXRlbS5maWxlIGluc3RhbmNlb2YgVEZvbGRlclxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IGZvbGRlclRhZ3MgPSB0aGlzLmdldEZvbGRlclRhZ3NXaXRoSW5oZXJpdGFuY2UocGF0aCBhcyBzdHJpbmcpO1xuICAgICAgICBjb25zdCBmb2xkZXJFbCA9IGl0ZW0uZWwgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgIGNvbnN0IGljb25FbCA9IGZvbGRlckVsLnF1ZXJ5U2VsZWN0b3IoXG4gICAgICAgICAgXCIubmF2LWZvbGRlci10aXRsZS1jb250ZW50XCJcbiAgICAgICAgKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG5cbiAgICAgICAgaWYgKGljb25FbCkge1xuICAgICAgICAgIGlmIChmb2xkZXJUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGljb25FbC5hZGRDbGFzcyhcInRhZ2dlZC1mb2xkZXJcIik7XG4gICAgICAgICAgICBpY29uRWwuc2V0QXR0cmlidXRlKFxuICAgICAgICAgICAgICBcImFyaWEtbGFiZWxcIixcbiAgICAgICAgICAgICAgYFRhZ2dlZCBmb2xkZXI6ICR7Zm9sZGVyVGFncy5qb2luKFwiLCBcIil9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUNsYXNzKFwidGFnZ2VkLWZvbGRlclwiKTtcbiAgICAgICAgICAgIGljb25FbC5yZW1vdmVBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oYENvdWxkIG5vdCBmaW5kIGljb24gZWxlbWVudCBmb3IgZm9sZGVyOiAke3BhdGh9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBBZGQgdGhpcyBuZXcgbWV0aG9kXG4gIGFzeW5jIHVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRyaWdnZXIgbWV0YWRhdGEgY2FjaGUgdXBkYXRlXG4gICAgICB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLnRyaWdnZXIoXCJjaGFuZ2VkXCIpO1xuXG4gICAgICAvLyBUcnkgdG8gcmVmcmVzaCB0aGUgdGFnIHBhbmUgaWYgaXQgZXhpc3RzXG4gICAgICBjb25zdCB0YWdQYW5lTGVhdmVzID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcInRhZ1wiKTtcbiAgICAgIGlmICh0YWdQYW5lTGVhdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gVXNlIHRoZSB3b3Jrc3BhY2UgdHJpZ2dlciBpbnN0ZWFkIG9mIGRpcmVjdGx5IGNhbGxpbmcgcmVmcmVzaFxuICAgICAgICB0aGlzLmFwcC53b3Jrc3BhY2UudHJpZ2dlcihcInRhZ3MtdXBkYXRlZFwiKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHRoaXMuc2V0dGluZ3MuZGVidWdNb2RlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgdG8gdXBkYXRlIHRhZyBjYWNoZTpcIiwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEFkZCB0aGlzIG5ldyBtZXRob2RcbiAgZ2V0QWxsRm9sZGVyVGFncygpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYWxsVGFncyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgdGFncyBvZiBPYmplY3QudmFsdWVzKHRoaXMuZm9sZGVyVGFncykpIHtcbiAgICAgIHRhZ3MuZm9yRWFjaCgodGFnOiBzdHJpbmcpID0+IGFsbFRhZ3MuYWRkKHRhZykpO1xuICAgIH1cbiAgICByZXR1cm4gQXJyYXkuZnJvbShhbGxUYWdzKTtcbiAgfVxuXG4gIGFzeW5jIHJlcGxhY2VBbGxUYWdzKGZpbGU6IFRGaWxlLCBuZXdUYWdzOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnNvbGUubG9nKGBSZXBsYWNpbmcgYWxsIHRhZ3MgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIGNvbnNvbGUubG9nKGBOZXcgdGFnczogJHtuZXdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuXG4gICAgLy8gUmVtb3ZlIGFsbCBleGlzdGluZyB0YWdzIGZyb20gdGhlIGNvbnRlbnRcbiAgICBsZXQgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnJlbW92ZUFsbFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgIC8vIEFkZCBuZXcgdGFnc1xuICAgIGlmIChuZXdUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gdXBkYXRlZENvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG5cbiAgICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgICAgY29uc3QgbmV3VGFnc1NlY3Rpb24gPSBgdGFnczpcXG4ke25ld1RhZ3NcbiAgICAgICAgICAubWFwKCh0YWcpID0+IGAgIC0gJHt0YWd9YClcbiAgICAgICAgICAuam9pbihcIlxcblwiKX1gO1xuICAgICAgICBjb25zdCB1cGRhdGVkRnJvbnRtYXR0ZXIgPSBgJHtmcm9udG1hdHRlci50cmltKCl9XFxuJHtuZXdUYWdzU2VjdGlvbn1gO1xuICAgICAgICB1cGRhdGVkQ29udGVudCA9IHVwZGF0ZWRDb250ZW50LnJlcGxhY2UoXG4gICAgICAgICAgZnJvbnRtYXR0ZXJSZWdleCxcbiAgICAgICAgICBgLS0tXFxuJHt1cGRhdGVkRnJvbnRtYXR0ZXJ9XFxuLS0tYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgbmV3VGFnc1NlY3Rpb24gPSBgdGFnczpcXG4ke25ld1RhZ3NcbiAgICAgICAgICAubWFwKCh0YWcpID0+IGAgIC0gJHt0YWd9YClcbiAgICAgICAgICAuam9pbihcIlxcblwiKX1gO1xuICAgICAgICB1cGRhdGVkQ29udGVudCA9IGAtLS1cXG4ke25ld1RhZ3NTZWN0aW9ufVxcbi0tLVxcblxcbiR7dXBkYXRlZENvbnRlbnR9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgIHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuICAgIG5ldyBOb3RpY2UoYFRhZ3MgcmVwbGFjZWQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICB9XG5cbiAgcmVtb3ZlQWxsVGFnc0Zyb21Db250ZW50KGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuW1xcc1xcU10qP1xcbi0tLVxcbi87XG4gICAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZShmcm9udG1hdHRlclJlZ2V4LCBcIlwiKTtcbiAgfVxuXG4gIGFzeW5jIG1lcmdlVGFncyhcbiAgICBmaWxlOiBURmlsZSxcbiAgICBvbGRUYWdzOiBzdHJpbmdbXSxcbiAgICBuZXdUYWdzOiBzdHJpbmdbXVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zb2xlLmxvZyhgTWVyZ2luZyB0YWdzIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICBjb25zb2xlLmxvZyhgT2xkIHRhZ3M6ICR7b2xkVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgY29uc29sZS5sb2coYE5ldyB0YWdzOiAke25ld1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgY29uc29sZS5sb2coYEV4aXN0aW5nIHRhZ3M6ICR7ZXhpc3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIC8vIFJlbW92ZSBvbGQgZm9sZGVyIHRhZ3NcbiAgICBjb25zdCBtYW51YWxUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcigodGFnKSA9PiAhb2xkVGFncy5pbmNsdWRlcyh0YWcpKTtcblxuICAgIC8vIE1lcmdlIG1hbnVhbCB0YWdzIHdpdGggbmV3IGZvbGRlciB0YWdzLCBlbnN1cmluZyBubyBkdXBsaWNhdGVzXG4gICAgY29uc3QgbWVyZ2VkVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5tYW51YWxUYWdzLCAuLi5uZXdUYWdzXSldO1xuXG4gICAgY29uc29sZS5sb2coYE1lcmdlZCB0YWdzOiAke21lcmdlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgaWYgKFxuICAgICAgSlNPTi5zdHJpbmdpZnkoZXhpc3RpbmdUYWdzLnNvcnQoKSkgIT09IEpTT04uc3RyaW5naWZ5KG1lcmdlZFRhZ3Muc29ydCgpKVxuICAgICkge1xuICAgICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgbWVyZ2VkVGFncyk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgICBuZXcgTm90aWNlKGBUYWdzIG1lcmdlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKGBObyBjaGFuZ2VzIG5lZWRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYXBwbHlGb2xkZXJUYWdzVG9Ob3Rlcyhmb2xkZXI6IFRGb2xkZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjdXJyZW50Rm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCk7XG4gICAgY29uc29sZS5sb2coYEN1cnJlbnQgZm9sZGVyIHRhZ3M6ICR7Y3VycmVudEZvbGRlclRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgaWYgKGN1cnJlbnRGb2xkZXJUYWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbmV3IE5vdGljZShcIlRoaXMgZm9sZGVyIGhhcyBubyB0YWdzIHRvIGFwcGx5LlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlcyA9IGZvbGRlci5jaGlsZHJlbi5maWx0ZXIoXG4gICAgICAoY2hpbGQpOiBjaGlsZCBpcyBURmlsZSA9PiBjaGlsZCBpbnN0YW5jZW9mIFRGaWxlXG4gICAgKTtcbiAgICBsZXQgdXBkYXRlZENvdW50ID0gMDtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgICAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICAgICAgLy8gR2V0IHRoZSBjdXJyZW50IGZvbGRlcidzIGV4aXN0aW5nIHRhZ3MgaW4gdGhlIGZpbGVcbiAgICAgICAgY29uc3QgZXhpc3RpbmdGb2xkZXJUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcigodGFnKSA9PlxuICAgICAgICAgIHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCkuaW5jbHVkZXModGFnKVxuICAgICAgICApO1xuXG4gICAgICAgIC8vIEdldCBtYW51YWxseSBhZGRlZCB0YWdzICh0YWdzIHRoYXQgYXJlbid0IGZyb20gdGhlIGZvbGRlcilcbiAgICAgICAgY29uc3QgbWFudWFsVGFncyA9IGV4aXN0aW5nVGFncy5maWx0ZXIoXG4gICAgICAgICAgKHRhZykgPT4gIWV4aXN0aW5nRm9sZGVyVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gQ29tYmluZSBtYW51YWwgdGFncyB3aXRoIGN1cnJlbnQgZm9sZGVyIHRhZ3NcbiAgICAgICAgY29uc3QgdXBkYXRlZFRhZ3MgPSBbLi4ubWFudWFsVGFncywgLi4uY3VycmVudEZvbGRlclRhZ3NdO1xuXG4gICAgICAgIC8vIE9ubHkgdXBkYXRlIGlmIHRoZXJlIGFyZSBjaGFuZ2VzXG4gICAgICAgIGlmIChcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShleGlzdGluZ1RhZ3Muc29ydCgpKSAhPT1cbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh1cGRhdGVkVGFncy5zb3J0KCkpXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBFeGlzdGluZyB0YWdzOiAke2V4aXN0aW5nVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgICAgICAgY29uc29sZS5sb2coYE1hbnVhbCB0YWdzOiAke21hbnVhbFRhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIHRhZ3M6ICR7dXBkYXRlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgICAgICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgdXBkYXRlZFRhZ3MpO1xuICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICAgICAgdXBkYXRlZENvdW50Kys7XG4gICAgICAgICAgY29uc29sZS5sb2coYFVwZGF0ZWQgdGFncyBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYE5vIGNoYW5nZXMgbmVlZGVkIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBmaWxlICR7ZmlsZS5uYW1lfTpgLCBlcnJvcik7XG4gICAgICAgIG5ldyBOb3RpY2UoYEVycm9yIHVwZGF0aW5nIHRhZ3MgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh1cGRhdGVkQ291bnQgPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKGBVcGRhdGVkIHRhZ3MgZm9yICR7dXBkYXRlZENvdW50fSBmaWxlKHMpIGluICR7Zm9sZGVyLm5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBOb3RpY2UoYE5vIGZpbGVzIG5lZWRlZCB0YWcgdXBkYXRlcyBpbiAke2ZvbGRlci5uYW1lfWApO1xuICAgIH1cbiAgfVxuXG4gIC8vIEFkZCB0aGlzIGhlbHBlciBtZXRob2QgdG8gY2hlY2sgaWYgYSB0YWcgaXMgdXNlZCBieSBhbnkgZm9sZGVyXG4gIHByaXZhdGUgaXNBbnlGb2xkZXJUYWcodGFnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLmZvbGRlclRhZ3MpLnNvbWUoKGZvbGRlclRhZ3MpID0+XG4gICAgICBmb2xkZXJUYWdzLmluY2x1ZGVzKHRhZylcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlVGFnc0Zyb21GaWxlKGZpbGU6IFRGaWxlLCB0YWdzVG9SZW1vdmU6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc29sZS5sb2coYFJlbW92aW5nIGZvbGRlciB0YWdzIGZyb20gZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgY29uc29sZS5sb2coYFRhZ3MgdG8gcmVtb3ZlOiAke3RhZ3NUb1JlbW92ZS5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICBjb25zb2xlLmxvZyhgRXhpc3RpbmcgdGFnczogJHtleGlzdGluZ1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgLy8gS2VlcCBhbGwgdGFncyB0aGF0IGFyZSBub3QgaW4gdGFnc1RvUmVtb3ZlXG4gICAgY29uc3QgdXBkYXRlZFRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKFxuICAgICAgKHRhZykgPT4gIXRhZ3NUb1JlbW92ZS5pbmNsdWRlcyh0YWcpXG4gICAgKTtcblxuICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIHRhZ3M6ICR7dXBkYXRlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgLy8gVXNlIHVwZGF0ZVRhZ3NJbkNvbnRlbnQgdG8gdXBkYXRlIHRoZSBmaWxlJ3MgY29udGVudFxuICAgIGxldCB1cGRhdGVkQ29udGVudDogc3RyaW5nO1xuICAgIGlmICh1cGRhdGVkVGFncy5sZW5ndGggPiAwKSB7XG4gICAgICB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudChjb250ZW50LCB1cGRhdGVkVGFncyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIG5vIHRhZ3MgcmVtYWluLCByZW1vdmUgdGhlIGVudGlyZSBZQU1MIGZyb250IG1hdHRlclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnJlbW92ZVlhbWxGcm9udE1hdHRlcihjb250ZW50KTtcbiAgICB9XG5cbiAgICAvLyBPbmx5IG1vZGlmeSB0aGUgZmlsZSBpZiB0aGUgY29udGVudCBoYXMgY2hhbmdlZFxuICAgIGlmIChjb250ZW50ICE9PSB1cGRhdGVkQ29udGVudCkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIGNvbnRlbnQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgICBuZXcgTm90aWNlKGBSZW1vdmVkIGZvbGRlciB0YWdzIGZyb20gZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKGBObyBjaGFuZ2VzIG5lZWRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlWWFtbEZyb250TWF0dGVyKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuW1xcc1xcU10qP1xcbi0tLVxcbi87XG4gICAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZShmcm9udG1hdHRlclJlZ2V4LCBcIlwiKTtcbiAgfVxuXG4gIGRldGVjdENvbmZsaWN0aW5nVGFncyhmaWxlOiBURmlsZSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwYXJlbnRGb2xkZXJzID0gdGhpcy5nZXRQYXJlbnRGb2xkZXJzKGZpbGUpO1xuICAgIGNvbnN0IGFsbFRhZ3MgPSBwYXJlbnRGb2xkZXJzLmZsYXRNYXAoKGZvbGRlcikgPT5cbiAgICAgIHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aClcbiAgICApO1xuICAgIHJldHVybiBhbGxUYWdzLmZpbHRlcigodGFnLCBpbmRleCwgc2VsZikgPT4gc2VsZi5pbmRleE9mKHRhZykgIT09IGluZGV4KTtcbiAgfVxuXG4gIGdldFBhcmVudEZvbGRlcnMoZmlsZTogVEZpbGUpOiBURm9sZGVyW10ge1xuICAgIGNvbnN0IGZvbGRlcnM6IFRGb2xkZXJbXSA9IFtdO1xuICAgIGxldCBjdXJyZW50Rm9sZGVyID0gZmlsZS5wYXJlbnQ7XG4gICAgd2hpbGUgKGN1cnJlbnRGb2xkZXIpIHtcbiAgICAgIGZvbGRlcnMucHVzaChjdXJyZW50Rm9sZGVyKTtcbiAgICAgIGN1cnJlbnRGb2xkZXIgPSBjdXJyZW50Rm9sZGVyLnBhcmVudDtcbiAgICB9XG4gICAgcmV0dXJuIGZvbGRlcnM7XG4gIH1cblxuICBwcml2YXRlIHJlbW92ZUR1cGxpY2F0ZVRhZ3ModGFnczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRhZ3MpXTtcbiAgfVxuXG4gIHJlbW92ZUZvbGRlckljb25zKCkge1xuICAgIC8vIEN1cnJlbnQgaW1wbGVtZW50YXRpb24gbWlnaHQgbWlzcyBzb21lIGVsZW1lbnRzXG4gICAgLy8gQWRkIG1vcmUgcm9idXN0IGVsZW1lbnQgc2VsZWN0aW9uIGFuZCBjbGVhbnVwXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtZXhwbG9yZXJcIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgY29uc3QgZmlsZUV4cGxvcmVyVmlldyA9IGxlYWYudmlldyBhcyBhbnk7XG4gICAgICBjb25zdCBmaWxlSXRlbXMgPSBmaWxlRXhwbG9yZXJWaWV3LmZpbGVJdGVtcztcbiAgICAgIGZvciAoY29uc3QgWywgaXRlbV0gb2YgT2JqZWN0LmVudHJpZXMoZmlsZUl0ZW1zKSkge1xuICAgICAgICBpZiAoaXRlbSAmJiB0eXBlb2YgaXRlbSA9PT0gXCJvYmplY3RcIiAmJiBcImVsXCIgaW4gaXRlbSkge1xuICAgICAgICAgIGNvbnN0IGZvbGRlckVsID0gaXRlbS5lbCBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICBjb25zdCBpY29uRWwgPSBmb2xkZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiKTtcbiAgICAgICAgICBpZiAoaWNvbkVsKSB7XG4gICAgICAgICAgICBpY29uRWwucmVtb3ZlQ2xhc3MoXCJ0YWdnZWQtZm9sZGVyXCIpO1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIik7XG4gICAgICAgICAgICAvLyBBbHNvIHJlbW92ZSBhbnkgb3RoZXIgY3VzdG9tIGNsYXNzZXMgb3IgYXR0cmlidXRlc1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUF0dHJpYnV0ZShcImRhdGEtdGFnaXRcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBoYW5kbGVGaWxlTW92ZW1lbnQoZmlsZTogVEZpbGUpIHtcbiAgICAvLyBBZGQgZGVib3VuY2luZyB0byBwcmV2ZW50IG11bHRpcGxlIHJhcGlkIGZpbGUgbW92ZW1lbnRzIGZyb20gY2F1c2luZyBpc3N1ZXNcbiAgICBpZiAodGhpcy5tb3ZlVGltZW91dCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMubW92ZVRpbWVvdXQpO1xuICAgIH1cbiAgICB0aGlzLm1vdmVUaW1lb3V0ID0gc2V0VGltZW91dChhc3luYyAoKSA9PiB7XG4gICAgICAvLyBFeGlzdGluZyBmaWxlIG1vdmVtZW50IGxvZ2ljXG4gICAgfSwgMzAwKTtcbiAgfVxuXG4gIGFzeW5jIG1pZ3JhdGVTZXR0aW5ncyhvbGREYXRhOiBhbnkpOiBQcm9taXNlPFRhZ0l0U2V0dGluZ3M+IHtcbiAgICBjb25zb2xlLmxvZyhcIk1pZ3JhdGluZyBzZXR0aW5ncyBmcm9tIG9sZCB2ZXJzaW9uXCIpO1xuICAgIC8vIEZvciBub3csIGp1c3QgcmV0dXJuIHRoZSBkZWZhdWx0IHNldHRpbmdzIG1lcmdlZCB3aXRoIGFueSB2YWxpZCBvbGQgc2V0dGluZ3NcbiAgICByZXR1cm4ge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIC4uLntcbiAgICAgICAgaW5oZXJpdGFuY2VNb2RlOlxuICAgICAgICAgIG9sZERhdGEuaW5oZXJpdGFuY2VNb2RlIHx8IERFRkFVTFRfU0VUVElOR1MuaW5oZXJpdGFuY2VNb2RlLFxuICAgICAgICBleGNsdWRlZEZvbGRlcnM6XG4gICAgICAgICAgb2xkRGF0YS5leGNsdWRlZEZvbGRlcnMgfHwgREVGQVVMVF9TRVRUSU5HUy5leGNsdWRlZEZvbGRlcnMsXG4gICAgICAgIHNob3dGb2xkZXJJY29uczpcbiAgICAgICAgICBvbGREYXRhLnNob3dGb2xkZXJJY29ucyB8fCBERUZBVUxUX1NFVFRJTkdTLnNob3dGb2xkZXJJY29ucyxcbiAgICAgICAgYXV0b0FwcGx5VGFnczogb2xkRGF0YS5hdXRvQXBwbHlUYWdzIHx8IERFRkFVTFRfU0VUVElOR1MuYXV0b0FwcGx5VGFncyxcbiAgICAgICAgZGVidWdNb2RlOiBvbGREYXRhLmRlYnVnTW9kZSB8fCBERUZBVUxUX1NFVFRJTkdTLmRlYnVnTW9kZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGNoZWNrQW5kUmVtb3ZlRHVwbGljYXRlVGFncyhmb2xkZXI6IFRGb2xkZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmaWxlcyA9IGZvbGRlci5jaGlsZHJlbi5maWx0ZXIoXG4gICAgICAoY2hpbGQpOiBjaGlsZCBpcyBURmlsZSA9PiBjaGlsZCBpbnN0YW5jZW9mIFRGaWxlXG4gICAgKTtcbiAgICBsZXQgcHJvY2Vzc2VkQ291bnQgPSAwO1xuICAgIGxldCBkdXBsaWNhdGVzRm91bmQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ2hlY2tpbmcgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuXG4gICAgICAgIC8vIEV4dHJhY3QgWUFNTCBmcm9udCBtYXR0ZXJcbiAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG5cbiAgICAgICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgICAgICBjb25zdCBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgICAgICAgLy8gQ2hlY2sgZm9yIGR1cGxpY2F0ZXMgYnkgY29tcGFyaW5nIGxlbmd0aHNcbiAgICAgICAgICBjb25zdCB1bmlxdWVUYWdzID0gWy4uLm5ldyBTZXQoZXhpc3RpbmdUYWdzKV07XG5cbiAgICAgICAgICBpZiAodW5pcXVlVGFncy5sZW5ndGggPCBleGlzdGluZ1RhZ3MubGVuZ3RoKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgZHVwbGljYXRlcyBpbiBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBPcmlnaW5hbCB0YWdzOiAke2V4aXN0aW5nVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVW5pcXVlIHRhZ3M6ICR7dW5pcXVlVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSBuZXcgWUFNTCBmcm9udCBtYXR0ZXIgd2l0aCB1bmlxdWUgdGFnc1xuICAgICAgICAgICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoXG4gICAgICAgICAgICAgIGNvbnRlbnQsXG4gICAgICAgICAgICAgIHVuaXF1ZVRhZ3NcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgICAgICAgZHVwbGljYXRlc0ZvdW5kKys7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgUmVtb3ZlZCBkdXBsaWNhdGUgdGFncyBmcm9tIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBwcm9jZXNzZWRDb3VudCsrO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBmaWxlICR7ZmlsZS5uYW1lfTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGR1cGxpY2F0ZXNGb3VuZCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGBSZW1vdmVkIGR1cGxpY2F0ZXMgZnJvbSAke2R1cGxpY2F0ZXNGb3VuZH0gb3V0IG9mICR7cHJvY2Vzc2VkQ291bnR9IGZpbGVzLmBcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBOb3RpY2UoYE5vIGR1cGxpY2F0ZXMgZm91bmQgaW4gJHtwcm9jZXNzZWRDb3VudH0gZmlsZXMuYCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYmF0Y2hDb252ZXJ0SW5saW5lVGFnc1RvWUFNTChmaWxlczogVEZpbGVbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBwcm9jZXNzZWRDb3VudCA9IDA7XG4gICAgbGV0IHN1Y2Nlc3NDb3VudCA9IDA7XG4gICAgbGV0IGVycm9yQ291bnQgPSAwO1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKGZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCkgIT09IFwibWRcIikge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuXG4gICAgICAgIC8vIFNraXAgWUFNTCBmcm9udCBtYXR0ZXIgaWYgaXQgZXhpc3RzXG4gICAgICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbltcXHNcXFNdKj9cXG4tLS1cXG4vO1xuICAgICAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcbiAgICAgICAgY29uc3QgY29udGVudFdpdGhvdXRZYW1sID0gZnJvbnRtYXR0ZXJNYXRjaFxuICAgICAgICAgID8gY29udGVudC5zbGljZShmcm9udG1hdHRlck1hdGNoWzBdLmxlbmd0aClcbiAgICAgICAgICA6IGNvbnRlbnQ7XG5cbiAgICAgICAgLy8gR2V0IGZpcnN0IHRocmVlIGxpbmVzIGFmdGVyIFlBTUxcbiAgICAgICAgY29uc3QgZmlyc3RUaHJlZUxpbmVzID0gY29udGVudFdpdGhvdXRZYW1sLnNwbGl0KFwiXFxuXCIsIDMpLmpvaW4oXCJcXG5cIik7XG4gICAgICAgIGNvbnN0IGlubGluZVRhZ3MgPSBmaXJzdFRocmVlTGluZXMubWF0Y2goLyNbXlxccyNdKy9nKTtcblxuICAgICAgICBpZiAoIWlubGluZVRhZ3MpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgICAgIGBObyBpbmxpbmUgdGFncyBmb3VuZCBpbiBmaXJzdCB0aHJlZSBsaW5lcyBvZjogJHtmaWxlLm5hbWV9YFxuICAgICAgICAgICk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBuZXdUYWdzID0gaW5saW5lVGFncy5tYXAoKHRhZykgPT4gdGFnLnN1YnN0cmluZygxKSk7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcbiAgICAgICAgY29uc3QgYWxsVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5leGlzdGluZ1RhZ3MsIC4uLm5ld1RhZ3NdKV07XG5cbiAgICAgICAgLy8gUmVtb3ZlIGlubGluZSB0YWdzIGZyb20gZmlyc3QgdGhyZWUgbGluZXMgd2hpbGUgcHJlc2VydmluZyBZQU1MXG4gICAgICAgIGxldCB1cGRhdGVkQ29udGVudCA9IGNvbnRlbnQ7XG4gICAgICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICAgICAgY29uc3QgY29udGVudExpbmVzID0gY29udGVudFdpdGhvdXRZYW1sLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgTWF0aC5taW4oMywgY29udGVudExpbmVzLmxlbmd0aCk7IGkrKykge1xuICAgICAgICAgICAgY29udGVudExpbmVzW2ldID0gY29udGVudExpbmVzW2ldLnJlcGxhY2UoLyNbXlxccyNdKy9nLCBcIlwiKS50cmltKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID1cbiAgICAgICAgICAgIGZyb250bWF0dGVyTWF0Y2hbMF0gKyB0aGlzLmNsZWFuRW1wdHlMaW5lcyhjb250ZW50TGluZXMuam9pbihcIlxcblwiKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgY29udGVudExpbmVzID0gY29udGVudC5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE1hdGgubWluKDMsIGNvbnRlbnRMaW5lcy5sZW5ndGgpOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnRlbnRMaW5lc1tpXSA9IGNvbnRlbnRMaW5lc1tpXS5yZXBsYWNlKC8jW15cXHMjXSsvZywgXCJcIikudHJpbSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB1cGRhdGVkQ29udGVudCA9IHRoaXMuY2xlYW5FbXB0eUxpbmVzKGNvbnRlbnRMaW5lcy5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCB0YWdzIHRvIFlBTUwgZnJvbnQgbWF0dGVyXG4gICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVUYWdzSW5Db250ZW50KHVwZGF0ZWRDb250ZW50LCBhbGxUYWdzKTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcblxuICAgICAgICBzdWNjZXNzQ291bnQrKztcbiAgICAgICAgY29uc29sZS5sb2coYFN1Y2Nlc3NmdWxseSBjb252ZXJ0ZWQgdGFncyBpbjogJHtmaWxlLm5hbWV9YCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIGZpbGUgJHtmaWxlLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgICAgZXJyb3JDb3VudCsrO1xuICAgICAgICBlcnJvcnMucHVzaChmaWxlLm5hbWUpO1xuICAgICAgfVxuICAgICAgcHJvY2Vzc2VkQ291bnQrKztcbiAgICB9XG5cbiAgICAvLyBTaG93IHN1bW1hcnkgcG9wdXBcbiAgICBuZXcgQmF0Y2hDb252ZXJzaW9uUmVzdWx0TW9kYWwoXG4gICAgICB0aGlzLmFwcCxcbiAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgc3VjY2Vzc0NvdW50LFxuICAgICAgZXJyb3JDb3VudCxcbiAgICAgIGVycm9yc1xuICAgICkub3BlbigpO1xuICB9XG5cbiAgYXN5bmMgYmF0Y2hDb252ZXJ0V2l0aENvbmZpcm1hdGlvbihmaWxlczogVEZpbGVbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnNldHRpbmdzLnNob3dCYXRjaENvbnZlcnNpb25XYXJuaW5nKSB7XG4gICAgICBuZXcgQmF0Y2hDb252ZXJzaW9uV2FybmluZ01vZGFsKHRoaXMuYXBwLCBmaWxlcywgdGhpcykub3BlbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLmJhdGNoQ29udmVydElubGluZVRhZ3NUb1lBTUwoZmlsZXMpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY2xlYW5FbXB0eUxpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGNvbnRlbnRcbiAgICAgIC5zcGxpdChcIlxcblwiKVxuICAgICAgLmZpbHRlcigobGluZSwgaW5kZXgsIGFycmF5KSA9PiB7XG4gICAgICAgIC8vIEtlZXAgbm9uLWVtcHR5IGxpbmVzXG4gICAgICAgIGlmIChsaW5lLnRyaW0oKSkgcmV0dXJuIHRydWU7XG4gICAgICAgIC8vIEtlZXAgc2luZ2xlIGVtcHR5IGxpbmVzIGJldHdlZW4gY29udGVudFxuICAgICAgICBpZiAoaW5kZXggPiAwICYmIGluZGV4IDwgYXJyYXkubGVuZ3RoIC0gMSkge1xuICAgICAgICAgIGNvbnN0IHByZXZMaW5lID0gYXJyYXlbaW5kZXggLSAxXS50cmltKCk7XG4gICAgICAgICAgY29uc3QgbmV4dExpbmUgPSBhcnJheVtpbmRleCArIDFdLnRyaW0oKTtcbiAgICAgICAgICByZXR1cm4gcHJldkxpbmUgJiYgbmV4dExpbmU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSlcbiAgICAgIC5qb2luKFwiXFxuXCIpO1xuICB9XG59XG5cbmNsYXNzIEZvbGRlclRhZ01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBmb2xkZXI6IFRGb2xkZXI7XG4gIHBsdWdpbjogVGFnSXRQbHVnaW47XG4gIGZvbGRlck5hbWVJbnB1dDogVGV4dENvbXBvbmVudDtcbiAgdGFnc0lucHV0OiBUZXh0Q29tcG9uZW50O1xuICB0YWdzOiBzdHJpbmcgPSBcIlwiO1xuICBpc05ld0ZvbGRlcjogYm9vbGVhbjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBmb2xkZXI6IFRGb2xkZXIsXG4gICAgcGx1Z2luOiBUYWdJdFBsdWdpbixcbiAgICBpc05ld0ZvbGRlcjogYm9vbGVhbiA9IGZhbHNlXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5mb2xkZXIgPSBmb2xkZXI7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5pc05ld0ZvbGRlciA9IGlzTmV3Rm9sZGVyO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIkFkZC9FZGl0IEZvbGRlciBUYWdzXCIgfSk7XG5cbiAgICAvLyBGb2xkZXIgbmFtZSBmaWVsZFxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuc2V0TmFtZShcIkZvbGRlciBOYW1lXCIpLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgIHRoaXMuZm9sZGVyTmFtZUlucHV0ID0gdGV4dDtcbiAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5mb2xkZXIubmFtZSk7XG4gICAgICB0ZXh0LmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgdGhpcy5oYW5kbGVFbnRlci5iaW5kKHRoaXMpKTtcbiAgICAgIHJldHVybiB0ZXh0O1xuICAgIH0pO1xuXG4gICAgLy8gVGFncyBmaWVsZFxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuc2V0TmFtZShcIlRhZ3NcIikuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgdGhpcy50YWdzSW5wdXQgPSB0ZXh0O1xuICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5wbHVnaW4uZ2V0Rm9sZGVyVGFncyh0aGlzLmZvbGRlci5wYXRoKTtcbiAgICAgIHRoaXMudGFncyA9IGV4aXN0aW5nVGFncy5qb2luKFwiLCBcIik7XG4gICAgICB0ZXh0LnNldFZhbHVlKHRoaXMudGFncyk7XG4gICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiRW50ZXIgdGFncywgY29tbWEtc2VwYXJhdGVkXCIpLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICB0aGlzLnRhZ3MgPSB2YWx1ZTtcbiAgICAgIH0pO1xuICAgICAgdGV4dC5pbnB1dEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIHRoaXMuaGFuZGxlRW50ZXIuYmluZCh0aGlzKSk7XG4gICAgICByZXR1cm4gdGV4dDtcbiAgICB9KTtcblxuICAgIC8vIENhbmNlbCBhbmQgU2F2ZSBidXR0b25zIChvcmRlciBzd2FwcGVkKVxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlNhdmVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNhdmVGb2xkZXJUYWdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cblxuICBoYW5kbGVFbnRlcihldmVudDogS2V5Ym9hcmRFdmVudCkge1xuICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZXZlbnQuc2hpZnRLZXkpIHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICB0aGlzLnNhdmVGb2xkZXJUYWdzKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2F2ZUZvbGRlclRhZ3MoKSB7XG4gICAgY29uc3QgbmV3Rm9sZGVyTmFtZSA9IHRoaXMuZm9sZGVyTmFtZUlucHV0LmdldFZhbHVlKCk7XG4gICAgbGV0IGZvbGRlclBhdGggPSB0aGlzLmZvbGRlci5wYXRoO1xuXG4gICAgaWYgKG5ld0ZvbGRlck5hbWUgIT09IHRoaXMuZm9sZGVyLm5hbWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG5ld1BhdGggPSB0aGlzLmZvbGRlci5wYXJlbnRcbiAgICAgICAgICA/IGAke3RoaXMuZm9sZGVyLnBhcmVudC5wYXRofS8ke25ld0ZvbGRlck5hbWV9YFxuICAgICAgICAgIDogbmV3Rm9sZGVyTmFtZTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucmVuYW1lRmlsZSh0aGlzLmZvbGRlciwgbmV3UGF0aCk7XG4gICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgIGBSZW5hbWVkIGZvbGRlciBmcm9tICR7dGhpcy5mb2xkZXIubmFtZX0gdG8gJHtuZXdGb2xkZXJOYW1lfWBcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBXYWl0IGZvciBhIHNob3J0IHRpbWUgdG8gYWxsb3cgdGhlIGZpbGUgc3lzdGVtIHRvIHVwZGF0ZVxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTtcblxuICAgICAgICAvLyBVcGRhdGUgZm9sZGVyIHJlZmVyZW5jZSBhbmQgcGF0aFxuICAgICAgICBjb25zdCBuZXdGb2xkZXIgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobmV3UGF0aCk7XG4gICAgICAgIGlmIChuZXdGb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICAgICAgdGhpcy5mb2xkZXIgPSBuZXdGb2xkZXI7XG4gICAgICAgICAgZm9sZGVyUGF0aCA9IG5ld1BhdGg7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgICAgYENvdWxkIG5vdCBnZXQgbmV3IGZvbGRlciBvYmplY3QsIHVzaW5nIG5ldyBwYXRoOiAke25ld1BhdGh9YFxuICAgICAgICAgICk7XG4gICAgICAgICAgZm9sZGVyUGF0aCA9IG5ld1BhdGg7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byByZW5hbWUgZm9sZGVyOiAke2Vycm9yfWApO1xuICAgICAgICBuZXcgTm90aWNlKGBGYWlsZWQgdG8gcmVuYW1lIGZvbGRlcjogJHtlcnJvcn1gKTtcbiAgICAgICAgLy8gQ29udGludWUgd2l0aCB0aGUgb3JpZ2luYWwgZm9sZGVyIG5hbWUgYW5kIHBhdGhcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBFbnN1cmUgZm9sZGVyUGF0aCBkb2Vzbid0IHN0YXJ0IHdpdGggJy8vJ1xuICAgIGZvbGRlclBhdGggPSBmb2xkZXJQYXRoLnJlcGxhY2UoL15cXC8rLywgXCJcIik7XG5cbiAgICBjb25zdCB0YWdBcnJheSA9IHRoaXMudGFnc1xuICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgLm1hcCgodGFnKSA9PiB0YWcudHJpbSgpKVxuICAgICAgLmZpbHRlcigodGFnKSA9PiB0YWcgIT09IFwiXCIpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIG51bWJlci1vbmx5IHRhZ3NcbiAgICBjb25zdCBudW1iZXJPbmx5VGFncyA9IHRhZ0FycmF5LmZpbHRlcigodGFnKSA9PiAvXlxcZCskLy50ZXN0KHRhZykpO1xuICAgIGlmIChudW1iZXJPbmx5VGFncy5sZW5ndGggPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBgRXJyb3I6IE51bWJlci1vbmx5IHRhZ3MgYXJlIG5vdCBhbGxvd2VkLiBQbGVhc2UgcmVtb3ZlOiAke251bWJlck9ubHlUYWdzLmpvaW4oXG4gICAgICAgICAgXCIsIFwiXG4gICAgICAgICl9YFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnBsdWdpbi5zZXRGb2xkZXJUYWdzKGZvbGRlclBhdGgsIHRhZ0FycmF5KTtcbiAgICBjb25zb2xlLmxvZyhgU2F2ZWQgdGFncyBmb3IgZm9sZGVyICR7Zm9sZGVyUGF0aH06ICR7dGFnQXJyYXkuam9pbihcIiwgXCIpfWApO1xuICAgIG5ldyBOb3RpY2UoYFRhZ3Mgc2F2ZWQgZm9yIGZvbGRlcjogJHtmb2xkZXJQYXRofWApO1xuXG4gICAgaWYgKHRoaXMuaXNOZXdGb2xkZXIpIHtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5Rm9sZGVyVGFnc1RvQ29udGVudHModGhpcy5mb2xkZXIpO1xuICAgICAgY29uc29sZS5sb2coYEFwcGxpZWQgdGFncyB0byBjb250ZW50cyBvZiBuZXcgZm9sZGVyOiAke2ZvbGRlclBhdGh9YCk7XG4gICAgfVxuXG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBUYWdJdFNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBUYWdJdFBsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBUYWdJdFBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgLy8gQWRkIGxvZ28gY29udGFpbmVyIHdpdGggc3BlY2lmaWMgc3R5bGluZ1xuICAgIGNvbnN0IGxvZ29Db250YWluZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoXCJ0YWdpdC1sb2dvLWNvbnRhaW5lclwiKTtcbiAgICBsb2dvQ29udGFpbmVyLmlubmVySFRNTCA9IGBcbiAgICAgIDxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOiBjZW50ZXI7IG1hcmdpbi1ib3R0b206IDJlbTtcIj5cbiAgICAgICAgPHN2ZyB3aWR0aD1cIjUyXCIgaGVpZ2h0PVwiMjFcIiB2aWV3Qm94PVwiMCAwIDUyIDIxXCIgZmlsbD1cIm5vbmVcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCI+IFxuICAgICAgICAgIDxwYXRoIGZpbGwtcnVsZT1cImV2ZW5vZGRcIiBjbGlwLXJ1bGU9XCJldmVub2RkXCIgZD1cIk0xLjA0NzYzIDQuMTUwOEMwLjM4MjY4OCA0LjcyMDc1IDAgNS41NTI4IDAgNi40Mjg1N1YxNy4wNDg4QzAgMTguNzA1NiAxLjM0MzE1IDIwLjA0ODggMyAyMC4wNDg4SDExQzEyLjY1NjkgMjAuMDQ4OCAxNCAxOC43MDU2IDE0IDE3LjA0ODhWNi40Mjg1N0MxNCA1LjU1MjggMTMuNjE3MyA0LjcyMDc1IDEyLjk1MjQgNC4xNTA4TDguOTUyMzcgMC43MjIyM0M3LjgyODkxIC0wLjI0MDc0MyA2LjE3MTEgLTAuMjQwNzQ0IDUuMDQ3NjMgMC43MjIyM0wxLjA0NzYzIDQuMTUwOFpNNy4xMDMxOCAxMy42MDkyTDYuNjc1NjggMTYuMDQ4OEg4LjY0NzA2TDkuMDc4MDEgMTMuNjA5MkgxMC41NTQ4VjExLjk2NTlIOS4zNjgyOUw5LjU0OTE1IDEwLjk0MkgxMVY5LjMxMTQxSDkuODM3MkwxMC4yMzY5IDcuMDQ4NzdIOC4yNTI3OEw3Ljg1NjI5IDkuMzExNDFINi44NDJMNy4yMzUyOSA3LjA0ODc3SDUuMjc2NjNMNC44NzY5NCA5LjMxMTQxSDMuNDU3ODdWMTAuOTQySDQuNTg4OUw0LjQwODAzIDExLjk2NTlIM1YxMy42MDkySDQuMTE3NzVMMy42ODY4IDE2LjA0ODhINS42NzA5MUw2LjA5NDk2IDEzLjYwOTJINy4xMDMxOFpNNy4zOTExMyAxMS45NjU5TDcuNTcwNTUgMTAuOTQySDYuNTU4NTZMNi4zODA1OSAxMS45NjU5SDcuMzkxMTNaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTM1LjY5ODMgMTUuNDQyNEMzNS4xMTQzIDE1LjQ0MjQgMzQuNTk0MyAxNS4zMzQ0IDM0LjEzODMgMTUuMTE4NEMzMy42OTAzIDE0LjkwMjQgMzMuMzMwMyAxNC41OTg0IDMzLjA1ODMgMTQuMjA2NEwzMy43NTQzIDEzLjQ5ODRDMzMuOTg2MyAxMy43OTQ0IDM0LjI2MjMgMTQuMDE4NCAzNC41ODIzIDE0LjE3MDRDMzQuOTAyMyAxNC4zMzA0IDM1LjI4MjMgMTQuNDEwNCAzNS43MjIzIDE0LjQxMDRDMzYuMzA2MyAxNC40MTA0IDM2Ljc2NjMgMTQuMjU0NCAzNy4xMDIzIDEzLjk0MjRDMzcuNDQ2MyAxMy42Mzg0IDM3LjYxODMgMTMuMjI2NCAzNy42MTgzIDEyLjcwNjRWMTEuMjkwNEwzNy44MTAzIDEwLjAwNjRMMzcuNjE4MyA4LjczNDM4VjcuMjM0MzhIMzguNjk4M1YxMi43MDY0QzM4LjY5ODMgMTMuMjUwNCAzOC41NzAzIDEzLjcyNjQgMzguMzE0MyAxNC4xMzQ0QzM4LjA2NjMgMTQuNTQyNCAzNy43MTQzIDE0Ljg2MjQgMzcuMjU4MyAxNS4wOTQ0QzM2LjgxMDMgMTUuMzI2NCAzNi4yOTAzIDE1LjQ0MjQgMzUuNjk4MyAxNS40NDI0Wk0zNS42OTgzIDEyLjgzODRDMzUuMTc4MyAxMi44Mzg0IDM0LjcxMDMgMTIuNzE0NCAzNC4yOTQzIDEyLjQ2NjRDMzMuODg2MyAxMi4yMTg0IDMzLjU2MjMgMTEuODc4NCAzMy4zMjIzIDExLjQ0NjRDMzMuMDgyMyAxMS4wMDY0IDMyLjk2MjMgMTAuNTE0NCAzMi45NjIzIDkuOTcwMzhDMzIuOTYyMyA5LjQyNjM4IDMzLjA4MjMgOC45NDIzOCAzMy4zMjIzIDguNTE4MzhDMzMuNTYyMyA4LjA4NjM4IDMzLjg4NjMgNy43NDYzOCAzNC4yOTQzIDcuNDk4MzhDMzQuNzEwMyA3LjI0MjM4IDM1LjE3ODMgNy4xMTQzOCAzNS42OTgzIDcuMTE0MzhDMzYuMTQ2MyA3LjExNDM4IDM2LjU0MjMgNy4yMDIzOCAzNi44ODYzIDcuMzc4MzhDMzcuMjMwMyA3LjU1NDM4IDM3LjUwMjMgNy44MDIzOCAzNy43MDIzIDguMTIyMzhDMzcuOTEwMyA4LjQzNDM4IDM4LjAyMjMgOC44MDIzOCAzOC4wMzgzIDkuMjI2MzhWMTAuNzM4NEMzOC4wMTQzIDExLjE1NDQgMzcuODk4MyAxMS41MjI0IDM3LjY5MDMgMTEuODQyNEMzNy40OTAzIDEyLjE1NDQgMzcuMjE4MyAxMi4zOTg0IDM2Ljg3NDMgMTIuNTc0NEMzNi41MzAzIDEyLjc1MDQgMzYuMTM4MyAxMi44Mzg0IDM1LjY5ODMgMTIuODM4NFpNMzUuOTE0MyAxMS44MTg0QzM2LjI2NjMgMTEuODE4NCAzNi41NzQzIDExLjc0MjQgMzYuODM4MyAxMS41OTA0QzM3LjExMDMgMTEuNDM4NCAzNy4zMTgzIDExLjIyNjQgMzcuNDYyMyAxMC45NTQ0QzM3LjYwNjMgMTAuNjc0NCAzNy42NzgzIDEwLjM1MDQgMzcuNjc4MyA5Ljk4MjM4QzM3LjY3ODMgOS42MTQzOCAzNy42MDIzIDkuMjk0MzggMzcuNDUwMyA5LjAyMjM4QzM3LjMwNjMgOC43NDIzOCAzNy4xMDIzIDguNTI2MzggMzYuODM4MyA4LjM3NDM4QzM2LjU3NDMgOC4yMTQzOCAzNi4yNjIzIDguMTM0MzggMzUuOTAyMyA4LjEzNDM4QzM1LjU0MjMgOC4xMzQzOCAzNS4yMjYzIDguMjE0MzggMzQuOTU0MyA4LjM3NDM4QzM0LjY4MjMgOC41MjYzOCAzNC40NjYzIDguNzQyMzggMzQuMzA2MyA5LjAyMjM4QzM0LjE1NDMgOS4yOTQzOCAzNC4wNzgzIDkuNjEwMzggMzQuMDc4MyA5Ljk3MDM4QzM0LjA3ODMgMTAuMzMwNCAzNC4xNTQzIDEwLjY1MDQgMzQuMzA2MyAxMC45MzA0QzM0LjQ2NjMgMTEuMjEwNCAzNC42ODIzIDExLjQzMDQgMzQuOTU0MyAxMS41OTA0QzM1LjIzNDMgMTEuNzQyNCAzNS41NTQzIDExLjgxODQgMzUuOTE0MyAxMS44MTg0WlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk0yOC43NzQgMTMuMDU0NEMyOC4yNTQgMTMuMDU0NCAyNy43ODIgMTIuOTI2NCAyNy4zNTggMTIuNjcwNEMyNi45MzQgMTIuNDA2NCAyNi41OTggMTIuMDUwNCAyNi4zNSAxMS42MDI0QzI2LjExIDExLjE1NDQgMjUuOTkgMTAuNjUwNCAyNS45OSAxMC4wOTA0QzI1Ljk5IDkuNTMwMzggMjYuMTEgOS4wMjYzOCAyNi4zNSA4LjU3ODM4QzI2LjU5OCA4LjEzMDM4IDI2LjkzIDcuNzc0MzggMjcuMzQ2IDcuNTEwMzhDMjcuNzcgNy4yNDYzOCAyOC4yNDYgNy4xMTQzOCAyOC43NzQgNy4xMTQzOEMyOS4yMDYgNy4xMTQzOCAyOS41OSA3LjIwNjM4IDI5LjkyNiA3LjM5MDM4QzMwLjI3IDcuNTY2MzggMzAuNTQ2IDcuODE0MzggMzAuNzU0IDguMTM0MzhDMzAuOTYyIDguNDQ2MzggMzEuMDc4IDguODEwMzggMzEuMTAyIDkuMjI2MzhWMTAuOTQyNEMzMS4wNzggMTEuMzUwNCAzMC45NjIgMTEuNzE0NCAzMC43NTQgMTIuMDM0NEMzMC41NTQgMTIuMzU0NCAzMC4yODIgMTIuNjA2NCAyOS45MzggMTIuNzkwNEMzOS42MDIgMTIuOTY2NCAyOS4yMTQgMTMuMDU0NCAyOC43NzQgMTMuMDU0NFpNMjguOTU0IDEyLjAzNDRDMjkuNDkgMTIuMDM0NCAyOS45MjIgMTEuODU0NCAzMC4yNSAxMS40OTQ0QzMwLjU3OCAxMS4xMjY0IDMwLjc0MiAxMC42NTg0IDMwLjc0MiAxMC4wOTA0QzMwLjc0MiA5LjY5ODM4IDMwLjY2NiA5LjM1ODM4IDMwLjUxNCA5LjA3MDM4QzMwLjM3IDguNzc0MzggMzAuMTYyIDguNTQ2MzggMjkuODkgOC4zODYzOEMyOS42MTggOC4yMTgzOCAyOS4zMDIgOC4xMzQzOCAyOC45NDIgOC4xMzQzOEMyOC41ODIgOC4xMzQzOCAyOC4yNjIgOC4yMTgzOCAyNy45ODIgOC4zODYzOEMyNy43MSA4LjU1NDM4IDI3LjQ5NCA4Ljc4NjM4IDI3LjMzNCA5LjA4MjM4QzI3LjE4MiA5LjM3MDM4IDI3LjEwNiA5LjcwMjM4IDI3LjEwNiAxMC4wNzg0QzI3LjEwNiAxMC40NjI0IDI3LjE4MiAxMC44MDI0IDI3LjMzNCAxMS4wOTg0QzI3LjQ5NCAxMS4zODY0IDI3LjcxNCAxMS42MTQ0IDI3Ljk5NCAxMS43ODI0QzI4LjI3NCAxMS45NTA0IDI4LjU5NCAxMi4wMzQ0IDI4Ljk1NCAxMi4wMzQ0Wk0zMC42NyAxMi45MzQ0VjExLjM5ODRMMzAuODc0IDEwLjAwNjRMMzAuNjcgOC42MjYzOFY3LjIzNDM4SDMxLjc2MlYxMi45MzQ0SDMwLjY3WlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk0yMi44MzIgMTIuOTM0NFY0Ljg0NjM4SDIzLjk2VjEyLjkzNDRIMjIuODMyWk0yMCA1LjYzODM4VjQuNjA2MzhIMjYuNzhWNS42MzgzOEgyMFpcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNDAuNjk4MyAxMi45OTY0VjQuNDUyMzlINDMuMDk4M1YxMi45OTY0SDQwLjY5ODNaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQ2LjY1NDMgMTIuOTk2NFY0LjQ1MjM5SDQ5LjA1NDNWMTIuOTk2NEg0Ni42NTQzWk00NC4wOTgzIDYuNDkyMzlWNC40NTIzOUg1MS42MjIzVjYuNDkyMzlINDQuMDk4M1pcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvZGl2PlxuICAgIGA7XG5cbiAgICAvLyBSZXN0IG9mIHlvdXIgc2V0dGluZ3MgY29kZS4uLlxuXG4gICAgLy8gUmVzdCBvZiB5b3VyIHNldHRpbmdzLi4uXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlRhZyBJbmhlcml0YW5jZSBNb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSBob3cgdGFncyBhcmUgaW5oZXJpdGVkIGluIG5lc3RlZCBmb2xkZXJzXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJub25lXCIsIFwiTm8gaW5oZXJpdGFuY2VcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiaW1tZWRpYXRlXCIsIFwiSW5oZXJpdCBmcm9tIGltbWVkaWF0ZSBwYXJlbnRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiYWxsXCIsIFwiSW5oZXJpdCBmcm9tIGFsbCBwYXJlbnRzXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmluaGVyaXRhbmNlTW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmhlcml0YW5jZU1vZGUgPSB2YWx1ZSBhc1xuICAgICAgICAgICAgICB8IFwibm9uZVwiXG4gICAgICAgICAgICAgIHwgXCJpbW1lZGlhdGVcIlxuICAgICAgICAgICAgICB8IFwiYWxsXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFeGNsdWRlZCBGb2xkZXJzXCIpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgXCJFbnRlciBmb2xkZXIgcGF0aHMgdG8gZXhjbHVkZSBmcm9tIHRhZyBpbmhlcml0YW5jZSAob25lIHBlciBsaW5lKVwiXG4gICAgICApXG4gICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJmb2xkZXIxXFxuZm9sZGVyMi9zdWJmb2xkZXJcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZXhjbHVkZWRGb2xkZXJzLmpvaW4oXCJcXG5cIikpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZXhjbHVkZWRGb2xkZXJzID0gdmFsdWVcbiAgICAgICAgICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAgICAgICAgIC5maWx0ZXIoKGYpID0+IGYudHJpbSgpICE9PSBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlNob3cgRm9sZGVyIEljb25zXCIpXG4gICAgICAuc2V0RGVzYyhcIkRpc3BsYXkgaWNvbnMgbmV4dCB0byBmb2xkZXJzIHdpdGggdGFnc1wiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGVcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd0ZvbGRlckljb25zKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dGb2xkZXJJY29ucyA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4udXBkYXRlRm9sZGVySWNvbnMoKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlbW92ZUZvbGRlckljb25zKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQXV0by1hcHBseSBUYWdzXCIpXG4gICAgICAuc2V0RGVzYyhcIkF1dG9tYXRpY2FsbHkgYXBwbHkgZm9sZGVyIHRhZ3MgdG8gbmV3IGZpbGVzXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvQXBwbHlUYWdzKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9BcHBseVRhZ3MgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkRlYnVnIE1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiRW5hYmxlIGRldGFpbGVkIGxvZ2dpbmcgZm9yIHRyb3VibGVzaG9vdGluZ1wiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGVcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVidWdNb2RlKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlYnVnTW9kZSA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICAvLyBBZGQgdGhpcyBuZXcgc2V0dGluZyBzZWN0aW9uXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkJhdGNoIENvbnZlcnNpb24gV2FybmluZ1wiKVxuICAgICAgLnNldERlc2MoXCJSZS1lbmFibGUgdGhlIHdhcm5pbmcgd2hlbiBjb252ZXJ0aW5nIGlubGluZSB0YWdzIHRvIFlBTUxcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJSZXNldCBXYXJuaW5nXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dCYXRjaENvbnZlcnNpb25XYXJuaW5nID0gdHJ1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQmF0Y2ggY29udmVyc2lvbiB3YXJuaW5nIGhhcyBiZWVuIHJlLWVuYWJsZWRcIik7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbmNsYXNzIENvbmZpcm1hdGlvbk1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBvbkNvbmZpcm06ICgpID0+IHZvaWQ7XG4gIG1lc3NhZ2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWVzc2FnZTogc3RyaW5nLCBvbkNvbmZpcm06ICgpID0+IHZvaWQpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IHRoaXMubWVzc2FnZSB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNvbmZpcm1cIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICB0aGlzLm9uQ29uZmlybSgpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBUYWdTZWxlY3Rpb25Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgdGFnczogc3RyaW5nW107XG4gIG9uQ29uZmlybTogKHNlbGVjdGVkVGFnczogc3RyaW5nW10pID0+IHZvaWQ7XG4gIG1lc3NhZ2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgdGFnczogc3RyaW5nW10sXG4gICAgb25Db25maXJtOiAoc2VsZWN0ZWRUYWdzOiBzdHJpbmdbXSkgPT4gdm9pZFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgdGhpcy50YWdzID0gdGFncztcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogdGhpcy5tZXNzYWdlIH0pO1xuXG4gICAgY29uc3QgdGFnQ29udGFpbmVyID0gY29udGVudEVsLmNyZWF0ZURpdihcInRhZy1jb250YWluZXJcIik7XG4gICAgdGhpcy50YWdzLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgY29uc3QgdGFnRWwgPSB0YWdDb250YWluZXIuY3JlYXRlRWwoXCJkaXZcIiwgeyBjbHM6IFwidGFnXCIgfSk7XG4gICAgICB0YWdFbC5jcmVhdGVTcGFuKHsgdGV4dDogdGFnIH0pO1xuICAgICAgY29uc3QgcmVtb3ZlQnV0dG9uID0gdGFnRWwuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlhcIiB9KTtcbiAgICAgIHJlbW92ZUJ1dHRvbi5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgICB0aGlzLnRhZ3MgPSB0aGlzLnRhZ3MuZmlsdGVyKCh0KSA9PiB0ICE9PSB0YWcpO1xuICAgICAgICB0YWdFbC5yZW1vdmUoKTtcbiAgICAgIH07XG4gICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDb25maXJtXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgICAgdGhpcy5vbkNvbmZpcm0odGhpcy50YWdzKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICB0aGlzLnRpdGxlRWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBGaWxlTW92ZWRNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgZmlsZTogVEZpbGU7XG4gIG9sZFRhZ3M6IHN0cmluZ1tdO1xuICBuZXdUYWdzOiBzdHJpbmdbXTtcbiAgcGx1Z2luOiBUYWdJdFBsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBmaWxlOiBURmlsZSxcbiAgICBvbGRUYWdzOiBzdHJpbmdbXSxcbiAgICBuZXdUYWdzOiBzdHJpbmdbXSxcbiAgICBwbHVnaW46IFRhZ0l0UGx1Z2luXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5maWxlID0gZmlsZTtcbiAgICB0aGlzLm9sZFRhZ3MgPSBvbGRUYWdzO1xuICAgIHRoaXMubmV3VGFncyA9IG5ld1RhZ3M7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRmlsZSBNb3ZlZFwiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogYEZpbGUgXCIke3RoaXMuZmlsZS5uYW1lfVwiIGhhcyBiZWVuIG1vdmVkLmAsXG4gICAgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiSG93IHdvdWxkIHlvdSBsaWtlIHRvIGhhbmRsZSB0aGUgdGFncz9cIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiUmVwbGFjZSBBbGxcIilcbiAgICAgIC5zZXREZXNjKFwiUmVwbGFjZSBhbGwgZXhpc3RpbmcgdGFncyB3aXRoIG5ldyBmb2xkZXIgdGFnc1wiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlcGxhY2UgQWxsXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVwbGFjZUFsbFRhZ3ModGhpcy5maWxlLCB0aGlzLm5ld1RhZ3MpO1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJNZXJnZVwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIGV4aXN0aW5nIHRhZ3MgYW5kIGFkZCBuZXcgZm9sZGVyIHRhZ3NcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJNZXJnZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLm1lcmdlVGFncyh0aGlzLmZpbGUsIHRoaXMub2xkVGFncywgdGhpcy5uZXdUYWdzKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiTm8gQWN0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcIktlZXAgdGFncyBhcyB0aGV5IGFyZVwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIk5vIEFjdGlvblwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBDb25mbGljdFJlc29sdXRpb25Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgZmlsZTogVEZpbGU7XG4gIGNvbmZsaWN0aW5nVGFnczogc3RyaW5nW107XG4gIHBsdWdpbjogVGFnSXRQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgZmlsZTogVEZpbGUsXG4gICAgY29uZmxpY3RpbmdUYWdzOiBzdHJpbmdbXSxcbiAgICBwbHVnaW46IFRhZ0l0UGx1Z2luXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5maWxlID0gZmlsZTtcbiAgICB0aGlzLmNvbmZsaWN0aW5nVGFncyA9IGNvbmZsaWN0aW5nVGFncztcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJUYWcgQ29uZmxpY3QgRGV0ZWN0ZWRcIiB9KTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IGBUaGUgZm9sbG93aW5nIHRhZ3MgYXJlIGFzc2lnbmVkIGJ5IG11bHRpcGxlIHBhcmVudCBmb2xkZXJzOmAsXG4gICAgfSk7XG5cbiAgICBjb25zdCB0YWdMaXN0ID0gY29udGVudEVsLmNyZWF0ZUVsKFwidWxcIik7XG4gICAgdGhpcy5jb25mbGljdGluZ1RhZ3MuZm9yRWFjaCgodGFnKSA9PiB7XG4gICAgICB0YWdMaXN0LmNyZWF0ZUVsKFwibGlcIiwgeyB0ZXh0OiB0YWcgfSk7XG4gICAgfSk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IFwiSG93IHdvdWxkIHlvdSBsaWtlIHRvIGhhbmRsZSB0aGVzZSBjb25mbGljdHM/XCIsXG4gICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgQWxsXCIpXG4gICAgICAuc2V0RGVzYyhcIktlZXAgYWxsIGluc3RhbmNlcyBvZiBjb25mbGljdGluZyB0YWdzXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiS2VlcCBBbGxcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVDb25mbGljdChcImtlZXBBbGxcIik7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgT25lXCIpXG4gICAgICAuc2V0RGVzYyhcIktlZXAgb25seSBvbmUgaW5zdGFuY2Ugb2YgZWFjaCBjb25mbGljdGluZyB0YWdcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJLZWVwIE9uZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZUNvbmZsaWN0KFwia2VlcE9uZVwiKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiUmVtb3ZlIEFsbFwiKVxuICAgICAgLnNldERlc2MoXCJSZW1vdmUgYWxsIGluc3RhbmNlcyBvZiBjb25mbGljdGluZyB0YWdzXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVtb3ZlIEFsbFwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZUNvbmZsaWN0KFwicmVtb3ZlQWxsXCIpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgYXN5bmMgcmVzb2x2ZUNvbmZsaWN0KHJlc29sdXRpb246IFwia2VlcEFsbFwiIHwgXCJrZWVwT25lXCIgfCBcInJlbW92ZUFsbFwiKSB7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMucGx1Z2luLmFwcC52YXVsdC5yZWFkKHRoaXMuZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5wbHVnaW4uZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcbiAgICBsZXQgdXBkYXRlZFRhZ3M6IHN0cmluZ1tdO1xuXG4gICAgc3dpdGNoIChyZXNvbHV0aW9uKSB7XG4gICAgICBjYXNlIFwia2VlcEFsbFwiOlxuICAgICAgICB1cGRhdGVkVGFncyA9IGV4aXN0aW5nVGFncztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwia2VlcE9uZVwiOlxuICAgICAgICB1cGRhdGVkVGFncyA9IFsuLi5uZXcgU2V0KGV4aXN0aW5nVGFncyldO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJyZW1vdmVBbGxcIjpcbiAgICAgICAgdXBkYXRlZFRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKFxuICAgICAgICAgICh0YWcpID0+ICF0aGlzLmNvbmZsaWN0aW5nVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgICAgICk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy5wbHVnaW4udXBkYXRlVGFnc0luQ29udGVudChcbiAgICAgIGNvbnRlbnQsXG4gICAgICB1cGRhdGVkVGFnc1xuICAgICk7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwLnZhdWx0Lm1vZGlmeSh0aGlzLmZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICB0aGlzLnBsdWdpbi51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgbmV3IE5vdGljZShgUmVzb2x2ZWQgdGFnIGNvbmZsaWN0cyBmb3IgZmlsZTogJHt0aGlzLmZpbGUubmFtZX1gKTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbmNsYXNzIEJhdGNoQ29udmVyc2lvblJlc3VsdE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcm9jZXNzZWRDb3VudDogbnVtYmVyO1xuICBzdWNjZXNzQ291bnQ6IG51bWJlcjtcbiAgZXJyb3JDb3VudDogbnVtYmVyO1xuICBlcnJvcnM6IHN0cmluZ1tdO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIHByb2Nlc3NlZENvdW50OiBudW1iZXIsXG4gICAgc3VjY2Vzc0NvdW50OiBudW1iZXIsXG4gICAgZXJyb3JDb3VudDogbnVtYmVyLFxuICAgIGVycm9yczogc3RyaW5nW11cbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnByb2Nlc3NlZENvdW50ID0gcHJvY2Vzc2VkQ291bnQ7XG4gICAgdGhpcy5zdWNjZXNzQ291bnQgPSBzdWNjZXNzQ291bnQ7XG4gICAgdGhpcy5lcnJvckNvdW50ID0gZXJyb3JDb3VudDtcbiAgICB0aGlzLmVycm9ycyA9IGVycm9ycztcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJCYXRjaCBDb252ZXJzaW9uIENvbXBsZXRlXCIgfSk7XG5cbiAgICBjb25zdCBzdGF0c0NvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoXCJzdGF0cy1jb250YWluZXJcIik7XG4gICAgc3RhdHNDb250YWluZXIuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IGBQcm9jZXNzZWQ6ICR7dGhpcy5wcm9jZXNzZWRDb3VudH0gZmlsZXNgLFxuICAgIH0pO1xuICAgIHN0YXRzQ29udGFpbmVyLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBgU3VjY2Vzc2Z1bGx5IGNvbnZlcnRlZDogJHt0aGlzLnN1Y2Nlc3NDb3VudH0gZmlsZXNgLFxuICAgIH0pO1xuXG4gICAgaWYgKHRoaXMuZXJyb3JDb3VudCA+IDApIHtcbiAgICAgIGNvbnN0IGVycm9yU2VjdGlvbiA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoXCJlcnJvci1zZWN0aW9uXCIpO1xuICAgICAgZXJyb3JTZWN0aW9uLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IGBGYWlsZWQgdG8gcHJvY2VzcyAke3RoaXMuZXJyb3JDb3VudH0gZmlsZXM6YCxcbiAgICAgICAgY2xzOiBcImVycm9yLWhlYWRlclwiLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGVycm9yTGlzdCA9IGVycm9yU2VjdGlvbi5jcmVhdGVFbChcInVsXCIpO1xuICAgICAgdGhpcy5lcnJvcnMuZm9yRWFjaCgoZmlsZU5hbWUpID0+IHtcbiAgICAgICAgZXJyb3JMaXN0LmNyZWF0ZUVsKFwibGlcIiwgeyB0ZXh0OiBmaWxlTmFtZSB9KTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICBidG5cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDbG9zZVwiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBCYXRjaENvbnZlcnNpb25XYXJuaW5nTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZpbGVzOiBURmlsZVtdO1xuICBwbHVnaW46IFRhZ0l0UGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBmaWxlczogVEZpbGVbXSwgcGx1Z2luOiBUYWdJdFBsdWdpbikge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5maWxlcyA9IGZpbGVzO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIkJhdGNoIENvbnZlcnQgVGFncyB0byBZQU1MXCIgfSk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IGBUaGlzIHdpbGwgY29udmVydCBpbmxpbmUgdGFncyB0byBZQU1MIGZyb250IG1hdHRlciBpbiAke3RoaXMuZmlsZXMubGVuZ3RofSBmaWxlKHMpLiBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgYXV0b21hdGljYWxseSB1bmRvbmUuYCxcbiAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgLnNldFZhbHVlKHRydWUpXG4gICAgICAgICAgLnNldFRvb2x0aXAoXCJTaG93IHRoaXMgd2FybmluZyBuZXh0IHRpbWVcIilcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93QmF0Y2hDb252ZXJzaW9uV2FybmluZyA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5zZXROYW1lKFwiU2hvdyB0aGlzIHdhcm5pbmcgbmV4dCB0aW1lXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5vbkNsaWNrKCgpID0+IHRoaXMuY2xvc2UoKSlcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJQcm9jZWVkXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYmF0Y2hDb252ZXJ0SW5saW5lVGFnc1RvWUFNTCh0aGlzLmZpbGVzKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cbiJdLCJuYW1lcyI6WyJQbHVnaW4iLCJURm9sZGVyIiwiVEZpbGUiLCJOb3RpY2UiLCJNb2RhbCIsIlNldHRpbmciLCJQbHVnaW5TZXR0aW5nVGFiIl0sIm1hcHBpbmdzIjoiOzs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQW9HQTtBQUNPLFNBQVMsU0FBUyxDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRTtBQUM3RCxJQUFJLFNBQVMsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLE9BQU8sS0FBSyxZQUFZLENBQUMsR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLENBQUMsVUFBVSxPQUFPLEVBQUUsRUFBRSxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRTtBQUNoSCxJQUFJLE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLE9BQU8sQ0FBQyxFQUFFLFVBQVUsT0FBTyxFQUFFLE1BQU0sRUFBRTtBQUMvRCxRQUFRLFNBQVMsU0FBUyxDQUFDLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7QUFDbkcsUUFBUSxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7QUFDdEcsUUFBUSxTQUFTLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxNQUFNLENBQUMsSUFBSSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDLEVBQUU7QUFDdEgsUUFBUSxJQUFJLENBQUMsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsVUFBVSxJQUFJLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7QUFDOUUsS0FBSyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBb01EO0FBQ3VCLE9BQU8sZUFBZSxLQUFLLFVBQVUsR0FBRyxlQUFlLEdBQUcsVUFBVSxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBRTtBQUN2SCxJQUFJLElBQUksQ0FBQyxHQUFHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQy9CLElBQUksT0FBTyxDQUFDLENBQUMsSUFBSSxHQUFHLGlCQUFpQixFQUFFLENBQUMsQ0FBQyxLQUFLLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxVQUFVLEdBQUcsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNyRjs7QUMxU0EsTUFBTSxnQkFBZ0IsR0FBa0I7QUFDdEMsSUFBQSxlQUFlLEVBQUUsV0FBVztBQUM1QixJQUFBLGVBQWUsRUFBRSxFQUFFO0FBQ25CLElBQUEsZUFBZSxFQUFFLElBQUk7QUFDckIsSUFBQSxhQUFhLEVBQUUsSUFBSTtBQUNuQixJQUFBLFNBQVMsRUFBRSxLQUFLO0FBQ2hCLElBQUEsMEJBQTBCLEVBQUUsSUFBSTtDQUNqQyxDQUFDO0FBaUJtQixNQUFBLFdBQVksU0FBUUEsZUFBTSxDQUFBO0FBQS9DLElBQUEsV0FBQSxHQUFBOztRQUVFLElBQVUsQ0FBQSxVQUFBLEdBQWUsRUFBRSxDQUFDO1FBQ3BCLElBQWEsQ0FBQSxhQUFBLEdBQVksSUFBSSxDQUFDO1FBQzlCLElBQWMsQ0FBQSxjQUFBLEdBQWMsRUFBRSxDQUFDO1FBQy9CLElBQVcsQ0FBQSxXQUFBLEdBQTBCLElBQUksQ0FBQztLQTRxQ25EO0lBMXFDTyxNQUFNLEdBQUE7O1lBQ1YsSUFBSTtBQUNGLGdCQUFBLE1BQU0sSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO0FBQzFCLGdCQUFBLE1BQU0sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO0FBQzdCLGFBQUE7QUFBQyxZQUFBLE9BQU8sS0FBSyxFQUFFO0FBQ2QsZ0JBQUEsT0FBTyxDQUFDLEtBQUssQ0FDWCx3REFBd0QsRUFDeEQsS0FBSyxDQUNOLENBQUM7QUFDRixnQkFBQSxNQUFNLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO0FBQ2pDLGFBQUE7QUFFRCxZQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLENBQUMsQ0FBQzs7WUFHcEMsVUFBVSxDQUFDLE1BQUs7QUFDZCxnQkFBQSxJQUFJLENBQUMsYUFBYSxHQUFHLEtBQUssQ0FBQztBQUMzQixnQkFBQSxJQUFJLENBQUMsYUFBYSxDQUNoQixJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsSUFBSSxLQUFJO29CQUNuQyxJQUFJLElBQUksWUFBWUMsZ0JBQU8sRUFBRTtBQUMzQix3QkFBQSxJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDakMscUJBQUE7eUJBQU0sSUFBSSxJQUFJLFlBQVlDLGNBQUssRUFBRTtBQUNoQyx3QkFBQSxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDL0IscUJBQUE7aUJBQ0YsQ0FBQyxDQUNILENBQUM7O0FBR0YsZ0JBQUEsSUFBSSxDQUFDLGdCQUFnQixDQUNuQixNQUFNLENBQUMsV0FBVyxDQUFDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLEVBQUUsSUFBSSxDQUFDLENBQzdELENBQUM7O0FBR0YsZ0JBQUEsSUFBSSxDQUFDLGFBQWEsQ0FDaEIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksRUFBRSxPQUFPLEtBQUk7b0JBQzVDLElBQUksSUFBSSxZQUFZQSxjQUFLLEVBQUU7QUFDekIsd0JBQUEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDcEMscUJBQUE7aUJBQ0YsQ0FBQyxDQUNILENBQUM7QUFDSixhQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7O1lBR1QsSUFBSSxDQUFDLFVBQVUsQ0FBQztBQUNkLGdCQUFBLEVBQUUsRUFBRSx1QkFBdUI7QUFDM0IsZ0JBQUEsSUFBSSxFQUFFLGtDQUFrQztnQkFDeEMsUUFBUSxFQUFFLE1BQUs7b0JBQ2IsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLENBQUM7QUFDdEQsb0JBQUEsTUFBTSxNQUFNLEdBQUcsVUFBVSxHQUFHLFVBQVUsQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO0FBQ3JELG9CQUFBLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztpQkFDakM7QUFDRixhQUFBLENBQUMsQ0FBQzs7WUFHSCxJQUFJLENBQUMsVUFBVSxDQUFDO0FBQ2QsZ0JBQUEsRUFBRSxFQUFFLG9CQUFvQjtBQUN4QixnQkFBQSxJQUFJLEVBQUUscUNBQXFDO2dCQUMzQyxRQUFRLEVBQUUsTUFBSztvQkFDYixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztBQUN0RCxvQkFBQSxNQUFNLE1BQU0sR0FBRyxVQUFVLEdBQUcsVUFBVSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUM7QUFDckQsb0JBQUEsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDO2lCQUMvQjtBQUNGLGFBQUEsQ0FBQyxDQUFDOztZQUdILElBQUksQ0FBQyxVQUFVLENBQUM7QUFDZCxnQkFBQSxFQUFFLEVBQUUsMkJBQTJCO0FBQy9CLGdCQUFBLElBQUksRUFBRSwyQkFBMkI7Z0JBQ2pDLFFBQVEsRUFBRSxNQUFLO29CQUNiLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGFBQWEsRUFBRSxDQUFDO0FBQ3RELG9CQUFBLElBQUksVUFBVSxFQUFFO0FBQ2Qsd0JBQUEsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3hDLHFCQUFBO0FBQU0seUJBQUE7QUFDTCx3QkFBQSxJQUFJQyxlQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQUM5QixxQkFBQTtpQkFDRjtBQUNGLGFBQUEsQ0FBQyxDQUFDOztZQUdILElBQUksQ0FBQyxVQUFVLENBQUM7QUFDZCxnQkFBQSxFQUFFLEVBQUUsNkJBQTZCO0FBQ2pDLGdCQUFBLElBQUksRUFBRSw2QkFBNkI7Z0JBQ25DLFFBQVEsRUFBRSxNQUFLO29CQUNiLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGFBQWEsRUFBRSxDQUFDO0FBQ3RELG9CQUFBLElBQUksVUFBVSxFQUFFO0FBQ2Qsd0JBQUEsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQzFDLHFCQUFBO0FBQU0seUJBQUE7QUFDTCx3QkFBQSxJQUFJQSxlQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQUM5QixxQkFBQTtpQkFDRjtBQUNGLGFBQUEsQ0FBQyxDQUFDOztZQUdILElBQUksQ0FBQyxhQUFhLENBQ2hCLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FDbkIsV0FBVyxFQUNYLENBQUMsSUFBVSxFQUFFLElBQW1CLEVBQUUsTUFBYyxLQUFJO0FBQ2xELGdCQUFBLElBQUksSUFBSSxZQUFZRCxjQUFLLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxJQUFJLEVBQUU7QUFDbEUsb0JBQUEsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQWMsS0FBSTt3QkFDOUIsSUFBSTs2QkFDRCxRQUFRLENBQUMsaUJBQWlCLENBQUM7NkJBQzNCLE9BQU8sQ0FBQyxLQUFLLENBQUM7NkJBQ2QsT0FBTyxDQUFDLE1BQUs7QUFDWiw0QkFBQSxJQUFJLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQzVDLHlCQUFDLENBQUMsQ0FBQztBQUNQLHFCQUFDLENBQUMsQ0FBQztBQUNKLGlCQUFBOztnQkFHRCxJQUFJLElBQUksWUFBWUQsZ0JBQU8sRUFBRTtBQUMzQixvQkFBQSxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBYyxLQUFJO3dCQUM5QixJQUFJOzZCQUNELFFBQVEsQ0FBQywyQkFBMkIsQ0FBQzs2QkFDckMsT0FBTyxDQUFDLEtBQUssQ0FBQzs2QkFDZCxPQUFPLENBQUMsTUFBSztBQUNaLDRCQUFBLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUNoQyxDQUFDLEtBQW9CLEtBQ25CLEtBQUssWUFBWUMsY0FBSztnQ0FDdEIsS0FBSyxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxJQUFJLENBQ3pDLENBQUM7QUFDRiw0QkFBQSxJQUFJLENBQUMsNEJBQTRCLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDM0MseUJBQUMsQ0FBQyxDQUFDO0FBQ1AscUJBQUMsQ0FBQyxDQUFDO0FBQ0osaUJBQUE7YUFDRixDQUNGLENBQ0YsQ0FBQzs7QUFHRixZQUFBLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBRXhELFlBQUEsSUFBSSxDQUFDLGFBQWEsQ0FDaEIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksS0FBSTtnQkFDbkMsSUFBSSxJQUFJLFlBQVlELGdCQUFPLEVBQUU7QUFDM0Isb0JBQUEsSUFBSSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2pDLGlCQUFBO2FBQ0YsQ0FBQyxDQUNILENBQUM7O1lBR0YsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLE1BQUs7Z0JBQ3BDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0FBQzNCLGFBQUMsQ0FBQyxDQUFDOztZQUdILElBQUksQ0FBQyxhQUFhLENBQ2hCLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUM1RCxDQUFDO1lBQ0YsSUFBSSxDQUFDLGFBQWEsQ0FDaEIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLENBQzVELENBQUM7WUFDRixJQUFJLENBQUMsYUFBYSxDQUNoQixJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUMsQ0FDNUQsQ0FBQzs7QUFHRixZQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLENBQUM7O1lBR3RFLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQyxNQUFLO0FBQ3BDLGdCQUFBLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLEVBQUU7b0JBQ2pDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0FBQzFCLGlCQUFBO0FBQ0gsYUFBQyxDQUFDLENBQUM7U0FDSixDQUFBLENBQUE7QUFBQSxLQUFBO0lBRUQsUUFBUSxHQUFBO0FBQ04sUUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QixDQUFDLENBQUM7S0FDdkM7SUFFSyxZQUFZLEdBQUE7O1lBQ2hCLElBQUk7Z0JBQ0YsTUFBTSxJQUFJLElBQUksTUFBTSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQWUsQ0FBQztBQUNuRCxnQkFBQSxJQUFJLElBQUksRUFBRTtvQkFDUixJQUFJLENBQUMsUUFBUSxHQUFRLE1BQUEsQ0FBQSxNQUFBLENBQUEsTUFBQSxDQUFBLE1BQUEsQ0FBQSxFQUFBLEVBQUEsZ0JBQWdCLEdBQUssSUFBSSxDQUFDLFFBQVEsQ0FBRSxDQUFDO29CQUMxRCxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDO0FBQ3pDLGlCQUFBO0FBQU0scUJBQUE7QUFDTCxvQkFBQSxJQUFJLENBQUMsUUFBUSxHQUFHLGdCQUFnQixDQUFDO0FBQ2pDLG9CQUFBLElBQUksQ0FBQyxVQUFVLEdBQUcsRUFBRSxDQUFDO0FBQ3RCLGlCQUFBO0FBQ0YsYUFBQTtBQUFDLFlBQUEsT0FBTyxLQUFLLEVBQUU7QUFDZCxnQkFBQSxPQUFPLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFFLEtBQUssQ0FBQyxDQUFDO0FBQ3BELGdCQUFBLElBQUksQ0FBQyxRQUFRLEdBQUcsZ0JBQWdCLENBQUM7QUFDakMsZ0JBQUEsSUFBSSxDQUFDLFVBQVUsR0FBRyxFQUFFLENBQUM7QUFDdEIsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFSyxZQUFZLEdBQUE7O0FBQ2hCLFlBQUEsTUFBTSxJQUFJLEdBQWU7Z0JBQ3ZCLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtnQkFDdkIsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO0FBQzNCLGdCQUFBLE9BQU8sRUFBRSxPQUFPO2FBQ2pCLENBQUM7QUFDRixZQUFBLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztTQUMzQixDQUFBLENBQUE7QUFBQSxLQUFBO0lBRUssY0FBYyxHQUFBOzs7O0FBR2xCLFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO1NBQzFELENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFSyxjQUFjLEdBQUE7O0FBQ2xCLFlBQUEsTUFBTSxJQUFJLEdBQWU7Z0JBQ3ZCLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtnQkFDdkIsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO0FBQzNCLGdCQUFBLE9BQU8sRUFBRSxPQUFPO2FBQ2pCLENBQUM7QUFDRixZQUFBLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztTQUMzQixDQUFBLENBQUE7QUFBQSxLQUFBO0FBRU8sSUFBQSxvQkFBb0IsQ0FBQyxNQUFlLEVBQUE7QUFDMUMsUUFBQSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRTtBQUN2QixZQUFBLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUN6RCxTQUFBO0tBQ0Y7SUFFRCxhQUFhLENBQUMsVUFBa0IsRUFBRSxJQUFjLEVBQUE7UUFDOUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2xELFFBQUEsSUFBSSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsR0FBRyxVQUFVLENBQUM7UUFDekMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO0tBQy9CO0FBRUQsSUFBQSxhQUFhLENBQUMsVUFBa0IsRUFBQTtRQUM5QixPQUFPLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxDQUFDO0tBQzFDO0FBRUQsSUFBQSxrQkFBa0IsQ0FBQyxNQUFzQixFQUFBO0FBQ3ZDLFFBQUEsSUFBSSxNQUFNLEVBQUU7QUFDVixZQUFBLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0FBQ25ELFNBQUE7QUFBTSxhQUFBO0FBQ0wsWUFBQSxJQUFJRSxlQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQztBQUNsQyxTQUFBO0tBQ0Y7QUFFRCxJQUFBLGdCQUFnQixDQUFDLE1BQXNCLEVBQUE7QUFDckMsUUFBQSxJQUFJLE1BQU0sRUFBRTtZQUNWLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNwQyxJQUFJQSxlQUFNLENBQUMsQ0FBaUMsOEJBQUEsRUFBQSxNQUFNLENBQUMsSUFBSSxDQUFBLENBQUUsQ0FBQyxDQUFDO0FBQzVELFNBQUE7QUFBTSxhQUFBO0FBQ0wsWUFBQSxJQUFJQSxlQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQztBQUNsQyxTQUFBO0tBQ0Y7QUFFSyxJQUFBLGtCQUFrQixDQUFDLElBQVcsRUFBQTs7O0FBRWxDLFlBQUEsSUFDRSxFQUFFLElBQUksWUFBWUQsY0FBSyxDQUFDO2dCQUN4QixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEVBQ3REO2dCQUNBLE9BQU87QUFDUixhQUFBO0FBRUQsWUFBQSxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxhQUFhLEVBQUU7QUFDaEMsZ0JBQUEsT0FBTztBQUNSLGFBQUE7QUFFRCxZQUFBLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7QUFDM0IsWUFBQSxJQUFJLE1BQU0sRUFBRTtnQkFDVixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2xFLGdCQUFBLElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7b0JBQ3pCLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7b0JBQzNDLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO0FBQy9CLGlCQUFBO0FBQ0YsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFSyxjQUFjLENBQUMsSUFBVyxFQUFFLE9BQWUsRUFBQTs7WUFDL0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFlLFlBQUEsRUFBQSxPQUFPLENBQU8sSUFBQSxFQUFBLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFFdEQsWUFBQSxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDckUsWUFBQSxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDO0FBRTlCLFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FDVCxDQUFBLGlCQUFBLEVBQW9CLGFBQWEsQ0FBaUIsY0FBQSxFQUFBLFNBQVMsS0FBVCxJQUFBLElBQUEsU0FBUyx1QkFBVCxTQUFTLENBQUUsSUFBSSxDQUFBLENBQUUsQ0FDcEUsQ0FBQztZQUVGLElBQUksYUFBYSxNQUFLLFNBQVMsS0FBVCxJQUFBLElBQUEsU0FBUyx1QkFBVCxTQUFTLENBQUUsSUFBSSxDQUFBLEVBQUU7Z0JBQ3JDLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxhQUFhLENBQUMsQ0FBQztBQUN2RSxnQkFBQSxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQ3JELENBQUEsU0FBUyxLQUFULElBQUEsSUFBQSxTQUFTLHVCQUFULFNBQVMsQ0FBRSxJQUFJLEtBQUksRUFBRSxDQUN0QixDQUFDOztnQkFHRixJQUNFLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxDQUFDO29CQUNwQyxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUNwQztBQUNBLG9CQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxpQkFBQSxFQUFvQixhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQzVELG9CQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxpQkFBQSxFQUFvQixhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO29CQUU1RCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDekQsb0JBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGtCQUFBLEVBQXFCLGVBQWUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFFL0Qsb0JBQUEsSUFBSSxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtBQUM5Qix3QkFBQSxJQUFJLHVCQUF1QixDQUN6QixJQUFJLENBQUMsR0FBRyxFQUNSLElBQUksRUFDSixlQUFlLEVBQ2YsSUFBSSxDQUNMLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDVixxQkFBQTtBQUFNLHlCQUFBO0FBQ0wsd0JBQUEsSUFBSSxjQUFjLENBQ2hCLElBQUksQ0FBQyxHQUFHLEVBQ1IsSUFBSSxFQUNKLGFBQWEsRUFDYixhQUFhLEVBQ2IsSUFBSSxDQUNMLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDVixxQkFBQTtBQUNGLGlCQUFBO0FBQU0scUJBQUE7QUFDTCxvQkFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7QUFDM0QsaUJBQUE7QUFDRixhQUFBO0FBQU0saUJBQUE7QUFDTCxnQkFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLHdEQUF3RCxDQUFDLENBQUM7QUFDdkUsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFSyxhQUFhLENBQUMsSUFBVyxFQUFFLFNBQW1CLEVBQUE7O0FBQ2xELFlBQUEsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDaEQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxDQUFDOztBQUcxRCxZQUFBLE1BQU0sT0FBTyxHQUFHLFNBQVMsQ0FBQyxNQUFNLENBQzlCLENBQUMsR0FBVyxLQUFLLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FDN0MsQ0FBQztZQUNGLE1BQU0sT0FBTyxHQUFHLENBQUMsR0FBRyxZQUFZLEVBQUUsR0FBRyxPQUFPLENBQUMsQ0FBQzs7QUFHOUMsWUFBQSxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUN0QixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQ2xFLGdCQUFBLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLENBQUMsQ0FBQztnQkFDbEQsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7QUFFOUIsZ0JBQUEsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRTtvQkFDM0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFxQixrQkFBQSxFQUFBLElBQUksQ0FBQyxJQUFJLENBQUcsQ0FBQSxDQUFBLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDekQsaUJBQUE7QUFDRixhQUFBO0FBQU0saUJBQUEsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRTtnQkFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLHNCQUFBLEVBQXlCLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDbkQsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFSyxJQUFBLGNBQWMsQ0FDbEIsSUFBVyxFQUNYLGFBQXVCLEVBQ3ZCLGFBQXVCLEVBQUE7O1lBRXZCLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSx3QkFBQSxFQUEyQixJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3BELFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGlCQUFBLEVBQW9CLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDNUQsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsaUJBQUEsRUFBb0IsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUU1RCxZQUFBLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2hELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUUxRCxZQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxlQUFBLEVBQWtCLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7O0FBR3pELFlBQUEsTUFBTSxVQUFVLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FDcEMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUN0QyxDQUFDOztBQUdGLFlBQUEsTUFBTSxXQUFXLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxVQUFVLEVBQUUsR0FBRyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFFcEUsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsYUFBQSxFQUFnQixVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3JELFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGNBQUEsRUFBaUIsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBRSxDQUFBLENBQUMsQ0FBQztZQUV2RCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBRXRFLElBQUksT0FBTyxLQUFLLGNBQWMsRUFBRTtBQUM5QixnQkFBQSxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUM7Z0JBQ2xELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSx1QkFBQSxFQUEwQixJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3BELGFBQUE7QUFBTSxpQkFBQTtnQkFDTCxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsNEJBQUEsRUFBK0IsSUFBSSxDQUFDLElBQUksQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUN6RCxhQUFBO1NBQ0YsQ0FBQSxDQUFBO0FBQUEsS0FBQTtJQUVELG1CQUFtQixDQUFDLE9BQWUsRUFBRSxJQUFjLEVBQUE7O1FBRWpELE1BQU0sVUFBVSxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBRXRDLFFBQUEsSUFBSSxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtBQUMzQixZQUFBLE9BQU8sSUFBSSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQzVDLFNBQUE7UUFFRCxNQUFNLGdCQUFnQixHQUFHLHVCQUF1QixDQUFDO1FBQ2pELE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDOztRQUd6RCxNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQU8sSUFBQSxFQUFBLEdBQUcsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBRXBFLFFBQUEsSUFBSSxnQkFBZ0IsRUFBRTtBQUNwQixZQUFBLE1BQU0sV0FBVyxHQUFHLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDOztZQUV4QyxNQUFNLGtCQUFrQixHQUFHLFdBQVc7QUFDbkMsaUJBQUEsT0FBTyxDQUFDLCtCQUErQixFQUFFLEVBQUUsQ0FBQztBQUM1QyxpQkFBQSxPQUFPLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQztBQUNyQixpQkFBQSxJQUFJLEVBQUUsQ0FBQzs7WUFHVixNQUFNLGtCQUFrQixHQUFHLGtCQUFrQjtBQUMzQyxrQkFBRSxDQUFBLEVBQUcsa0JBQWtCLENBQUEsU0FBQSxFQUFZLFVBQVUsQ0FBRSxDQUFBO0FBQy9DLGtCQUFFLENBQUEsT0FBQSxFQUFVLFVBQVUsQ0FBQSxDQUFFLENBQUM7WUFFM0IsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUNwQixnQkFBZ0IsRUFDaEIsQ0FBUSxLQUFBLEVBQUEsa0JBQWtCLENBQU8sS0FBQSxDQUFBLENBQ2xDLENBQUM7QUFDSCxTQUFBO0FBQU0sYUFBQTtBQUNMLFlBQUEsT0FBTyxDQUFlLFlBQUEsRUFBQSxVQUFVLENBQVksU0FBQSxFQUFBLE9BQU8sRUFBRSxDQUFDO0FBQ3ZELFNBQUE7S0FDRjtJQUVELGdCQUFnQixDQUFDLE9BQWUsRUFBRSxJQUFjLEVBQUE7QUFDOUMsUUFBQSxJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO0FBQ3JCLFlBQUEsT0FBTyxPQUFPLENBQUM7QUFDaEIsU0FBQTtRQUVELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBTyxJQUFBLEVBQUEsR0FBRyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDOUQsTUFBTSxnQkFBZ0IsR0FBRyx1QkFBdUIsQ0FBQztRQUNqRCxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQUV6RCxRQUFBLElBQUksZ0JBQWdCLEVBQUU7QUFDcEIsWUFBQSxNQUFNLFdBQVcsR0FBRyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN4QyxNQUFNLGtCQUFrQixHQUFHLENBQUEsRUFBRyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUEsU0FBQSxFQUFZLFVBQVUsQ0FBQSxDQUFFLENBQUM7WUFDekUsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUNwQixnQkFBZ0IsRUFDaEIsQ0FBUSxLQUFBLEVBQUEsa0JBQWtCLENBQU8sS0FBQSxDQUFBLENBQ2xDLENBQUM7QUFDSCxTQUFBO0FBQU0sYUFBQTtBQUNMLFlBQUEsT0FBTyxDQUFlLFlBQUEsRUFBQSxVQUFVLENBQVksU0FBQSxFQUFBLE9BQU8sRUFBRSxDQUFDO0FBQ3ZELFNBQUE7S0FDRjtJQUVELHFCQUFxQixDQUFDLE9BQWUsRUFBRSxZQUFzQixFQUFBO1FBQzNELE1BQU0sZ0JBQWdCLEdBQUcsdUJBQXVCLENBQUM7UUFDakQsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFFekQsUUFBQSxJQUFJLGdCQUFnQixFQUFFO0FBQ3BCLFlBQUEsTUFBTSxXQUFXLEdBQUcsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDeEMsTUFBTSxZQUFZLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRTVELFlBQUEsSUFBSSxZQUFZLEVBQUU7Z0JBQ2hCLE1BQU0sV0FBVyxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxLQUFLLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQ3hFLGdCQUFBLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQ3BDLENBQUMsR0FBRyxLQUFLLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FDckMsQ0FBQztBQUNGLGdCQUFBLE1BQU0sa0JBQWtCLEdBQUcsV0FBVyxDQUFDLE9BQU8sQ0FDNUMsaUJBQWlCLEVBQ2pCLENBQVUsT0FBQSxFQUFBLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUEsQ0FBQSxDQUFHLENBQ3BDLENBQUM7Z0JBQ0YsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUNwQixnQkFBZ0IsRUFDaEIsQ0FBUSxLQUFBLEVBQUEsa0JBQWtCLENBQU8sS0FBQSxDQUFBLENBQ2xDLENBQUM7QUFDSCxhQUFBO0FBQ0YsU0FBQTtBQUVELFFBQUEsT0FBTyxPQUFPLENBQUM7S0FDaEI7QUFFSyxJQUFBLHFCQUFxQixDQUFDLElBQVcsRUFBQTs7QUFDckMsWUFBQSxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDO1lBQzNCLElBQUksQ0FBQyxNQUFNLEVBQUU7QUFDWCxnQkFBQSxJQUFJQyxlQUFNLENBQUMseUJBQXlCLENBQUMsQ0FBQztnQkFDdEMsT0FBTztBQUNSLGFBQUE7QUFFRCxZQUFBLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2hELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUV0RCxZQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSwwQkFBQSxFQUE2QixRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBRWhFLFlBQUEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtBQUN6QixnQkFBQSxJQUFJQSxlQUFNLENBQUMsMkJBQTJCLENBQUMsQ0FBQztnQkFDeEMsT0FBTztBQUNSLGFBQUE7O1lBR0QsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDbkQsWUFBQSxNQUFNLE9BQU8sR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLFVBQVUsRUFBRSxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzRCxZQUFBLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFFckUsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsc0JBQUEsRUFBeUIsVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUM5RCxZQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxpQkFBQSxFQUFvQixTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBRXhELFlBQUEsSUFBSSxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtBQUMxQixnQkFBQSxJQUFJQSxlQUFNLENBQUMsa0NBQWtDLENBQUMsQ0FBQztnQkFDL0MsT0FBTztBQUNSLGFBQUE7WUFFRCxJQUFJLGlCQUFpQixDQUNuQixJQUFJLENBQUMsR0FBRyxFQUNSLENBQUEsa0NBQUEsRUFBcUMsSUFBSSxDQUFDLElBQUksb0JBQW9CLE1BQU0sQ0FBQyxJQUFJLENBQUksRUFBQSxDQUFBLEVBQ2pGLFNBQVMsRUFDVCxDQUFDLFlBQVksS0FBSTtBQUNmLGdCQUFBLE1BQU0sV0FBVyxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsVUFBVSxFQUFFLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNuRSxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7QUFDN0MsZ0JBQUEsSUFBSUEsZUFBTSxDQUNSLENBQVcsUUFBQSxFQUFBLFlBQVksQ0FBQyxNQUFNLENBQThCLDJCQUFBLEVBQUEsTUFBTSxDQUFDLElBQUksQ0FBRSxDQUFBLENBQzFFLENBQUM7QUFDSixhQUFDLENBQ0YsQ0FBQyxJQUFJLEVBQUUsQ0FBQztTQUNWLENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFRCxJQUFBLHNCQUFzQixDQUFDLE9BQWUsRUFBQTtRQUNwQyxNQUFNLGdCQUFnQixHQUFHLHVCQUF1QixDQUFDO1FBQ2pELE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBRXpELElBQUksSUFBSSxHQUFhLEVBQUUsQ0FBQztBQUV4QixRQUFBLElBQUksZ0JBQWdCLEVBQUU7QUFDcEIsWUFBQSxNQUFNLFdBQVcsR0FBRyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQzs7WUFFeEMsTUFBTSxRQUFRLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO0FBQ3ZFLFlBQUEsSUFBSSxRQUFRLEVBQUU7QUFDWixnQkFBQSxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0IsZ0JBQUEsSUFBSSxVQUFVLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFOztBQUU5QixvQkFBQSxJQUFJLEdBQUcsVUFBVTtBQUNkLHlCQUFBLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7eUJBQ1osS0FBSyxDQUFDLEdBQUcsQ0FBQzt5QkFDVixHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7QUFDN0IsaUJBQUE7QUFBTSxxQkFBQTs7QUFFTCxvQkFBQSxJQUFJLEdBQUcsVUFBVTt5QkFDZCxLQUFLLENBQUMsSUFBSSxDQUFDO0FBQ1gseUJBQUEsR0FBRyxDQUFDLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO3lCQUNsRCxNQUFNLENBQUMsQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLENBQUM7QUFDekIsaUJBQUE7QUFDRixhQUFBO0FBQ0YsU0FBQTs7UUFHRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQzlDLFFBQUEsSUFBSSxVQUFVLEVBQUU7WUFDZCxJQUFJLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEUsU0FBQTtRQUVELE9BQU8sQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7S0FDM0I7QUFFSyxJQUFBLHVCQUF1QixDQUFDLElBQVcsRUFBQTs7QUFDdkMsWUFBQSxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNoRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBRTlDLElBQUksQ0FBQyxVQUFVLEVBQUU7QUFDZixnQkFBQSxJQUFJQSxlQUFNLENBQUMsa0NBQWtDLENBQUMsQ0FBQztnQkFDL0MsT0FBTztBQUNSLGFBQUE7QUFFRCxZQUFBLE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBRTFELFlBQUEsSUFBSSxpQkFBaUIsQ0FDbkIsSUFBSSxDQUFDLEdBQUcsRUFDUixDQUFxQixrQkFBQSxFQUFBLE9BQU8sQ0FBQyxNQUFNLENBQXVHLHFHQUFBLENBQUEsRUFDMUksTUFBVyxTQUFBLENBQUEsSUFBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLGFBQUE7QUFDVCxnQkFBQSxJQUFJLGlCQUFpQixDQUNuQixJQUFJLENBQUMsR0FBRyxFQUNSLENBQXFELG1EQUFBLENBQUEsRUFDckQsT0FBTyxFQUNQLENBQU8sWUFBWSxLQUFJLFNBQUEsQ0FBQSxJQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsYUFBQTtBQUNyQixvQkFBQSxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO0FBQzdCLHdCQUFBLElBQUlBLGVBQU0sQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO3dCQUM5QyxPQUFPO0FBQ1IscUJBQUE7O29CQUdELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7QUFHMUQsb0JBQUEsTUFBTSxPQUFPLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxZQUFZLEVBQUUsR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBRWpFLElBQUksY0FBYyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7O0FBRzdELG9CQUFBLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLEtBQUk7d0JBQzNCLE1BQU0sS0FBSyxHQUFHLElBQUksTUFBTSxDQUFDLENBQUksQ0FBQSxFQUFBLEdBQUcsQ0FBSyxHQUFBLENBQUEsRUFBRSxHQUFHLENBQUMsQ0FBQzt3QkFDNUMsY0FBYyxHQUFHLGNBQWMsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQ3JELHFCQUFDLENBQUMsQ0FBQztBQUVILG9CQUFBLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLENBQUMsQ0FBQztvQkFDbEQsSUFBSUEsZUFBTSxDQUNSLENBQWEsVUFBQSxFQUFBLFlBQVksQ0FBQyxNQUFNLENBQUEsaUNBQUEsQ0FBbUMsQ0FDcEUsQ0FBQztBQUNKLGlCQUFDLENBQUEsQ0FDRixDQUFDLElBQUksRUFBRSxDQUFDO0FBQ1gsYUFBQyxDQUFBLENBQ0YsQ0FBQyxJQUFJLEVBQUUsQ0FBQztTQUNWLENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFTyxJQUFBLG9CQUFvQixDQUFDLE1BQWUsRUFBQTtRQUMxQyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3BDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztLQUN2QjtBQUVLLElBQUEseUJBQXlCLENBQUMsTUFBZSxFQUFBOztZQUM3QyxJQUFJLENBQUMsTUFBTSxFQUFFO0FBQ1gsZ0JBQUEsT0FBTyxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO2dCQUM3QyxPQUFPO0FBQ1IsYUFBQTtZQUVELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ25ELFlBQUEsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLLEtBQUssS0FBSyxZQUFZRCxjQUFLLENBQUMsQ0FBQztZQUV4RSxJQUFJLFlBQVksR0FBRyxDQUFDLENBQUM7QUFDckIsWUFBQSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRTtnQkFDeEIsSUFBSSxJQUFJLFlBQVlBLGNBQUssRUFBRTtBQUN6QixvQkFBQSxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztvQkFDaEQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQzFELG9CQUFBLE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQy9CLENBQUMsR0FBVyxLQUFLLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FDN0MsQ0FBQztBQUVGLG9CQUFBLElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7d0JBQ3RCLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDeEMsd0JBQUEsWUFBWSxFQUFFLENBQUM7QUFDaEIscUJBQUE7QUFDRixpQkFBQTtBQUNGLGFBQUE7WUFFRCxJQUFJLFlBQVksR0FBRyxDQUFDLEVBQUU7QUFDcEIsZ0JBQUEsSUFBSUMsZUFBTSxDQUFDLENBQUEsaUJBQUEsRUFBb0IsWUFBWSxDQUFBLFFBQUEsQ0FBVSxDQUFDLENBQUM7QUFDeEQsYUFBQTtBQUFNLGlCQUFBO0FBQ0wsZ0JBQUEsSUFBSUEsZUFBTSxDQUFDLDZCQUE2QixDQUFDLENBQUM7QUFDM0MsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFSyxrQkFBa0IsR0FBQTs7QUFDdEIsWUFBQSxNQUFNLFdBQVcsR0FBRztBQUNsQixnQkFBQSxRQUFRLEVBQUUsZ0JBQWdCO0FBQzFCLGdCQUFBLFVBQVUsRUFBRSxFQUFFO2FBQ2YsQ0FBQztZQUNGLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztBQUNwRCxZQUFBLElBQUksQ0FBQyxVQUFVLEdBQUcsRUFBRSxDQUFDO0FBQ3JCLFlBQUEsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQ2pDLFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDO1NBQzFELENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFRCxJQUFBLGNBQWMsQ0FBQyxNQUFlLEVBQUE7O0FBRTVCLFFBQUEsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3hFLElBQUksYUFBYSxZQUFZRixnQkFBTyxFQUFFO0FBQ3BDLFlBQUEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7QUFDekMsU0FBQTtBQUFNLGFBQUE7WUFDTCxPQUFPLENBQUMsS0FBSyxDQUNYLENBQUEsOENBQUEsRUFBaUQsTUFBTSxDQUFDLElBQUksQ0FBRSxDQUFBLENBQy9ELENBQUM7QUFDSCxTQUFBO0tBQ0Y7SUFFSyxxQkFBcUIsR0FBQTs7QUFDekIsWUFBQSxLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUU7QUFDeEMsZ0JBQUEsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDeEMsYUFBQTtBQUNELFlBQUEsSUFBSSxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUM7U0FDMUIsQ0FBQSxDQUFBO0FBQUEsS0FBQTtBQUVLLElBQUEsbUJBQW1CLENBQUMsTUFBZSxFQUFBOztBQUN2QyxZQUFBLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztTQUN6RCxDQUFBLENBQUE7QUFBQSxLQUFBO0FBRUQsSUFBQSw0QkFBNEIsQ0FBQyxVQUFrQixFQUFBO0FBQzdDLFFBQUEsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGVBQWUsS0FBSyxNQUFNLEVBQUU7QUFDNUMsWUFBQSxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDdkMsU0FBQTtRQUVELElBQUksSUFBSSxHQUFhLEVBQUUsQ0FBQztRQUN4QixJQUFJLFdBQVcsR0FBRyxVQUFVLENBQUM7QUFFN0IsUUFBQSxPQUFPLFdBQVcsRUFBRTtZQUNsQixJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFO2dCQUN4RCxJQUFJLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3BFLGFBQUE7QUFFRCxZQUFBLElBQ0UsSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLEtBQUssV0FBVztnQkFDN0MsV0FBVyxLQUFLLFVBQVUsRUFDMUI7Z0JBQ0EsTUFBTTtBQUNQLGFBQUE7QUFFRCxZQUFBLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUMxRSxJQUFJLFVBQVUsS0FBSyxXQUFXLEVBQUU7QUFDOUIsZ0JBQUEsTUFBTTtBQUNQLGFBQUE7WUFDRCxXQUFXLEdBQUcsVUFBVSxDQUFDO0FBQzFCLFNBQUE7QUFFRCxRQUFBLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFFSyxpQkFBaUIsR0FBQTs7QUFDckIsWUFBQSxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLEVBQUU7O0FBRWxDLGdCQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGVBQWUsQ0FBQyxlQUFlLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEtBQUk7QUFDbkUsb0JBQUEsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsSUFBVyxDQUFDO0FBQzFDLG9CQUFBLE1BQU0sU0FBUyxHQUFHLGdCQUFnQixDQUFDLFNBQVMsQ0FBQztBQUM3QyxvQkFBQSxLQUFLLE1BQU0sR0FBRyxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFO3dCQUNoRCxJQUFJLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUNwRCw0QkFBQSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsRUFBaUIsQ0FBQzs0QkFDeEMsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FDbkMsMkJBQTJCLENBQ04sQ0FBQztBQUN4Qiw0QkFBQSxJQUFJLE1BQU0sRUFBRTtBQUNWLGdDQUFBLE1BQU0sQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDcEMsZ0NBQUEsTUFBTSxDQUFDLGVBQWUsQ0FBQyxZQUFZLENBQUMsQ0FBQztBQUN0Qyw2QkFBQTtBQUNGLHlCQUFBO0FBQ0YscUJBQUE7QUFDSCxpQkFBQyxDQUFDLENBQUM7Z0JBQ0gsT0FBTztBQUNSLGFBQUE7QUFFRCxZQUFBLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGVBQWUsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM1RSxZQUFBLElBQUksQ0FBQyxZQUFZO2dCQUFFLE9BQU87QUFFMUIsWUFBQSxNQUFNLGdCQUFnQixHQUFHLFlBQVksQ0FBQyxJQUFXLENBQUM7QUFDbEQsWUFBQSxNQUFNLFNBQVMsR0FBRyxnQkFBZ0IsQ0FBQyxTQUFTLENBQUM7QUFFN0MsWUFBQSxLQUFLLE1BQU0sQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBRTtBQUNwRCxnQkFBQSxJQUNFLElBQUk7b0JBQ0osT0FBTyxJQUFJLEtBQUssUUFBUTtBQUN4QixvQkFBQSxJQUFJLElBQUksSUFBSTtBQUNaLG9CQUFBLE1BQU0sSUFBSSxJQUFJO0FBQ2Qsb0JBQUEsSUFBSSxDQUFDLElBQUksWUFBWUEsZ0JBQU8sRUFDNUI7b0JBQ0EsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLElBQWMsQ0FBQyxDQUFDO0FBQ3JFLG9CQUFBLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxFQUFpQixDQUFDO29CQUN4QyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUNuQywyQkFBMkIsQ0FDTixDQUFDO0FBRXhCLG9CQUFBLElBQUksTUFBTSxFQUFFO0FBQ1Ysd0JBQUEsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtBQUN6Qiw0QkFBQSxNQUFNLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQ2pDLDRCQUFBLE1BQU0sQ0FBQyxZQUFZLENBQ2pCLFlBQVksRUFDWixDQUFrQixlQUFBLEVBQUEsVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQSxDQUFFLENBQzFDLENBQUM7QUFDSCx5QkFBQTtBQUFNLDZCQUFBO0FBQ0wsNEJBQUEsTUFBTSxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsQ0FBQztBQUNwQyw0QkFBQSxNQUFNLENBQUMsZUFBZSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ3RDLHlCQUFBO0FBQ0YscUJBQUE7QUFBTSx5QkFBQTtBQUNMLHdCQUFBLE9BQU8sQ0FBQyxJQUFJLENBQUMsMkNBQTJDLElBQUksQ0FBQSxDQUFFLENBQUMsQ0FBQztBQUNqRSxxQkFBQTtBQUNGLGlCQUFBO0FBQ0YsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7O0lBR0ssc0JBQXNCLEdBQUE7O1lBQzFCLElBQUk7O2dCQUVGLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQzs7QUFHMUMsZ0JBQUEsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsZUFBZSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ2hFLGdCQUFBLElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7O29CQUU1QixJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDNUMsaUJBQUE7QUFDRixhQUFBO0FBQUMsWUFBQSxPQUFPLEtBQUssRUFBRTtBQUNkLGdCQUFBLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEVBQUU7QUFDM0Isb0JBQUEsT0FBTyxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsRUFBRSxLQUFLLENBQUMsQ0FBQztBQUNyRCxpQkFBQTtBQUNGLGFBQUE7U0FDRixDQUFBLENBQUE7QUFBQSxLQUFBOztJQUdELGdCQUFnQixHQUFBO0FBQ2QsUUFBQSxNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1FBQ2xDLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7QUFDakQsWUFBQSxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBVyxLQUFLLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNqRCxTQUFBO0FBQ0QsUUFBQSxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7S0FDNUI7SUFFSyxjQUFjLENBQUMsSUFBVyxFQUFFLE9BQWlCLEVBQUE7O1lBQ2pELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSw2QkFBQSxFQUFnQyxJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3pELFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLFVBQUEsRUFBYSxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBRS9DLFlBQUEsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7O1lBR2hELElBQUksY0FBYyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7QUFHNUQsWUFBQSxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUN0QixNQUFNLGdCQUFnQixHQUFHLHVCQUF1QixDQUFDO2dCQUNqRCxNQUFNLGdCQUFnQixHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQUVoRSxnQkFBQSxJQUFJLGdCQUFnQixFQUFFO0FBQ3BCLG9CQUFBLE1BQU0sV0FBVyxHQUFHLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUN4QyxNQUFNLGNBQWMsR0FBRyxDQUFBLE9BQUEsRUFBVSxPQUFPO3lCQUNyQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQSxJQUFBLEVBQU8sR0FBRyxDQUFBLENBQUUsQ0FBQztBQUMxQix5QkFBQSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUEsQ0FBRSxDQUFDO29CQUNoQixNQUFNLGtCQUFrQixHQUFHLENBQUEsRUFBRyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUEsRUFBQSxFQUFLLGNBQWMsQ0FBQSxDQUFFLENBQUM7b0JBQ3RFLGNBQWMsR0FBRyxjQUFjLENBQUMsT0FBTyxDQUNyQyxnQkFBZ0IsRUFDaEIsQ0FBUSxLQUFBLEVBQUEsa0JBQWtCLENBQU8sS0FBQSxDQUFBLENBQ2xDLENBQUM7QUFDSCxpQkFBQTtBQUFNLHFCQUFBO29CQUNMLE1BQU0sY0FBYyxHQUFHLENBQUEsT0FBQSxFQUFVLE9BQU87eUJBQ3JDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFBLElBQUEsRUFBTyxHQUFHLENBQUEsQ0FBRSxDQUFDO0FBQzFCLHlCQUFBLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQSxDQUFFLENBQUM7QUFDaEIsb0JBQUEsY0FBYyxHQUFHLENBQVEsS0FBQSxFQUFBLGNBQWMsQ0FBWSxTQUFBLEVBQUEsY0FBYyxFQUFFLENBQUM7QUFDckUsaUJBQUE7QUFDRixhQUFBO0FBRUQsWUFBQSxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUM7WUFDbEQsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7WUFDOUIsSUFBSUUsZUFBTSxDQUFDLENBQTJCLHdCQUFBLEVBQUEsSUFBSSxDQUFDLElBQUksQ0FBQSxDQUFFLENBQUMsQ0FBQztTQUNwRCxDQUFBLENBQUE7QUFBQSxLQUFBO0FBRUQsSUFBQSx3QkFBd0IsQ0FBQyxPQUFlLEVBQUE7UUFDdEMsTUFBTSxnQkFBZ0IsR0FBRyx1QkFBdUIsQ0FBQztRQUNqRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsRUFBRSxDQUFDLENBQUM7S0FDOUM7QUFFSyxJQUFBLFNBQVMsQ0FDYixJQUFXLEVBQ1gsT0FBaUIsRUFDakIsT0FBaUIsRUFBQTs7WUFFakIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLHVCQUFBLEVBQTBCLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDbkQsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsVUFBQSxFQUFhLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDL0MsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsVUFBQSxFQUFhLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFFL0MsWUFBQSxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNoRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsT0FBTyxDQUFDLENBQUM7QUFFMUQsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsZUFBQSxFQUFrQixZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDOztBQUd6RCxZQUFBLE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7O0FBR3hFLFlBQUEsTUFBTSxVQUFVLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxVQUFVLEVBQUUsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFFN0QsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsYUFBQSxFQUFnQixVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBRXJELFlBQUEsSUFDRSxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxDQUFDLEVBQ3pFO2dCQUNBLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsVUFBVSxDQUFDLENBQUM7QUFDckUsZ0JBQUEsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGNBQWMsQ0FBQyxDQUFDO2dCQUNsRCxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztnQkFDOUIsSUFBSUEsZUFBTSxDQUFDLENBQXlCLHNCQUFBLEVBQUEsSUFBSSxDQUFDLElBQUksQ0FBQSxDQUFFLENBQUMsQ0FBQztBQUNsRCxhQUFBO0FBQU0saUJBQUE7Z0JBQ0wsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLDRCQUFBLEVBQStCLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDekQsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFSyxJQUFBLHNCQUFzQixDQUFDLE1BQWUsRUFBQTs7WUFDMUMsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUMxRCxZQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxxQkFBQSxFQUF3QixpQkFBaUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFFcEUsWUFBQSxJQUFJLGlCQUFpQixDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7QUFDbEMsZ0JBQUEsSUFBSUEsZUFBTSxDQUFDLG1DQUFtQyxDQUFDLENBQUM7Z0JBQ2hELE9BQU87QUFDUixhQUFBO0FBRUQsWUFBQSxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FDbEMsQ0FBQyxLQUFLLEtBQXFCLEtBQUssWUFBWUQsY0FBSyxDQUNsRCxDQUFDO1lBQ0YsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO0FBRXJCLFlBQUEsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUU7Z0JBQ3hCLElBQUk7b0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGlCQUFBLEVBQW9CLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDN0Msb0JBQUEsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ2hELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7b0JBRzFELE1BQU0sa0JBQWtCLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsS0FDakQsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUM5QyxDQUFDOztBQUdGLG9CQUFBLE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQ3BDLENBQUMsR0FBRyxLQUFLLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUMzQyxDQUFDOztvQkFHRixNQUFNLFdBQVcsR0FBRyxDQUFDLEdBQUcsVUFBVSxFQUFFLEdBQUcsaUJBQWlCLENBQUMsQ0FBQzs7b0JBRzFELElBQ0UsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLENBQUM7d0JBQ25DLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQ2xDO0FBQ0Esd0JBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGVBQUEsRUFBa0IsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUN6RCx3QkFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsYUFBQSxFQUFnQixVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3JELHdCQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxjQUFBLEVBQWlCLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7d0JBRXZELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7QUFDdEUsd0JBQUEsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGNBQWMsQ0FBQyxDQUFDO0FBQ2xELHdCQUFBLFlBQVksRUFBRSxDQUFDO3dCQUNmLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSx1QkFBQSxFQUEwQixJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3BELHFCQUFBO0FBQU0seUJBQUE7d0JBQ0wsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLDRCQUFBLEVBQStCLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDekQscUJBQUE7QUFDRixpQkFBQTtBQUFDLGdCQUFBLE9BQU8sS0FBSyxFQUFFO29CQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBeUIsc0JBQUEsRUFBQSxJQUFJLENBQUMsSUFBSSxDQUFHLENBQUEsQ0FBQSxFQUFFLEtBQUssQ0FBQyxDQUFDO29CQUM1RCxJQUFJQyxlQUFNLENBQUMsQ0FBaUMsOEJBQUEsRUFBQSxJQUFJLENBQUMsSUFBSSxDQUFBLENBQUUsQ0FBQyxDQUFDO0FBQzFELGlCQUFBO0FBQ0YsYUFBQTtZQUVELElBQUksWUFBWSxHQUFHLENBQUMsRUFBRTtnQkFDcEIsSUFBSUEsZUFBTSxDQUFDLENBQUEsaUJBQUEsRUFBb0IsWUFBWSxDQUFBLFlBQUEsRUFBZSxNQUFNLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQzFFLGFBQUE7QUFBTSxpQkFBQTtnQkFDTCxJQUFJQSxlQUFNLENBQUMsQ0FBa0MsK0JBQUEsRUFBQSxNQUFNLENBQUMsSUFBSSxDQUFBLENBQUUsQ0FBQyxDQUFDO0FBQzdELGFBQUE7U0FDRixDQUFBLENBQUE7QUFBQSxLQUFBOztBQUdPLElBQUEsY0FBYyxDQUFDLEdBQVcsRUFBQTtRQUNoQyxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsS0FDcEQsVUFBVSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FDekIsQ0FBQztLQUNIO0lBRUssa0JBQWtCLENBQUMsSUFBVyxFQUFFLFlBQXNCLEVBQUE7O1lBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxnQ0FBQSxFQUFtQyxJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQzVELFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGdCQUFBLEVBQW1CLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFFMUQsWUFBQSxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNoRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsT0FBTyxDQUFDLENBQUM7QUFFMUQsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsZUFBQSxFQUFrQixZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDOztBQUd6RCxZQUFBLE1BQU0sV0FBVyxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQ3JDLENBQUMsR0FBRyxLQUFLLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FDckMsQ0FBQztBQUVGLFlBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGNBQUEsRUFBaUIsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBRSxDQUFBLENBQUMsQ0FBQzs7QUFHdkQsWUFBQSxJQUFJLGNBQXNCLENBQUM7QUFDM0IsWUFBQSxJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUMxQixjQUFjLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQztBQUNqRSxhQUFBO0FBQU0saUJBQUE7O0FBRUwsZ0JBQUEsY0FBYyxHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUN0RCxhQUFBOztZQUdELElBQUksT0FBTyxLQUFLLGNBQWMsRUFBRTtBQUM5QixnQkFBQSxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUM7Z0JBQ2xELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSwwQkFBQSxFQUE2QixJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO2dCQUN0RCxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztnQkFDOUIsSUFBSUEsZUFBTSxDQUFDLENBQWtDLCtCQUFBLEVBQUEsSUFBSSxDQUFDLElBQUksQ0FBQSxDQUFFLENBQUMsQ0FBQztBQUMzRCxhQUFBO0FBQU0saUJBQUE7Z0JBQ0wsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLDRCQUFBLEVBQStCLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDekQsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFRCxJQUFBLHFCQUFxQixDQUFDLE9BQWUsRUFBQTtRQUNuQyxNQUFNLGdCQUFnQixHQUFHLHVCQUF1QixDQUFDO1FBQ2pELE9BQU8sT0FBTyxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLENBQUMsQ0FBQztLQUM5QztBQUVELElBQUEscUJBQXFCLENBQUMsSUFBVyxFQUFBO1FBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNsRCxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxLQUMzQyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FDaEMsQ0FBQztRQUNGLE9BQU8sT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUUsSUFBSSxLQUFLLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssS0FBSyxDQUFDLENBQUM7S0FDMUU7QUFFRCxJQUFBLGdCQUFnQixDQUFDLElBQVcsRUFBQTtRQUMxQixNQUFNLE9BQU8sR0FBYyxFQUFFLENBQUM7QUFDOUIsUUFBQSxJQUFJLGFBQWEsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDO0FBQ2hDLFFBQUEsT0FBTyxhQUFhLEVBQUU7QUFDcEIsWUFBQSxPQUFPLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0FBQzVCLFlBQUEsYUFBYSxHQUFHLGFBQWEsQ0FBQyxNQUFNLENBQUM7QUFDdEMsU0FBQTtBQUNELFFBQUEsT0FBTyxPQUFPLENBQUM7S0FDaEI7QUFFTyxJQUFBLG1CQUFtQixDQUFDLElBQWMsRUFBQTtRQUN4QyxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0tBQzNCO0lBRUQsaUJBQWlCLEdBQUE7OztBQUdmLFFBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsZUFBZSxDQUFDLGVBQWUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksS0FBSTtBQUNuRSxZQUFBLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLElBQVcsQ0FBQztBQUMxQyxZQUFBLE1BQU0sU0FBUyxHQUFHLGdCQUFnQixDQUFDLFNBQVMsQ0FBQztBQUM3QyxZQUFBLEtBQUssTUFBTSxHQUFHLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUU7Z0JBQ2hELElBQUksSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQ3BELG9CQUFBLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxFQUFpQixDQUFDO29CQUN4QyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLDJCQUEyQixDQUFDLENBQUM7QUFDbkUsb0JBQUEsSUFBSSxNQUFNLEVBQUU7QUFDVix3QkFBQSxNQUFNLENBQUMsV0FBVyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQ3BDLHdCQUFBLE1BQU0sQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLENBQUM7O0FBRXJDLHdCQUFBLE1BQU0sQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDdEMscUJBQUE7QUFDRixpQkFBQTtBQUNGLGFBQUE7QUFDSCxTQUFDLENBQUMsQ0FBQztLQUNKO0FBRUssSUFBQSxrQkFBa0IsQ0FBQyxJQUFXLEVBQUE7OztZQUVsQyxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUU7QUFDcEIsZ0JBQUEsWUFBWSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUNoQyxhQUFBO0FBQ0QsWUFBQSxJQUFJLENBQUMsV0FBVyxHQUFHLFVBQVUsQ0FBQyxNQUFXLFNBQUEsQ0FBQSxJQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsYUFBQTs7QUFFekMsYUFBQyxDQUFBLEVBQUUsR0FBRyxDQUFDLENBQUM7U0FDVCxDQUFBLENBQUE7QUFBQSxLQUFBO0FBRUssSUFBQSxlQUFlLENBQUMsT0FBWSxFQUFBOztBQUNoQyxZQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMscUNBQXFDLENBQUMsQ0FBQzs7QUFFbkQsWUFBQSxPQUFBLE1BQUEsQ0FBQSxNQUFBLENBQUEsTUFBQSxDQUFBLE1BQUEsQ0FBQSxFQUFBLEVBQ0ssZ0JBQWdCLENBQ2hCLEVBQUE7QUFDRCxnQkFBQSxlQUFlLEVBQ2IsT0FBTyxDQUFDLGVBQWUsSUFBSSxnQkFBZ0IsQ0FBQyxlQUFlO0FBQzdELGdCQUFBLGVBQWUsRUFDYixPQUFPLENBQUMsZUFBZSxJQUFJLGdCQUFnQixDQUFDLGVBQWU7QUFDN0QsZ0JBQUEsZUFBZSxFQUNiLE9BQU8sQ0FBQyxlQUFlLElBQUksZ0JBQWdCLENBQUMsZUFBZTtBQUM3RCxnQkFBQSxhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWEsSUFBSSxnQkFBZ0IsQ0FBQyxhQUFhO0FBQ3RFLGdCQUFBLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUyxJQUFJLGdCQUFnQixDQUFDLFNBQVM7YUFDM0QsQ0FDRCxDQUFBO1NBQ0gsQ0FBQSxDQUFBO0FBQUEsS0FBQTtBQUVLLElBQUEsMkJBQTJCLENBQUMsTUFBZSxFQUFBOztBQUMvQyxZQUFBLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUNsQyxDQUFDLEtBQUssS0FBcUIsS0FBSyxZQUFZRCxjQUFLLENBQ2xELENBQUM7WUFDRixJQUFJLGNBQWMsR0FBRyxDQUFDLENBQUM7WUFDdkIsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBRXhCLFlBQUEsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUU7Z0JBQ3hCLElBQUk7b0JBQ0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGVBQUEsRUFBa0IsSUFBSSxDQUFDLElBQUksQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUMzQyxvQkFBQSxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQzs7b0JBR2hELE1BQU0sZ0JBQWdCLEdBQUcsdUJBQXVCLENBQUM7b0JBQ2pELE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0FBRXpELG9CQUFBLElBQUksZ0JBQWdCLEVBQUU7QUFDcEIsd0JBQUEsTUFBTSxXQUFXLEdBQUcsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUM7d0JBQ3hDLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQzs7d0JBRzFELE1BQU0sVUFBVSxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO0FBRTlDLHdCQUFBLElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxZQUFZLENBQUMsTUFBTSxFQUFFOzRCQUMzQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsMEJBQUEsRUFBNkIsSUFBSSxDQUFDLElBQUksQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUN0RCw0QkFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsZUFBQSxFQUFrQixZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3pELDRCQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxhQUFBLEVBQWdCLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQSxDQUFDLENBQUM7OzRCQUdyRCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQzdDLE9BQU8sRUFDUCxVQUFVLENBQ1gsQ0FBQztBQUNGLDRCQUFBLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLENBQUMsQ0FBQztBQUNsRCw0QkFBQSxlQUFlLEVBQUUsQ0FBQzs0QkFDbEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBLGtDQUFBLEVBQXFDLElBQUksQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDL0QseUJBQUE7QUFDRixxQkFBQTtBQUNELG9CQUFBLGNBQWMsRUFBRSxDQUFDO0FBQ2xCLGlCQUFBO0FBQUMsZ0JBQUEsT0FBTyxLQUFLLEVBQUU7b0JBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUF5QixzQkFBQSxFQUFBLElBQUksQ0FBQyxJQUFJLENBQUcsQ0FBQSxDQUFBLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDN0QsaUJBQUE7QUFDRixhQUFBO1lBRUQsSUFBSSxlQUFlLEdBQUcsQ0FBQyxFQUFFO2dCQUN2QixJQUFJQyxlQUFNLENBQ1IsQ0FBMkIsd0JBQUEsRUFBQSxlQUFlLFdBQVcsY0FBYyxDQUFBLE9BQUEsQ0FBUyxDQUM3RSxDQUFDO0FBQ0gsYUFBQTtBQUFNLGlCQUFBO0FBQ0wsZ0JBQUEsSUFBSUEsZUFBTSxDQUFDLENBQUEsdUJBQUEsRUFBMEIsY0FBYyxDQUFBLE9BQUEsQ0FBUyxDQUFDLENBQUM7QUFDL0QsYUFBQTtTQUNGLENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFSyxJQUFBLDRCQUE0QixDQUFDLEtBQWMsRUFBQTs7WUFDL0MsSUFBSSxjQUFjLEdBQUcsQ0FBQyxDQUFDO1lBQ3ZCLElBQUksWUFBWSxHQUFHLENBQUMsQ0FBQztZQUNyQixJQUFJLFVBQVUsR0FBRyxDQUFDLENBQUM7WUFDbkIsTUFBTSxNQUFNLEdBQWEsRUFBRSxDQUFDO0FBRTVCLFlBQUEsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUU7Z0JBQ3hCLElBQUk7b0JBQ0YsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsRUFBRSxLQUFLLElBQUksRUFBRTt3QkFDekMsU0FBUztBQUNWLHFCQUFBO29CQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQSxpQkFBQSxFQUFvQixJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQzdDLG9CQUFBLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDOztvQkFHaEQsTUFBTSxnQkFBZ0IsR0FBRyx1QkFBdUIsQ0FBQztvQkFDakQsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7b0JBQ3pELE1BQU0sa0JBQWtCLEdBQUcsZ0JBQWdCOzBCQUN2QyxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQzswQkFDekMsT0FBTyxDQUFDOztBQUdaLG9CQUFBLE1BQU0sZUFBZSxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO29CQUNyRSxNQUFNLFVBQVUsR0FBRyxlQUFlLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO29CQUV0RCxJQUFJLENBQUMsVUFBVSxFQUFFO3dCQUNmLE9BQU8sQ0FBQyxHQUFHLENBQ1QsQ0FBQSw4Q0FBQSxFQUFpRCxJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FDN0QsQ0FBQzt3QkFDRixTQUFTO0FBQ1YscUJBQUE7QUFFRCxvQkFBQSxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxLQUFLLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDMUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQzFELG9CQUFBLE1BQU0sT0FBTyxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsWUFBWSxFQUFFLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDOztvQkFHNUQsSUFBSSxjQUFjLEdBQUcsT0FBTyxDQUFDO0FBQzdCLG9CQUFBLElBQUksZ0JBQWdCLEVBQUU7d0JBQ3BCLE1BQU0sWUFBWSxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQzt3QkFDcEQsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTtBQUN6RCw0QkFBQSxZQUFZLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDbkUseUJBQUE7d0JBQ0QsY0FBYztBQUNaLDRCQUFBLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQ3ZFLHFCQUFBO0FBQU0seUJBQUE7d0JBQ0wsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQzt3QkFDekMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTtBQUN6RCw0QkFBQSxZQUFZLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDbkUseUJBQUE7QUFDRCx3QkFBQSxjQUFjLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDaEUscUJBQUE7O29CQUdELGNBQWMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsY0FBYyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQ25FLG9CQUFBLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLENBQUMsQ0FBQztBQUVsRCxvQkFBQSxZQUFZLEVBQUUsQ0FBQztvQkFDZixPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsZ0NBQUEsRUFBbUMsSUFBSSxDQUFDLElBQUksQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUM3RCxpQkFBQTtBQUFDLGdCQUFBLE9BQU8sS0FBSyxFQUFFO29CQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBeUIsc0JBQUEsRUFBQSxJQUFJLENBQUMsSUFBSSxDQUFHLENBQUEsQ0FBQSxFQUFFLEtBQUssQ0FBQyxDQUFDO0FBQzVELG9CQUFBLFVBQVUsRUFBRSxDQUFDO0FBQ2Isb0JBQUEsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDeEIsaUJBQUE7QUFDRCxnQkFBQSxjQUFjLEVBQUUsQ0FBQztBQUNsQixhQUFBOztBQUdELFlBQUEsSUFBSSwwQkFBMEIsQ0FDNUIsSUFBSSxDQUFDLEdBQUcsRUFDUixjQUFjLEVBQ2QsWUFBWSxFQUNaLFVBQVUsRUFDVixNQUFNLENBQ1AsQ0FBQyxJQUFJLEVBQUUsQ0FBQztTQUNWLENBQUEsQ0FBQTtBQUFBLEtBQUE7QUFFSyxJQUFBLDRCQUE0QixDQUFDLEtBQWMsRUFBQTs7QUFDL0MsWUFBQSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsMEJBQTBCLEVBQUU7QUFDNUMsZ0JBQUEsSUFBSSwyQkFBMkIsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUMvRCxhQUFBO0FBQU0saUJBQUE7QUFDTCxnQkFBQSxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNoRCxhQUFBO1NBQ0YsQ0FBQSxDQUFBO0FBQUEsS0FBQTtBQUVPLElBQUEsZUFBZSxDQUFDLE9BQWUsRUFBQTtBQUNyQyxRQUFBLE9BQU8sT0FBTzthQUNYLEtBQUssQ0FBQyxJQUFJLENBQUM7YUFDWCxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssS0FBSTs7WUFFN0IsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFO0FBQUUsZ0JBQUEsT0FBTyxJQUFJLENBQUM7O1lBRTdCLElBQUksS0FBSyxHQUFHLENBQUMsSUFBSSxLQUFLLEdBQUcsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7Z0JBQ3pDLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ3pDLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ3pDLE9BQU8sUUFBUSxJQUFJLFFBQVEsQ0FBQztBQUM3QixhQUFBO0FBQ0QsWUFBQSxPQUFPLEtBQUssQ0FBQztBQUNmLFNBQUMsQ0FBQzthQUNELElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztLQUNmO0FBQ0YsQ0FBQTtBQUVELE1BQU0sY0FBZSxTQUFRQyxjQUFLLENBQUE7QUFRaEMsSUFBQSxXQUFBLENBQ0UsR0FBUSxFQUNSLE1BQWUsRUFDZixNQUFtQixFQUNuQixjQUF1QixLQUFLLEVBQUE7UUFFNUIsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBVGIsSUFBSSxDQUFBLElBQUEsR0FBVyxFQUFFLENBQUM7QUFVaEIsUUFBQSxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztBQUNyQixRQUFBLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0FBQ3JCLFFBQUEsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUM7S0FDaEM7SUFFRCxNQUFNLEdBQUE7QUFDSixRQUFBLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFDM0IsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBRWxCLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLHNCQUFzQixFQUFFLENBQUMsQ0FBQzs7QUFHM0QsUUFBQSxJQUFJQyxnQkFBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEtBQUk7QUFDN0QsWUFBQSxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQztZQUM1QixJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDaEMsWUFBQSxJQUFJLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQ3RFLFlBQUEsT0FBTyxJQUFJLENBQUM7QUFDZCxTQUFDLENBQUMsQ0FBQzs7QUFHSCxRQUFBLElBQUlBLGdCQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksS0FBSTtBQUN0RCxZQUFBLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDO0FBQ3RCLFlBQUEsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNqRSxJQUFJLENBQUMsSUFBSSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDcEMsWUFBQSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUN6QixJQUFJLENBQUMsY0FBYyxDQUFDLDZCQUE2QixDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxLQUFJO0FBQ3BFLGdCQUFBLElBQUksQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDO0FBQ3BCLGFBQUMsQ0FBQyxDQUFDO0FBQ0gsWUFBQSxJQUFJLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQ3RFLFlBQUEsT0FBTyxJQUFJLENBQUM7QUFDZCxTQUFDLENBQUMsQ0FBQzs7UUFHSCxJQUFJQSxnQkFBTyxDQUFDLFNBQVMsQ0FBQztBQUNuQixhQUFBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDYixHQUFHLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFLO1lBQ3ZDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUNmLFNBQUMsQ0FBQyxDQUNIO0FBQ0EsYUFBQSxTQUFTLENBQUMsQ0FBQyxHQUFHLEtBQ2IsR0FBRzthQUNBLGFBQWEsQ0FBQyxNQUFNLENBQUM7QUFDckIsYUFBQSxNQUFNLEVBQUU7YUFDUixPQUFPLENBQUMsTUFBSztZQUNaLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztTQUN2QixDQUFDLENBQ0wsQ0FBQztLQUNMO0FBRUQsSUFBQSxXQUFXLENBQUMsS0FBb0IsRUFBQTtRQUM5QixJQUFJLEtBQUssQ0FBQyxHQUFHLEtBQUssT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRTtZQUM1QyxLQUFLLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO0FBQ3ZCLFNBQUE7S0FDRjtJQUVLLGNBQWMsR0FBQTs7WUFDbEIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxRQUFRLEVBQUUsQ0FBQztBQUN0RCxZQUFBLElBQUksVUFBVSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDO0FBRWxDLFlBQUEsSUFBSSxhQUFhLEtBQUssSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7Z0JBQ3RDLElBQUk7QUFDRixvQkFBQSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU07MEJBQzlCLENBQUcsRUFBQSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUksQ0FBQSxFQUFBLGFBQWEsQ0FBRSxDQUFBOzBCQUM3QyxhQUFhLENBQUM7QUFDbEIsb0JBQUEsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQztBQUM1RCxvQkFBQSxPQUFPLENBQUMsR0FBRyxDQUNULENBQUEsb0JBQUEsRUFBdUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUEsSUFBQSxFQUFPLGFBQWEsQ0FBQSxDQUFFLENBQzlELENBQUM7O0FBR0Ysb0JBQUEsTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sS0FBSyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7O0FBR3pELG9CQUFBLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDO29CQUNoRSxJQUFJLFNBQVMsWUFBWUosZ0JBQU8sRUFBRTtBQUNoQyx3QkFBQSxJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQzt3QkFDeEIsVUFBVSxHQUFHLE9BQU8sQ0FBQztBQUN0QixxQkFBQTtBQUFNLHlCQUFBO0FBQ0wsd0JBQUEsT0FBTyxDQUFDLElBQUksQ0FDVixvREFBb0QsT0FBTyxDQUFBLENBQUUsQ0FDOUQsQ0FBQzt3QkFDRixVQUFVLEdBQUcsT0FBTyxDQUFDO0FBQ3RCLHFCQUFBO0FBQ0YsaUJBQUE7QUFBQyxnQkFBQSxPQUFPLEtBQUssRUFBRTtBQUNkLG9CQUFBLE9BQU8sQ0FBQyxLQUFLLENBQUMsNEJBQTRCLEtBQUssQ0FBQSxDQUFFLENBQUMsQ0FBQztBQUNuRCxvQkFBQSxJQUFJRSxlQUFNLENBQUMsQ0FBQSx5QkFBQSxFQUE0QixLQUFLLENBQUEsQ0FBRSxDQUFDLENBQUM7O0FBRWpELGlCQUFBO0FBQ0YsYUFBQTs7WUFHRCxVQUFVLEdBQUcsVUFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7QUFFNUMsWUFBQSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsSUFBSTtpQkFDdkIsS0FBSyxDQUFDLEdBQUcsQ0FBQztpQkFDVixHQUFHLENBQUMsQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDO2lCQUN4QixNQUFNLENBQUMsQ0FBQyxHQUFHLEtBQUssR0FBRyxLQUFLLEVBQUUsQ0FBQyxDQUFDOztBQUcvQixZQUFBLE1BQU0sY0FBYyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEtBQUssT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ25FLFlBQUEsSUFBSSxjQUFjLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDN0IsSUFBSUEsZUFBTSxDQUNSLENBQUEsd0RBQUEsRUFBMkQsY0FBYyxDQUFDLElBQUksQ0FDNUUsSUFBSSxDQUNMLENBQUUsQ0FBQSxDQUNKLENBQUM7Z0JBQ0YsT0FBTztBQUNSLGFBQUE7WUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFDaEQsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUEsc0JBQUEsRUFBeUIsVUFBVSxDQUFLLEVBQUEsRUFBQSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBLENBQUUsQ0FBQyxDQUFDO0FBQzNFLFlBQUEsSUFBSUEsZUFBTSxDQUFDLENBQUEsdUJBQUEsRUFBMEIsVUFBVSxDQUFBLENBQUUsQ0FBQyxDQUFDO1lBRW5ELElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRTtnQkFDcEIsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLHlCQUF5QixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUN6RCxnQkFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLDJDQUEyQyxVQUFVLENBQUEsQ0FBRSxDQUFDLENBQUM7QUFDdEUsYUFBQTtZQUVELElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUNkLENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFRCxPQUFPLEdBQUE7QUFDTCxRQUFBLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFDM0IsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0tBQ25CO0FBQ0YsQ0FBQTtBQUVELE1BQU0sZUFBZ0IsU0FBUUcseUJBQWdCLENBQUE7SUFHNUMsV0FBWSxDQUFBLEdBQVEsRUFBRSxNQUFtQixFQUFBO0FBQ3ZDLFFBQUEsS0FBSyxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQztBQUNuQixRQUFBLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0tBQ3RCO0lBRUQsT0FBTyxHQUFBO0FBQ0wsUUFBQSxNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBQzdCLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQzs7UUFHcEIsTUFBTSxhQUFhLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO1FBQ3BFLGFBQWEsQ0FBQyxTQUFTLEdBQUcsQ0FBQTs7Ozs7Ozs7Ozs7S0FXekIsQ0FBQzs7O1FBS0YsSUFBSUQsZ0JBQU8sQ0FBQyxXQUFXLENBQUM7YUFDckIsT0FBTyxDQUFDLHNCQUFzQixDQUFDO2FBQy9CLE9BQU8sQ0FBQyxpREFBaUQsQ0FBQztBQUMxRCxhQUFBLFdBQVcsQ0FBQyxDQUFDLFFBQVEsS0FDcEIsUUFBUTtBQUNMLGFBQUEsU0FBUyxDQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQztBQUNuQyxhQUFBLFNBQVMsQ0FBQyxXQUFXLEVBQUUsK0JBQStCLENBQUM7QUFDdkQsYUFBQSxTQUFTLENBQUMsS0FBSyxFQUFFLDBCQUEwQixDQUFDO2FBQzVDLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUM7QUFDOUMsYUFBQSxRQUFRLENBQUMsQ0FBTyxLQUFLLEtBQUksU0FBQSxDQUFBLElBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxhQUFBO1lBQ3hCLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLGVBQWUsR0FBRyxLQUc5QixDQUFDO0FBQ1YsWUFBQSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7U0FDbEMsQ0FBQSxDQUFDLENBQ0wsQ0FBQztRQUVKLElBQUlBLGdCQUFPLENBQUMsV0FBVyxDQUFDO2FBQ3JCLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQzthQUMzQixPQUFPLENBQ04sbUVBQW1FLENBQ3BFO0FBQ0EsYUFBQSxXQUFXLENBQUMsQ0FBQyxJQUFJLEtBQ2hCLElBQUk7YUFDRCxjQUFjLENBQUMsNEJBQTRCLENBQUM7QUFDNUMsYUFBQSxRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN6RCxhQUFBLFFBQVEsQ0FBQyxDQUFPLEtBQUssS0FBSSxTQUFBLENBQUEsSUFBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLGFBQUE7QUFDeEIsWUFBQSxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxlQUFlLEdBQUcsS0FBSztpQkFDekMsS0FBSyxDQUFDLElBQUksQ0FBQztBQUNYLGlCQUFBLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7QUFDbEMsWUFBQSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7U0FDbEMsQ0FBQSxDQUFDLENBQ0wsQ0FBQztRQUVKLElBQUlBLGdCQUFPLENBQUMsV0FBVyxDQUFDO2FBQ3JCLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQzthQUM1QixPQUFPLENBQUMseUNBQXlDLENBQUM7QUFDbEQsYUFBQSxTQUFTLENBQUMsQ0FBQyxNQUFNLEtBQ2hCLE1BQU07YUFDSCxRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDO0FBQzlDLGFBQUEsUUFBUSxDQUFDLENBQU8sS0FBSyxLQUFJLFNBQUEsQ0FBQSxJQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsYUFBQTtZQUN4QixJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxlQUFlLEdBQUcsS0FBSyxDQUFDO0FBQzdDLFlBQUEsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDO0FBQ2pDLFlBQUEsSUFBSSxLQUFLLEVBQUU7QUFDVCxnQkFBQSxJQUFJLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLENBQUM7QUFDakMsYUFBQTtBQUFNLGlCQUFBO0FBQ0wsZ0JBQUEsSUFBSSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0FBQ2pDLGFBQUE7U0FDRixDQUFBLENBQUMsQ0FDTCxDQUFDO1FBRUosSUFBSUEsZ0JBQU8sQ0FBQyxXQUFXLENBQUM7YUFDckIsT0FBTyxDQUFDLGlCQUFpQixDQUFDO2FBQzFCLE9BQU8sQ0FBQyw4Q0FBOEMsQ0FBQztBQUN2RCxhQUFBLFNBQVMsQ0FBQyxDQUFDLE1BQU0sS0FDaEIsTUFBTTthQUNILFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUM7QUFDNUMsYUFBQSxRQUFRLENBQUMsQ0FBTyxLQUFLLEtBQUksU0FBQSxDQUFBLElBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxhQUFBO1lBQ3hCLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUM7QUFDM0MsWUFBQSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7U0FDbEMsQ0FBQSxDQUFDLENBQ0wsQ0FBQztRQUVKLElBQUlBLGdCQUFPLENBQUMsV0FBVyxDQUFDO2FBQ3JCLE9BQU8sQ0FBQyxZQUFZLENBQUM7YUFDckIsT0FBTyxDQUFDLDZDQUE2QyxDQUFDO0FBQ3RELGFBQUEsU0FBUyxDQUFDLENBQUMsTUFBTSxLQUNoQixNQUFNO2FBQ0gsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztBQUN4QyxhQUFBLFFBQVEsQ0FBQyxDQUFPLEtBQUssS0FBSSxTQUFBLENBQUEsSUFBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLGFBQUE7WUFDeEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQztBQUN2QyxZQUFBLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQztTQUNsQyxDQUFBLENBQUMsQ0FDTCxDQUFDOztRQUdKLElBQUlBLGdCQUFPLENBQUMsV0FBVyxDQUFDO2FBQ3JCLE9BQU8sQ0FBQywwQkFBMEIsQ0FBQzthQUNuQyxPQUFPLENBQUMsMkRBQTJELENBQUM7QUFDcEUsYUFBQSxTQUFTLENBQUMsQ0FBQyxNQUFNLEtBQ2hCLE1BQU0sQ0FBQyxhQUFhLENBQUMsZUFBZSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQVcsU0FBQSxDQUFBLElBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxhQUFBO1lBQ3ZELElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLDBCQUEwQixHQUFHLElBQUksQ0FBQztBQUN2RCxZQUFBLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQztBQUNqQyxZQUFBLElBQUlGLGVBQU0sQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFDO1NBQzVELENBQUEsQ0FBQyxDQUNILENBQUM7S0FDTDtBQUNGLENBQUE7QUFFRCxNQUFNLGlCQUFrQixTQUFRQyxjQUFLLENBQUE7QUFJbkMsSUFBQSxXQUFBLENBQVksR0FBUSxFQUFFLE9BQWUsRUFBRSxTQUFxQixFQUFBO1FBQzFELEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNYLFFBQUEsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7QUFDdkIsUUFBQSxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztLQUM1QjtJQUVELE1BQU0sR0FBQTtBQUNKLFFBQUEsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQztRQUMzQixTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDbEIsUUFBQSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUVoRCxJQUFJQyxnQkFBTyxDQUFDLFNBQVMsQ0FBQztBQUNuQixhQUFBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDYixHQUFHLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFLO1lBQ3ZDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUNmLFNBQUMsQ0FBQyxDQUNIO0FBQ0EsYUFBQSxTQUFTLENBQUMsQ0FBQyxHQUFHLEtBQ2IsR0FBRzthQUNBLGFBQWEsQ0FBQyxTQUFTLENBQUM7QUFDeEIsYUFBQSxNQUFNLEVBQUU7YUFDUixPQUFPLENBQUMsTUFBSztZQUNaLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztTQUNsQixDQUFDLENBQ0wsQ0FBQztLQUNMO0lBRUQsT0FBTyxHQUFBO0FBQ0wsUUFBQSxNQUFNLEVBQUUsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBQzNCLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztLQUNuQjtBQUNGLENBQUE7QUFFRCxNQUFNLGlCQUFrQixTQUFRRCxjQUFLLENBQUE7QUFLbkMsSUFBQSxXQUFBLENBQ0UsR0FBUSxFQUNSLE9BQWUsRUFDZixJQUFjLEVBQ2QsU0FBMkMsRUFBQTtRQUUzQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDWCxRQUFBLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO0FBQ3ZCLFFBQUEsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7QUFDakIsUUFBQSxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztLQUM1QjtJQUVELE1BQU0sR0FBQTtBQUNKLFFBQUEsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQztRQUMzQixTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDbEIsUUFBQSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUVoRCxNQUFNLFlBQVksR0FBRyxTQUFTLENBQUMsU0FBUyxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQzFELElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxLQUFJO0FBQ3hCLFlBQUEsTUFBTSxLQUFLLEdBQUcsWUFBWSxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUMzRCxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7QUFDaEMsWUFBQSxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0FBQzdELFlBQUEsWUFBWSxDQUFDLE9BQU8sR0FBRyxNQUFLO0FBQzFCLGdCQUFBLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDO2dCQUMvQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7QUFDakIsYUFBQyxDQUFDO0FBQ0osU0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJQyxnQkFBTyxDQUFDLFNBQVMsQ0FBQztBQUNuQixhQUFBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDYixHQUFHLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFLO1lBQ3ZDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUNmLFNBQUMsQ0FBQyxDQUNIO0FBQ0EsYUFBQSxTQUFTLENBQUMsQ0FBQyxHQUFHLEtBQ2IsR0FBRzthQUNBLGFBQWEsQ0FBQyxTQUFTLENBQUM7QUFDeEIsYUFBQSxNQUFNLEVBQUU7YUFDUixPQUFPLENBQUMsTUFBSztZQUNaLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUNiLFlBQUEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7U0FDM0IsQ0FBQyxDQUNMLENBQUM7S0FDTDtJQUVELE9BQU8sR0FBQTtBQUNMLFFBQUEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUN2QixRQUFBLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUM7S0FDdEI7QUFDRixDQUFBO0FBRUQsTUFBTSxjQUFlLFNBQVFELGNBQUssQ0FBQTtJQU1oQyxXQUNFLENBQUEsR0FBUSxFQUNSLElBQVcsRUFDWCxPQUFpQixFQUNqQixPQUFpQixFQUNqQixNQUFtQixFQUFBO1FBRW5CLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNYLFFBQUEsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7QUFDakIsUUFBQSxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztBQUN2QixRQUFBLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO0FBQ3ZCLFFBQUEsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7S0FDdEI7SUFFRCxNQUFNLEdBQUE7QUFDSixRQUFBLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFDM0IsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBRWxCLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxDQUFDLENBQUM7QUFDakQsUUFBQSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRTtBQUN0QixZQUFBLElBQUksRUFBRSxDQUFTLE1BQUEsRUFBQSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBbUIsaUJBQUEsQ0FBQTtBQUNqRCxTQUFBLENBQUMsQ0FBQztRQUNILFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFLEVBQUUsSUFBSSxFQUFFLHdDQUF3QyxFQUFFLENBQUMsQ0FBQztRQUU1RSxJQUFJQyxnQkFBTyxDQUFDLFNBQVMsQ0FBQzthQUNuQixPQUFPLENBQUMsYUFBYSxDQUFDO2FBQ3RCLE9BQU8sQ0FBQyxnREFBZ0QsQ0FBQztBQUN6RCxhQUFBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDYixHQUFHO2FBQ0EsYUFBYSxDQUFDLGFBQWEsQ0FBQztBQUM1QixhQUFBLE1BQU0sRUFBRTthQUNSLE9BQU8sQ0FBQyxNQUFLO0FBQ1osWUFBQSxJQUFJLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNwRCxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7U0FDZCxDQUFDLENBQ0wsQ0FBQztRQUVKLElBQUlBLGdCQUFPLENBQUMsU0FBUyxDQUFDO2FBQ25CLE9BQU8sQ0FBQyxPQUFPLENBQUM7YUFDaEIsT0FBTyxDQUFDLDRDQUE0QyxDQUFDO0FBQ3JELGFBQUEsU0FBUyxDQUFDLENBQUMsR0FBRyxLQUNiLEdBQUc7YUFDQSxhQUFhLENBQUMsT0FBTyxDQUFDO0FBQ3RCLGFBQUEsTUFBTSxFQUFFO2FBQ1IsT0FBTyxDQUFDLE1BQUs7QUFDWixZQUFBLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDN0QsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1NBQ2QsQ0FBQyxDQUNMLENBQUM7UUFFSixJQUFJQSxnQkFBTyxDQUFDLFNBQVMsQ0FBQzthQUNuQixPQUFPLENBQUMsV0FBVyxDQUFDO2FBQ3BCLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQztBQUNoQyxhQUFBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDYixHQUFHLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFLO1lBQzFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUNkLENBQUMsQ0FDSCxDQUFDO0tBQ0w7SUFFRCxPQUFPLEdBQUE7QUFDTCxRQUFBLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFDM0IsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0tBQ25CO0FBQ0YsQ0FBQTtBQUVELE1BQU0sdUJBQXdCLFNBQVFELGNBQUssQ0FBQTtBQUt6QyxJQUFBLFdBQUEsQ0FDRSxHQUFRLEVBQ1IsSUFBVyxFQUNYLGVBQXlCLEVBQ3pCLE1BQW1CLEVBQUE7UUFFbkIsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ1gsUUFBQSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztBQUNqQixRQUFBLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxDQUFDO0FBQ3ZDLFFBQUEsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7S0FDdEI7SUFFRCxNQUFNLEdBQUE7QUFDSixRQUFBLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFDM0IsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBRWxCLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLHVCQUF1QixFQUFFLENBQUMsQ0FBQztBQUM1RCxRQUFBLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFO0FBQ3RCLFlBQUEsSUFBSSxFQUFFLENBQTZELDJEQUFBLENBQUE7QUFDcEUsU0FBQSxDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8sR0FBRyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3pDLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxLQUFJO1lBQ25DLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7QUFDeEMsU0FBQyxDQUFDLENBQUM7QUFFSCxRQUFBLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFO0FBQ3RCLFlBQUEsSUFBSSxFQUFFLCtDQUErQztBQUN0RCxTQUFBLENBQUMsQ0FBQztRQUVILElBQUlDLGdCQUFPLENBQUMsU0FBUyxDQUFDO2FBQ25CLE9BQU8sQ0FBQyxVQUFVLENBQUM7YUFDbkIsT0FBTyxDQUFDLHdDQUF3QyxDQUFDO0FBQ2pELGFBQUEsU0FBUyxDQUFDLENBQUMsR0FBRyxLQUNiLEdBQUc7YUFDQSxhQUFhLENBQUMsVUFBVSxDQUFDO0FBQ3pCLGFBQUEsTUFBTSxFQUFFO2FBQ1IsT0FBTyxDQUFDLE1BQUs7QUFDWixZQUFBLElBQUksQ0FBQyxlQUFlLENBQUMsU0FBUyxDQUFDLENBQUM7U0FDakMsQ0FBQyxDQUNMLENBQUM7UUFFSixJQUFJQSxnQkFBTyxDQUFDLFNBQVMsQ0FBQzthQUNuQixPQUFPLENBQUMsVUFBVSxDQUFDO2FBQ25CLE9BQU8sQ0FBQyxnREFBZ0QsQ0FBQztBQUN6RCxhQUFBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDYixHQUFHO2FBQ0EsYUFBYSxDQUFDLFVBQVUsQ0FBQztBQUN6QixhQUFBLE1BQU0sRUFBRTthQUNSLE9BQU8sQ0FBQyxNQUFLO0FBQ1osWUFBQSxJQUFJLENBQUMsZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1NBQ2pDLENBQUMsQ0FDTCxDQUFDO1FBRUosSUFBSUEsZ0JBQU8sQ0FBQyxTQUFTLENBQUM7YUFDbkIsT0FBTyxDQUFDLFlBQVksQ0FBQzthQUNyQixPQUFPLENBQUMsMENBQTBDLENBQUM7QUFDbkQsYUFBQSxTQUFTLENBQUMsQ0FBQyxHQUFHLEtBQ2IsR0FBRzthQUNBLGFBQWEsQ0FBQyxZQUFZLENBQUM7QUFDM0IsYUFBQSxNQUFNLEVBQUU7YUFDUixPQUFPLENBQUMsTUFBSztBQUNaLFlBQUEsSUFBSSxDQUFDLGVBQWUsQ0FBQyxXQUFXLENBQUMsQ0FBQztTQUNuQyxDQUFDLENBQ0wsQ0FBQztLQUNMO0FBRUssSUFBQSxlQUFlLENBQUMsVUFBK0MsRUFBQTs7QUFDbkUsWUFBQSxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsc0JBQXNCLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDakUsWUFBQSxJQUFJLFdBQXFCLENBQUM7QUFFMUIsWUFBQSxRQUFRLFVBQVU7QUFDaEIsZ0JBQUEsS0FBSyxTQUFTO29CQUNaLFdBQVcsR0FBRyxZQUFZLENBQUM7b0JBQzNCLE1BQU07QUFDUixnQkFBQSxLQUFLLFNBQVM7b0JBQ1osV0FBVyxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO29CQUN6QyxNQUFNO0FBQ1IsZ0JBQUEsS0FBSyxXQUFXO29CQUNkLFdBQVcsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUMvQixDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUM3QyxDQUFDO29CQUNGLE1BQU07QUFDVCxhQUFBO0FBRUQsWUFBQSxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLG1CQUFtQixDQUNwRCxPQUFPLEVBQ1AsV0FBVyxDQUNaLENBQUM7QUFDRixZQUFBLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsQ0FBQyxDQUFDO0FBQzlELFlBQUEsSUFBSSxDQUFDLE1BQU0sQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO1lBQ3JDLElBQUlGLGVBQU0sQ0FBQyxDQUFBLGlDQUFBLEVBQW9DLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFFLENBQUEsQ0FBQyxDQUFDO1lBQ2pFLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUNkLENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFRCxPQUFPLEdBQUE7QUFDTCxRQUFBLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFDM0IsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0tBQ25CO0FBQ0YsQ0FBQTtBQUVELE1BQU0sMEJBQTJCLFNBQVFDLGNBQUssQ0FBQTtJQU01QyxXQUNFLENBQUEsR0FBUSxFQUNSLGNBQXNCLEVBQ3RCLFlBQW9CLEVBQ3BCLFVBQWtCLEVBQ2xCLE1BQWdCLEVBQUE7UUFFaEIsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ1gsUUFBQSxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQztBQUNyQyxRQUFBLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO0FBQ2pDLFFBQUEsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7QUFDN0IsUUFBQSxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztLQUN0QjtJQUVELE1BQU0sR0FBQTtBQUNKLFFBQUEsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQztRQUMzQixTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7UUFFbEIsU0FBUyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsRUFBRSxJQUFJLEVBQUUsMkJBQTJCLEVBQUUsQ0FBQyxDQUFDO1FBRWhFLE1BQU0sY0FBYyxHQUFHLFNBQVMsQ0FBQyxTQUFTLENBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUM5RCxRQUFBLGNBQWMsQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFO0FBQzNCLFlBQUEsSUFBSSxFQUFFLENBQUEsV0FBQSxFQUFjLElBQUksQ0FBQyxjQUFjLENBQVEsTUFBQSxDQUFBO0FBQ2hELFNBQUEsQ0FBQyxDQUFDO0FBQ0gsUUFBQSxjQUFjLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRTtBQUMzQixZQUFBLElBQUksRUFBRSxDQUFBLHdCQUFBLEVBQTJCLElBQUksQ0FBQyxZQUFZLENBQVEsTUFBQSxDQUFBO0FBQzNELFNBQUEsQ0FBQyxDQUFDO0FBRUgsUUFBQSxJQUFJLElBQUksQ0FBQyxVQUFVLEdBQUcsQ0FBQyxFQUFFO1lBQ3ZCLE1BQU0sWUFBWSxHQUFHLFNBQVMsQ0FBQyxTQUFTLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDMUQsWUFBQSxZQUFZLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRTtBQUN6QixnQkFBQSxJQUFJLEVBQUUsQ0FBQSxrQkFBQSxFQUFxQixJQUFJLENBQUMsVUFBVSxDQUFTLE9BQUEsQ0FBQTtBQUNuRCxnQkFBQSxHQUFHLEVBQUUsY0FBYztBQUNwQixhQUFBLENBQUMsQ0FBQztZQUVILE1BQU0sU0FBUyxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDOUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLEtBQUk7Z0JBQy9CLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7QUFDL0MsYUFBQyxDQUFDLENBQUM7QUFDSixTQUFBO0FBRUQsUUFBQSxJQUFJQyxnQkFBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDbkMsR0FBRzthQUNBLGFBQWEsQ0FBQyxPQUFPLENBQUM7QUFDdEIsYUFBQSxNQUFNLEVBQUU7YUFDUixPQUFPLENBQUMsTUFBSztZQUNaLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUNkLENBQUMsQ0FDTCxDQUFDO0tBQ0g7SUFFRCxPQUFPLEdBQUE7QUFDTCxRQUFBLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFDM0IsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0tBQ25CO0FBQ0YsQ0FBQTtBQUVELE1BQU0sMkJBQTRCLFNBQVFELGNBQUssQ0FBQTtBQUk3QyxJQUFBLFdBQUEsQ0FBWSxHQUFRLEVBQUUsS0FBYyxFQUFFLE1BQW1CLEVBQUE7UUFDdkQsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ1gsUUFBQSxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztBQUNuQixRQUFBLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0tBQ3RCO0lBRUQsTUFBTSxHQUFBO0FBQ0osUUFBQSxNQUFNLEVBQUUsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBQzNCLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUVsQixTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxFQUFFLElBQUksRUFBRSw0QkFBNEIsRUFBRSxDQUFDLENBQUM7QUFFakUsUUFBQSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRTtBQUN0QixZQUFBLElBQUksRUFBRSxDQUF5RCxzREFBQSxFQUFBLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUF1RCxxREFBQSxDQUFBO0FBQ3hJLFNBQUEsQ0FBQyxDQUFDO1FBRUgsSUFBSUMsZ0JBQU8sQ0FBQyxTQUFTLENBQUM7QUFDbkIsYUFBQSxTQUFTLENBQUMsQ0FBQyxNQUFNLEtBQ2hCLE1BQU07YUFDSCxRQUFRLENBQUMsSUFBSSxDQUFDO2FBQ2QsVUFBVSxDQUFDLDZCQUE2QixDQUFDO0FBQ3pDLGFBQUEsUUFBUSxDQUFDLENBQUMsS0FBSyxLQUFJO1lBQ2xCLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLDBCQUEwQixHQUFHLEtBQUssQ0FBQztBQUN4RCxZQUFBLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7QUFDN0IsU0FBQyxDQUFDLENBQ0w7YUFDQSxPQUFPLENBQUMsNkJBQTZCLENBQUMsQ0FBQztRQUUxQyxJQUFJQSxnQkFBTyxDQUFDLFNBQVMsQ0FBQzthQUNuQixTQUFTLENBQUMsQ0FBQyxHQUFHLEtBQ2IsR0FBRyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FDeEQ7QUFDQSxhQUFBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsS0FDYixHQUFHO2FBQ0EsYUFBYSxDQUFDLFNBQVMsQ0FBQztBQUN4QixhQUFBLE1BQU0sRUFBRTthQUNSLE9BQU8sQ0FBQyxNQUFXLFNBQUEsQ0FBQSxJQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsS0FBQSxDQUFBLEVBQUEsYUFBQTtZQUNsQixJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDYixNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsNEJBQTRCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1NBQzVELENBQUEsQ0FBQyxDQUNMLENBQUM7S0FDTDtJQUVELE9BQU8sR0FBQTtBQUNMLFFBQUEsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQztRQUMzQixTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7S0FDbkI7QUFDRjs7OzsifQ==
