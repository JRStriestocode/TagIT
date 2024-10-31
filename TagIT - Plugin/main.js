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
    showNewFolderModal: true,
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
                if (file instanceof obsidian.TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle("Add/Edit Folder Tags")
                            .setIcon("tag")
                            .onClick(() => this.openFolderTagModal(file));
                    });
                    menu.addItem((item) => {
                        item
                            .setTitle("Remove All Folder Tags")
                            .setIcon("trash")
                            .onClick(() => this.removeFolderTags(file));
                    });
                    menu.addItem((item) => {
                        item
                            .setTitle("Apply Folder Tags to Notes")
                            .setIcon("file-plus")
                            .onClick(() => this.applyFolderTagsToNotes(file));
                    });
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
                    menu.addItem((item) => {
                        item
                            .setTitle("Check for Duplicate Tags")
                            .setIcon("search")
                            .onClick(() => this.checkAndRemoveDuplicateTags(file));
                    });
                }
                if (file instanceof obsidian.TFile && file.extension.toLowerCase() === "md") {
                    menu.addItem((item) => {
                        item
                            .setTitle("Apply Tags to Folder")
                            .setIcon("tag")
                            .onClick(() => this.applyFileTagsToFolder(file));
                    });
                    menu.addItem((item) => {
                        item
                            .setTitle("Convert to YAML")
                            .setIcon("tag")
                            .onClick(() => {
                            this.batchConvertWithConfirmation([file]);
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
        if (!this.isInitialLoad && this.settings.showNewFolderModal) {
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
        new obsidian.Setting(containerEl)
            .setName("New Folder Modal")
            .setDesc("Show tag modal when creating new folders")
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.showNewFolderModal)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showNewFolderModal = value;
            yield this.plugin.saveSettings();
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3RzbGliL3RzbGliLmVzNi5qcyIsIm1haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG5Db3B5cmlnaHQgKGMpIE1pY3Jvc29mdCBDb3Jwb3JhdGlvbi5cclxuXHJcblBlcm1pc3Npb24gdG8gdXNlLCBjb3B5LCBtb2RpZnksIGFuZC9vciBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUgZm9yIGFueVxyXG5wdXJwb3NlIHdpdGggb3Igd2l0aG91dCBmZWUgaXMgaGVyZWJ5IGdyYW50ZWQuXHJcblxyXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiIEFORCBUSEUgQVVUSE9SIERJU0NMQUlNUyBBTEwgV0FSUkFOVElFUyBXSVRIXHJcblJFR0FSRCBUTyBUSElTIFNPRlRXQVJFIElOQ0xVRElORyBBTEwgSU1QTElFRCBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWVxyXG5BTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsXHJcbklORElSRUNULCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgT1IgQU5ZIERBTUFHRVMgV0hBVFNPRVZFUiBSRVNVTFRJTkcgRlJPTVxyXG5MT1NTIE9GIFVTRSwgREFUQSBPUiBQUk9GSVRTLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgTkVHTElHRU5DRSBPUlxyXG5PVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SXHJcblBFUkZPUk1BTkNFIE9GIFRISVMgU09GVFdBUkUuXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqICovXHJcbi8qIGdsb2JhbCBSZWZsZWN0LCBQcm9taXNlLCBTdXBwcmVzc2VkRXJyb3IsIFN5bWJvbCwgSXRlcmF0b3IgKi9cclxuXHJcbnZhciBleHRlbmRTdGF0aWNzID0gZnVuY3Rpb24oZCwgYikge1xyXG4gICAgZXh0ZW5kU3RhdGljcyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fFxyXG4gICAgICAgICh7IF9fcHJvdG9fXzogW10gfSBpbnN0YW5jZW9mIEFycmF5ICYmIGZ1bmN0aW9uIChkLCBiKSB7IGQuX19wcm90b19fID0gYjsgfSkgfHxcclxuICAgICAgICBmdW5jdGlvbiAoZCwgYikgeyBmb3IgKHZhciBwIGluIGIpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYiwgcCkpIGRbcF0gPSBiW3BdOyB9O1xyXG4gICAgcmV0dXJuIGV4dGVuZFN0YXRpY3MoZCwgYik7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHRlbmRzKGQsIGIpIHtcclxuICAgIGlmICh0eXBlb2YgYiAhPT0gXCJmdW5jdGlvblwiICYmIGIgIT09IG51bGwpXHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNsYXNzIGV4dGVuZHMgdmFsdWUgXCIgKyBTdHJpbmcoYikgKyBcIiBpcyBub3QgYSBjb25zdHJ1Y3RvciBvciBudWxsXCIpO1xyXG4gICAgZXh0ZW5kU3RhdGljcyhkLCBiKTtcclxuICAgIGZ1bmN0aW9uIF9fKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gZDsgfVxyXG4gICAgZC5wcm90b3R5cGUgPSBiID09PSBudWxsID8gT2JqZWN0LmNyZWF0ZShiKSA6IChfXy5wcm90b3R5cGUgPSBiLnByb3RvdHlwZSwgbmV3IF9fKCkpO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fYXNzaWduID0gZnVuY3Rpb24oKSB7XHJcbiAgICBfX2Fzc2lnbiA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gX19hc3NpZ24odCkge1xyXG4gICAgICAgIGZvciAodmFyIHMsIGkgPSAxLCBuID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xyXG4gICAgICAgICAgICBzID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkpIHRbcF0gPSBzW3BdO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdDtcclxuICAgIH1cclxuICAgIHJldHVybiBfX2Fzc2lnbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZXN0KHMsIGUpIHtcclxuICAgIHZhciB0ID0ge307XHJcbiAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkgJiYgZS5pbmRleE9mKHApIDwgMClcclxuICAgICAgICB0W3BdID0gc1twXTtcclxuICAgIGlmIChzICE9IG51bGwgJiYgdHlwZW9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocyk7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmIChlLmluZGV4T2YocFtpXSkgPCAwICYmIE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChzLCBwW2ldKSlcclxuICAgICAgICAgICAgICAgIHRbcFtpXV0gPSBzW3BbaV1dO1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiB0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYykge1xyXG4gICAgdmFyIGMgPSBhcmd1bWVudHMubGVuZ3RoLCByID0gYyA8IDMgPyB0YXJnZXQgOiBkZXNjID09PSBudWxsID8gZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodGFyZ2V0LCBrZXkpIDogZGVzYywgZDtcclxuICAgIGlmICh0eXBlb2YgUmVmbGVjdCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgUmVmbGVjdC5kZWNvcmF0ZSA9PT0gXCJmdW5jdGlvblwiKSByID0gUmVmbGVjdC5kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYyk7XHJcbiAgICBlbHNlIGZvciAodmFyIGkgPSBkZWNvcmF0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoZCA9IGRlY29yYXRvcnNbaV0pIHIgPSAoYyA8IDMgPyBkKHIpIDogYyA+IDMgPyBkKHRhcmdldCwga2V5LCByKSA6IGQodGFyZ2V0LCBrZXkpKSB8fCByO1xyXG4gICAgcmV0dXJuIGMgPiAzICYmIHIgJiYgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCByKSwgcjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcGFyYW0ocGFyYW1JbmRleCwgZGVjb3JhdG9yKSB7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldCwga2V5KSB7IGRlY29yYXRvcih0YXJnZXQsIGtleSwgcGFyYW1JbmRleCk7IH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZXNEZWNvcmF0ZShjdG9yLCBkZXNjcmlwdG9ySW4sIGRlY29yYXRvcnMsIGNvbnRleHRJbiwgaW5pdGlhbGl6ZXJzLCBleHRyYUluaXRpYWxpemVycykge1xyXG4gICAgZnVuY3Rpb24gYWNjZXB0KGYpIHsgaWYgKGYgIT09IHZvaWQgMCAmJiB0eXBlb2YgZiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnVuY3Rpb24gZXhwZWN0ZWRcIik7IHJldHVybiBmOyB9XHJcbiAgICB2YXIga2luZCA9IGNvbnRleHRJbi5raW5kLCBrZXkgPSBraW5kID09PSBcImdldHRlclwiID8gXCJnZXRcIiA6IGtpbmQgPT09IFwic2V0dGVyXCIgPyBcInNldFwiIDogXCJ2YWx1ZVwiO1xyXG4gICAgdmFyIHRhcmdldCA9ICFkZXNjcmlwdG9ySW4gJiYgY3RvciA/IGNvbnRleHRJbltcInN0YXRpY1wiXSA/IGN0b3IgOiBjdG9yLnByb3RvdHlwZSA6IG51bGw7XHJcbiAgICB2YXIgZGVzY3JpcHRvciA9IGRlc2NyaXB0b3JJbiB8fCAodGFyZ2V0ID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih0YXJnZXQsIGNvbnRleHRJbi5uYW1lKSA6IHt9KTtcclxuICAgIHZhciBfLCBkb25lID0gZmFsc2U7XHJcbiAgICBmb3IgKHZhciBpID0gZGVjb3JhdG9ycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgIHZhciBjb250ZXh0ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4pIGNvbnRleHRbcF0gPSBwID09PSBcImFjY2Vzc1wiID8ge30gOiBjb250ZXh0SW5bcF07XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4uYWNjZXNzKSBjb250ZXh0LmFjY2Vzc1twXSA9IGNvbnRleHRJbi5hY2Nlc3NbcF07XHJcbiAgICAgICAgY29udGV4dC5hZGRJbml0aWFsaXplciA9IGZ1bmN0aW9uIChmKSB7IGlmIChkb25lKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IGFkZCBpbml0aWFsaXplcnMgYWZ0ZXIgZGVjb3JhdGlvbiBoYXMgY29tcGxldGVkXCIpOyBleHRyYUluaXRpYWxpemVycy5wdXNoKGFjY2VwdChmIHx8IG51bGwpKTsgfTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKDAsIGRlY29yYXRvcnNbaV0pKGtpbmQgPT09IFwiYWNjZXNzb3JcIiA/IHsgZ2V0OiBkZXNjcmlwdG9yLmdldCwgc2V0OiBkZXNjcmlwdG9yLnNldCB9IDogZGVzY3JpcHRvcltrZXldLCBjb250ZXh0KTtcclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJhY2Nlc3NvclwiKSB7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IHZvaWQgMCkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZFwiKTtcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmdldCkpIGRlc2NyaXB0b3IuZ2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LnNldCkpIGRlc2NyaXB0b3Iuc2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmluaXQpKSBpbml0aWFsaXplcnMudW5zaGlmdChfKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoXyA9IGFjY2VwdChyZXN1bHQpKSB7XHJcbiAgICAgICAgICAgIGlmIChraW5kID09PSBcImZpZWxkXCIpIGluaXRpYWxpemVycy51bnNoaWZ0KF8pO1xyXG4gICAgICAgICAgICBlbHNlIGRlc2NyaXB0b3Jba2V5XSA9IF87XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRhcmdldCkgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgY29udGV4dEluLm5hbWUsIGRlc2NyaXB0b3IpO1xyXG4gICAgZG9uZSA9IHRydWU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19ydW5Jbml0aWFsaXplcnModGhpc0FyZywgaW5pdGlhbGl6ZXJzLCB2YWx1ZSkge1xyXG4gICAgdmFyIHVzZVZhbHVlID0gYXJndW1lbnRzLmxlbmd0aCA+IDI7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGluaXRpYWxpemVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhbHVlID0gdXNlVmFsdWUgPyBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnLCB2YWx1ZSkgOiBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1c2VWYWx1ZSA/IHZhbHVlIDogdm9pZCAwO1xyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcHJvcEtleSh4KSB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHggPT09IFwic3ltYm9sXCIgPyB4IDogXCJcIi5jb25jYXQoeCk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zZXRGdW5jdGlvbk5hbWUoZiwgbmFtZSwgcHJlZml4KSB7XHJcbiAgICBpZiAodHlwZW9mIG5hbWUgPT09IFwic3ltYm9sXCIpIG5hbWUgPSBuYW1lLmRlc2NyaXB0aW9uID8gXCJbXCIuY29uY2F0KG5hbWUuZGVzY3JpcHRpb24sIFwiXVwiKSA6IFwiXCI7XHJcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGYsIFwibmFtZVwiLCB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IHByZWZpeCA/IFwiXCIuY29uY2F0KHByZWZpeCwgXCIgXCIsIG5hbWUpIDogbmFtZSB9KTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX21ldGFkYXRhKG1ldGFkYXRhS2V5LCBtZXRhZGF0YVZhbHVlKSB7XHJcbiAgICBpZiAodHlwZW9mIFJlZmxlY3QgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIFJlZmxlY3QubWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFJlZmxlY3QubWV0YWRhdGEobWV0YWRhdGFLZXksIG1ldGFkYXRhVmFsdWUpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikge1xyXG4gICAgZnVuY3Rpb24gYWRvcHQodmFsdWUpIHsgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgUCA/IHZhbHVlIDogbmV3IFAoZnVuY3Rpb24gKHJlc29sdmUpIHsgcmVzb2x2ZSh2YWx1ZSk7IH0pOyB9XHJcbiAgICByZXR1cm4gbmV3IChQIHx8IChQID0gUHJvbWlzZSkpKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gcmVqZWN0ZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3JbXCJ0aHJvd1wiXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gc3RlcChyZXN1bHQpIHsgcmVzdWx0LmRvbmUgPyByZXNvbHZlKHJlc3VsdC52YWx1ZSkgOiBhZG9wdChyZXN1bHQudmFsdWUpLnRoZW4oZnVsZmlsbGVkLCByZWplY3RlZCk7IH1cclxuICAgICAgICBzdGVwKChnZW5lcmF0b3IgPSBnZW5lcmF0b3IuYXBwbHkodGhpc0FyZywgX2FyZ3VtZW50cyB8fCBbXSkpLm5leHQoKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZ2VuZXJhdG9yKHRoaXNBcmcsIGJvZHkpIHtcclxuICAgIHZhciBfID0geyBsYWJlbDogMCwgc2VudDogZnVuY3Rpb24oKSB7IGlmICh0WzBdICYgMSkgdGhyb3cgdFsxXTsgcmV0dXJuIHRbMV07IH0sIHRyeXM6IFtdLCBvcHM6IFtdIH0sIGYsIHksIHQsIGcgPSBPYmplY3QuY3JlYXRlKCh0eXBlb2YgSXRlcmF0b3IgPT09IFwiZnVuY3Rpb25cIiA/IEl0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpO1xyXG4gICAgcmV0dXJuIGcubmV4dCA9IHZlcmIoMCksIGdbXCJ0aHJvd1wiXSA9IHZlcmIoMSksIGdbXCJyZXR1cm5cIl0gPSB2ZXJiKDIpLCB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgKGdbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSksIGc7XHJcbiAgICBmdW5jdGlvbiB2ZXJiKG4pIHsgcmV0dXJuIGZ1bmN0aW9uICh2KSB7IHJldHVybiBzdGVwKFtuLCB2XSk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHN0ZXAob3ApIHtcclxuICAgICAgICBpZiAoZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkdlbmVyYXRvciBpcyBhbHJlYWR5IGV4ZWN1dGluZy5cIik7XHJcbiAgICAgICAgd2hpbGUgKGcgJiYgKGcgPSAwLCBvcFswXSAmJiAoXyA9IDApKSwgXykgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKGYgPSAxLCB5ICYmICh0ID0gb3BbMF0gJiAyID8geVtcInJldHVyblwiXSA6IG9wWzBdID8geVtcInRocm93XCJdIHx8ICgodCA9IHlbXCJyZXR1cm5cIl0pICYmIHQuY2FsbCh5KSwgMCkgOiB5Lm5leHQpICYmICEodCA9IHQuY2FsbCh5LCBvcFsxXSkpLmRvbmUpIHJldHVybiB0O1xyXG4gICAgICAgICAgICBpZiAoeSA9IDAsIHQpIG9wID0gW29wWzBdICYgMiwgdC52YWx1ZV07XHJcbiAgICAgICAgICAgIHN3aXRjaCAob3BbMF0pIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgMDogY2FzZSAxOiB0ID0gb3A7IGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSA0OiBfLmxhYmVsKys7IHJldHVybiB7IHZhbHVlOiBvcFsxXSwgZG9uZTogZmFsc2UgfTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNTogXy5sYWJlbCsrOyB5ID0gb3BbMV07IG9wID0gWzBdOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNzogb3AgPSBfLm9wcy5wb3AoKTsgXy50cnlzLnBvcCgpOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEodCA9IF8udHJ5cywgdCA9IHQubGVuZ3RoID4gMCAmJiB0W3QubGVuZ3RoIC0gMV0pICYmIChvcFswXSA9PT0gNiB8fCBvcFswXSA9PT0gMikpIHsgXyA9IDA7IGNvbnRpbnVlOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wWzBdID09PSAzICYmICghdCB8fCAob3BbMV0gPiB0WzBdICYmIG9wWzFdIDwgdFszXSkpKSB7IF8ubGFiZWwgPSBvcFsxXTsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAob3BbMF0gPT09IDYgJiYgXy5sYWJlbCA8IHRbMV0pIHsgXy5sYWJlbCA9IHRbMV07IHQgPSBvcDsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiBfLmxhYmVsIDwgdFsyXSkgeyBfLmxhYmVsID0gdFsyXTsgXy5vcHMucHVzaChvcCk7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRbMl0pIF8ub3BzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIF8udHJ5cy5wb3AoKTsgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3AgPSBib2R5LmNhbGwodGhpc0FyZywgXyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkgeyBvcCA9IFs2LCBlXTsgeSA9IDA7IH0gZmluYWxseSB7IGYgPSB0ID0gMDsgfVxyXG4gICAgICAgIGlmIChvcFswXSAmIDUpIHRocm93IG9wWzFdOyByZXR1cm4geyB2YWx1ZTogb3BbMF0gPyBvcFsxXSA6IHZvaWQgMCwgZG9uZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fY3JlYXRlQmluZGluZyA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgbSwgaywgazIpIHtcclxuICAgIGlmIChrMiA9PT0gdW5kZWZpbmVkKSBrMiA9IGs7XHJcbiAgICB2YXIgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IobSwgayk7XHJcbiAgICBpZiAoIWRlc2MgfHwgKFwiZ2V0XCIgaW4gZGVzYyA/ICFtLl9fZXNNb2R1bGUgOiBkZXNjLndyaXRhYmxlIHx8IGRlc2MuY29uZmlndXJhYmxlKSkge1xyXG4gICAgICAgIGRlc2MgPSB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiBtW2tdOyB9IH07XHJcbiAgICB9XHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgazIsIGRlc2MpO1xyXG59KSA6IChmdW5jdGlvbihvLCBtLCBrLCBrMikge1xyXG4gICAgaWYgKGsyID09PSB1bmRlZmluZWQpIGsyID0gaztcclxuICAgIG9bazJdID0gbVtrXTtcclxufSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHBvcnRTdGFyKG0sIG8pIHtcclxuICAgIGZvciAodmFyIHAgaW4gbSkgaWYgKHAgIT09IFwiZGVmYXVsdFwiICYmICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgcCkpIF9fY3JlYXRlQmluZGluZyhvLCBtLCBwKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fdmFsdWVzKG8pIHtcclxuICAgIHZhciBzID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIFN5bWJvbC5pdGVyYXRvciwgbSA9IHMgJiYgb1tzXSwgaSA9IDA7XHJcbiAgICBpZiAobSkgcmV0dXJuIG0uY2FsbChvKTtcclxuICAgIGlmIChvICYmIHR5cGVvZiBvLmxlbmd0aCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHtcclxuICAgICAgICBuZXh0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChvICYmIGkgPj0gby5sZW5ndGgpIG8gPSB2b2lkIDA7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBvICYmIG9baSsrXSwgZG9uZTogIW8gfTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihzID8gXCJPYmplY3QgaXMgbm90IGl0ZXJhYmxlLlwiIDogXCJTeW1ib2wuaXRlcmF0b3IgaXMgbm90IGRlZmluZWQuXCIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZWFkKG8sIG4pIHtcclxuICAgIHZhciBtID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIG9bU3ltYm9sLml0ZXJhdG9yXTtcclxuICAgIGlmICghbSkgcmV0dXJuIG87XHJcbiAgICB2YXIgaSA9IG0uY2FsbChvKSwgciwgYXIgPSBbXSwgZTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgd2hpbGUgKChuID09PSB2b2lkIDAgfHwgbi0tID4gMCkgJiYgIShyID0gaS5uZXh0KCkpLmRvbmUpIGFyLnB1c2goci52YWx1ZSk7XHJcbiAgICB9XHJcbiAgICBjYXRjaCAoZXJyb3IpIHsgZSA9IHsgZXJyb3I6IGVycm9yIH07IH1cclxuICAgIGZpbmFsbHkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChyICYmICFyLmRvbmUgJiYgKG0gPSBpW1wicmV0dXJuXCJdKSkgbS5jYWxsKGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaW5hbGx5IHsgaWYgKGUpIHRocm93IGUuZXJyb3I7IH1cclxuICAgIH1cclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZCgpIHtcclxuICAgIGZvciAodmFyIGFyID0gW10sIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKVxyXG4gICAgICAgIGFyID0gYXIuY29uY2F0KF9fcmVhZChhcmd1bWVudHNbaV0pKTtcclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZEFycmF5cygpIHtcclxuICAgIGZvciAodmFyIHMgPSAwLCBpID0gMCwgaWwgPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgaWw7IGkrKykgcyArPSBhcmd1bWVudHNbaV0ubGVuZ3RoO1xyXG4gICAgZm9yICh2YXIgciA9IEFycmF5KHMpLCBrID0gMCwgaSA9IDA7IGkgPCBpbDsgaSsrKVxyXG4gICAgICAgIGZvciAodmFyIGEgPSBhcmd1bWVudHNbaV0sIGogPSAwLCBqbCA9IGEubGVuZ3RoOyBqIDwgamw7IGorKywgaysrKVxyXG4gICAgICAgICAgICByW2tdID0gYVtqXTtcclxuICAgIHJldHVybiByO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zcHJlYWRBcnJheSh0bywgZnJvbSwgcGFjaykge1xyXG4gICAgaWYgKHBhY2sgfHwgYXJndW1lbnRzLmxlbmd0aCA9PT0gMikgZm9yICh2YXIgaSA9IDAsIGwgPSBmcm9tLmxlbmd0aCwgYXI7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XHJcbiAgICAgICAgICAgIGlmICghYXIpIGFyID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSwgMCwgaSk7XHJcbiAgICAgICAgICAgIGFyW2ldID0gZnJvbVtpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdG8uY29uY2F0KGFyIHx8IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fYXdhaXQodikge1xyXG4gICAgcmV0dXJuIHRoaXMgaW5zdGFuY2VvZiBfX2F3YWl0ID8gKHRoaXMudiA9IHYsIHRoaXMpIDogbmV3IF9fYXdhaXQodik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jR2VuZXJhdG9yKHRoaXNBcmcsIF9hcmd1bWVudHMsIGdlbmVyYXRvcikge1xyXG4gICAgaWYgKCFTeW1ib2wuYXN5bmNJdGVyYXRvcikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0l0ZXJhdG9yIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgIHZhciBnID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pLCBpLCBxID0gW107XHJcbiAgICByZXR1cm4gaSA9IE9iamVjdC5jcmVhdGUoKHR5cGVvZiBBc3luY0l0ZXJhdG9yID09PSBcImZ1bmN0aW9uXCIgPyBBc3luY0l0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpLCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIsIGF3YWl0UmV0dXJuKSwgaVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0gPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzOyB9LCBpO1xyXG4gICAgZnVuY3Rpb24gYXdhaXRSZXR1cm4oZikgeyByZXR1cm4gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh2KS50aGVuKGYsIHJlamVjdCk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpZiAoZ1tuXSkgeyBpW25dID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChhLCBiKSB7IHEucHVzaChbbiwgdiwgYSwgYl0pID4gMSB8fCByZXN1bWUobiwgdik7IH0pOyB9OyBpZiAoZikgaVtuXSA9IGYoaVtuXSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gcmVzdW1lKG4sIHYpIHsgdHJ5IHsgc3RlcChnW25dKHYpKTsgfSBjYXRjaCAoZSkgeyBzZXR0bGUocVswXVszXSwgZSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gc3RlcChyKSB7IHIudmFsdWUgaW5zdGFuY2VvZiBfX2F3YWl0ID8gUHJvbWlzZS5yZXNvbHZlKHIudmFsdWUudikudGhlbihmdWxmaWxsLCByZWplY3QpIDogc2V0dGxlKHFbMF1bMl0sIHIpOyB9XHJcbiAgICBmdW5jdGlvbiBmdWxmaWxsKHZhbHVlKSB7IHJlc3VtZShcIm5leHRcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiByZWplY3QodmFsdWUpIHsgcmVzdW1lKFwidGhyb3dcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiBzZXR0bGUoZiwgdikgeyBpZiAoZih2KSwgcS5zaGlmdCgpLCBxLmxlbmd0aCkgcmVzdW1lKHFbMF1bMF0sIHFbMF1bMV0pOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jRGVsZWdhdG9yKG8pIHtcclxuICAgIHZhciBpLCBwO1xyXG4gICAgcmV0dXJuIGkgPSB7fSwgdmVyYihcIm5leHRcIiksIHZlcmIoXCJ0aHJvd1wiLCBmdW5jdGlvbiAoZSkgeyB0aHJvdyBlOyB9KSwgdmVyYihcInJldHVyblwiKSwgaVtTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfSwgaTtcclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpW25dID0gb1tuXSA/IGZ1bmN0aW9uICh2KSB7IHJldHVybiAocCA9ICFwKSA/IHsgdmFsdWU6IF9fYXdhaXQob1tuXSh2KSksIGRvbmU6IGZhbHNlIH0gOiBmID8gZih2KSA6IHY7IH0gOiBmOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jVmFsdWVzKG8pIHtcclxuICAgIGlmICghU3ltYm9sLmFzeW5jSXRlcmF0b3IpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNJdGVyYXRvciBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICB2YXIgbSA9IG9bU3ltYm9sLmFzeW5jSXRlcmF0b3JdLCBpO1xyXG4gICAgcmV0dXJuIG0gPyBtLmNhbGwobykgOiAobyA9IHR5cGVvZiBfX3ZhbHVlcyA9PT0gXCJmdW5jdGlvblwiID8gX192YWx1ZXMobykgOiBvW1N5bWJvbC5pdGVyYXRvcl0oKSwgaSA9IHt9LCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIpLCBpW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXM7IH0sIGkpO1xyXG4gICAgZnVuY3Rpb24gdmVyYihuKSB7IGlbbl0gPSBvW25dICYmIGZ1bmN0aW9uICh2KSB7IHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHYgPSBvW25dKHYpLCBzZXR0bGUocmVzb2x2ZSwgcmVqZWN0LCB2LmRvbmUsIHYudmFsdWUpOyB9KTsgfTsgfVxyXG4gICAgZnVuY3Rpb24gc2V0dGxlKHJlc29sdmUsIHJlamVjdCwgZCwgdikgeyBQcm9taXNlLnJlc29sdmUodikudGhlbihmdW5jdGlvbih2KSB7IHJlc29sdmUoeyB2YWx1ZTogdiwgZG9uZTogZCB9KTsgfSwgcmVqZWN0KTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19tYWtlVGVtcGxhdGVPYmplY3QoY29va2VkLCByYXcpIHtcclxuICAgIGlmIChPYmplY3QuZGVmaW5lUHJvcGVydHkpIHsgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvb2tlZCwgXCJyYXdcIiwgeyB2YWx1ZTogcmF3IH0pOyB9IGVsc2UgeyBjb29rZWQucmF3ID0gcmF3OyB9XHJcbiAgICByZXR1cm4gY29va2VkO1xyXG59O1xyXG5cclxudmFyIF9fc2V0TW9kdWxlRGVmYXVsdCA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgdikge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sIFwiZGVmYXVsdFwiLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2IH0pO1xyXG59KSA6IGZ1bmN0aW9uKG8sIHYpIHtcclxuICAgIG9bXCJkZWZhdWx0XCJdID0gdjtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydFN0YXIobW9kKSB7XHJcbiAgICBpZiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSByZXR1cm4gbW9kO1xyXG4gICAgdmFyIHJlc3VsdCA9IHt9O1xyXG4gICAgaWYgKG1vZCAhPSBudWxsKSBmb3IgKHZhciBrIGluIG1vZCkgaWYgKGsgIT09IFwiZGVmYXVsdFwiICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb2QsIGspKSBfX2NyZWF0ZUJpbmRpbmcocmVzdWx0LCBtb2QsIGspO1xyXG4gICAgX19zZXRNb2R1bGVEZWZhdWx0KHJlc3VsdCwgbW9kKTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydERlZmF1bHQobW9kKSB7XHJcbiAgICByZXR1cm4gKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgPyBtb2QgOiB7IGRlZmF1bHQ6IG1vZCB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEdldChyZWNlaXZlciwgc3RhdGUsIGtpbmQsIGYpIHtcclxuICAgIGlmIChraW5kID09PSBcImFcIiAmJiAhZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlByaXZhdGUgYWNjZXNzb3Igd2FzIGRlZmluZWQgd2l0aG91dCBhIGdldHRlclwiKTtcclxuICAgIGlmICh0eXBlb2Ygc3RhdGUgPT09IFwiZnVuY3Rpb25cIiA/IHJlY2VpdmVyICE9PSBzdGF0ZSB8fCAhZiA6ICFzdGF0ZS5oYXMocmVjZWl2ZXIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHJlYWQgcHJpdmF0ZSBtZW1iZXIgZnJvbSBhbiBvYmplY3Qgd2hvc2UgY2xhc3MgZGlkIG5vdCBkZWNsYXJlIGl0XCIpO1xyXG4gICAgcmV0dXJuIGtpbmQgPT09IFwibVwiID8gZiA6IGtpbmQgPT09IFwiYVwiID8gZi5jYWxsKHJlY2VpdmVyKSA6IGYgPyBmLnZhbHVlIDogc3RhdGUuZ2V0KHJlY2VpdmVyKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fY2xhc3NQcml2YXRlRmllbGRTZXQocmVjZWl2ZXIsIHN0YXRlLCB2YWx1ZSwga2luZCwgZikge1xyXG4gICAgaWYgKGtpbmQgPT09IFwibVwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBtZXRob2QgaXMgbm90IHdyaXRhYmxlXCIpO1xyXG4gICAgaWYgKGtpbmQgPT09IFwiYVwiICYmICFmKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBhY2Nlc3NvciB3YXMgZGVmaW5lZCB3aXRob3V0IGEgc2V0dGVyXCIpO1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gXCJmdW5jdGlvblwiID8gcmVjZWl2ZXIgIT09IHN0YXRlIHx8ICFmIDogIXN0YXRlLmhhcyhyZWNlaXZlcikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3Qgd3JpdGUgcHJpdmF0ZSBtZW1iZXIgdG8gYW4gb2JqZWN0IHdob3NlIGNsYXNzIGRpZCBub3QgZGVjbGFyZSBpdFwiKTtcclxuICAgIHJldHVybiAoa2luZCA9PT0gXCJhXCIgPyBmLmNhbGwocmVjZWl2ZXIsIHZhbHVlKSA6IGYgPyBmLnZhbHVlID0gdmFsdWUgOiBzdGF0ZS5zZXQocmVjZWl2ZXIsIHZhbHVlKSksIHZhbHVlO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEluKHN0YXRlLCByZWNlaXZlcikge1xyXG4gICAgaWYgKHJlY2VpdmVyID09PSBudWxsIHx8ICh0eXBlb2YgcmVjZWl2ZXIgIT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY2VpdmVyICE9PSBcImZ1bmN0aW9uXCIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHVzZSAnaW4nIG9wZXJhdG9yIG9uIG5vbi1vYmplY3RcIik7XHJcbiAgICByZXR1cm4gdHlwZW9mIHN0YXRlID09PSBcImZ1bmN0aW9uXCIgPyByZWNlaXZlciA9PT0gc3RhdGUgOiBzdGF0ZS5oYXMocmVjZWl2ZXIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hZGREaXNwb3NhYmxlUmVzb3VyY2UoZW52LCB2YWx1ZSwgYXN5bmMpIHtcclxuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdm9pZCAwKSB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZC5cIik7XHJcbiAgICAgICAgdmFyIGRpc3Bvc2UsIGlubmVyO1xyXG4gICAgICAgIGlmIChhc3luYykge1xyXG4gICAgICAgICAgICBpZiAoIVN5bWJvbC5hc3luY0Rpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNEaXNwb3NlIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgICAgICAgICAgZGlzcG9zZSA9IHZhbHVlW1N5bWJvbC5hc3luY0Rpc3Bvc2VdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZGlzcG9zZSA9PT0gdm9pZCAwKSB7XHJcbiAgICAgICAgICAgIGlmICghU3ltYm9sLmRpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuZGlzcG9zZSBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICAgICAgICAgIGRpc3Bvc2UgPSB2YWx1ZVtTeW1ib2wuZGlzcG9zZV07XHJcbiAgICAgICAgICAgIGlmIChhc3luYykgaW5uZXIgPSBkaXNwb3NlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodHlwZW9mIGRpc3Bvc2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBub3QgZGlzcG9zYWJsZS5cIik7XHJcbiAgICAgICAgaWYgKGlubmVyKSBkaXNwb3NlID0gZnVuY3Rpb24oKSB7IHRyeSB7IGlubmVyLmNhbGwodGhpcyk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIFByb21pc2UucmVqZWN0KGUpOyB9IH07XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyB2YWx1ZTogdmFsdWUsIGRpc3Bvc2U6IGRpc3Bvc2UsIGFzeW5jOiBhc3luYyB9KTtcclxuICAgIH1cclxuICAgIGVsc2UgaWYgKGFzeW5jKSB7XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyBhc3luYzogdHJ1ZSB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiB2YWx1ZTtcclxuXHJcbn1cclxuXHJcbnZhciBfU3VwcHJlc3NlZEVycm9yID0gdHlwZW9mIFN1cHByZXNzZWRFcnJvciA9PT0gXCJmdW5jdGlvblwiID8gU3VwcHJlc3NlZEVycm9yIDogZnVuY3Rpb24gKGVycm9yLCBzdXBwcmVzc2VkLCBtZXNzYWdlKSB7XHJcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuICAgIHJldHVybiBlLm5hbWUgPSBcIlN1cHByZXNzZWRFcnJvclwiLCBlLmVycm9yID0gZXJyb3IsIGUuc3VwcHJlc3NlZCA9IHN1cHByZXNzZWQsIGU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kaXNwb3NlUmVzb3VyY2VzKGVudikge1xyXG4gICAgZnVuY3Rpb24gZmFpbChlKSB7XHJcbiAgICAgICAgZW52LmVycm9yID0gZW52Lmhhc0Vycm9yID8gbmV3IF9TdXBwcmVzc2VkRXJyb3IoZSwgZW52LmVycm9yLCBcIkFuIGVycm9yIHdhcyBzdXBwcmVzc2VkIGR1cmluZyBkaXNwb3NhbC5cIikgOiBlO1xyXG4gICAgICAgIGVudi5oYXNFcnJvciA9IHRydWU7XHJcbiAgICB9XHJcbiAgICB2YXIgciwgcyA9IDA7XHJcbiAgICBmdW5jdGlvbiBuZXh0KCkge1xyXG4gICAgICAgIHdoaWxlIChyID0gZW52LnN0YWNrLnBvcCgpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXIuYXN5bmMgJiYgcyA9PT0gMSkgcmV0dXJuIHMgPSAwLCBlbnYuc3RhY2sucHVzaChyKSwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihuZXh0KTtcclxuICAgICAgICAgICAgICAgIGlmIChyLmRpc3Bvc2UpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gci5kaXNwb3NlLmNhbGwoci52YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHIuYXN5bmMpIHJldHVybiBzIHw9IDIsIFByb21pc2UucmVzb2x2ZShyZXN1bHQpLnRoZW4obmV4dCwgZnVuY3Rpb24oZSkgeyBmYWlsKGUpOyByZXR1cm4gbmV4dCgpOyB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgcyB8PSAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBmYWlsKGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChzID09PSAxKSByZXR1cm4gZW52Lmhhc0Vycm9yID8gUHJvbWlzZS5yZWplY3QoZW52LmVycm9yKSA6IFByb21pc2UucmVzb2x2ZSgpO1xyXG4gICAgICAgIGlmIChlbnYuaGFzRXJyb3IpIHRocm93IGVudi5lcnJvcjtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0KCk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbihwYXRoLCBwcmVzZXJ2ZUpzeCkge1xyXG4gICAgaWYgKHR5cGVvZiBwYXRoID09PSBcInN0cmluZ1wiICYmIC9eXFwuXFwuP1xcLy8udGVzdChwYXRoKSkge1xyXG4gICAgICAgIHJldHVybiBwYXRoLnJlcGxhY2UoL1xcLih0c3gpJHwoKD86XFwuZCk/KSgoPzpcXC5bXi4vXSs/KT8pXFwuKFtjbV0/KXRzJC9pLCBmdW5jdGlvbiAobSwgdHN4LCBkLCBleHQsIGNtKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0c3ggPyBwcmVzZXJ2ZUpzeCA/IFwiLmpzeFwiIDogXCIuanNcIiA6IGQgJiYgKCFleHQgfHwgIWNtKSA/IG0gOiAoZCArIGV4dCArIFwiLlwiICsgY20udG9Mb3dlckNhc2UoKSArIFwianNcIik7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGF0aDtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQge1xyXG4gICAgX19leHRlbmRzOiBfX2V4dGVuZHMsXHJcbiAgICBfX2Fzc2lnbjogX19hc3NpZ24sXHJcbiAgICBfX3Jlc3Q6IF9fcmVzdCxcclxuICAgIF9fZGVjb3JhdGU6IF9fZGVjb3JhdGUsXHJcbiAgICBfX3BhcmFtOiBfX3BhcmFtLFxyXG4gICAgX19lc0RlY29yYXRlOiBfX2VzRGVjb3JhdGUsXHJcbiAgICBfX3J1bkluaXRpYWxpemVyczogX19ydW5Jbml0aWFsaXplcnMsXHJcbiAgICBfX3Byb3BLZXk6IF9fcHJvcEtleSxcclxuICAgIF9fc2V0RnVuY3Rpb25OYW1lOiBfX3NldEZ1bmN0aW9uTmFtZSxcclxuICAgIF9fbWV0YWRhdGE6IF9fbWV0YWRhdGEsXHJcbiAgICBfX2F3YWl0ZXI6IF9fYXdhaXRlcixcclxuICAgIF9fZ2VuZXJhdG9yOiBfX2dlbmVyYXRvcixcclxuICAgIF9fY3JlYXRlQmluZGluZzogX19jcmVhdGVCaW5kaW5nLFxyXG4gICAgX19leHBvcnRTdGFyOiBfX2V4cG9ydFN0YXIsXHJcbiAgICBfX3ZhbHVlczogX192YWx1ZXMsXHJcbiAgICBfX3JlYWQ6IF9fcmVhZCxcclxuICAgIF9fc3ByZWFkOiBfX3NwcmVhZCxcclxuICAgIF9fc3ByZWFkQXJyYXlzOiBfX3NwcmVhZEFycmF5cyxcclxuICAgIF9fc3ByZWFkQXJyYXk6IF9fc3ByZWFkQXJyYXksXHJcbiAgICBfX2F3YWl0OiBfX2F3YWl0LFxyXG4gICAgX19hc3luY0dlbmVyYXRvcjogX19hc3luY0dlbmVyYXRvcixcclxuICAgIF9fYXN5bmNEZWxlZ2F0b3I6IF9fYXN5bmNEZWxlZ2F0b3IsXHJcbiAgICBfX2FzeW5jVmFsdWVzOiBfX2FzeW5jVmFsdWVzLFxyXG4gICAgX19tYWtlVGVtcGxhdGVPYmplY3Q6IF9fbWFrZVRlbXBsYXRlT2JqZWN0LFxyXG4gICAgX19pbXBvcnRTdGFyOiBfX2ltcG9ydFN0YXIsXHJcbiAgICBfX2ltcG9ydERlZmF1bHQ6IF9faW1wb3J0RGVmYXVsdCxcclxuICAgIF9fY2xhc3NQcml2YXRlRmllbGRHZXQ6IF9fY2xhc3NQcml2YXRlRmllbGRHZXQsXHJcbiAgICBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0OiBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0LFxyXG4gICAgX19jbGFzc1ByaXZhdGVGaWVsZEluOiBfX2NsYXNzUHJpdmF0ZUZpZWxkSW4sXHJcbiAgICBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZTogX19hZGREaXNwb3NhYmxlUmVzb3VyY2UsXHJcbiAgICBfX2Rpc3Bvc2VSZXNvdXJjZXM6IF9fZGlzcG9zZVJlc291cmNlcyxcclxuICAgIF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uOiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbixcclxufTtcclxuIiwiaW1wb3J0IHtcbiAgQXBwLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIFRGb2xkZXIsXG4gIFRGaWxlLFxuICBNb2RhbCxcbiAgVGV4dENvbXBvbmVudCxcbiAgTm90aWNlLFxuICBUQWJzdHJhY3RGaWxlLFxuICBNZW51LFxuICBNZW51SXRlbSxcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmludGVyZmFjZSBUYWdJdFNldHRpbmdzIHtcbiAgaW5oZXJpdGFuY2VNb2RlOiBcIm5vbmVcIiB8IFwiaW1tZWRpYXRlXCIgfCBcImFsbFwiO1xuICBleGNsdWRlZEZvbGRlcnM6IHN0cmluZ1tdO1xuICBzaG93Rm9sZGVySWNvbnM6IGJvb2xlYW47XG4gIGF1dG9BcHBseVRhZ3M6IGJvb2xlYW47XG4gIGRlYnVnTW9kZTogYm9vbGVhbjtcbiAgc2hvd0JhdGNoQ29udmVyc2lvbldhcm5pbmc6IGJvb2xlYW47XG4gIHNob3dOZXdGb2xkZXJNb2RhbDogYm9vbGVhbjtcbn1cblxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogVGFnSXRTZXR0aW5ncyA9IHtcbiAgaW5oZXJpdGFuY2VNb2RlOiBcImltbWVkaWF0ZVwiLFxuICBleGNsdWRlZEZvbGRlcnM6IFtdLFxuICBzaG93Rm9sZGVySWNvbnM6IHRydWUsXG4gIGF1dG9BcHBseVRhZ3M6IHRydWUsXG4gIGRlYnVnTW9kZTogZmFsc2UsXG4gIHNob3dCYXRjaENvbnZlcnNpb25XYXJuaW5nOiB0cnVlLFxuICBzaG93TmV3Rm9sZGVyTW9kYWw6IHRydWUsXG59O1xuXG4vLyBBZGQgdGhpcyB0eXBlIGRlZmluaXRpb25cbnR5cGUgRm9sZGVyVGFncyA9IHsgW2ZvbGRlclBhdGg6IHN0cmluZ106IHN0cmluZ1tdIH07XG5cbmludGVyZmFjZSBQbHVnaW5EYXRhIHtcbiAgc2V0dGluZ3M6IFRhZ0l0U2V0dGluZ3M7XG4gIGZvbGRlclRhZ3M6IEZvbGRlclRhZ3M7XG4gIHZlcnNpb246IHN0cmluZztcbn1cblxuY29uc3QgREVGQVVMVF9EQVRBOiBQbHVnaW5EYXRhID0ge1xuICBzZXR0aW5nczogREVGQVVMVF9TRVRUSU5HUyxcbiAgZm9sZGVyVGFnczoge30sXG4gIHZlcnNpb246IFwiMS4wLjBcIixcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRhZ0l0UGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IFRhZ0l0U2V0dGluZ3M7XG4gIGZvbGRlclRhZ3M6IEZvbGRlclRhZ3MgPSB7fTtcbiAgcHJpdmF0ZSBpc0luaXRpYWxMb2FkOiBib29sZWFuID0gdHJ1ZTtcbiAgcHJpdmF0ZSBuZXdGb2xkZXJRdWV1ZTogVEZvbGRlcltdID0gW107XG4gIHByaXZhdGUgbW92ZVRpbWVvdXQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG5cbiAgYXN5bmMgb25sb2FkKCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuICAgICAgYXdhaXQgdGhpcy5sb2FkRm9sZGVyVGFncygpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICBcIkVycm9yIGxvYWRpbmcgcGx1Z2luIGRhdGEsIGluaXRpYWxpemluZyB3aXRoIGRlZmF1bHRzOlwiLFxuICAgICAgICBlcnJvclxuICAgICAgKTtcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZURhdGFGaWxlKCk7XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coXCJsb2FkaW5nIFRhZ0l0IHBsdWdpblwiKTtcblxuICAgIC8vIERlbGF5ZWQgaW5pdGlhbGl6YXRpb25cbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuaXNJbml0aWFsTG9hZCA9IGZhbHNlO1xuICAgICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgICB0aGlzLmFwcC52YXVsdC5vbihcImNyZWF0ZVwiLCAoZmlsZSkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVGb2xkZXJDcmVhdGlvbihmaWxlKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkge1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVGaWxlQ3JlYXRpb24oZmlsZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgICAgLy8gUHJvY2VzcyB0aGUgcXVldWUgZXZlcnkgMiBzZWNvbmRzXG4gICAgICB0aGlzLnJlZ2lzdGVySW50ZXJ2YWwoXG4gICAgICAgIHdpbmRvdy5zZXRJbnRlcnZhbCgoKSA9PiB0aGlzLnByb2Nlc3NOZXdGb2xkZXJRdWV1ZSgpLCAyMDAwKVxuICAgICAgKTtcblxuICAgICAgLy8gQWRkIGV2ZW50IGxpc3RlbmVyIGZvciBmaWxlIG1vdmVtZW50XG4gICAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIChmaWxlLCBvbGRQYXRoKSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkge1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVGaWxlTW92ZShmaWxlLCBvbGRQYXRoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0sIDIwMDApOyAvLyAyIHNlY29uZCBkZWxheVxuXG4gICAgLy8gQWRkIGNvbW1hbmQgdG8gb3BlbiB0YWcgbW9kYWwgZm9yIGN1cnJlbnQgZm9sZGVyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tZm9sZGVyLXRhZy1tb2RhbFwiLFxuICAgICAgbmFtZTogXCJBZGQvRWRpdCB0YWdzIGZvciBjdXJyZW50IGZvbGRlclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGNvbnN0IGZvbGRlciA9IGFjdGl2ZUZpbGUgPyBhY3RpdmVGaWxlLnBhcmVudCA6IG51bGw7XG4gICAgICAgIHRoaXMub3BlbkZvbGRlclRhZ01vZGFsKGZvbGRlcik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbW1hbmQgdG8gcmVtb3ZlIGFsbCB0YWdzIGZyb20gY3VycmVudCBmb2xkZXJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicmVtb3ZlLWZvbGRlci10YWdzXCIsXG4gICAgICBuYW1lOiBcIlJlbW92ZSBhbGwgdGFncyBmcm9tIGN1cnJlbnQgZm9sZGVyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgY29uc3QgZm9sZGVyID0gYWN0aXZlRmlsZSA/IGFjdGl2ZUZpbGUucGFyZW50IDogbnVsbDtcbiAgICAgICAgdGhpcy5yZW1vdmVGb2xkZXJUYWdzKGZvbGRlcik7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbW1hbmQgdG8gYXBwbHkgZmlsZSB0YWdzIHRvIGZvbGRlclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJhcHBseS1maWxlLXRhZ3MtdG8tZm9sZGVyXCIsXG4gICAgICBuYW1lOiBcIkFwcGx5IGZpbGUgdGFncyB0byBmb2xkZXJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFjdGl2ZUZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBpZiAoYWN0aXZlRmlsZSkge1xuICAgICAgICAgIHRoaXMuYXBwbHlGaWxlVGFnc1RvRm9sZGVyKGFjdGl2ZUZpbGUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyBhY3RpdmUgZmlsZVwiKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb21tYW5kIHRvIGNvbnZlcnQgaW5saW5lIHRhZ3MgdG8gWUFNTFxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJjb252ZXJ0LWlubGluZS10YWdzLXRvLXlhbWxcIixcbiAgICAgIG5hbWU6IFwiQ29udmVydCBpbmxpbmUgdGFncyB0byBZQU1MXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKGFjdGl2ZUZpbGUpIHtcbiAgICAgICAgICB0aGlzLmNvbnZlcnRJbmxpbmVUYWdzVG9ZQU1MKGFjdGl2ZUZpbGUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyBhY3RpdmUgZmlsZVwiKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFJlZ2lzdGVyIGNvbnRleHQgbWVudSBldmVudHNcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXG4gICAgICAgIFwiZmlsZS1tZW51XCIsXG4gICAgICAgIChtZW51OiBNZW51LCBmaWxlOiBUQWJzdHJhY3RGaWxlLCBzb3VyY2U6IHN0cmluZykgPT4ge1xuICAgICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQWRkL0VkaXQgRm9sZGVyIFRhZ3NcIilcbiAgICAgICAgICAgICAgICAuc2V0SWNvbihcInRhZ1wiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMub3BlbkZvbGRlclRhZ01vZGFsKGZpbGUpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW06IE1lbnVJdGVtKSA9PiB7XG4gICAgICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJSZW1vdmUgQWxsIEZvbGRlciBUYWdzXCIpXG4gICAgICAgICAgICAgICAgLnNldEljb24oXCJ0cmFzaFwiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMucmVtb3ZlRm9sZGVyVGFncyhmaWxlKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQXBwbHkgRm9sZGVyIFRhZ3MgdG8gTm90ZXNcIilcbiAgICAgICAgICAgICAgICAuc2V0SWNvbihcImZpbGUtcGx1c1wiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuYXBwbHlGb2xkZXJUYWdzVG9Ob3RlcyhmaWxlKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQ29udmVydCBBbGwgTm90ZXMgdG8gWUFNTFwiKVxuICAgICAgICAgICAgICAgIC5zZXRJY29uKFwidGFnXCIpXG4gICAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSBmaWxlLmNoaWxkcmVuLmZpbHRlcihcbiAgICAgICAgICAgICAgICAgICAgKGNoaWxkOiBUQWJzdHJhY3RGaWxlKTogY2hpbGQgaXMgVEZpbGUgPT5cbiAgICAgICAgICAgICAgICAgICAgICBjaGlsZCBpbnN0YW5jZW9mIFRGaWxlICYmXG4gICAgICAgICAgICAgICAgICAgICAgY2hpbGQuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCkgPT09IFwibWRcIlxuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgIHRoaXMuYmF0Y2hDb252ZXJ0V2l0aENvbmZpcm1hdGlvbihmaWxlcyk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQ2hlY2sgZm9yIER1cGxpY2F0ZSBUYWdzXCIpXG4gICAgICAgICAgICAgICAgLnNldEljb24oXCJzZWFyY2hcIilcbiAgICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLmNoZWNrQW5kUmVtb3ZlRHVwbGljYXRlVGFncyhmaWxlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCkgPT09IFwibWRcIikge1xuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQXBwbHkgVGFncyB0byBGb2xkZXJcIilcbiAgICAgICAgICAgICAgICAuc2V0SWNvbihcInRhZ1wiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuYXBwbHlGaWxlVGFnc1RvRm9sZGVyKGZpbGUpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW06IE1lbnVJdGVtKSA9PiB7XG4gICAgICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJDb252ZXJ0IHRvIFlBTUxcIilcbiAgICAgICAgICAgICAgICAuc2V0SWNvbihcInRhZ1wiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuYmF0Y2hDb252ZXJ0V2l0aENvbmZpcm1hdGlvbihbZmlsZV0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICApXG4gICAgKTtcblxuICAgIC8vIFRoaXMgYWRkcyBhIHNldHRpbmdzIHRhYiBzbyB0aGUgdXNlciBjYW4gY29uZmlndXJlIHZhcmlvdXMgYXNwZWN0cyBvZiB0aGUgcGx1Z2luXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUYWdJdFNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgICAgIHRoaXMuaGFuZGxlRm9sZGVyRGVsZXRpb24oZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFVwZGF0ZSBmb2xkZXIgaWNvbnMgd2hlbiB0aGUgcGx1Z2luIGxvYWRzXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy51cGRhdGVGb2xkZXJJY29ucygpO1xuICAgIH0pO1xuXG4gICAgLy8gVXBkYXRlIGZvbGRlciBpY29ucyB3aGVuIGZpbGVzIGFyZSBjcmVhdGVkLCBkZWxldGVkLCBvciByZW5hbWVkXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJkZWxldGVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG5cbiAgICAvLyBBZGQgdGhpcyBsaW5lIHRvIHVwZGF0ZSB0YWdzIHdoZW4gdGhlIHBsdWdpbiBsb2Fkc1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpKTtcblxuICAgIC8vIFVwZGF0ZSBmb2xkZXIgaWNvbnMgYmFzZWQgb24gdGhlIHNob3dGb2xkZXJJY29ucyBzZXR0aW5nXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd0ZvbGRlckljb25zKSB7XG4gICAgICAgIHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge1xuICAgIGNvbnNvbGUubG9nKFwidW5sb2FkaW5nIFRhZ0l0IHBsdWdpblwiKTtcbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGF0YSA9IChhd2FpdCB0aGlzLmxvYWREYXRhKCkpIGFzIFBsdWdpbkRhdGE7XG4gICAgICBpZiAoZGF0YSkge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLCAuLi5kYXRhLnNldHRpbmdzIH07XG4gICAgICAgIHRoaXMuZm9sZGVyVGFncyA9IGRhdGEuZm9sZGVyVGFncyB8fCB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICAgICAgICB0aGlzLmZvbGRlclRhZ3MgPSB7fTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBsb2FkIHBsdWdpbiBkYXRhOlwiLCBlcnJvcik7XG4gICAgICB0aGlzLnNldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HUztcbiAgICAgIHRoaXMuZm9sZGVyVGFncyA9IHt9O1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcbiAgICBjb25zdCBkYXRhOiBQbHVnaW5EYXRhID0ge1xuICAgICAgc2V0dGluZ3M6IHRoaXMuc2V0dGluZ3MsXG4gICAgICBmb2xkZXJUYWdzOiB0aGlzLmZvbGRlclRhZ3MsXG4gICAgICB2ZXJzaW9uOiBcIjEuMC4wXCIsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKGRhdGEpO1xuICB9XG5cbiAgYXN5bmMgbG9hZEZvbGRlclRhZ3MoKSB7XG4gICAgLy8gVGhpcyBtZXRob2QgaXMgbm93IHJlZHVuZGFudCBhcyB3ZSdyZSBsb2FkaW5nIGJvdGggc2V0dGluZ3MgYW5kIGZvbGRlclRhZ3MgaW4gbG9hZFNldHRpbmdzXG4gICAgLy8gS2VlcGluZyBpdCBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgICBjb25zb2xlLmxvZyhcIkZvbGRlciB0YWdzIGxvYWRlZCBpbiBsb2FkU2V0dGluZ3MgbWV0aG9kXCIpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZUZvbGRlclRhZ3MoKSB7XG4gICAgY29uc3QgZGF0YTogUGx1Z2luRGF0YSA9IHtcbiAgICAgIHNldHRpbmdzOiB0aGlzLnNldHRpbmdzLFxuICAgICAgZm9sZGVyVGFnczogdGhpcy5mb2xkZXJUYWdzLFxuICAgICAgdmVyc2lvbjogXCIxLjAuMFwiLFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YShkYXRhKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlRm9sZGVyQ3JlYXRpb24oZm9sZGVyOiBURm9sZGVyKSB7XG4gICAgaWYgKCF0aGlzLmlzSW5pdGlhbExvYWQgJiYgdGhpcy5zZXR0aW5ncy5zaG93TmV3Rm9sZGVyTW9kYWwpIHtcbiAgICAgIG5ldyBGb2xkZXJUYWdNb2RhbCh0aGlzLmFwcCwgZm9sZGVyLCB0aGlzLCB0cnVlKS5vcGVuKCk7XG4gICAgfVxuICB9XG5cbiAgc2V0Rm9sZGVyVGFncyhmb2xkZXJQYXRoOiBzdHJpbmcsIHRhZ3M6IHN0cmluZ1tdKSB7XG4gICAgY29uc3QgdW5pcXVlVGFncyA9IHRoaXMucmVtb3ZlRHVwbGljYXRlVGFncyh0YWdzKTtcbiAgICB0aGlzLmZvbGRlclRhZ3NbZm9sZGVyUGF0aF0gPSB1bmlxdWVUYWdzO1xuICAgIHRoaXMuc2F2ZUZvbGRlclRhZ3MoKTtcbiAgICB0aGlzLnVwZGF0ZUZvbGRlckljb25zKCk7XG4gICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gIH1cblxuICBnZXRGb2xkZXJUYWdzKGZvbGRlclBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gdGhpcy5mb2xkZXJUYWdzW2ZvbGRlclBhdGhdIHx8IFtdO1xuICB9XG5cbiAgb3BlbkZvbGRlclRhZ01vZGFsKGZvbGRlcjogVEZvbGRlciB8IG51bGwpIHtcbiAgICBpZiAoZm9sZGVyKSB7XG4gICAgICBuZXcgRm9sZGVyVGFnTW9kYWwodGhpcy5hcHAsIGZvbGRlciwgdGhpcykub3BlbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gZm9sZGVyIHNlbGVjdGVkXCIpO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZUZvbGRlclRhZ3MoZm9sZGVyOiBURm9sZGVyIHwgbnVsbCkge1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIHRoaXMuc2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCwgW10pO1xuICAgICAgbmV3IE5vdGljZShgUmVtb3ZlZCBhbGwgdGFncyBmcm9tIGZvbGRlcjogJHtmb2xkZXIucGF0aH1gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IE5vdGljZShcIk5vIGZvbGRlciBzZWxlY3RlZFwiKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBoYW5kbGVGaWxlQ3JlYXRpb24oZmlsZTogVEZpbGUpIHtcbiAgICAvLyBBZGQgbW9yZSB0aG9yb3VnaCBmaWxlIHR5cGUgY2hlY2tpbmdcbiAgICBpZiAoXG4gICAgICAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgfHxcbiAgICAgICFmaWxlLmV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpLm1hdGNoKC9eKG1kfG1hcmtkb3duKSQvKVxuICAgICkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5zZXR0aW5ncy5hdXRvQXBwbHlUYWdzKSB7XG4gICAgICByZXR1cm47IC8vIERvbid0IGFwcGx5IHRhZ3MgaWYgdGhlIHNldHRpbmcgaXMgb2ZmXG4gICAgfVxuXG4gICAgY29uc3QgZm9sZGVyID0gZmlsZS5wYXJlbnQ7XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgY29uc3QgZm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShmb2xkZXIucGF0aCk7XG4gICAgICBpZiAoZm9sZGVyVGFncy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWRkVGFnc1RvRmlsZShmaWxlLCBmb2xkZXJUYWdzKTtcbiAgICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgaGFuZGxlRmlsZU1vdmUoZmlsZTogVEZpbGUsIG9sZFBhdGg6IHN0cmluZykge1xuICAgIGNvbnNvbGUubG9nKGBGaWxlIG1vdmVkOiAke29sZFBhdGh9IC0+ICR7ZmlsZS5wYXRofWApO1xuXG4gICAgY29uc3Qgb2xkRm9sZGVyUGF0aCA9IG9sZFBhdGguc3Vic3RyaW5nKDAsIG9sZFBhdGgubGFzdEluZGV4T2YoXCIvXCIpKTtcbiAgICBjb25zdCBuZXdGb2xkZXIgPSBmaWxlLnBhcmVudDtcblxuICAgIGNvbnNvbGUubG9nKFxuICAgICAgYE9sZCBmb2xkZXIgcGF0aDogJHtvbGRGb2xkZXJQYXRofSwgTmV3IGZvbGRlcjogJHtuZXdGb2xkZXI/LnBhdGh9YFxuICAgICk7XG5cbiAgICBpZiAob2xkRm9sZGVyUGF0aCAhPT0gbmV3Rm9sZGVyPy5wYXRoKSB7XG4gICAgICBjb25zdCBvbGRGb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzV2l0aEluaGVyaXRhbmNlKG9sZEZvbGRlclBhdGgpO1xuICAgICAgY29uc3QgbmV3Rm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShcbiAgICAgICAgbmV3Rm9sZGVyPy5wYXRoIHx8IFwiXCJcbiAgICAgICk7XG5cbiAgICAgIC8vIE9ubHkgcHJvY2VlZCBpZiB0aGUgdGFncyBhcmUgZGlmZmVyZW50XG4gICAgICBpZiAoXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KG9sZEZvbGRlclRhZ3Muc29ydCgpKSAhPT1cbiAgICAgICAgSlNPTi5zdHJpbmdpZnkobmV3Rm9sZGVyVGFncy5zb3J0KCkpXG4gICAgICApIHtcbiAgICAgICAgY29uc29sZS5sb2coYE9sZCBmb2xkZXIgdGFnczogJHtvbGRGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYE5ldyBmb2xkZXIgdGFnczogJHtuZXdGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgICAgICBjb25zdCBjb25mbGljdGluZ1RhZ3MgPSB0aGlzLmRldGVjdENvbmZsaWN0aW5nVGFncyhmaWxlKTtcbiAgICAgICAgY29uc29sZS5sb2coYENvbmZsaWN0aW5nIHRhZ3M6ICR7Y29uZmxpY3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgICAgICBpZiAoY29uZmxpY3RpbmdUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBuZXcgQ29uZmxpY3RSZXNvbHV0aW9uTW9kYWwoXG4gICAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICAgIGZpbGUsXG4gICAgICAgICAgICBjb25mbGljdGluZ1RhZ3MsXG4gICAgICAgICAgICB0aGlzXG4gICAgICAgICAgKS5vcGVuKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3IEZpbGVNb3ZlZE1vZGFsKFxuICAgICAgICAgICAgdGhpcy5hcHAsXG4gICAgICAgICAgICBmaWxlLFxuICAgICAgICAgICAgb2xkRm9sZGVyVGFncyxcbiAgICAgICAgICAgIG5ld0ZvbGRlclRhZ3MsXG4gICAgICAgICAgICB0aGlzXG4gICAgICAgICAgKS5vcGVuKCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiRm9sZGVyIHRhZ3MgYXJlIHRoZSBzYW1lLCBubyB1cGRhdGUgbmVlZGVkXCIpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmxvZyhcIkZpbGUgbm90IG1vdmVkIGJldHdlZW4gZm9sZGVycyBvciBmb2xkZXJzIGFyZSB0aGUgc2FtZVwiKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhZGRUYWdzVG9GaWxlKGZpbGU6IFRGaWxlLCB0YWdzVG9BZGQ6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgLy8gT25seSBhZGQgdGFncyB0aGF0IGRvbid0IGFscmVhZHkgZXhpc3RcbiAgICBjb25zdCBuZXdUYWdzID0gdGFnc1RvQWRkLmZpbHRlcihcbiAgICAgICh0YWc6IHN0cmluZykgPT4gIWV4aXN0aW5nVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgKTtcbiAgICBjb25zdCBhbGxUYWdzID0gWy4uLmV4aXN0aW5nVGFncywgLi4ubmV3VGFnc107XG5cbiAgICAvLyBPbmx5IHVwZGF0ZSBpZiB0aGVyZSBhcmUgbmV3IHRhZ3MgdG8gYWRkXG4gICAgaWYgKG5ld1RhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgYWxsVGFncyk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG5cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLmRlYnVnTW9kZSkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQWRkZWQgbmV3IHRhZ3MgdG8gJHtmaWxlLm5hbWV9OmAsIG5ld1RhZ3MpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5zZXR0aW5ncy5kZWJ1Z01vZGUpIHtcbiAgICAgIGNvbnNvbGUubG9nKGBObyBuZXcgdGFncyB0byBhZGQgdG8gJHtmaWxlLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdXBkYXRlRmlsZVRhZ3MoXG4gICAgZmlsZTogVEZpbGUsXG4gICAgb2xkRm9sZGVyVGFnczogc3RyaW5nW10sXG4gICAgbmV3Rm9sZGVyVGFnczogc3RyaW5nW11cbiAgKSB7XG4gICAgY29uc29sZS5sb2coYFVwZGF0aW5nIHRhZ3MgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIGNvbnNvbGUubG9nKGBPbGQgZm9sZGVyIHRhZ3M6ICR7b2xkRm9sZGVyVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgY29uc29sZS5sb2coYE5ldyBmb2xkZXIgdGFnczogJHtuZXdGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgIGNvbnNvbGUubG9nKGBFeGlzdGluZyB0YWdzOiAke2V4aXN0aW5nVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAvLyBSZW1vdmUgb2xkIGZvbGRlciB0YWdzIGFuZCBrZWVwIG1hbnVhbCB0YWdzXG4gICAgY29uc3QgbWFudWFsVGFncyA9IGV4aXN0aW5nVGFncy5maWx0ZXIoXG4gICAgICAodGFnKSA9PiAhb2xkRm9sZGVyVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgKTtcblxuICAgIC8vIEFkZCBuZXcgZm9sZGVyIHRhZ3NcbiAgICBjb25zdCB1cGRhdGVkVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5tYW51YWxUYWdzLCAuLi5uZXdGb2xkZXJUYWdzXSldO1xuXG4gICAgY29uc29sZS5sb2coYE1hbnVhbCB0YWdzOiAke21hbnVhbFRhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIHRhZ3M6ICR7dXBkYXRlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgdXBkYXRlZFRhZ3MpO1xuXG4gICAgaWYgKGNvbnRlbnQgIT09IHVwZGF0ZWRDb250ZW50KSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgY29uc29sZS5sb2coYFRhZ3MgdXBkYXRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKGBObyBjaGFuZ2VzIG5lZWRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgdXBkYXRlVGFnc0luQ29udGVudChjb250ZW50OiBzdHJpbmcsIHRhZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgICAvLyBFbnN1cmUgdGFncyBhcmUgdW5pcXVlIHdoaWxlIHByZXNlcnZpbmcgb3JkZXJcbiAgICBjb25zdCB1bmlxdWVUYWdzID0gWy4uLm5ldyBTZXQodGFncyldO1xuXG4gICAgaWYgKHVuaXF1ZVRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZW1vdmVZYW1sRnJvbnRNYXR0ZXIoY29udGVudCk7XG4gICAgfVxuXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgIC8vIENyZWF0ZSB0aGUgdGFncyBzZWN0aW9uIGluIFlBTUwgZm9ybWF0XG4gICAgY29uc3QgdGFnU2VjdGlvbiA9IHVuaXF1ZVRhZ3MubWFwKCh0YWcpID0+IGAgIC0gJHt0YWd9YCkuam9pbihcIlxcblwiKTtcblxuICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICBjb25zdCBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG4gICAgICAvLyBSZW1vdmUgZXhpc3RpbmcgdGFncyBzZWN0aW9uIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZnJvbnRtYXR0ZXJcbiAgICAgIGNvbnN0IGNsZWFuZWRGcm9udG1hdHRlciA9IGZyb250bWF0dGVyXG4gICAgICAgIC5yZXBsYWNlKC90YWdzOltcXHNcXFNdKj8oPz1cXG5bXlxcc118XFxuJCkvbSwgXCJcIilcbiAgICAgICAgLnJlcGxhY2UoL1xcbisvZywgXCJcXG5cIilcbiAgICAgICAgLnRyaW0oKTtcblxuICAgICAgLy8gQWRkIG5ldyB0YWdzIHNlY3Rpb25cbiAgICAgIGNvbnN0IHVwZGF0ZWRGcm9udG1hdHRlciA9IGNsZWFuZWRGcm9udG1hdHRlclxuICAgICAgICA/IGAke2NsZWFuZWRGcm9udG1hdHRlcn1cXG50YWdzOlxcbiR7dGFnU2VjdGlvbn1gXG4gICAgICAgIDogYHRhZ3M6XFxuJHt0YWdTZWN0aW9ufWA7XG5cbiAgICAgIHJldHVybiBjb250ZW50LnJlcGxhY2UoXG4gICAgICAgIGZyb250bWF0dGVyUmVnZXgsXG4gICAgICAgIGAtLS1cXG4ke3VwZGF0ZWRGcm9udG1hdHRlcn1cXG4tLS1gXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYC0tLVxcbnRhZ3M6XFxuJHt0YWdTZWN0aW9ufVxcbi0tLVxcblxcbiR7Y29udGVudH1gO1xuICAgIH1cbiAgfVxuXG4gIGFkZFRhZ3NUb0NvbnRlbnQoY29udGVudDogc3RyaW5nLCB0YWdzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gICAgaWYgKHRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gY29udGVudDtcbiAgICB9XG5cbiAgICBjb25zdCB0YWdTZWN0aW9uID0gdGFncy5tYXAoKHRhZykgPT4gYCAgLSAke3RhZ31gKS5qb2luKFwiXFxuXCIpO1xuICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG5cbiAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgY29uc3QgdXBkYXRlZEZyb250bWF0dGVyID0gYCR7ZnJvbnRtYXR0ZXIudHJpbSgpfVxcbnRhZ3M6XFxuJHt0YWdTZWN0aW9ufWA7XG4gICAgICByZXR1cm4gY29udGVudC5yZXBsYWNlKFxuICAgICAgICBmcm9udG1hdHRlclJlZ2V4LFxuICAgICAgICBgLS0tXFxuJHt1cGRhdGVkRnJvbnRtYXR0ZXJ9XFxuLS0tYFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGAtLS1cXG50YWdzOlxcbiR7dGFnU2VjdGlvbn1cXG4tLS1cXG5cXG4ke2NvbnRlbnR9YDtcbiAgICB9XG4gIH1cblxuICByZW1vdmVUYWdzRnJvbUNvbnRlbnQoY29udGVudDogc3RyaW5nLCB0YWdzVG9SZW1vdmU6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IGZyb250bWF0dGVyLm1hdGNoKC90YWdzOlxccypcXFsoLio/KVxcXS8pO1xuXG4gICAgICBpZiAoZXhpc3RpbmdUYWdzKSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRUYWdzID0gZXhpc3RpbmdUYWdzWzFdLnNwbGl0KFwiLFwiKS5tYXAoKHRhZykgPT4gdGFnLnRyaW0oKSk7XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRUYWdzID0gY3VycmVudFRhZ3MuZmlsdGVyKFxuICAgICAgICAgICh0YWcpID0+ICF0YWdzVG9SZW1vdmUuaW5jbHVkZXModGFnKVxuICAgICAgICApO1xuICAgICAgICBjb25zdCB1cGRhdGVkRnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlci5yZXBsYWNlKFxuICAgICAgICAgIC90YWdzOlxccypcXFsuKj9cXF0vLFxuICAgICAgICAgIGB0YWdzOiBbJHt1cGRhdGVkVGFncy5qb2luKFwiLCBcIil9XWBcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZShcbiAgICAgICAgICBmcm9udG1hdHRlclJlZ2V4LFxuICAgICAgICAgIGAtLS1cXG4ke3VwZGF0ZWRGcm9udG1hdHRlcn1cXG4tLS1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH1cblxuICBhc3luYyBhcHBseUZpbGVUYWdzVG9Gb2xkZXIoZmlsZTogVEZpbGUpIHtcbiAgICBjb25zdCBmb2xkZXIgPSBmaWxlLnBhcmVudDtcbiAgICBpZiAoIWZvbGRlcikge1xuICAgICAgbmV3IE5vdGljZShcIkZpbGUgaXMgbm90IGluIGEgZm9sZGVyXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGZpbGVUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgY29uc29sZS5sb2coYEV4dHJhY3RlZCB0YWdzIGZyb20gZmlsZTogJHtmaWxlVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBpZiAoZmlsZVRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gdGFncyBmb3VuZCBpbiB0aGUgZmlsZVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBHZXQgdGFncyBvbmx5IGZyb20gdGhlIGltbWVkaWF0ZSBwYXJlbnQgZm9sZGVyXG4gICAgY29uc3QgZm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCk7XG4gICAgY29uc3QgbmV3VGFncyA9IFsuLi5uZXcgU2V0KFsuLi5mb2xkZXJUYWdzLCAuLi5maWxlVGFnc10pXTtcbiAgICBjb25zdCBhZGRlZFRhZ3MgPSBuZXdUYWdzLmZpbHRlcigodGFnKSA9PiAhZm9sZGVyVGFncy5pbmNsdWRlcyh0YWcpKTtcblxuICAgIGNvbnNvbGUubG9nKGBFeGlzdGluZyBmb2xkZXIgdGFnczogJHtmb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICBjb25zb2xlLmxvZyhgTmV3IHRhZ3MgdG8gYWRkOiAke2FkZGVkVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBpZiAoYWRkZWRUYWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbmV3IE5vdGljZShcIk5vIG5ldyB0YWdzIHRvIGFkZCB0byB0aGUgZm9sZGVyXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBUYWdTZWxlY3Rpb25Nb2RhbChcbiAgICAgIHRoaXMuYXBwLFxuICAgICAgYFNlbGVjdCB0YWdzIHRvIGFkZCBmcm9tIHRoZSBmaWxlIFwiJHtmaWxlLm5hbWV9XCIgdG8gdGhlIGZvbGRlciBcIiR7Zm9sZGVyLm5hbWV9XCI6YCxcbiAgICAgIGFkZGVkVGFncyxcbiAgICAgIChzZWxlY3RlZFRhZ3MpID0+IHtcbiAgICAgICAgY29uc3QgdXBkYXRlZFRhZ3MgPSBbLi4ubmV3IFNldChbLi4uZm9sZGVyVGFncywgLi4uc2VsZWN0ZWRUYWdzXSldO1xuICAgICAgICB0aGlzLnNldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgsIHVwZGF0ZWRUYWdzKTtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICBgQXBwbGllZCAke3NlbGVjdGVkVGFncy5sZW5ndGh9IHRhZ3MgZnJvbSBmaWxlIHRvIGZvbGRlcjogJHtmb2xkZXIubmFtZX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgKS5vcGVuKCk7XG4gIH1cblxuICBleHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgbGV0IHRhZ3M6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgLy8gTWF0Y2ggYm90aCBhcnJheS1zdHlsZSBhbmQgbGlzdC1zdHlsZSBZQU1MIHRhZ3NcbiAgICAgIGNvbnN0IHlhbWxUYWdzID0gZnJvbnRtYXR0ZXIubWF0Y2goL3RhZ3M6XFxzKihcXFsuKj9cXF18KFxcblxccyotXFxzKi4rKSspLyk7XG4gICAgICBpZiAoeWFtbFRhZ3MpIHtcbiAgICAgICAgY29uc3QgdGFnQ29udGVudCA9IHlhbWxUYWdzWzFdO1xuICAgICAgICBpZiAodGFnQ29udGVudC5zdGFydHNXaXRoKFwiW1wiKSkge1xuICAgICAgICAgIC8vIEFycmF5LXN0eWxlIHRhZ3NcbiAgICAgICAgICB0YWdzID0gdGFnQ29udGVudFxuICAgICAgICAgICAgLnNsaWNlKDEsIC0xKVxuICAgICAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAgICAgLm1hcCgodGFnKSA9PiB0YWcudHJpbSgpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBMaXN0LXN0eWxlIHRhZ3NcbiAgICAgICAgICB0YWdzID0gdGFnQ29udGVudFxuICAgICAgICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAgICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnJlcGxhY2UoL15cXHMqLVxccyovLCBcIlwiKS50cmltKCkpXG4gICAgICAgICAgICAuZmlsdGVyKCh0YWcpID0+IHRhZyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IGlubGluZSB0YWdzXG4gICAgY29uc3QgaW5saW5lVGFncyA9IGNvbnRlbnQubWF0Y2goLyNbXlxccyNdKy9nKTtcbiAgICBpZiAoaW5saW5lVGFncykge1xuICAgICAgdGFncyA9IFsuLi50YWdzLCAuLi5pbmxpbmVUYWdzLm1hcCgodGFnKSA9PiB0YWcuc3Vic3RyaW5nKDEpKV07XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRhZ3MpXTsgLy8gUmVtb3ZlIGR1cGxpY2F0ZXNcbiAgfVxuXG4gIGFzeW5jIGNvbnZlcnRJbmxpbmVUYWdzVG9ZQU1MKGZpbGU6IFRGaWxlKSB7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgaW5saW5lVGFncyA9IGNvbnRlbnQubWF0Y2goLyNbXlxccyNdKy9nKTtcblxuICAgIGlmICghaW5saW5lVGFncykge1xuICAgICAgbmV3IE5vdGljZShcIk5vIGlubGluZSB0YWdzIGZvdW5kIGluIHRoZSBmaWxlXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG5ld1RhZ3MgPSBpbmxpbmVUYWdzLm1hcCgodGFnKSA9PiB0YWcuc3Vic3RyaW5nKDEpKTtcblxuICAgIG5ldyBDb25maXJtYXRpb25Nb2RhbChcbiAgICAgIHRoaXMuYXBwLFxuICAgICAgYFRoaXMgd2lsbCBjb252ZXJ0ICR7bmV3VGFncy5sZW5ndGh9IGlubGluZSB0YWdzIHRvIFlBTUwgZnJvbnQgbWF0dGVyIGFuZCByZW1vdmUgdGhlbSBmcm9tIHRoZSBjb250ZW50LiBBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gcHJvY2VlZD9gLFxuICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICBuZXcgVGFnU2VsZWN0aW9uTW9kYWwoXG4gICAgICAgICAgdGhpcy5hcHAsXG4gICAgICAgICAgYFNlbGVjdCBpbmxpbmUgdGFncyB0byBjb252ZXJ0IHRvIFlBTUwgZnJvbnQgbWF0dGVyOmAsXG4gICAgICAgICAgbmV3VGFncyxcbiAgICAgICAgICBhc3luYyAoc2VsZWN0ZWRUYWdzKSA9PiB7XG4gICAgICAgICAgICBpZiAoc2VsZWN0ZWRUYWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiTm8gdGFncyBzZWxlY3RlZCBmb3IgY29udmVyc2lvblwiKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGV4aXN0aW5nIFlBTUwgdGFnc1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgICAgICAgICAvLyBDb21iaW5lIGV4aXN0aW5nIGFuZCBuZXcgdGFncywgcmVtb3ZpbmcgZHVwbGljYXRlc1xuICAgICAgICAgICAgY29uc3QgYWxsVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5leGlzdGluZ1RhZ3MsIC4uLnNlbGVjdGVkVGFnc10pXTtcblxuICAgICAgICAgICAgbGV0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy5hZGRUYWdzVG9Db250ZW50KGNvbnRlbnQsIGFsbFRhZ3MpO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgc2VsZWN0ZWQgaW5saW5lIHRhZ3MgZnJvbSB0aGUgY29udGVudFxuICAgICAgICAgICAgc2VsZWN0ZWRUYWdzLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAoYCMke3RhZ31cXFxcYmAsIFwiZ1wiKTtcbiAgICAgICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKHJlZ2V4LCBcIlwiKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICAgICAgYENvbnZlcnRlZCAke3NlbGVjdGVkVGFncy5sZW5ndGh9IGlubGluZSB0YWdzIHRvIFlBTUwgZnJvbnQgbWF0dGVyYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICkub3BlbigpO1xuICAgICAgfVxuICAgICkub3BlbigpO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVGb2xkZXJEZWxldGlvbihmb2xkZXI6IFRGb2xkZXIpIHtcbiAgICBkZWxldGUgdGhpcy5mb2xkZXJUYWdzW2ZvbGRlci5wYXRoXTtcbiAgICB0aGlzLnNhdmVGb2xkZXJUYWdzKCk7XG4gIH1cblxuICBhc3luYyBhcHBseUZvbGRlclRhZ3NUb0NvbnRlbnRzKGZvbGRlcjogVEZvbGRlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghZm9sZGVyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiRm9sZGVyIGlzIG51bGwgb3IgdW5kZWZpbmVkXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZvbGRlclRhZ3MgPSB0aGlzLmdldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgpO1xuICAgIGNvbnN0IGZpbGVzID0gZm9sZGVyLmNoaWxkcmVuLmZpbHRlcigoY2hpbGQpID0+IGNoaWxkIGluc3RhbmNlb2YgVEZpbGUpO1xuXG4gICAgbGV0IHVwZGF0ZWRDb3VudCA9IDA7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgICAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG4gICAgICAgIGNvbnN0IG5ld1RhZ3MgPSBmb2xkZXJUYWdzLmZpbHRlcihcbiAgICAgICAgICAodGFnOiBzdHJpbmcpID0+ICFleGlzdGluZ1RhZ3MuaW5jbHVkZXModGFnKVxuICAgICAgICApO1xuXG4gICAgICAgIGlmIChuZXdUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmFkZFRhZ3NUb0ZpbGUoZmlsZSwgbmV3VGFncyk7XG4gICAgICAgICAgdXBkYXRlZENvdW50Kys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodXBkYXRlZENvdW50ID4gMCkge1xuICAgICAgbmV3IE5vdGljZShgVXBkYXRlZCB0YWdzIGZvciAke3VwZGF0ZWRDb3VudH0gZmlsZShzKWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gZmlsZXMgbmVlZGVkIHRhZyB1cGRhdGVzXCIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemVEYXRhRmlsZSgpIHtcbiAgICBjb25zdCBpbml0aWFsRGF0YSA9IHtcbiAgICAgIHNldHRpbmdzOiBERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgZm9sZGVyVGFnczoge30sXG4gICAgfTtcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUyk7XG4gICAgdGhpcy5mb2xkZXJUYWdzID0ge307XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YShpbml0aWFsRGF0YSk7XG4gICAgY29uc29sZS5sb2coXCJJbml0aWFsaXplZCBkYXRhIGZpbGUgd2l0aCBkZWZhdWx0IHZhbHVlc1wiKTtcbiAgfVxuXG4gIHF1ZXVlTmV3Rm9sZGVyKGZvbGRlcjogVEZvbGRlcikge1xuICAgIC8vIEVuc3VyZSB3ZSBoYXZlIHRoZSBtb3N0IHVwLXRvLWRhdGUgZm9sZGVyIG9iamVjdFxuICAgIGNvbnN0IHVwZGF0ZWRGb2xkZXIgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZm9sZGVyLnBhdGgpO1xuICAgIGlmICh1cGRhdGVkRm9sZGVyIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgdGhpcy5uZXdGb2xkZXJRdWV1ZS5wdXNoKHVwZGF0ZWRGb2xkZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICBgRmFpbGVkIHRvIGdldCB1cGRhdGVkIGZvbGRlciBvYmplY3QgZm9yIHBhdGg6ICR7Zm9sZGVyLnBhdGh9YFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBwcm9jZXNzTmV3Rm9sZGVyUXVldWUoKSB7XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgdGhpcy5uZXdGb2xkZXJRdWV1ZSkge1xuICAgICAgYXdhaXQgdGhpcy5wcm9tcHRGb3JGb2xkZXJUYWdzKGZvbGRlcik7XG4gICAgfVxuICAgIHRoaXMubmV3Rm9sZGVyUXVldWUgPSBbXTsgLy8gQ2xlYXIgdGhlIHF1ZXVlXG4gIH1cblxuICBhc3luYyBwcm9tcHRGb3JGb2xkZXJUYWdzKGZvbGRlcjogVEZvbGRlcikge1xuICAgIG5ldyBGb2xkZXJUYWdNb2RhbCh0aGlzLmFwcCwgZm9sZGVyLCB0aGlzLCB0cnVlKS5vcGVuKCk7XG4gIH1cblxuICBnZXRGb2xkZXJUYWdzV2l0aEluaGVyaXRhbmNlKGZvbGRlclBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5pbmhlcml0YW5jZU1vZGUgPT09IFwibm9uZVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlclBhdGgpO1xuICAgIH1cblxuICAgIGxldCB0YWdzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGxldCBjdXJyZW50UGF0aCA9IGZvbGRlclBhdGg7XG5cbiAgICB3aGlsZSAoY3VycmVudFBhdGgpIHtcbiAgICAgIGlmICghdGhpcy5zZXR0aW5ncy5leGNsdWRlZEZvbGRlcnMuaW5jbHVkZXMoY3VycmVudFBhdGgpKSB7XG4gICAgICAgIHRhZ3MgPSBbLi4ubmV3IFNldChbLi4udGFncywgLi4udGhpcy5nZXRGb2xkZXJUYWdzKGN1cnJlbnRQYXRoKV0pXTtcbiAgICAgIH1cblxuICAgICAgaWYgKFxuICAgICAgICB0aGlzLnNldHRpbmdzLmluaGVyaXRhbmNlTW9kZSA9PT0gXCJpbW1lZGlhdGVcIiAmJlxuICAgICAgICBjdXJyZW50UGF0aCAhPT0gZm9sZGVyUGF0aFxuICAgICAgKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnRQYXRoID0gY3VycmVudFBhdGguc3Vic3RyaW5nKDAsIGN1cnJlbnRQYXRoLmxhc3RJbmRleE9mKFwiL1wiKSk7XG4gICAgICBpZiAocGFyZW50UGF0aCA9PT0gY3VycmVudFBhdGgpIHtcbiAgICAgICAgYnJlYWs7IC8vIFdlJ3ZlIHJlYWNoZWQgdGhlIHJvb3RcbiAgICAgIH1cbiAgICAgIGN1cnJlbnRQYXRoID0gcGFyZW50UGF0aDtcbiAgICB9XG5cbiAgICByZXR1cm4gdGFncztcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZUZvbGRlckljb25zKCkge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy5zaG93Rm9sZGVySWNvbnMpIHtcbiAgICAgIC8vIFJlbW92ZSBhbGwgZm9sZGVyIGljb25zIGlmIHRoZSBzZXR0aW5nIGlzIG9mZlxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtZXhwbG9yZXJcIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgICBjb25zdCBmaWxlRXhwbG9yZXJWaWV3ID0gbGVhZi52aWV3IGFzIGFueTtcbiAgICAgICAgY29uc3QgZmlsZUl0ZW1zID0gZmlsZUV4cGxvcmVyVmlldy5maWxlSXRlbXM7XG4gICAgICAgIGZvciAoY29uc3QgWywgaXRlbV0gb2YgT2JqZWN0LmVudHJpZXMoZmlsZUl0ZW1zKSkge1xuICAgICAgICAgIGlmIChpdGVtICYmIHR5cGVvZiBpdGVtID09PSBcIm9iamVjdFwiICYmIFwiZWxcIiBpbiBpdGVtKSB7XG4gICAgICAgICAgICBjb25zdCBmb2xkZXJFbCA9IGl0ZW0uZWwgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgICBjb25zdCBpY29uRWwgPSBmb2xkZXJFbC5xdWVyeVNlbGVjdG9yKFxuICAgICAgICAgICAgICBcIi5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIlxuICAgICAgICAgICAgKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgICAgICBpZiAoaWNvbkVsKSB7XG4gICAgICAgICAgICAgIGljb25FbC5yZW1vdmVDbGFzcyhcInRhZ2dlZC1mb2xkZXJcIik7XG4gICAgICAgICAgICAgIGljb25FbC5yZW1vdmVBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZUV4cGxvcmVyID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtZXhwbG9yZXJcIilbMF07XG4gICAgaWYgKCFmaWxlRXhwbG9yZXIpIHJldHVybjtcblxuICAgIGNvbnN0IGZpbGVFeHBsb3JlclZpZXcgPSBmaWxlRXhwbG9yZXIudmlldyBhcyBhbnk7XG4gICAgY29uc3QgZmlsZUl0ZW1zID0gZmlsZUV4cGxvcmVyVmlldy5maWxlSXRlbXM7XG5cbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBpdGVtXSBvZiBPYmplY3QuZW50cmllcyhmaWxlSXRlbXMpKSB7XG4gICAgICBpZiAoXG4gICAgICAgIGl0ZW0gJiZcbiAgICAgICAgdHlwZW9mIGl0ZW0gPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJlbFwiIGluIGl0ZW0gJiZcbiAgICAgICAgXCJmaWxlXCIgaW4gaXRlbSAmJlxuICAgICAgICBpdGVtLmZpbGUgaW5zdGFuY2VvZiBURm9sZGVyXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgZm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShwYXRoIGFzIHN0cmluZyk7XG4gICAgICAgIGNvbnN0IGZvbGRlckVsID0gaXRlbS5lbCBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgY29uc3QgaWNvbkVsID0gZm9sZGVyRWwucXVlcnlTZWxlY3RvcihcbiAgICAgICAgICBcIi5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIlxuICAgICAgICApIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcblxuICAgICAgICBpZiAoaWNvbkVsKSB7XG4gICAgICAgICAgaWYgKGZvbGRlclRhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgaWNvbkVsLmFkZENsYXNzKFwidGFnZ2VkLWZvbGRlclwiKTtcbiAgICAgICAgICAgIGljb25FbC5zZXRBdHRyaWJ1dGUoXG4gICAgICAgICAgICAgIFwiYXJpYS1sYWJlbFwiLFxuICAgICAgICAgICAgICBgVGFnZ2VkIGZvbGRlcjogJHtmb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpY29uRWwucmVtb3ZlQ2xhc3MoXCJ0YWdnZWQtZm9sZGVyXCIpO1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnNvbGUud2FybihgQ291bGQgbm90IGZpbmQgaWNvbiBlbGVtZW50IGZvciBmb2xkZXI6ICR7cGF0aH1gKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEFkZCB0aGlzIG5ldyBtZXRob2RcbiAgYXN5bmMgdXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpIHtcbiAgICB0cnkge1xuICAgICAgLy8gVHJpZ2dlciBtZXRhZGF0YSBjYWNoZSB1cGRhdGVcbiAgICAgIHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUudHJpZ2dlcihcImNoYW5nZWRcIik7XG5cbiAgICAgIC8vIFRyeSB0byByZWZyZXNoIHRoZSB0YWcgcGFuZSBpZiBpdCBleGlzdHNcbiAgICAgIGNvbnN0IHRhZ1BhbmVMZWF2ZXMgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwidGFnXCIpO1xuICAgICAgaWYgKHRhZ1BhbmVMZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBVc2UgdGhlIHdvcmtzcGFjZSB0cmlnZ2VyIGluc3RlYWQgb2YgZGlyZWN0bHkgY2FsbGluZyByZWZyZXNoXG4gICAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwidGFncy11cGRhdGVkXCIpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy5kZWJ1Z01vZGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byB1cGRhdGUgdGFnIGNhY2hlOlwiLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIHRoaXMgbmV3IG1ldGhvZFxuICBnZXRBbGxGb2xkZXJUYWdzKCk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhbGxUYWdzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCB0YWdzIG9mIE9iamVjdC52YWx1ZXModGhpcy5mb2xkZXJUYWdzKSkge1xuICAgICAgdGFncy5mb3JFYWNoKCh0YWc6IHN0cmluZykgPT4gYWxsVGFncy5hZGQodGFnKSk7XG4gICAgfVxuICAgIHJldHVybiBBcnJheS5mcm9tKGFsbFRhZ3MpO1xuICB9XG5cbiAgYXN5bmMgcmVwbGFjZUFsbFRhZ3MoZmlsZTogVEZpbGUsIG5ld1RhZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc29sZS5sb2coYFJlcGxhY2luZyBhbGwgdGFncyBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgY29uc29sZS5sb2coYE5ldyB0YWdzOiAke25ld1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG5cbiAgICAvLyBSZW1vdmUgYWxsIGV4aXN0aW5nIHRhZ3MgZnJvbSB0aGUgY29udGVudFxuICAgIGxldCB1cGRhdGVkQ29udGVudCA9IHRoaXMucmVtb3ZlQWxsVGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgLy8gQWRkIG5ldyB0YWdzXG4gICAgaWYgKG5ld1RhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSB1cGRhdGVkQ29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgICBjb25zdCBuZXdUYWdzU2VjdGlvbiA9IGB0YWdzOlxcbiR7bmV3VGFnc1xuICAgICAgICAgIC5tYXAoKHRhZykgPT4gYCAgLSAke3RhZ31gKVxuICAgICAgICAgIC5qb2luKFwiXFxuXCIpfWA7XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRGcm9udG1hdHRlciA9IGAke2Zyb250bWF0dGVyLnRyaW0oKX1cXG4ke25ld1RhZ3NTZWN0aW9ufWA7XG4gICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShcbiAgICAgICAgICBmcm9udG1hdHRlclJlZ2V4LFxuICAgICAgICAgIGAtLS1cXG4ke3VwZGF0ZWRGcm9udG1hdHRlcn1cXG4tLS1gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuZXdUYWdzU2VjdGlvbiA9IGB0YWdzOlxcbiR7bmV3VGFnc1xuICAgICAgICAgIC5tYXAoKHRhZykgPT4gYCAgLSAke3RhZ31gKVxuICAgICAgICAgIC5qb2luKFwiXFxuXCIpfWA7XG4gICAgICAgIHVwZGF0ZWRDb250ZW50ID0gYC0tLVxcbiR7bmV3VGFnc1NlY3Rpb259XFxuLS0tXFxuXFxuJHt1cGRhdGVkQ29udGVudH1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgbmV3IE5vdGljZShgVGFncyByZXBsYWNlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gIH1cblxuICByZW1vdmVBbGxUYWdzRnJvbUNvbnRlbnQoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG5bXFxzXFxTXSo/XFxuLS0tXFxuLztcbiAgICByZXR1cm4gY29udGVudC5yZXBsYWNlKGZyb250bWF0dGVyUmVnZXgsIFwiXCIpO1xuICB9XG5cbiAgYXN5bmMgbWVyZ2VUYWdzKFxuICAgIGZpbGU6IFRGaWxlLFxuICAgIG9sZFRhZ3M6IHN0cmluZ1tdLFxuICAgIG5ld1RhZ3M6IHN0cmluZ1tdXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnNvbGUubG9nKGBNZXJnaW5nIHRhZ3MgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIGNvbnNvbGUubG9nKGBPbGQgdGFnczogJHtvbGRUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICBjb25zb2xlLmxvZyhgTmV3IHRhZ3M6ICR7bmV3VGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICBjb25zb2xlLmxvZyhgRXhpc3RpbmcgdGFnczogJHtleGlzdGluZ1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgLy8gUmVtb3ZlIG9sZCBmb2xkZXIgdGFnc1xuICAgIGNvbnN0IG1hbnVhbFRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKCh0YWcpID0+ICFvbGRUYWdzLmluY2x1ZGVzKHRhZykpO1xuXG4gICAgLy8gTWVyZ2UgbWFudWFsIHRhZ3Mgd2l0aCBuZXcgZm9sZGVyIHRhZ3MsIGVuc3VyaW5nIG5vIGR1cGxpY2F0ZXNcbiAgICBjb25zdCBtZXJnZWRUYWdzID0gWy4uLm5ldyBTZXQoWy4uLm1hbnVhbFRhZ3MsIC4uLm5ld1RhZ3NdKV07XG5cbiAgICBjb25zb2xlLmxvZyhgTWVyZ2VkIHRhZ3M6ICR7bWVyZ2VkVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBpZiAoXG4gICAgICBKU09OLnN0cmluZ2lmeShleGlzdGluZ1RhZ3Muc29ydCgpKSAhPT0gSlNPTi5zdHJpbmdpZnkobWVyZ2VkVGFncy5zb3J0KCkpXG4gICAgKSB7XG4gICAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudChjb250ZW50LCBtZXJnZWRUYWdzKTtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICB0aGlzLnVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKTtcbiAgICAgIG5ldyBOb3RpY2UoYFRhZ3MgbWVyZ2VkIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5sb2coYE5vIGNoYW5nZXMgbmVlZGVkIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhcHBseUZvbGRlclRhZ3NUb05vdGVzKGZvbGRlcjogVEZvbGRlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGN1cnJlbnRGb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoKTtcbiAgICBjb25zb2xlLmxvZyhgQ3VycmVudCBmb2xkZXIgdGFnczogJHtjdXJyZW50Rm9sZGVyVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBpZiAoY3VycmVudEZvbGRlclRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICBuZXcgTm90aWNlKFwiVGhpcyBmb2xkZXIgaGFzIG5vIHRhZ3MgdG8gYXBwbHkuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVzID0gZm9sZGVyLmNoaWxkcmVuLmZpbHRlcihcbiAgICAgIChjaGlsZCk6IGNoaWxkIGlzIFRGaWxlID0+IGNoaWxkIGluc3RhbmNlb2YgVEZpbGVcbiAgICApO1xuICAgIGxldCB1cGRhdGVkQ291bnQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgICAgICAvLyBHZXQgdGhlIGN1cnJlbnQgZm9sZGVyJ3MgZXhpc3RpbmcgdGFncyBpbiB0aGUgZmlsZVxuICAgICAgICBjb25zdCBleGlzdGluZ0ZvbGRlclRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKCh0YWcpID0+XG4gICAgICAgICAgdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoKS5pbmNsdWRlcyh0YWcpXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gR2V0IG1hbnVhbGx5IGFkZGVkIHRhZ3MgKHRhZ3MgdGhhdCBhcmVuJ3QgZnJvbSB0aGUgZm9sZGVyKVxuICAgICAgICBjb25zdCBtYW51YWxUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcihcbiAgICAgICAgICAodGFnKSA9PiAhZXhpc3RpbmdGb2xkZXJUYWdzLmluY2x1ZGVzKHRhZylcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBDb21iaW5lIG1hbnVhbCB0YWdzIHdpdGggY3VycmVudCBmb2xkZXIgdGFnc1xuICAgICAgICBjb25zdCB1cGRhdGVkVGFncyA9IFsuLi5tYW51YWxUYWdzLCAuLi5jdXJyZW50Rm9sZGVyVGFnc107XG5cbiAgICAgICAgLy8gT25seSB1cGRhdGUgaWYgdGhlcmUgYXJlIGNoYW5nZXNcbiAgICAgICAgaWYgKFxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGV4aXN0aW5nVGFncy5zb3J0KCkpICE9PVxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHVwZGF0ZWRUYWdzLnNvcnQoKSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYEV4aXN0aW5nIHRhZ3M6ICR7ZXhpc3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgTWFudWFsIHRhZ3M6ICR7bWFudWFsVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgICAgICAgY29uc29sZS5sb2coYFVwZGF0ZWQgdGFnczogJHt1cGRhdGVkVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAgICAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudChjb250ZW50LCB1cGRhdGVkVGFncyk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgICAgICB1cGRhdGVkQ291bnQrKztcbiAgICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCB0YWdzIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgTm8gY2hhbmdlcyBuZWVkZWQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIGZpbGUgJHtmaWxlLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgICAgbmV3IE5vdGljZShgRXJyb3IgdXBkYXRpbmcgdGFncyBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHVwZGF0ZWRDb3VudCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoYFVwZGF0ZWQgdGFncyBmb3IgJHt1cGRhdGVkQ291bnR9IGZpbGUocykgaW4gJHtmb2xkZXIubmFtZX1gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IE5vdGljZShgTm8gZmlsZXMgbmVlZGVkIHRhZyB1cGRhdGVzIGluICR7Zm9sZGVyLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIHRoaXMgaGVscGVyIG1ldGhvZCB0byBjaGVjayBpZiBhIHRhZyBpcyB1c2VkIGJ5IGFueSBmb2xkZXJcbiAgcHJpdmF0ZSBpc0FueUZvbGRlclRhZyh0YWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHRoaXMuZm9sZGVyVGFncykuc29tZSgoZm9sZGVyVGFncykgPT5cbiAgICAgIGZvbGRlclRhZ3MuaW5jbHVkZXModGFnKVxuICAgICk7XG4gIH1cblxuICBhc3luYyByZW1vdmVUYWdzRnJvbUZpbGUoZmlsZTogVEZpbGUsIHRhZ3NUb1JlbW92ZTogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zb2xlLmxvZyhgUmVtb3ZpbmcgZm9sZGVyIHRhZ3MgZnJvbSBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICBjb25zb2xlLmxvZyhgVGFncyB0byByZW1vdmU6ICR7dGFnc1RvUmVtb3ZlLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgIGNvbnNvbGUubG9nKGBFeGlzdGluZyB0YWdzOiAke2V4aXN0aW5nVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAvLyBLZWVwIGFsbCB0YWdzIHRoYXQgYXJlIG5vdCBpbiB0YWdzVG9SZW1vdmVcbiAgICBjb25zdCB1cGRhdGVkVGFncyA9IGV4aXN0aW5nVGFncy5maWx0ZXIoXG4gICAgICAodGFnKSA9PiAhdGFnc1RvUmVtb3ZlLmluY2x1ZGVzKHRhZylcbiAgICApO1xuXG4gICAgY29uc29sZS5sb2coYFVwZGF0ZWQgdGFnczogJHt1cGRhdGVkVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAvLyBVc2UgdXBkYXRlVGFnc0luQ29udGVudCB0byB1cGRhdGUgdGhlIGZpbGUncyBjb250ZW50XG4gICAgbGV0IHVwZGF0ZWRDb250ZW50OiBzdHJpbmc7XG4gICAgaWYgKHVwZGF0ZWRUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgIHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVUYWdzSW5Db250ZW50KGNvbnRlbnQsIHVwZGF0ZWRUYWdzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgbm8gdGFncyByZW1haW4sIHJlbW92ZSB0aGUgZW50aXJlIFlBTUwgZnJvbnQgbWF0dGVyXG4gICAgICB1cGRhdGVkQ29udGVudCA9IHRoaXMucmVtb3ZlWWFtbEZyb250TWF0dGVyKGNvbnRlbnQpO1xuICAgIH1cblxuICAgIC8vIE9ubHkgbW9kaWZ5IHRoZSBmaWxlIGlmIHRoZSBjb250ZW50IGhhcyBjaGFuZ2VkXG4gICAgaWYgKGNvbnRlbnQgIT09IHVwZGF0ZWRDb250ZW50KSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgY29uc29sZS5sb2coYFVwZGF0ZWQgY29udGVudCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICB0aGlzLnVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKTtcbiAgICAgIG5ldyBOb3RpY2UoYFJlbW92ZWQgZm9sZGVyIHRhZ3MgZnJvbSBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5sb2coYE5vIGNoYW5nZXMgbmVlZGVkIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICB9XG4gIH1cblxuICByZW1vdmVZYW1sRnJvbnRNYXR0ZXIoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG5bXFxzXFxTXSo/XFxuLS0tXFxuLztcbiAgICByZXR1cm4gY29udGVudC5yZXBsYWNlKGZyb250bWF0dGVyUmVnZXgsIFwiXCIpO1xuICB9XG5cbiAgZGV0ZWN0Q29uZmxpY3RpbmdUYWdzKGZpbGU6IFRGaWxlKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHBhcmVudEZvbGRlcnMgPSB0aGlzLmdldFBhcmVudEZvbGRlcnMoZmlsZSk7XG4gICAgY29uc3QgYWxsVGFncyA9IHBhcmVudEZvbGRlcnMuZmxhdE1hcCgoZm9sZGVyKSA9PlxuICAgICAgdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoKVxuICAgICk7XG4gICAgcmV0dXJuIGFsbFRhZ3MuZmlsdGVyKCh0YWcsIGluZGV4LCBzZWxmKSA9PiBzZWxmLmluZGV4T2YodGFnKSAhPT0gaW5kZXgpO1xuICB9XG5cbiAgZ2V0UGFyZW50Rm9sZGVycyhmaWxlOiBURmlsZSk6IFRGb2xkZXJbXSB7XG4gICAgY29uc3QgZm9sZGVyczogVEZvbGRlcltdID0gW107XG4gICAgbGV0IGN1cnJlbnRGb2xkZXIgPSBmaWxlLnBhcmVudDtcbiAgICB3aGlsZSAoY3VycmVudEZvbGRlcikge1xuICAgICAgZm9sZGVycy5wdXNoKGN1cnJlbnRGb2xkZXIpO1xuICAgICAgY3VycmVudEZvbGRlciA9IGN1cnJlbnRGb2xkZXIucGFyZW50O1xuICAgIH1cbiAgICByZXR1cm4gZm9sZGVycztcbiAgfVxuXG4gIHByaXZhdGUgcmVtb3ZlRHVwbGljYXRlVGFncyh0YWdzOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQodGFncyldO1xuICB9XG5cbiAgcmVtb3ZlRm9sZGVySWNvbnMoKSB7XG4gICAgLy8gQ3VycmVudCBpbXBsZW1lbnRhdGlvbiBtaWdodCBtaXNzIHNvbWUgZWxlbWVudHNcbiAgICAvLyBBZGQgbW9yZSByb2J1c3QgZWxlbWVudCBzZWxlY3Rpb24gYW5kIGNsZWFudXBcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwiZmlsZS1leHBsb3JlclwiKS5mb3JFYWNoKChsZWFmKSA9PiB7XG4gICAgICBjb25zdCBmaWxlRXhwbG9yZXJWaWV3ID0gbGVhZi52aWV3IGFzIGFueTtcbiAgICAgIGNvbnN0IGZpbGVJdGVtcyA9IGZpbGVFeHBsb3JlclZpZXcuZmlsZUl0ZW1zO1xuICAgICAgZm9yIChjb25zdCBbLCBpdGVtXSBvZiBPYmplY3QuZW50cmllcyhmaWxlSXRlbXMpKSB7XG4gICAgICAgIGlmIChpdGVtICYmIHR5cGVvZiBpdGVtID09PSBcIm9iamVjdFwiICYmIFwiZWxcIiBpbiBpdGVtKSB7XG4gICAgICAgICAgY29uc3QgZm9sZGVyRWwgPSBpdGVtLmVsIGFzIEhUTUxFbGVtZW50O1xuICAgICAgICAgIGNvbnN0IGljb25FbCA9IGZvbGRlckVsLnF1ZXJ5U2VsZWN0b3IoXCIubmF2LWZvbGRlci10aXRsZS1jb250ZW50XCIpO1xuICAgICAgICAgIGlmIChpY29uRWwpIHtcbiAgICAgICAgICAgIGljb25FbC5yZW1vdmVDbGFzcyhcInRhZ2dlZC1mb2xkZXJcIik7XG4gICAgICAgICAgICBpY29uRWwucmVtb3ZlQXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiKTtcbiAgICAgICAgICAgIC8vIEFsc28gcmVtb3ZlIGFueSBvdGhlciBjdXN0b20gY2xhc3NlcyBvciBhdHRyaWJ1dGVzXG4gICAgICAgICAgICBpY29uRWwucmVtb3ZlQXR0cmlidXRlKFwiZGF0YS10YWdpdFwiKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGhhbmRsZUZpbGVNb3ZlbWVudChmaWxlOiBURmlsZSkge1xuICAgIC8vIEFkZCBkZWJvdW5jaW5nIHRvIHByZXZlbnQgbXVsdGlwbGUgcmFwaWQgZmlsZSBtb3ZlbWVudHMgZnJvbSBjYXVzaW5nIGlzc3Vlc1xuICAgIGlmICh0aGlzLm1vdmVUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5tb3ZlVGltZW91dCk7XG4gICAgfVxuICAgIHRoaXMubW92ZVRpbWVvdXQgPSBzZXRUaW1lb3V0KGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEV4aXN0aW5nIGZpbGUgbW92ZW1lbnQgbG9naWNcbiAgICB9LCAzMDApO1xuICB9XG5cbiAgYXN5bmMgbWlncmF0ZVNldHRpbmdzKG9sZERhdGE6IGFueSk6IFByb21pc2U8VGFnSXRTZXR0aW5ncz4ge1xuICAgIGNvbnNvbGUubG9nKFwiTWlncmF0aW5nIHNldHRpbmdzIGZyb20gb2xkIHZlcnNpb25cIik7XG4gICAgLy8gRm9yIG5vdywganVzdCByZXR1cm4gdGhlIGRlZmF1bHQgc2V0dGluZ3MgbWVyZ2VkIHdpdGggYW55IHZhbGlkIG9sZCBzZXR0aW5nc1xuICAgIHJldHVybiB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgLi4ue1xuICAgICAgICBpbmhlcml0YW5jZU1vZGU6XG4gICAgICAgICAgb2xkRGF0YS5pbmhlcml0YW5jZU1vZGUgfHwgREVGQVVMVF9TRVRUSU5HUy5pbmhlcml0YW5jZU1vZGUsXG4gICAgICAgIGV4Y2x1ZGVkRm9sZGVyczpcbiAgICAgICAgICBvbGREYXRhLmV4Y2x1ZGVkRm9sZGVycyB8fCBERUZBVUxUX1NFVFRJTkdTLmV4Y2x1ZGVkRm9sZGVycyxcbiAgICAgICAgc2hvd0ZvbGRlckljb25zOlxuICAgICAgICAgIG9sZERhdGEuc2hvd0ZvbGRlckljb25zIHx8IERFRkFVTFRfU0VUVElOR1Muc2hvd0ZvbGRlckljb25zLFxuICAgICAgICBhdXRvQXBwbHlUYWdzOiBvbGREYXRhLmF1dG9BcHBseVRhZ3MgfHwgREVGQVVMVF9TRVRUSU5HUy5hdXRvQXBwbHlUYWdzLFxuICAgICAgICBkZWJ1Z01vZGU6IG9sZERhdGEuZGVidWdNb2RlIHx8IERFRkFVTFRfU0VUVElOR1MuZGVidWdNb2RlLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgY2hlY2tBbmRSZW1vdmVEdXBsaWNhdGVUYWdzKGZvbGRlcjogVEZvbGRlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGVzID0gZm9sZGVyLmNoaWxkcmVuLmZpbHRlcihcbiAgICAgIChjaGlsZCk6IGNoaWxkIGlzIFRGaWxlID0+IGNoaWxkIGluc3RhbmNlb2YgVEZpbGVcbiAgICApO1xuICAgIGxldCBwcm9jZXNzZWRDb3VudCA9IDA7XG4gICAgbGV0IGR1cGxpY2F0ZXNGb3VuZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDaGVja2luZyBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG5cbiAgICAgICAgLy8gRXh0cmFjdCBZQU1MIGZyb250IG1hdHRlclxuICAgICAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgICAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgICAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICAgICAgICAvLyBDaGVjayBmb3IgZHVwbGljYXRlcyBieSBjb21wYXJpbmcgbGVuZ3Roc1xuICAgICAgICAgIGNvbnN0IHVuaXF1ZVRhZ3MgPSBbLi4ubmV3IFNldChleGlzdGluZ1RhZ3MpXTtcblxuICAgICAgICAgIGlmICh1bmlxdWVUYWdzLmxlbmd0aCA8IGV4aXN0aW5nVGFncy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCBkdXBsaWNhdGVzIGluIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYE9yaWdpbmFsIHRhZ3M6ICR7ZXhpc3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBVbmlxdWUgdGFnczogJHt1bmlxdWVUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgICAgICAgICAgLy8gQ3JlYXRlIG5ldyBZQU1MIGZyb250IG1hdHRlciB3aXRoIHVuaXF1ZSB0YWdzXG4gICAgICAgICAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudChcbiAgICAgICAgICAgICAgY29udGVudCxcbiAgICAgICAgICAgICAgdW5pcXVlVGFnc1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICAgICAgICBkdXBsaWNhdGVzRm91bmQrKztcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBSZW1vdmVkIGR1cGxpY2F0ZSB0YWdzIGZyb20gZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3NlZENvdW50Kys7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIGZpbGUgJHtmaWxlLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZHVwbGljYXRlc0ZvdW5kID4gMCkge1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYFJlbW92ZWQgZHVwbGljYXRlcyBmcm9tICR7ZHVwbGljYXRlc0ZvdW5kfSBvdXQgb2YgJHtwcm9jZXNzZWRDb3VudH0gZmlsZXMuYFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IE5vdGljZShgTm8gZHVwbGljYXRlcyBmb3VuZCBpbiAke3Byb2Nlc3NlZENvdW50fSBmaWxlcy5gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBiYXRjaENvbnZlcnRJbmxpbmVUYWdzVG9ZQU1MKGZpbGVzOiBURmlsZVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IHByb2Nlc3NlZENvdW50ID0gMDtcbiAgICBsZXQgc3VjY2Vzc0NvdW50ID0gMDtcbiAgICBsZXQgZXJyb3JDb3VudCA9IDA7XG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoZmlsZS5leHRlbnNpb24udG9Mb3dlckNhc2UoKSAhPT0gXCJtZFwiKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG5cbiAgICAgICAgLy8gU2tpcCBZQU1MIGZyb250IG1hdHRlciBpZiBpdCBleGlzdHNcbiAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuW1xcc1xcU10qP1xcbi0tLVxcbi87XG4gICAgICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuICAgICAgICBjb25zdCBjb250ZW50V2l0aG91dFlhbWwgPSBmcm9udG1hdHRlck1hdGNoXG4gICAgICAgICAgPyBjb250ZW50LnNsaWNlKGZyb250bWF0dGVyTWF0Y2hbMF0ubGVuZ3RoKVxuICAgICAgICAgIDogY29udGVudDtcblxuICAgICAgICAvLyBHZXQgZmlyc3QgdGhyZWUgbGluZXMgYWZ0ZXIgWUFNTFxuICAgICAgICBjb25zdCBmaXJzdFRocmVlTGluZXMgPSBjb250ZW50V2l0aG91dFlhbWwuc3BsaXQoXCJcXG5cIiwgMykuam9pbihcIlxcblwiKTtcbiAgICAgICAgY29uc3QgaW5saW5lVGFncyA9IGZpcnN0VGhyZWVMaW5lcy5tYXRjaCgvI1teXFxzI10rL2cpO1xuXG4gICAgICAgIGlmICghaW5saW5lVGFncykge1xuICAgICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgICAgYE5vIGlubGluZSB0YWdzIGZvdW5kIGluIGZpcnN0IHRocmVlIGxpbmVzIG9mOiAke2ZpbGUubmFtZX1gXG4gICAgICAgICAgKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG5ld1RhZ3MgPSBpbmxpbmVUYWdzLm1hcCgodGFnKSA9PiB0YWcuc3Vic3RyaW5nKDEpKTtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuICAgICAgICBjb25zdCBhbGxUYWdzID0gWy4uLm5ldyBTZXQoWy4uLmV4aXN0aW5nVGFncywgLi4ubmV3VGFnc10pXTtcblxuICAgICAgICAvLyBSZW1vdmUgaW5saW5lIHRhZ3MgZnJvbSBmaXJzdCB0aHJlZSBsaW5lcyB3aGlsZSBwcmVzZXJ2aW5nIFlBTUxcbiAgICAgICAgbGV0IHVwZGF0ZWRDb250ZW50ID0gY29udGVudDtcbiAgICAgICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgICAgICBjb25zdCBjb250ZW50TGluZXMgPSBjb250ZW50V2l0aG91dFlhbWwuc3BsaXQoXCJcXG5cIik7XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbigzLCBjb250ZW50TGluZXMubGVuZ3RoKTsgaSsrKSB7XG4gICAgICAgICAgICBjb250ZW50TGluZXNbaV0gPSBjb250ZW50TGluZXNbaV0ucmVwbGFjZSgvI1teXFxzI10rL2csIFwiXCIpLnRyaW0oKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdXBkYXRlZENvbnRlbnQgPVxuICAgICAgICAgICAgZnJvbnRtYXR0ZXJNYXRjaFswXSArIHRoaXMuY2xlYW5FbXB0eUxpbmVzKGNvbnRlbnRMaW5lcy5qb2luKFwiXFxuXCIpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjb250ZW50TGluZXMgPSBjb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgTWF0aC5taW4oMywgY29udGVudExpbmVzLmxlbmd0aCk7IGkrKykge1xuICAgICAgICAgICAgY29udGVudExpbmVzW2ldID0gY29udGVudExpbmVzW2ldLnJlcGxhY2UoLyNbXlxccyNdKy9nLCBcIlwiKS50cmltKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdGhpcy5jbGVhbkVtcHR5TGluZXMoY29udGVudExpbmVzLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIHRhZ3MgdG8gWUFNTCBmcm9udCBtYXR0ZXJcbiAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQodXBkYXRlZENvbnRlbnQsIGFsbFRhZ3MpO1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuXG4gICAgICAgIHN1Y2Nlc3NDb3VudCsrO1xuICAgICAgICBjb25zb2xlLmxvZyhgU3VjY2Vzc2Z1bGx5IGNvbnZlcnRlZCB0YWdzIGluOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgZmlsZSAke2ZpbGUubmFtZX06YCwgZXJyb3IpO1xuICAgICAgICBlcnJvckNvdW50Kys7XG4gICAgICAgIGVycm9ycy5wdXNoKGZpbGUubmFtZSk7XG4gICAgICB9XG4gICAgICBwcm9jZXNzZWRDb3VudCsrO1xuICAgIH1cblxuICAgIC8vIFNob3cgc3VtbWFyeSBwb3B1cFxuICAgIG5ldyBCYXRjaENvbnZlcnNpb25SZXN1bHRNb2RhbChcbiAgICAgIHRoaXMuYXBwLFxuICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICBzdWNjZXNzQ291bnQsXG4gICAgICBlcnJvckNvdW50LFxuICAgICAgZXJyb3JzXG4gICAgKS5vcGVuKCk7XG4gIH1cblxuICBhc3luYyBiYXRjaENvbnZlcnRXaXRoQ29uZmlybWF0aW9uKGZpbGVzOiBURmlsZVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd0JhdGNoQ29udmVyc2lvbldhcm5pbmcpIHtcbiAgICAgIG5ldyBCYXRjaENvbnZlcnNpb25XYXJuaW5nTW9kYWwodGhpcy5hcHAsIGZpbGVzLCB0aGlzKS5vcGVuKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuYmF0Y2hDb252ZXJ0SW5saW5lVGFnc1RvWUFNTChmaWxlcyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjbGVhbkVtcHR5TGluZXMoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gY29udGVudFxuICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAuZmlsdGVyKChsaW5lLCBpbmRleCwgYXJyYXkpID0+IHtcbiAgICAgICAgLy8gS2VlcCBub24tZW1wdHkgbGluZXNcbiAgICAgICAgaWYgKGxpbmUudHJpbSgpKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgLy8gS2VlcCBzaW5nbGUgZW1wdHkgbGluZXMgYmV0d2VlbiBjb250ZW50XG4gICAgICAgIGlmIChpbmRleCA+IDAgJiYgaW5kZXggPCBhcnJheS5sZW5ndGggLSAxKSB7XG4gICAgICAgICAgY29uc3QgcHJldkxpbmUgPSBhcnJheVtpbmRleCAtIDFdLnRyaW0oKTtcbiAgICAgICAgICBjb25zdCBuZXh0TGluZSA9IGFycmF5W2luZGV4ICsgMV0udHJpbSgpO1xuICAgICAgICAgIHJldHVybiBwcmV2TGluZSAmJiBuZXh0TGluZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9KVxuICAgICAgLmpvaW4oXCJcXG5cIik7XG4gIH1cbn1cblxuY2xhc3MgRm9sZGVyVGFnTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZvbGRlcjogVEZvbGRlcjtcbiAgcGx1Z2luOiBUYWdJdFBsdWdpbjtcbiAgZm9sZGVyTmFtZUlucHV0OiBUZXh0Q29tcG9uZW50O1xuICB0YWdzSW5wdXQ6IFRleHRDb21wb25lbnQ7XG4gIHRhZ3M6IHN0cmluZyA9IFwiXCI7XG4gIGlzTmV3Rm9sZGVyOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIGZvbGRlcjogVEZvbGRlcixcbiAgICBwbHVnaW46IFRhZ0l0UGx1Z2luLFxuICAgIGlzTmV3Rm9sZGVyOiBib29sZWFuID0gZmFsc2VcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLmZvbGRlciA9IGZvbGRlcjtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmlzTmV3Rm9sZGVyID0gaXNOZXdGb2xkZXI7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiQWRkL0VkaXQgRm9sZGVyIFRhZ3NcIiB9KTtcblxuICAgIC8vIEZvbGRlciBuYW1lIGZpZWxkXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5zZXROYW1lKFwiRm9sZGVyIE5hbWVcIikuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgdGhpcy5mb2xkZXJOYW1lSW5wdXQgPSB0ZXh0O1xuICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLmZvbGRlci5uYW1lKTtcbiAgICAgIHRleHQuaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCB0aGlzLmhhbmRsZUVudGVyLmJpbmQodGhpcykpO1xuICAgICAgcmV0dXJuIHRleHQ7XG4gICAgfSk7XG5cbiAgICAvLyBUYWdzIGZpZWxkXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5zZXROYW1lKFwiVGFnc1wiKS5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICB0aGlzLnRhZ3NJbnB1dCA9IHRleHQ7XG4gICAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLnBsdWdpbi5nZXRGb2xkZXJUYWdzKHRoaXMuZm9sZGVyLnBhdGgpO1xuICAgICAgdGhpcy50YWdzID0gZXhpc3RpbmdUYWdzLmpvaW4oXCIsIFwiKTtcbiAgICAgIHRleHQuc2V0VmFsdWUodGhpcy50YWdzKTtcbiAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCJFbnRlciB0YWdzLCBjb21tYS1zZXBhcmF0ZWRcIikub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMudGFncyA9IHZhbHVlO1xuICAgICAgfSk7XG4gICAgICB0ZXh0LmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgdGhpcy5oYW5kbGVFbnRlci5iaW5kKHRoaXMpKTtcbiAgICAgIHJldHVybiB0ZXh0O1xuICAgIH0pO1xuXG4gICAgLy8gQ2FuY2VsIGFuZCBTYXZlIGJ1dHRvbnMgKG9yZGVyIHN3YXBwZWQpXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiU2F2ZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2F2ZUZvbGRlclRhZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIGhhbmRsZUVudGVyKGV2ZW50OiBLZXlib2FyZEV2ZW50KSB7XG4gICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiICYmICFldmVudC5zaGlmdEtleSkge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIHRoaXMuc2F2ZUZvbGRlclRhZ3MoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzYXZlRm9sZGVyVGFncygpIHtcbiAgICBjb25zdCBuZXdGb2xkZXJOYW1lID0gdGhpcy5mb2xkZXJOYW1lSW5wdXQuZ2V0VmFsdWUoKTtcbiAgICBsZXQgZm9sZGVyUGF0aCA9IHRoaXMuZm9sZGVyLnBhdGg7XG5cbiAgICBpZiAobmV3Rm9sZGVyTmFtZSAhPT0gdGhpcy5mb2xkZXIubmFtZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbmV3UGF0aCA9IHRoaXMuZm9sZGVyLnBhcmVudFxuICAgICAgICAgID8gYCR7dGhpcy5mb2xkZXIucGFyZW50LnBhdGh9LyR7bmV3Rm9sZGVyTmFtZX1gXG4gICAgICAgICAgOiBuZXdGb2xkZXJOYW1lO1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci5yZW5hbWVGaWxlKHRoaXMuZm9sZGVyLCBuZXdQYXRoKTtcbiAgICAgICAgY29uc29sZS5sb2coXG4gICAgICAgICAgYFJlbmFtZWQgZm9sZGVyIGZyb20gJHt0aGlzLmZvbGRlci5uYW1lfSB0byAke25ld0ZvbGRlck5hbWV9YFxuICAgICAgICApO1xuXG4gICAgICAgIC8vIFdhaXQgZm9yIGEgc2hvcnQgdGltZSB0byBhbGxvdyB0aGUgZmlsZSBzeXN0ZW0gdG8gdXBkYXRlXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpO1xuXG4gICAgICAgIC8vIFVwZGF0ZSBmb2xkZXIgcmVmZXJlbmNlIGFuZCBwYXRoXG4gICAgICAgIGNvbnN0IG5ld0ZvbGRlciA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChuZXdQYXRoKTtcbiAgICAgICAgaWYgKG5ld0ZvbGRlciBpbnN0YW5jZW9mIFRGb2xkZXIpIHtcbiAgICAgICAgICB0aGlzLmZvbGRlciA9IG5ld0ZvbGRlcjtcbiAgICAgICAgICBmb2xkZXJQYXRoID0gbmV3UGF0aDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICBgQ291bGQgbm90IGdldCBuZXcgZm9sZGVyIG9iamVjdCwgdXNpbmcgbmV3IHBhdGg6ICR7bmV3UGF0aH1gXG4gICAgICAgICAgKTtcbiAgICAgICAgICBmb2xkZXJQYXRoID0gbmV3UGF0aDtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIHJlbmFtZSBmb2xkZXI6ICR7ZXJyb3J9YCk7XG4gICAgICAgIG5ldyBOb3RpY2UoYEZhaWxlZCB0byByZW5hbWUgZm9sZGVyOiAke2Vycm9yfWApO1xuICAgICAgICAvLyBDb250aW51ZSB3aXRoIHRoZSBvcmlnaW5hbCBmb2xkZXIgbmFtZSBhbmQgcGF0aFxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEVuc3VyZSBmb2xkZXJQYXRoIGRvZXNuJ3Qgc3RhcnQgd2l0aCAnLy8nXG4gICAgZm9sZGVyUGF0aCA9IGZvbGRlclBhdGgucmVwbGFjZSgvXlxcLysvLCBcIlwiKTtcblxuICAgIGNvbnN0IHRhZ0FycmF5ID0gdGhpcy50YWdzXG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAubWFwKCh0YWcpID0+IHRhZy50cmltKCkpXG4gICAgICAuZmlsdGVyKCh0YWcpID0+IHRhZyAhPT0gXCJcIik7XG5cbiAgICAvLyBDaGVjayBmb3IgbnVtYmVyLW9ubHkgdGFnc1xuICAgIGNvbnN0IG51bWJlck9ubHlUYWdzID0gdGFnQXJyYXkuZmlsdGVyKCh0YWcpID0+IC9eXFxkKyQvLnRlc3QodGFnKSk7XG4gICAgaWYgKG51bWJlck9ubHlUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGBFcnJvcjogTnVtYmVyLW9ubHkgdGFncyBhcmUgbm90IGFsbG93ZWQuIFBsZWFzZSByZW1vdmU6ICR7bnVtYmVyT25seVRhZ3Muam9pbihcbiAgICAgICAgICBcIiwgXCJcbiAgICAgICAgKX1gXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMucGx1Z2luLnNldEZvbGRlclRhZ3MoZm9sZGVyUGF0aCwgdGFnQXJyYXkpO1xuICAgIGNvbnNvbGUubG9nKGBTYXZlZCB0YWdzIGZvciBmb2xkZXIgJHtmb2xkZXJQYXRofTogJHt0YWdBcnJheS5qb2luKFwiLCBcIil9YCk7XG4gICAgbmV3IE5vdGljZShgVGFncyBzYXZlZCBmb3IgZm9sZGVyOiAke2ZvbGRlclBhdGh9YCk7XG5cbiAgICBpZiAodGhpcy5pc05ld0ZvbGRlcikge1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlGb2xkZXJUYWdzVG9Db250ZW50cyh0aGlzLmZvbGRlcik7XG4gICAgICBjb25zb2xlLmxvZyhgQXBwbGllZCB0YWdzIHRvIGNvbnRlbnRzIG9mIG5ldyBmb2xkZXI6ICR7Zm9sZGVyUGF0aH1gKTtcbiAgICB9XG5cbiAgICB0aGlzLmNsb3NlKCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbmNsYXNzIFRhZ0l0U2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwbHVnaW46IFRhZ0l0UGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IFRhZ0l0UGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICAvLyBBZGQgbG9nbyBjb250YWluZXIgd2l0aCBzcGVjaWZpYyBzdHlsaW5nXG4gICAgY29uc3QgbG9nb0NvbnRhaW5lciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdihcInRhZ2l0LWxvZ28tY29udGFpbmVyXCIpO1xuICAgIGxvZ29Db250YWluZXIuaW5uZXJIVE1MID0gYFxuICAgICAgPGRpdiBzdHlsZT1cInRleHQtYWxpZ246IGNlbnRlcjsgbWFyZ2luLWJvdHRvbTogMmVtO1wiPlxuICAgICAgICA8c3ZnIHdpZHRoPVwiNTJcIiBoZWlnaHQ9XCIyMVwiIHZpZXdCb3g9XCIwIDAgNTIgMjFcIiBmaWxsPVwibm9uZVwiIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIj4gXG4gICAgICAgICAgPHBhdGggZmlsbC1ydWxlPVwiZXZlbm9kZFwiIGNsaXAtcnVsZT1cImV2ZW5vZGRcIiBkPVwiTTEuMDQ3NjMgNC4xNTA4QzAuMzgyNjg4IDQuNzIwNzUgMCA1LjU1MjggMCA2LjQyODU3VjE3LjA0ODhDMCAxOC43MDU2IDEuMzQzMTUgMjAuMDQ4OCAzIDIwLjA0ODhIMTFDMTIuNjU2OSAyMC4wNDg4IDE0IDE4LjcwNTYgMTQgMTcuMDQ4OFY2LjQyODU3QzE0IDUuNTUyOCAxMy42MTczIDQuNzIwNzUgMTIuOTUyNCA0LjE1MDhMOC45NTIzNyAwLjcyMjIzQzcuODI4OTEgLTAuMjQwNzQzIDYuMTcxMSAtMC4yNDA3NDQgNS4wNDc2MyAwLjcyMjIzTDEuMDQ3NjMgNC4xNTA4Wk03LjEwMzE4IDEzLjYwOTJMNi42NzU2OCAxNi4wNDg4SDguNjQ3MDZMOS4wNzgwMSAxMy42MDkySDEwLjU1NDhWMTEuOTY1OUg5LjM2ODI5TDkuNTQ5MTUgMTAuOTQySDExVjkuMzExNDFIOS44MzcyTDEwLjIzNjkgNy4wNDg3N0g4LjI1Mjc4TDcuODU2MjkgOS4zMTE0MUg2Ljg0Mkw3LjIzNTI5IDcuMDQ4NzdINS4yNzY2M0w0Ljg3Njk0IDkuMzExNDFIMy40NTc4N1YxMC45NDJINC41ODg5TDQuNDA4MDMgMTEuOTY1OUgzVjEzLjYwOTJINC4xMTc3NUwzLjY4NjggMTYuMDQ4OEg1LjY3MDkxTDYuMDk0OTYgMTMuNjA5Mkg3LjEwMzE4Wk03LjM5MTEzIDExLjk2NTlMNy41NzA1NSAxMC45NDJINi41NTg1Nkw2LjM4MDU5IDExLjk2NTlINy4zOTExM1pcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMzUuNjk4MyAxNS40NDI0QzM1LjExNDMgMTUuNDQyNCAzNC41OTQzIDE1LjMzNDQgMzQuMTM4MyAxNS4xMTg0QzMzLjY5MDMgMTQuOTAyNCAzMy4zMzAzIDE0LjU5ODQgMzMuMDU4MyAxNC4yMDY0TDMzLjc1NDMgMTMuNDk4NEMzMy45ODYzIDEzLjc5NDQgMzQuMjYyMyAxNC4wMTg0IDM0LjU4MjMgMTQuMTcwNEMzNC45MDIzIDE0LjMzMDQgMzUuMjgyMyAxNC40MTA0IDM1LjcyMjMgMTQuNDEwNEMzNi4zMDYzIDE0LjQxMDQgMzYuNzY2MyAxNC4yNTQ0IDM3LjEwMjMgMTMuOTQyNEMzNy40NDYzIDEzLjYzODQgMzcuNjE4MyAxMy4yMjY0IDM3LjYxODMgMTIuNzA2NFYxMS4yOTA0TDM3LjgxMDMgMTAuMDA2NEwzNy42MTgzIDguNzM0MzhWNy4yMzQzOEgzOC42OTgzVjEyLjcwNjRDMzguNjk4MyAxMy4yNTA0IDM4LjU3MDMgMTMuNzI2NCAzOC4zMTQzIDE0LjEzNDRDMzguMDY2MyAxNC41NDI0IDM3LjcxNDMgMTQuODYyNCAzNy4yNTgzIDE1LjA5NDRDMzYuODEwMyAxNS4zMjY0IDM2LjI5MDMgMTUuNDQyNCAzNS42OTgzIDE1LjQ0MjRaTTM1LjY5ODMgMTIuODM4NEMzNS4xNzgzIDEyLjgzODQgMzQuNzEwMyAxMi43MTQ0IDM0LjI5NDMgMTIuNDY2NEMzMy44ODYzIDEyLjIxODQgMzMuNTYyMyAxMS44Nzg0IDMzLjMyMjMgMTEuNDQ2NEMzMy4wODIzIDExLjAwNjQgMzIuOTYyMyAxMC41MTQ0IDMyLjk2MjMgOS45NzAzOEMzMi45NjIzIDkuNDI2MzggMzMuMDgyMyA4Ljk0MjM4IDMzLjMyMjMgOC41MTgzOEMzMy41NjIzIDguMDg2MzggMzMuODg2MyA3Ljc0NjM4IDM0LjI5NDMgNy40OTgzOEMzNC43MTAzIDcuMjQyMzggMzUuMTc4MyA3LjExNDM4IDM1LjY5ODMgNy4xMTQzOEMzNi4xNDYzIDcuMTE0MzggMzYuNTQyMyA3LjIwMjM4IDM2Ljg4NjMgNy4zNzgzOEMzNy4yMzAzIDcuNTU0MzggMzcuNTAyMyA3LjgwMjM4IDM3LjcwMjMgOC4xMjIzOEMzNy45MTAzIDguNDM0MzggMzguMDIyMyA4LjgwMjM4IDM4LjAzODMgOS4yMjYzOFYxMC43Mzg0QzM4LjAxNDMgMTEuMTU0NCAzNy44OTgzIDExLjUyMjQgMzcuNjkwMyAxMS44NDI0QzM3LjQ5MDMgMTIuMTU0NCAzNy4yMTgzIDEyLjM5ODQgMzYuODc0MyAxMi41NzQ0QzM2LjUzMDMgMTIuNzUwNCAzNi4xMzgzIDEyLjgzODQgMzUuNjk4MyAxMi44Mzg0Wk0zNS45MTQzIDExLjgxODRDMzYuMjY2MyAxMS44MTg0IDM2LjU3NDMgMTEuNzQyNCAzNi44MzgzIDExLjU5MDRDMzcuMTEwMyAxMS40Mzg0IDM3LjMxODMgMTEuMjI2NCAzNy40NjIzIDEwLjk1NDRDMzcuNjA2MyAxMC42NzQ0IDM3LjY3ODMgMTAuMzUwNCAzNy42NzgzIDkuOTgyMzhDMzcuNjc4MyA5LjYxNDM4IDM3LjYwMjMgOS4yOTQzOCAzNy40NTAzIDkuMDIyMzhDMzcuMzA2MyA4Ljc0MjM4IDM3LjEwMjMgOC41MjYzOCAzNi44MzgzIDguMzc0MzhDMzYuNTc0MyA4LjIxNDM4IDM2LjI2MjMgOC4xMzQzOCAzNS45MDIzIDguMTM0MzhDMzUuNTQyMyA4LjEzNDM4IDM1LjIyNjMgOC4yMTQzOCAzNC45NTQzIDguMzc0MzhDMzQuNjgyMyA4LjUyNjM4IDM0LjQ2NjMgOC43NDIzOCAzNC4zMDYzIDkuMDIyMzhDMzQuMTU0MyA5LjI5NDM4IDM0LjA3ODMgOS42MTAzOCAzNC4wNzgzIDkuOTcwMzhDMzQuMDc4MyAxMC4zMzA0IDM0LjE1NDMgMTAuNjUwNCAzNC4zMDYzIDEwLjkzMDRDMzQuNDY2MyAxMS4yMTA0IDM0LjY4MjMgMTEuNDMwNCAzNC45NTQzIDExLjU5MDRDMzUuMjM0MyAxMS43NDI0IDM1LjU1NDMgMTEuODE4NCAzNS45MTQzIDExLjgxODRaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTI4Ljc3NCAxMy4wNTQ0QzI4LjI1NCAxMy4wNTQ0IDI3Ljc4MiAxMi45MjY0IDI3LjM1OCAxMi42NzA0QzI2LjkzNCAxMi40MDY0IDI2LjU5OCAxMi4wNTA0IDI2LjM1IDExLjYwMjRDMjYuMTEgMTEuMTU0NCAyNS45OSAxMC42NTA0IDI1Ljk5IDEwLjA5MDRDMjUuOTkgOS41MzAzOCAyNi4xMSA5LjAyNjM4IDI2LjM1IDguNTc4MzhDMjYuNTk4IDguMTMwMzggMjYuOTMgNy43NzQzOCAyNy4zNDYgNy41MTAzOEMyNy43NyA3LjI0NjM4IDI4LjI0NiA3LjExNDM4IDI4Ljc3NCA3LjExNDM4QzI5LjIwNiA3LjExNDM4IDI5LjU5IDcuMjA2MzggMjkuOTI2IDcuMzkwMzhDMzAuMjcgNy41NjYzOCAzMC41NDYgNy44MTQzOCAzMC43NTQgOC4xMzQzOEMzMC45NjIgOC40NDYzOCAzMS4wNzggOC44MTAzOCAzMS4xMDIgOS4yMjYzOFYxMC45NDI0QzMxLjA3OCAxMS4zNTA0IDMwLjk2MiAxMS43MTQ0IDMwLjc1NCAxMi4wMzQ0QzMwLjU1NCAxMi4zNTQ0IDMwLjI4MiAxMi42MDY0IDI5LjkzOCAxMi43OTA0QzM5LjYwMiAxMi45NjY0IDI5LjIxNCAxMy4wNTQ0IDI4Ljc3NCAxMy4wNTQ0Wk0yOC45NTQgMTIuMDM0NEMyOS40OSAxMi4wMzQ0IDI5LjkyMiAxMS44NTQ0IDMwLjI1IDExLjQ5NDRDMzAuNTc4IDExLjEyNjQgMzAuNzQyIDEwLjY1ODQgMzAuNzQyIDEwLjA5MDRDMzAuNzQyIDkuNjk4MzggMzAuNjY2IDkuMzU4MzggMzAuNTE0IDkuMDcwMzhDMzAuMzcgOC43NzQzOCAzMC4xNjIgOC41NDYzOCAyOS44OSA4LjM4NjM4QzI5LjYxOCA4LjIxODM4IDI5LjMwMiA4LjEzNDM4IDI4Ljk0MiA4LjEzNDM4QzI4LjU4MiA4LjEzNDM4IDI4LjI2MiA4LjIxODM4IDI3Ljk4MiA4LjM4NjM4QzI3LjcxIDguNTU0MzggMjcuNDk0IDguNzg2MzggMjcuMzM0IDkuMDgyMzhDMjcuMTgyIDkuMzcwMzggMjcuMTA2IDkuNzAyMzggMjcuMTA2IDEwLjA3ODRDMjcuMTA2IDEwLjQ2MjQgMjcuMTgyIDEwLjgwMjQgMjcuMzM0IDExLjA5ODRDMjcuNDk0IDExLjM4NjQgMjcuNzE0IDExLjYxNDQgMjcuOTk0IDExLjc4MjRDMjguMjc0IDExLjk1MDQgMjguNTk0IDEyLjAzNDQgMjguOTU0IDEyLjAzNDRaTTMwLjY3IDEyLjkzNDRWMTEuMzk4NEwzMC44NzQgMTAuMDA2NEwzMC42NyA4LjYyNjM4VjcuMjM0MzhIMzEuNzYyVjEyLjkzNDRIMzAuNjdaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTIyLjgzMiAxMi45MzQ0VjQuODQ2MzhIMjMuOTZWMTIuOTM0NEgyMi44MzJaTTIwIDUuNjM4MzhWNC42MDYzOEgyNi43OFY1LjYzODM4SDIwWlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk00MC42OTgzIDEyLjk5NjRWNC40NTIzOUg0My4wOTgzVjEyLjk5NjRINDAuNjk4M1pcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNDYuNjU0MyAxMi45OTY0VjQuNDUyMzlINDkuMDU0M1YxMi45OTY0SDQ2LjY1NDNaTTQ0LjA5ODMgNi40OTIzOVY0LjQ1MjM5SDUxLjYyMjNWNi40OTIzOUg0NC4wOTgzWlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgIDwvc3ZnPlxuICAgICAgPC9kaXY+XG4gICAgYDtcblxuICAgIC8vIFJlc3Qgb2YgeW91ciBzZXR0aW5ncyBjb2RlLi4uXG5cbiAgICAvLyBSZXN0IG9mIHlvdXIgc2V0dGluZ3MuLi5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiVGFnIEluaGVyaXRhbmNlIE1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGhvdyB0YWdzIGFyZSBpbmhlcml0ZWQgaW4gbmVzdGVkIGZvbGRlcnNcIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm5vbmVcIiwgXCJObyBpbmhlcml0YW5jZVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJpbW1lZGlhdGVcIiwgXCJJbmhlcml0IGZyb20gaW1tZWRpYXRlIHBhcmVudFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJhbGxcIiwgXCJJbmhlcml0IGZyb20gYWxsIHBhcmVudHNcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5oZXJpdGFuY2VNb2RlKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluaGVyaXRhbmNlTW9kZSA9IHZhbHVlIGFzXG4gICAgICAgICAgICAgIHwgXCJub25lXCJcbiAgICAgICAgICAgICAgfCBcImltbWVkaWF0ZVwiXG4gICAgICAgICAgICAgIHwgXCJhbGxcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkV4Y2x1ZGVkIEZvbGRlcnNcIilcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBcIkVudGVyIGZvbGRlciBwYXRocyB0byBleGNsdWRlIGZyb20gdGFnIGluaGVyaXRhbmNlIChvbmUgcGVyIGxpbmUpXCJcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcImZvbGRlcjFcXG5mb2xkZXIyL3N1YmZvbGRlclwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5leGNsdWRlZEZvbGRlcnMuam9pbihcIlxcblwiKSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5leGNsdWRlZEZvbGRlcnMgPSB2YWx1ZVxuICAgICAgICAgICAgICAuc3BsaXQoXCJcXG5cIilcbiAgICAgICAgICAgICAgLmZpbHRlcigoZikgPT4gZi50cmltKCkgIT09IFwiXCIpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiU2hvdyBGb2xkZXIgSWNvbnNcIilcbiAgICAgIC5zZXREZXNjKFwiRGlzcGxheSBpY29ucyBuZXh0IHRvIGZvbGRlcnMgd2l0aCB0YWdzXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93Rm9sZGVySWNvbnMpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd0ZvbGRlckljb25zID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi51cGRhdGVGb2xkZXJJY29ucygpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVtb3ZlRm9sZGVySWNvbnMoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBdXRvLWFwcGx5IFRhZ3NcIilcbiAgICAgIC5zZXREZXNjKFwiQXV0b21hdGljYWxseSBhcHBseSBmb2xkZXIgdGFncyB0byBuZXcgZmlsZXNcIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9BcHBseVRhZ3MpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b0FwcGx5VGFncyA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRGVidWcgTW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJFbmFibGUgZGV0YWlsZWQgbG9nZ2luZyBmb3IgdHJvdWJsZXNob290aW5nXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWJ1Z01vZGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVidWdNb2RlID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIC8vIEFkZCB0aGlzIG5ldyBzZXR0aW5nIHNlY3Rpb25cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQmF0Y2ggQ29udmVyc2lvbiBXYXJuaW5nXCIpXG4gICAgICAuc2V0RGVzYyhcIlJlLWVuYWJsZSB0aGUgd2FybmluZyB3aGVuIGNvbnZlcnRpbmcgaW5saW5lIHRhZ3MgdG8gWUFNTFwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIlJlc2V0IFdhcm5pbmdcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd0JhdGNoQ29udmVyc2lvbldhcm5pbmcgPSB0cnVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJCYXRjaCBjb252ZXJzaW9uIHdhcm5pbmcgaGFzIGJlZW4gcmUtZW5hYmxlZFwiKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiTmV3IEZvbGRlciBNb2RhbFwiKVxuICAgICAgLnNldERlc2MoXCJTaG93IHRhZyBtb2RhbCB3aGVuIGNyZWF0aW5nIG5ldyBmb2xkZXJzXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93TmV3Rm9sZGVyTW9kYWwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd05ld0ZvbGRlck1vZGFsID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxufVxuXG5jbGFzcyBDb25maXJtYXRpb25Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgb25Db25maXJtOiAoKSA9PiB2b2lkO1xuICBtZXNzYWdlOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIG1lc3NhZ2U6IHN0cmluZywgb25Db25maXJtOiAoKSA9PiB2b2lkKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiB0aGlzLm1lc3NhZ2UgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDb25maXJtXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgICAgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuY2xhc3MgVGFnU2VsZWN0aW9uTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHRhZ3M6IHN0cmluZ1tdO1xuICBvbkNvbmZpcm06IChzZWxlY3RlZFRhZ3M6IHN0cmluZ1tdKSA9PiB2b2lkO1xuICBtZXNzYWdlOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHRhZ3M6IHN0cmluZ1tdLFxuICAgIG9uQ29uZmlybTogKHNlbGVjdGVkVGFnczogc3RyaW5nW10pID0+IHZvaWRcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgIHRoaXMudGFncyA9IHRhZ3M7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IHRoaXMubWVzc2FnZSB9KTtcblxuICAgIGNvbnN0IHRhZ0NvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoXCJ0YWctY29udGFpbmVyXCIpO1xuICAgIHRoaXMudGFncy5mb3JFYWNoKCh0YWcpID0+IHtcbiAgICAgIGNvbnN0IHRhZ0VsID0gdGFnQ29udGFpbmVyLmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInRhZ1wiIH0pO1xuICAgICAgdGFnRWwuY3JlYXRlU3Bhbih7IHRleHQ6IHRhZyB9KTtcbiAgICAgIGNvbnN0IHJlbW92ZUJ1dHRvbiA9IHRhZ0VsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJYXCIgfSk7XG4gICAgICByZW1vdmVCdXR0b24ub25jbGljayA9ICgpID0+IHtcbiAgICAgICAgdGhpcy50YWdzID0gdGhpcy50YWdzLmZpbHRlcigodCkgPT4gdCAhPT0gdGFnKTtcbiAgICAgICAgdGFnRWwucmVtb3ZlKCk7XG4gICAgICB9O1xuICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ29uZmlybVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICAgIHRoaXMub25Db25maXJtKHRoaXMudGFncyk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy50aXRsZUVsLmVtcHR5KCk7XG4gIH1cbn1cblxuY2xhc3MgRmlsZU1vdmVkTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZpbGU6IFRGaWxlO1xuICBvbGRUYWdzOiBzdHJpbmdbXTtcbiAgbmV3VGFnczogc3RyaW5nW107XG4gIHBsdWdpbjogVGFnSXRQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgZmlsZTogVEZpbGUsXG4gICAgb2xkVGFnczogc3RyaW5nW10sXG4gICAgbmV3VGFnczogc3RyaW5nW10sXG4gICAgcGx1Z2luOiBUYWdJdFBsdWdpblxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gICAgdGhpcy5vbGRUYWdzID0gb2xkVGFncztcbiAgICB0aGlzLm5ld1RhZ3MgPSBuZXdUYWdzO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIkZpbGUgTW92ZWRcIiB9KTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IGBGaWxlIFwiJHt0aGlzLmZpbGUubmFtZX1cIiBoYXMgYmVlbiBtb3ZlZC5gLFxuICAgIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIkhvdyB3b3VsZCB5b3UgbGlrZSB0byBoYW5kbGUgdGhlIHRhZ3M/XCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlJlcGxhY2UgQWxsXCIpXG4gICAgICAuc2V0RGVzYyhcIlJlcGxhY2UgYWxsIGV4aXN0aW5nIHRhZ3Mgd2l0aCBuZXcgZm9sZGVyIHRhZ3NcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJSZXBsYWNlIEFsbFwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlcGxhY2VBbGxUYWdzKHRoaXMuZmlsZSwgdGhpcy5uZXdUYWdzKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiTWVyZ2VcIilcbiAgICAgIC5zZXREZXNjKFwiS2VlcCBleGlzdGluZyB0YWdzIGFuZCBhZGQgbmV3IGZvbGRlciB0YWdzXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiTWVyZ2VcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5tZXJnZVRhZ3ModGhpcy5maWxlLCB0aGlzLm9sZFRhZ3MsIHRoaXMubmV3VGFncyk7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIk5vIEFjdGlvblwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIHRhZ3MgYXMgdGhleSBhcmVcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJObyBBY3Rpb25cIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuY2xhc3MgQ29uZmxpY3RSZXNvbHV0aW9uTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZpbGU6IFRGaWxlO1xuICBjb25mbGljdGluZ1RhZ3M6IHN0cmluZ1tdO1xuICBwbHVnaW46IFRhZ0l0UGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIGZpbGU6IFRGaWxlLFxuICAgIGNvbmZsaWN0aW5nVGFnczogc3RyaW5nW10sXG4gICAgcGx1Z2luOiBUYWdJdFBsdWdpblxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gICAgdGhpcy5jb25mbGljdGluZ1RhZ3MgPSBjb25mbGljdGluZ1RhZ3M7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiVGFnIENvbmZsaWN0IERldGVjdGVkXCIgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBgVGhlIGZvbGxvd2luZyB0YWdzIGFyZSBhc3NpZ25lZCBieSBtdWx0aXBsZSBwYXJlbnQgZm9sZGVyczpgLFxuICAgIH0pO1xuXG4gICAgY29uc3QgdGFnTGlzdCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInVsXCIpO1xuICAgIHRoaXMuY29uZmxpY3RpbmdUYWdzLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgdGFnTGlzdC5jcmVhdGVFbChcImxpXCIsIHsgdGV4dDogdGFnIH0pO1xuICAgIH0pO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcIkhvdyB3b3VsZCB5b3UgbGlrZSB0byBoYW5kbGUgdGhlc2UgY29uZmxpY3RzP1wiLFxuICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIEFsbFwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIGFsbCBpbnN0YW5jZXMgb2YgY29uZmxpY3RpbmcgdGFnc1wiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIktlZXAgQWxsXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlQ29uZmxpY3QoXCJrZWVwQWxsXCIpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIE9uZVwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIG9ubHkgb25lIGluc3RhbmNlIG9mIGVhY2ggY29uZmxpY3RpbmcgdGFnXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiS2VlcCBPbmVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVDb25mbGljdChcImtlZXBPbmVcIik7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlJlbW92ZSBBbGxcIilcbiAgICAgIC5zZXREZXNjKFwiUmVtb3ZlIGFsbCBpbnN0YW5jZXMgb2YgY29uZmxpY3RpbmcgdGFnc1wiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlbW92ZSBBbGxcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVDb25mbGljdChcInJlbW92ZUFsbFwiKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIGFzeW5jIHJlc29sdmVDb25mbGljdChyZXNvbHV0aW9uOiBcImtlZXBBbGxcIiB8IFwia2VlcE9uZVwiIHwgXCJyZW1vdmVBbGxcIikge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLnBsdWdpbi5hcHAudmF1bHQucmVhZCh0aGlzLmZpbGUpO1xuICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMucGx1Z2luLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG4gICAgbGV0IHVwZGF0ZWRUYWdzOiBzdHJpbmdbXTtcblxuICAgIHN3aXRjaCAocmVzb2x1dGlvbikge1xuICAgICAgY2FzZSBcImtlZXBBbGxcIjpcbiAgICAgICAgdXBkYXRlZFRhZ3MgPSBleGlzdGluZ1RhZ3M7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcImtlZXBPbmVcIjpcbiAgICAgICAgdXBkYXRlZFRhZ3MgPSBbLi4ubmV3IFNldChleGlzdGluZ1RhZ3MpXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwicmVtb3ZlQWxsXCI6XG4gICAgICAgIHVwZGF0ZWRUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcihcbiAgICAgICAgICAodGFnKSA9PiAhdGhpcy5jb25mbGljdGluZ1RhZ3MuaW5jbHVkZXModGFnKVxuICAgICAgICApO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMucGx1Z2luLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoXG4gICAgICBjb250ZW50LFxuICAgICAgdXBkYXRlZFRhZ3NcbiAgICApO1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcC52YXVsdC5tb2RpZnkodGhpcy5maWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgdGhpcy5wbHVnaW4udXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuICAgIG5ldyBOb3RpY2UoYFJlc29sdmVkIHRhZyBjb25mbGljdHMgZm9yIGZpbGU6ICR7dGhpcy5maWxlLm5hbWV9YCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBCYXRjaENvbnZlcnNpb25SZXN1bHRNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJvY2Vzc2VkQ291bnQ6IG51bWJlcjtcbiAgc3VjY2Vzc0NvdW50OiBudW1iZXI7XG4gIGVycm9yQ291bnQ6IG51bWJlcjtcbiAgZXJyb3JzOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcm9jZXNzZWRDb3VudDogbnVtYmVyLFxuICAgIHN1Y2Nlc3NDb3VudDogbnVtYmVyLFxuICAgIGVycm9yQ291bnQ6IG51bWJlcixcbiAgICBlcnJvcnM6IHN0cmluZ1tdXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wcm9jZXNzZWRDb3VudCA9IHByb2Nlc3NlZENvdW50O1xuICAgIHRoaXMuc3VjY2Vzc0NvdW50ID0gc3VjY2Vzc0NvdW50O1xuICAgIHRoaXMuZXJyb3JDb3VudCA9IGVycm9yQ291bnQ7XG4gICAgdGhpcy5lcnJvcnMgPSBlcnJvcnM7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiQmF0Y2ggQ29udmVyc2lvbiBDb21wbGV0ZVwiIH0pO1xuXG4gICAgY29uc3Qgc3RhdHNDb250YWluZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KFwic3RhdHMtY29udGFpbmVyXCIpO1xuICAgIHN0YXRzQ29udGFpbmVyLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBgUHJvY2Vzc2VkOiAke3RoaXMucHJvY2Vzc2VkQ291bnR9IGZpbGVzYCxcbiAgICB9KTtcbiAgICBzdGF0c0NvbnRhaW5lci5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogYFN1Y2Nlc3NmdWxseSBjb252ZXJ0ZWQ6ICR7dGhpcy5zdWNjZXNzQ291bnR9IGZpbGVzYCxcbiAgICB9KTtcblxuICAgIGlmICh0aGlzLmVycm9yQ291bnQgPiAwKSB7XG4gICAgICBjb25zdCBlcnJvclNlY3Rpb24gPSBjb250ZW50RWwuY3JlYXRlRGl2KFwiZXJyb3Itc2VjdGlvblwiKTtcbiAgICAgIGVycm9yU2VjdGlvbi5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRmFpbGVkIHRvIHByb2Nlc3MgJHt0aGlzLmVycm9yQ291bnR9IGZpbGVzOmAsXG4gICAgICAgIGNsczogXCJlcnJvci1oZWFkZXJcIixcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBlcnJvckxpc3QgPSBlcnJvclNlY3Rpb24uY3JlYXRlRWwoXCJ1bFwiKTtcbiAgICAgIHRoaXMuZXJyb3JzLmZvckVhY2goKGZpbGVOYW1lKSA9PiB7XG4gICAgICAgIGVycm9yTGlzdC5jcmVhdGVFbChcImxpXCIsIHsgdGV4dDogZmlsZU5hbWUgfSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgYnRuXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ2xvc2VcIilcbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuY2xhc3MgQmF0Y2hDb252ZXJzaW9uV2FybmluZ01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBmaWxlczogVEZpbGVbXTtcbiAgcGx1Z2luOiBUYWdJdFBsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgZmlsZXM6IFRGaWxlW10sIHBsdWdpbjogVGFnSXRQbHVnaW4pIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuZmlsZXMgPSBmaWxlcztcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJCYXRjaCBDb252ZXJ0IFRhZ3MgdG8gWUFNTFwiIH0pO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBgVGhpcyB3aWxsIGNvbnZlcnQgaW5saW5lIHRhZ3MgdG8gWUFNTCBmcm9udCBtYXR0ZXIgaW4gJHt0aGlzLmZpbGVzLmxlbmd0aH0gZmlsZShzKS4gVGhpcyBhY3Rpb24gY2Fubm90IGJlIGF1dG9tYXRpY2FsbHkgdW5kb25lLmAsXG4gICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0cnVlKVxuICAgICAgICAgIC5zZXRUb29sdGlwKFwiU2hvdyB0aGlzIHdhcm5pbmcgbmV4dCB0aW1lXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd0JhdGNoQ29udmVyc2lvbldhcm5pbmcgPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApXG4gICAgICAuc2V0TmFtZShcIlNob3cgdGhpcyB3YXJuaW5nIG5leHQgdGltZVwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB0aGlzLmNsb3NlKCkpXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUHJvY2VlZFwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmJhdGNoQ29udmVydElubGluZVRhZ3NUb1lBTUwodGhpcy5maWxlcyk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG4iXSwibmFtZXMiOlsiUGx1Z2luIiwiVEZvbGRlciIsIlRGaWxlIiwiTm90aWNlIiwiTW9kYWwiLCJTZXR0aW5nIiwiUGx1Z2luU2V0dGluZ1RhYiJdLCJtYXBwaW5ncyI6Ijs7OztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFvR0E7QUFDTyxTQUFTLFNBQVMsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUU7QUFDN0QsSUFBSSxTQUFTLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxPQUFPLEtBQUssWUFBWSxDQUFDLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxDQUFDLFVBQVUsT0FBTyxFQUFFLEVBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUU7QUFDaEgsSUFBSSxPQUFPLEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxPQUFPLENBQUMsRUFBRSxVQUFVLE9BQU8sRUFBRSxNQUFNLEVBQUU7QUFDL0QsUUFBUSxTQUFTLFNBQVMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFO0FBQ25HLFFBQVEsU0FBUyxRQUFRLENBQUMsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFO0FBQ3RHLFFBQVEsU0FBUyxJQUFJLENB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
