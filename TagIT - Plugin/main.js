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
            this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
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
                }
                if (file instanceof obsidian.TFile) {
                    menu.addItem((item) => {
                        item
                            .setTitle("Apply Tags to Folder")
                            .setIcon("tag")
                            .onClick(() => this.applyFileTagsToFolder(file));
                    });
                    menu.addItem((item) => {
                        item
                            .setTitle("Convert Inline Tags to YAML")
                            .setIcon("tag")
                            .onClick(() => this.convertInlineTagsToYAML(file));
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
            const allTags = this.removeDuplicateTags([...existingTags, ...tagsToAdd]);
            const updatedContent = this.updateTagsInContent(content, allTags);
            if (content !== updatedContent) {
                yield this.app.vault.modify(file, updatedContent);
                this.updateObsidianTagCache();
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
        const uniqueTags = [...new Set(tags)];
        if (uniqueTags.length === 0) {
            return this.removeYamlFrontMatter(content);
        }
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        const tagSection = uniqueTags.map((tag) => `  - ${tag}`).join("\n");
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            const updatedFrontmatter = frontmatter.replace(/tags:[\s\S]*?(\n|$)/, `tags:\n${tagSection}\n`);
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
            for (const file of files) {
                yield this.addTagsToFile(file, folderTags);
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
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        if (frontmatterMatch) {
            let frontmatter = frontmatterMatch[1];
            // Remove both list-style and array-style tag declarations
            frontmatter = frontmatter.replace(/^tags:[\s\S]*?(\n[^\s]|\n$)/m, "$1");
            frontmatter = frontmatter.replace(/^- .*\n?/gm, "");
            frontmatter = frontmatter.trim();
            if (frontmatter) {
                return content.replace(frontmatterRegex, `---\n${frontmatter}\n---`);
            }
            else {
                // If frontmatter is empty after removing tags, remove the entire frontmatter
                return content.replace(frontmatterRegex, "");
            }
        }
        return content;
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
            const folderTags = this.getFolderTags(folder.path);
            if (folderTags.length === 0) {
                new obsidian.Notice("This folder has no tags to apply.");
                return;
            }
            const files = folder.children.filter((child) => child instanceof obsidian.TFile);
            let updatedCount = 0;
            for (const file of files) {
                const content = yield this.app.vault.read(file);
                const existingTags = this.extractTagsFromContent(content);
                const mergedTags = [...new Set([...existingTags, ...folderTags])];
                if (mergedTags.length > existingTags.length) {
                    const updatedContent = this.updateTagsInContent(content, mergedTags);
                    yield this.app.vault.modify(file, updatedContent);
                    updatedCount++;
                }
            }
            new obsidian.Notice(`Applied folder tags to ${updatedCount} file(s) in ${folder.name}`);
        });
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
          <path d="M28.774 13.0544C28.254 13.0544 27.782 12.9264 27.358 12.6704C26.934 12.4064 26.598 12.0504 26.35 11.6024C26.11 11.1544 25.99 10.6504 25.99 10.0904C25.99 9.53038 26.11 9.02638 26.35 8.57838C26.598 8.13038 26.93 7.77438 27.346 7.51038C27.77 7.24638 28.246 7.11438 28.774 7.11438C29.206 7.11438 29.59 7.20638 29.926 7.39038C30.27 7.56638 30.546 7.81438 30.754 8.13438C30.962 8.44638 31.078 8.81038 31.102 9.22638V10.9424C31.078 11.3504 30.962 11.7144 30.754 12.0344C30.554 12.3544 30.282 12.6064 29.938 12.7904C29.602 12.9664 29.214 13.0544 28.774 13.0544ZM28.954 12.0344C29.49 12.0344 29.922 11.8544 30.25 11.4944C30.578 11.1264 30.742 10.6584 30.742 10.0904C30.742 9.69838 30.666 9.35838 30.514 9.07038C30.37 8.77438 30.162 8.54638 29.89 8.38638C29.618 8.21838 29.302 8.13438 28.942 8.13438C28.582 8.13438 28.262 8.21838 27.982 8.38638C27.71 8.55438 27.494 8.78638 27.334 9.08238C27.182 9.37038 27.106 9.70238 27.106 10.0784C27.106 10.4624 27.182 10.8024 27.334 11.0984C27.494 11.3864 27.714 11.6144 27.994 11.7824C28.274 11.9504 28.594 12.0344 28.954 12.0344ZM30.67 12.9344V11.3984L30.874 10.0064L30.67 8.62638V7.23438H31.762V12.9344H30.67Z" fill="currentColor"/>
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

module.exports = TagItPlugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3RzbGliL3RzbGliLmVzNi5qcyIsIm1haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG5Db3B5cmlnaHQgKGMpIE1pY3Jvc29mdCBDb3Jwb3JhdGlvbi5cclxuXHJcblBlcm1pc3Npb24gdG8gdXNlLCBjb3B5LCBtb2RpZnksIGFuZC9vciBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUgZm9yIGFueVxyXG5wdXJwb3NlIHdpdGggb3Igd2l0aG91dCBmZWUgaXMgaGVyZWJ5IGdyYW50ZWQuXHJcblxyXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiIEFORCBUSEUgQVVUSE9SIERJU0NMQUlNUyBBTEwgV0FSUkFOVElFUyBXSVRIXHJcblJFR0FSRCBUTyBUSElTIFNPRlRXQVJFIElOQ0xVRElORyBBTEwgSU1QTElFRCBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWVxyXG5BTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsXHJcbklORElSRUNULCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgT1IgQU5ZIERBTUFHRVMgV0hBVFNPRVZFUiBSRVNVTFRJTkcgRlJPTVxyXG5MT1NTIE9GIFVTRSwgREFUQSBPUiBQUk9GSVRTLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgTkVHTElHRU5DRSBPUlxyXG5PVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SXHJcblBFUkZPUk1BTkNFIE9GIFRISVMgU09GVFdBUkUuXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqICovXHJcbi8qIGdsb2JhbCBSZWZsZWN0LCBQcm9taXNlLCBTdXBwcmVzc2VkRXJyb3IsIFN5bWJvbCwgSXRlcmF0b3IgKi9cclxuXHJcbnZhciBleHRlbmRTdGF0aWNzID0gZnVuY3Rpb24oZCwgYikge1xyXG4gICAgZXh0ZW5kU3RhdGljcyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fFxyXG4gICAgICAgICh7IF9fcHJvdG9fXzogW10gfSBpbnN0YW5jZW9mIEFycmF5ICYmIGZ1bmN0aW9uIChkLCBiKSB7IGQuX19wcm90b19fID0gYjsgfSkgfHxcclxuICAgICAgICBmdW5jdGlvbiAoZCwgYikgeyBmb3IgKHZhciBwIGluIGIpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYiwgcCkpIGRbcF0gPSBiW3BdOyB9O1xyXG4gICAgcmV0dXJuIGV4dGVuZFN0YXRpY3MoZCwgYik7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHRlbmRzKGQsIGIpIHtcclxuICAgIGlmICh0eXBlb2YgYiAhPT0gXCJmdW5jdGlvblwiICYmIGIgIT09IG51bGwpXHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNsYXNzIGV4dGVuZHMgdmFsdWUgXCIgKyBTdHJpbmcoYikgKyBcIiBpcyBub3QgYSBjb25zdHJ1Y3RvciBvciBudWxsXCIpO1xyXG4gICAgZXh0ZW5kU3RhdGljcyhkLCBiKTtcclxuICAgIGZ1bmN0aW9uIF9fKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gZDsgfVxyXG4gICAgZC5wcm90b3R5cGUgPSBiID09PSBudWxsID8gT2JqZWN0LmNyZWF0ZShiKSA6IChfXy5wcm90b3R5cGUgPSBiLnByb3RvdHlwZSwgbmV3IF9fKCkpO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fYXNzaWduID0gZnVuY3Rpb24oKSB7XHJcbiAgICBfX2Fzc2lnbiA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gX19hc3NpZ24odCkge1xyXG4gICAgICAgIGZvciAodmFyIHMsIGkgPSAxLCBuID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xyXG4gICAgICAgICAgICBzID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkpIHRbcF0gPSBzW3BdO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdDtcclxuICAgIH1cclxuICAgIHJldHVybiBfX2Fzc2lnbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZXN0KHMsIGUpIHtcclxuICAgIHZhciB0ID0ge307XHJcbiAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkgJiYgZS5pbmRleE9mKHApIDwgMClcclxuICAgICAgICB0W3BdID0gc1twXTtcclxuICAgIGlmIChzICE9IG51bGwgJiYgdHlwZW9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocyk7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmIChlLmluZGV4T2YocFtpXSkgPCAwICYmIE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChzLCBwW2ldKSlcclxuICAgICAgICAgICAgICAgIHRbcFtpXV0gPSBzW3BbaV1dO1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiB0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYykge1xyXG4gICAgdmFyIGMgPSBhcmd1bWVudHMubGVuZ3RoLCByID0gYyA8IDMgPyB0YXJnZXQgOiBkZXNjID09PSBudWxsID8gZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodGFyZ2V0LCBrZXkpIDogZGVzYywgZDtcclxuICAgIGlmICh0eXBlb2YgUmVmbGVjdCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgUmVmbGVjdC5kZWNvcmF0ZSA9PT0gXCJmdW5jdGlvblwiKSByID0gUmVmbGVjdC5kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYyk7XHJcbiAgICBlbHNlIGZvciAodmFyIGkgPSBkZWNvcmF0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoZCA9IGRlY29yYXRvcnNbaV0pIHIgPSAoYyA8IDMgPyBkKHIpIDogYyA+IDMgPyBkKHRhcmdldCwga2V5LCByKSA6IGQodGFyZ2V0LCBrZXkpKSB8fCByO1xyXG4gICAgcmV0dXJuIGMgPiAzICYmIHIgJiYgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCByKSwgcjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcGFyYW0ocGFyYW1JbmRleCwgZGVjb3JhdG9yKSB7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldCwga2V5KSB7IGRlY29yYXRvcih0YXJnZXQsIGtleSwgcGFyYW1JbmRleCk7IH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZXNEZWNvcmF0ZShjdG9yLCBkZXNjcmlwdG9ySW4sIGRlY29yYXRvcnMsIGNvbnRleHRJbiwgaW5pdGlhbGl6ZXJzLCBleHRyYUluaXRpYWxpemVycykge1xyXG4gICAgZnVuY3Rpb24gYWNjZXB0KGYpIHsgaWYgKGYgIT09IHZvaWQgMCAmJiB0eXBlb2YgZiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnVuY3Rpb24gZXhwZWN0ZWRcIik7IHJldHVybiBmOyB9XHJcbiAgICB2YXIga2luZCA9IGNvbnRleHRJbi5raW5kLCBrZXkgPSBraW5kID09PSBcImdldHRlclwiID8gXCJnZXRcIiA6IGtpbmQgPT09IFwic2V0dGVyXCIgPyBcInNldFwiIDogXCJ2YWx1ZVwiO1xyXG4gICAgdmFyIHRhcmdldCA9ICFkZXNjcmlwdG9ySW4gJiYgY3RvciA/IGNvbnRleHRJbltcInN0YXRpY1wiXSA/IGN0b3IgOiBjdG9yLnByb3RvdHlwZSA6IG51bGw7XHJcbiAgICB2YXIgZGVzY3JpcHRvciA9IGRlc2NyaXB0b3JJbiB8fCAodGFyZ2V0ID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih0YXJnZXQsIGNvbnRleHRJbi5uYW1lKSA6IHt9KTtcclxuICAgIHZhciBfLCBkb25lID0gZmFsc2U7XHJcbiAgICBmb3IgKHZhciBpID0gZGVjb3JhdG9ycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgIHZhciBjb250ZXh0ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4pIGNvbnRleHRbcF0gPSBwID09PSBcImFjY2Vzc1wiID8ge30gOiBjb250ZXh0SW5bcF07XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4uYWNjZXNzKSBjb250ZXh0LmFjY2Vzc1twXSA9IGNvbnRleHRJbi5hY2Nlc3NbcF07XHJcbiAgICAgICAgY29udGV4dC5hZGRJbml0aWFsaXplciA9IGZ1bmN0aW9uIChmKSB7IGlmIChkb25lKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IGFkZCBpbml0aWFsaXplcnMgYWZ0ZXIgZGVjb3JhdGlvbiBoYXMgY29tcGxldGVkXCIpOyBleHRyYUluaXRpYWxpemVycy5wdXNoKGFjY2VwdChmIHx8IG51bGwpKTsgfTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKDAsIGRlY29yYXRvcnNbaV0pKGtpbmQgPT09IFwiYWNjZXNzb3JcIiA/IHsgZ2V0OiBkZXNjcmlwdG9yLmdldCwgc2V0OiBkZXNjcmlwdG9yLnNldCB9IDogZGVzY3JpcHRvcltrZXldLCBjb250ZXh0KTtcclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJhY2Nlc3NvclwiKSB7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IHZvaWQgMCkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZFwiKTtcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmdldCkpIGRlc2NyaXB0b3IuZ2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LnNldCkpIGRlc2NyaXB0b3Iuc2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmluaXQpKSBpbml0aWFsaXplcnMudW5zaGlmdChfKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoXyA9IGFjY2VwdChyZXN1bHQpKSB7XHJcbiAgICAgICAgICAgIGlmIChraW5kID09PSBcImZpZWxkXCIpIGluaXRpYWxpemVycy51bnNoaWZ0KF8pO1xyXG4gICAgICAgICAgICBlbHNlIGRlc2NyaXB0b3Jba2V5XSA9IF87XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRhcmdldCkgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgY29udGV4dEluLm5hbWUsIGRlc2NyaXB0b3IpO1xyXG4gICAgZG9uZSA9IHRydWU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19ydW5Jbml0aWFsaXplcnModGhpc0FyZywgaW5pdGlhbGl6ZXJzLCB2YWx1ZSkge1xyXG4gICAgdmFyIHVzZVZhbHVlID0gYXJndW1lbnRzLmxlbmd0aCA+IDI7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGluaXRpYWxpemVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhbHVlID0gdXNlVmFsdWUgPyBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnLCB2YWx1ZSkgOiBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1c2VWYWx1ZSA/IHZhbHVlIDogdm9pZCAwO1xyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcHJvcEtleSh4KSB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHggPT09IFwic3ltYm9sXCIgPyB4IDogXCJcIi5jb25jYXQoeCk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zZXRGdW5jdGlvbk5hbWUoZiwgbmFtZSwgcHJlZml4KSB7XHJcbiAgICBpZiAodHlwZW9mIG5hbWUgPT09IFwic3ltYm9sXCIpIG5hbWUgPSBuYW1lLmRlc2NyaXB0aW9uID8gXCJbXCIuY29uY2F0KG5hbWUuZGVzY3JpcHRpb24sIFwiXVwiKSA6IFwiXCI7XHJcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGYsIFwibmFtZVwiLCB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IHByZWZpeCA/IFwiXCIuY29uY2F0KHByZWZpeCwgXCIgXCIsIG5hbWUpIDogbmFtZSB9KTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX21ldGFkYXRhKG1ldGFkYXRhS2V5LCBtZXRhZGF0YVZhbHVlKSB7XHJcbiAgICBpZiAodHlwZW9mIFJlZmxlY3QgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIFJlZmxlY3QubWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFJlZmxlY3QubWV0YWRhdGEobWV0YWRhdGFLZXksIG1ldGFkYXRhVmFsdWUpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikge1xyXG4gICAgZnVuY3Rpb24gYWRvcHQodmFsdWUpIHsgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgUCA/IHZhbHVlIDogbmV3IFAoZnVuY3Rpb24gKHJlc29sdmUpIHsgcmVzb2x2ZSh2YWx1ZSk7IH0pOyB9XHJcbiAgICByZXR1cm4gbmV3IChQIHx8IChQID0gUHJvbWlzZSkpKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gcmVqZWN0ZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3JbXCJ0aHJvd1wiXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gc3RlcChyZXN1bHQpIHsgcmVzdWx0LmRvbmUgPyByZXNvbHZlKHJlc3VsdC52YWx1ZSkgOiBhZG9wdChyZXN1bHQudmFsdWUpLnRoZW4oZnVsZmlsbGVkLCByZWplY3RlZCk7IH1cclxuICAgICAgICBzdGVwKChnZW5lcmF0b3IgPSBnZW5lcmF0b3IuYXBwbHkodGhpc0FyZywgX2FyZ3VtZW50cyB8fCBbXSkpLm5leHQoKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZ2VuZXJhdG9yKHRoaXNBcmcsIGJvZHkpIHtcclxuICAgIHZhciBfID0geyBsYWJlbDogMCwgc2VudDogZnVuY3Rpb24oKSB7IGlmICh0WzBdICYgMSkgdGhyb3cgdFsxXTsgcmV0dXJuIHRbMV07IH0sIHRyeXM6IFtdLCBvcHM6IFtdIH0sIGYsIHksIHQsIGcgPSBPYmplY3QuY3JlYXRlKCh0eXBlb2YgSXRlcmF0b3IgPT09IFwiZnVuY3Rpb25cIiA/IEl0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpO1xyXG4gICAgcmV0dXJuIGcubmV4dCA9IHZlcmIoMCksIGdbXCJ0aHJvd1wiXSA9IHZlcmIoMSksIGdbXCJyZXR1cm5cIl0gPSB2ZXJiKDIpLCB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgKGdbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSksIGc7XHJcbiAgICBmdW5jdGlvbiB2ZXJiKG4pIHsgcmV0dXJuIGZ1bmN0aW9uICh2KSB7IHJldHVybiBzdGVwKFtuLCB2XSk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHN0ZXAob3ApIHtcclxuICAgICAgICBpZiAoZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkdlbmVyYXRvciBpcyBhbHJlYWR5IGV4ZWN1dGluZy5cIik7XHJcbiAgICAgICAgd2hpbGUgKGcgJiYgKGcgPSAwLCBvcFswXSAmJiAoXyA9IDApKSwgXykgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKGYgPSAxLCB5ICYmICh0ID0gb3BbMF0gJiAyID8geVtcInJldHVyblwiXSA6IG9wWzBdID8geVtcInRocm93XCJdIHx8ICgodCA9IHlbXCJyZXR1cm5cIl0pICYmIHQuY2FsbCh5KSwgMCkgOiB5Lm5leHQpICYmICEodCA9IHQuY2FsbCh5LCBvcFsxXSkpLmRvbmUpIHJldHVybiB0O1xyXG4gICAgICAgICAgICBpZiAoeSA9IDAsIHQpIG9wID0gW29wWzBdICYgMiwgdC52YWx1ZV07XHJcbiAgICAgICAgICAgIHN3aXRjaCAob3BbMF0pIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgMDogY2FzZSAxOiB0ID0gb3A7IGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSA0OiBfLmxhYmVsKys7IHJldHVybiB7IHZhbHVlOiBvcFsxXSwgZG9uZTogZmFsc2UgfTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNTogXy5sYWJlbCsrOyB5ID0gb3BbMV07IG9wID0gWzBdOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNzogb3AgPSBfLm9wcy5wb3AoKTsgXy50cnlzLnBvcCgpOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEodCA9IF8udHJ5cywgdCA9IHQubGVuZ3RoID4gMCAmJiB0W3QubGVuZ3RoIC0gMV0pICYmIChvcFswXSA9PT0gNiB8fCBvcFswXSA9PT0gMikpIHsgXyA9IDA7IGNvbnRpbnVlOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wWzBdID09PSAzICYmICghdCB8fCAob3BbMV0gPiB0WzBdICYmIG9wWzFdIDwgdFszXSkpKSB7IF8ubGFiZWwgPSBvcFsxXTsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAob3BbMF0gPT09IDYgJiYgXy5sYWJlbCA8IHRbMV0pIHsgXy5sYWJlbCA9IHRbMV07IHQgPSBvcDsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiBfLmxhYmVsIDwgdFsyXSkgeyBfLmxhYmVsID0gdFsyXTsgXy5vcHMucHVzaChvcCk7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRbMl0pIF8ub3BzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIF8udHJ5cy5wb3AoKTsgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3AgPSBib2R5LmNhbGwodGhpc0FyZywgXyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkgeyBvcCA9IFs2LCBlXTsgeSA9IDA7IH0gZmluYWxseSB7IGYgPSB0ID0gMDsgfVxyXG4gICAgICAgIGlmIChvcFswXSAmIDUpIHRocm93IG9wWzFdOyByZXR1cm4geyB2YWx1ZTogb3BbMF0gPyBvcFsxXSA6IHZvaWQgMCwgZG9uZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fY3JlYXRlQmluZGluZyA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgbSwgaywgazIpIHtcclxuICAgIGlmIChrMiA9PT0gdW5kZWZpbmVkKSBrMiA9IGs7XHJcbiAgICB2YXIgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IobSwgayk7XHJcbiAgICBpZiAoIWRlc2MgfHwgKFwiZ2V0XCIgaW4gZGVzYyA/ICFtLl9fZXNNb2R1bGUgOiBkZXNjLndyaXRhYmxlIHx8IGRlc2MuY29uZmlndXJhYmxlKSkge1xyXG4gICAgICAgIGRlc2MgPSB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiBtW2tdOyB9IH07XHJcbiAgICB9XHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgazIsIGRlc2MpO1xyXG59KSA6IChmdW5jdGlvbihvLCBtLCBrLCBrMikge1xyXG4gICAgaWYgKGsyID09PSB1bmRlZmluZWQpIGsyID0gaztcclxuICAgIG9bazJdID0gbVtrXTtcclxufSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHBvcnRTdGFyKG0sIG8pIHtcclxuICAgIGZvciAodmFyIHAgaW4gbSkgaWYgKHAgIT09IFwiZGVmYXVsdFwiICYmICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgcCkpIF9fY3JlYXRlQmluZGluZyhvLCBtLCBwKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fdmFsdWVzKG8pIHtcclxuICAgIHZhciBzID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIFN5bWJvbC5pdGVyYXRvciwgbSA9IHMgJiYgb1tzXSwgaSA9IDA7XHJcbiAgICBpZiAobSkgcmV0dXJuIG0uY2FsbChvKTtcclxuICAgIGlmIChvICYmIHR5cGVvZiBvLmxlbmd0aCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHtcclxuICAgICAgICBuZXh0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChvICYmIGkgPj0gby5sZW5ndGgpIG8gPSB2b2lkIDA7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBvICYmIG9baSsrXSwgZG9uZTogIW8gfTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihzID8gXCJPYmplY3QgaXMgbm90IGl0ZXJhYmxlLlwiIDogXCJTeW1ib2wuaXRlcmF0b3IgaXMgbm90IGRlZmluZWQuXCIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZWFkKG8sIG4pIHtcclxuICAgIHZhciBtID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIG9bU3ltYm9sLml0ZXJhdG9yXTtcclxuICAgIGlmICghbSkgcmV0dXJuIG87XHJcbiAgICB2YXIgaSA9IG0uY2FsbChvKSwgciwgYXIgPSBbXSwgZTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgd2hpbGUgKChuID09PSB2b2lkIDAgfHwgbi0tID4gMCkgJiYgIShyID0gaS5uZXh0KCkpLmRvbmUpIGFyLnB1c2goci52YWx1ZSk7XHJcbiAgICB9XHJcbiAgICBjYXRjaCAoZXJyb3IpIHsgZSA9IHsgZXJyb3I6IGVycm9yIH07IH1cclxuICAgIGZpbmFsbHkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChyICYmICFyLmRvbmUgJiYgKG0gPSBpW1wicmV0dXJuXCJdKSkgbS5jYWxsKGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaW5hbGx5IHsgaWYgKGUpIHRocm93IGUuZXJyb3I7IH1cclxuICAgIH1cclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZCgpIHtcclxuICAgIGZvciAodmFyIGFyID0gW10sIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKVxyXG4gICAgICAgIGFyID0gYXIuY29uY2F0KF9fcmVhZChhcmd1bWVudHNbaV0pKTtcclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZEFycmF5cygpIHtcclxuICAgIGZvciAodmFyIHMgPSAwLCBpID0gMCwgaWwgPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgaWw7IGkrKykgcyArPSBhcmd1bWVudHNbaV0ubGVuZ3RoO1xyXG4gICAgZm9yICh2YXIgciA9IEFycmF5KHMpLCBrID0gMCwgaSA9IDA7IGkgPCBpbDsgaSsrKVxyXG4gICAgICAgIGZvciAodmFyIGEgPSBhcmd1bWVudHNbaV0sIGogPSAwLCBqbCA9IGEubGVuZ3RoOyBqIDwgamw7IGorKywgaysrKVxyXG4gICAgICAgICAgICByW2tdID0gYVtqXTtcclxuICAgIHJldHVybiByO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zcHJlYWRBcnJheSh0bywgZnJvbSwgcGFjaykge1xyXG4gICAgaWYgKHBhY2sgfHwgYXJndW1lbnRzLmxlbmd0aCA9PT0gMikgZm9yICh2YXIgaSA9IDAsIGwgPSBmcm9tLmxlbmd0aCwgYXI7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XHJcbiAgICAgICAgICAgIGlmICghYXIpIGFyID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSwgMCwgaSk7XHJcbiAgICAgICAgICAgIGFyW2ldID0gZnJvbVtpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdG8uY29uY2F0KGFyIHx8IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fYXdhaXQodikge1xyXG4gICAgcmV0dXJuIHRoaXMgaW5zdGFuY2VvZiBfX2F3YWl0ID8gKHRoaXMudiA9IHYsIHRoaXMpIDogbmV3IF9fYXdhaXQodik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jR2VuZXJhdG9yKHRoaXNBcmcsIF9hcmd1bWVudHMsIGdlbmVyYXRvcikge1xyXG4gICAgaWYgKCFTeW1ib2wuYXN5bmNJdGVyYXRvcikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0l0ZXJhdG9yIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgIHZhciBnID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pLCBpLCBxID0gW107XHJcbiAgICByZXR1cm4gaSA9IE9iamVjdC5jcmVhdGUoKHR5cGVvZiBBc3luY0l0ZXJhdG9yID09PSBcImZ1bmN0aW9uXCIgPyBBc3luY0l0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpLCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIsIGF3YWl0UmV0dXJuKSwgaVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0gPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzOyB9LCBpO1xyXG4gICAgZnVuY3Rpb24gYXdhaXRSZXR1cm4oZikgeyByZXR1cm4gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh2KS50aGVuKGYsIHJlamVjdCk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpZiAoZ1tuXSkgeyBpW25dID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChhLCBiKSB7IHEucHVzaChbbiwgdiwgYSwgYl0pID4gMSB8fCByZXN1bWUobiwgdik7IH0pOyB9OyBpZiAoZikgaVtuXSA9IGYoaVtuXSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gcmVzdW1lKG4sIHYpIHsgdHJ5IHsgc3RlcChnW25dKHYpKTsgfSBjYXRjaCAoZSkgeyBzZXR0bGUocVswXVszXSwgZSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gc3RlcChyKSB7IHIudmFsdWUgaW5zdGFuY2VvZiBfX2F3YWl0ID8gUHJvbWlzZS5yZXNvbHZlKHIudmFsdWUudikudGhlbihmdWxmaWxsLCByZWplY3QpIDogc2V0dGxlKHFbMF1bMl0sIHIpOyB9XHJcbiAgICBmdW5jdGlvbiBmdWxmaWxsKHZhbHVlKSB7IHJlc3VtZShcIm5leHRcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiByZWplY3QodmFsdWUpIHsgcmVzdW1lKFwidGhyb3dcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiBzZXR0bGUoZiwgdikgeyBpZiAoZih2KSwgcS5zaGlmdCgpLCBxLmxlbmd0aCkgcmVzdW1lKHFbMF1bMF0sIHFbMF1bMV0pOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jRGVsZWdhdG9yKG8pIHtcclxuICAgIHZhciBpLCBwO1xyXG4gICAgcmV0dXJuIGkgPSB7fSwgdmVyYihcIm5leHRcIiksIHZlcmIoXCJ0aHJvd1wiLCBmdW5jdGlvbiAoZSkgeyB0aHJvdyBlOyB9KSwgdmVyYihcInJldHVyblwiKSwgaVtTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfSwgaTtcclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpW25dID0gb1tuXSA/IGZ1bmN0aW9uICh2KSB7IHJldHVybiAocCA9ICFwKSA/IHsgdmFsdWU6IF9fYXdhaXQob1tuXSh2KSksIGRvbmU6IGZhbHNlIH0gOiBmID8gZih2KSA6IHY7IH0gOiBmOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jVmFsdWVzKG8pIHtcclxuICAgIGlmICghU3ltYm9sLmFzeW5jSXRlcmF0b3IpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNJdGVyYXRvciBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICB2YXIgbSA9IG9bU3ltYm9sLmFzeW5jSXRlcmF0b3JdLCBpO1xyXG4gICAgcmV0dXJuIG0gPyBtLmNhbGwobykgOiAobyA9IHR5cGVvZiBfX3ZhbHVlcyA9PT0gXCJmdW5jdGlvblwiID8gX192YWx1ZXMobykgOiBvW1N5bWJvbC5pdGVyYXRvcl0oKSwgaSA9IHt9LCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIpLCBpW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXM7IH0sIGkpO1xyXG4gICAgZnVuY3Rpb24gdmVyYihuKSB7IGlbbl0gPSBvW25dICYmIGZ1bmN0aW9uICh2KSB7IHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHYgPSBvW25dKHYpLCBzZXR0bGUocmVzb2x2ZSwgcmVqZWN0LCB2LmRvbmUsIHYudmFsdWUpOyB9KTsgfTsgfVxyXG4gICAgZnVuY3Rpb24gc2V0dGxlKHJlc29sdmUsIHJlamVjdCwgZCwgdikgeyBQcm9taXNlLnJlc29sdmUodikudGhlbihmdW5jdGlvbih2KSB7IHJlc29sdmUoeyB2YWx1ZTogdiwgZG9uZTogZCB9KTsgfSwgcmVqZWN0KTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19tYWtlVGVtcGxhdGVPYmplY3QoY29va2VkLCByYXcpIHtcclxuICAgIGlmIChPYmplY3QuZGVmaW5lUHJvcGVydHkpIHsgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvb2tlZCwgXCJyYXdcIiwgeyB2YWx1ZTogcmF3IH0pOyB9IGVsc2UgeyBjb29rZWQucmF3ID0gcmF3OyB9XHJcbiAgICByZXR1cm4gY29va2VkO1xyXG59O1xyXG5cclxudmFyIF9fc2V0TW9kdWxlRGVmYXVsdCA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgdikge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sIFwiZGVmYXVsdFwiLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2IH0pO1xyXG59KSA6IGZ1bmN0aW9uKG8sIHYpIHtcclxuICAgIG9bXCJkZWZhdWx0XCJdID0gdjtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydFN0YXIobW9kKSB7XHJcbiAgICBpZiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSByZXR1cm4gbW9kO1xyXG4gICAgdmFyIHJlc3VsdCA9IHt9O1xyXG4gICAgaWYgKG1vZCAhPSBudWxsKSBmb3IgKHZhciBrIGluIG1vZCkgaWYgKGsgIT09IFwiZGVmYXVsdFwiICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb2QsIGspKSBfX2NyZWF0ZUJpbmRpbmcocmVzdWx0LCBtb2QsIGspO1xyXG4gICAgX19zZXRNb2R1bGVEZWZhdWx0KHJlc3VsdCwgbW9kKTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydERlZmF1bHQobW9kKSB7XHJcbiAgICByZXR1cm4gKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgPyBtb2QgOiB7IGRlZmF1bHQ6IG1vZCB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEdldChyZWNlaXZlciwgc3RhdGUsIGtpbmQsIGYpIHtcclxuICAgIGlmIChraW5kID09PSBcImFcIiAmJiAhZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlByaXZhdGUgYWNjZXNzb3Igd2FzIGRlZmluZWQgd2l0aG91dCBhIGdldHRlclwiKTtcclxuICAgIGlmICh0eXBlb2Ygc3RhdGUgPT09IFwiZnVuY3Rpb25cIiA/IHJlY2VpdmVyICE9PSBzdGF0ZSB8fCAhZiA6ICFzdGF0ZS5oYXMocmVjZWl2ZXIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHJlYWQgcHJpdmF0ZSBtZW1iZXIgZnJvbSBhbiBvYmplY3Qgd2hvc2UgY2xhc3MgZGlkIG5vdCBkZWNsYXJlIGl0XCIpO1xyXG4gICAgcmV0dXJuIGtpbmQgPT09IFwibVwiID8gZiA6IGtpbmQgPT09IFwiYVwiID8gZi5jYWxsKHJlY2VpdmVyKSA6IGYgPyBmLnZhbHVlIDogc3RhdGUuZ2V0KHJlY2VpdmVyKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fY2xhc3NQcml2YXRlRmllbGRTZXQocmVjZWl2ZXIsIHN0YXRlLCB2YWx1ZSwga2luZCwgZikge1xyXG4gICAgaWYgKGtpbmQgPT09IFwibVwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBtZXRob2QgaXMgbm90IHdyaXRhYmxlXCIpO1xyXG4gICAgaWYgKGtpbmQgPT09IFwiYVwiICYmICFmKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBhY2Nlc3NvciB3YXMgZGVmaW5lZCB3aXRob3V0IGEgc2V0dGVyXCIpO1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gXCJmdW5jdGlvblwiID8gcmVjZWl2ZXIgIT09IHN0YXRlIHx8ICFmIDogIXN0YXRlLmhhcyhyZWNlaXZlcikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3Qgd3JpdGUgcHJpdmF0ZSBtZW1iZXIgdG8gYW4gb2JqZWN0IHdob3NlIGNsYXNzIGRpZCBub3QgZGVjbGFyZSBpdFwiKTtcclxuICAgIHJldHVybiAoa2luZCA9PT0gXCJhXCIgPyBmLmNhbGwocmVjZWl2ZXIsIHZhbHVlKSA6IGYgPyBmLnZhbHVlID0gdmFsdWUgOiBzdGF0ZS5zZXQocmVjZWl2ZXIsIHZhbHVlKSksIHZhbHVlO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEluKHN0YXRlLCByZWNlaXZlcikge1xyXG4gICAgaWYgKHJlY2VpdmVyID09PSBudWxsIHx8ICh0eXBlb2YgcmVjZWl2ZXIgIT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY2VpdmVyICE9PSBcImZ1bmN0aW9uXCIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHVzZSAnaW4nIG9wZXJhdG9yIG9uIG5vbi1vYmplY3RcIik7XHJcbiAgICByZXR1cm4gdHlwZW9mIHN0YXRlID09PSBcImZ1bmN0aW9uXCIgPyByZWNlaXZlciA9PT0gc3RhdGUgOiBzdGF0ZS5oYXMocmVjZWl2ZXIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hZGREaXNwb3NhYmxlUmVzb3VyY2UoZW52LCB2YWx1ZSwgYXN5bmMpIHtcclxuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdm9pZCAwKSB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZC5cIik7XHJcbiAgICAgICAgdmFyIGRpc3Bvc2UsIGlubmVyO1xyXG4gICAgICAgIGlmIChhc3luYykge1xyXG4gICAgICAgICAgICBpZiAoIVN5bWJvbC5hc3luY0Rpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNEaXNwb3NlIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgICAgICAgICAgZGlzcG9zZSA9IHZhbHVlW1N5bWJvbC5hc3luY0Rpc3Bvc2VdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZGlzcG9zZSA9PT0gdm9pZCAwKSB7XHJcbiAgICAgICAgICAgIGlmICghU3ltYm9sLmRpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuZGlzcG9zZSBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICAgICAgICAgIGRpc3Bvc2UgPSB2YWx1ZVtTeW1ib2wuZGlzcG9zZV07XHJcbiAgICAgICAgICAgIGlmIChhc3luYykgaW5uZXIgPSBkaXNwb3NlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodHlwZW9mIGRpc3Bvc2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBub3QgZGlzcG9zYWJsZS5cIik7XHJcbiAgICAgICAgaWYgKGlubmVyKSBkaXNwb3NlID0gZnVuY3Rpb24oKSB7IHRyeSB7IGlubmVyLmNhbGwodGhpcyk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIFByb21pc2UucmVqZWN0KGUpOyB9IH07XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyB2YWx1ZTogdmFsdWUsIGRpc3Bvc2U6IGRpc3Bvc2UsIGFzeW5jOiBhc3luYyB9KTtcclxuICAgIH1cclxuICAgIGVsc2UgaWYgKGFzeW5jKSB7XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyBhc3luYzogdHJ1ZSB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiB2YWx1ZTtcclxuXHJcbn1cclxuXHJcbnZhciBfU3VwcHJlc3NlZEVycm9yID0gdHlwZW9mIFN1cHByZXNzZWRFcnJvciA9PT0gXCJmdW5jdGlvblwiID8gU3VwcHJlc3NlZEVycm9yIDogZnVuY3Rpb24gKGVycm9yLCBzdXBwcmVzc2VkLCBtZXNzYWdlKSB7XHJcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuICAgIHJldHVybiBlLm5hbWUgPSBcIlN1cHByZXNzZWRFcnJvclwiLCBlLmVycm9yID0gZXJyb3IsIGUuc3VwcHJlc3NlZCA9IHN1cHByZXNzZWQsIGU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kaXNwb3NlUmVzb3VyY2VzKGVudikge1xyXG4gICAgZnVuY3Rpb24gZmFpbChlKSB7XHJcbiAgICAgICAgZW52LmVycm9yID0gZW52Lmhhc0Vycm9yID8gbmV3IF9TdXBwcmVzc2VkRXJyb3IoZSwgZW52LmVycm9yLCBcIkFuIGVycm9yIHdhcyBzdXBwcmVzc2VkIGR1cmluZyBkaXNwb3NhbC5cIikgOiBlO1xyXG4gICAgICAgIGVudi5oYXNFcnJvciA9IHRydWU7XHJcbiAgICB9XHJcbiAgICB2YXIgciwgcyA9IDA7XHJcbiAgICBmdW5jdGlvbiBuZXh0KCkge1xyXG4gICAgICAgIHdoaWxlIChyID0gZW52LnN0YWNrLnBvcCgpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXIuYXN5bmMgJiYgcyA9PT0gMSkgcmV0dXJuIHMgPSAwLCBlbnYuc3RhY2sucHVzaChyKSwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihuZXh0KTtcclxuICAgICAgICAgICAgICAgIGlmIChyLmRpc3Bvc2UpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gci5kaXNwb3NlLmNhbGwoci52YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHIuYXN5bmMpIHJldHVybiBzIHw9IDIsIFByb21pc2UucmVzb2x2ZShyZXN1bHQpLnRoZW4obmV4dCwgZnVuY3Rpb24oZSkgeyBmYWlsKGUpOyByZXR1cm4gbmV4dCgpOyB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgcyB8PSAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBmYWlsKGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChzID09PSAxKSByZXR1cm4gZW52Lmhhc0Vycm9yID8gUHJvbWlzZS5yZWplY3QoZW52LmVycm9yKSA6IFByb21pc2UucmVzb2x2ZSgpO1xyXG4gICAgICAgIGlmIChlbnYuaGFzRXJyb3IpIHRocm93IGVudi5lcnJvcjtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0KCk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbihwYXRoLCBwcmVzZXJ2ZUpzeCkge1xyXG4gICAgaWYgKHR5cGVvZiBwYXRoID09PSBcInN0cmluZ1wiICYmIC9eXFwuXFwuP1xcLy8udGVzdChwYXRoKSkge1xyXG4gICAgICAgIHJldHVybiBwYXRoLnJlcGxhY2UoL1xcLih0c3gpJHwoKD86XFwuZCk/KSgoPzpcXC5bXi4vXSs/KT8pXFwuKFtjbV0/KXRzJC9pLCBmdW5jdGlvbiAobSwgdHN4LCBkLCBleHQsIGNtKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0c3ggPyBwcmVzZXJ2ZUpzeCA/IFwiLmpzeFwiIDogXCIuanNcIiA6IGQgJiYgKCFleHQgfHwgIWNtKSA/IG0gOiAoZCArIGV4dCArIFwiLlwiICsgY20udG9Mb3dlckNhc2UoKSArIFwianNcIik7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGF0aDtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQge1xyXG4gICAgX19leHRlbmRzOiBfX2V4dGVuZHMsXHJcbiAgICBfX2Fzc2lnbjogX19hc3NpZ24sXHJcbiAgICBfX3Jlc3Q6IF9fcmVzdCxcclxuICAgIF9fZGVjb3JhdGU6IF9fZGVjb3JhdGUsXHJcbiAgICBfX3BhcmFtOiBfX3BhcmFtLFxyXG4gICAgX19lc0RlY29yYXRlOiBfX2VzRGVjb3JhdGUsXHJcbiAgICBfX3J1bkluaXRpYWxpemVyczogX19ydW5Jbml0aWFsaXplcnMsXHJcbiAgICBfX3Byb3BLZXk6IF9fcHJvcEtleSxcclxuICAgIF9fc2V0RnVuY3Rpb25OYW1lOiBfX3NldEZ1bmN0aW9uTmFtZSxcclxuICAgIF9fbWV0YWRhdGE6IF9fbWV0YWRhdGEsXHJcbiAgICBfX2F3YWl0ZXI6IF9fYXdhaXRlcixcclxuICAgIF9fZ2VuZXJhdG9yOiBfX2dlbmVyYXRvcixcclxuICAgIF9fY3JlYXRlQmluZGluZzogX19jcmVhdGVCaW5kaW5nLFxyXG4gICAgX19leHBvcnRTdGFyOiBfX2V4cG9ydFN0YXIsXHJcbiAgICBfX3ZhbHVlczogX192YWx1ZXMsXHJcbiAgICBfX3JlYWQ6IF9fcmVhZCxcclxuICAgIF9fc3ByZWFkOiBfX3NwcmVhZCxcclxuICAgIF9fc3ByZWFkQXJyYXlzOiBfX3NwcmVhZEFycmF5cyxcclxuICAgIF9fc3ByZWFkQXJyYXk6IF9fc3ByZWFkQXJyYXksXHJcbiAgICBfX2F3YWl0OiBfX2F3YWl0LFxyXG4gICAgX19hc3luY0dlbmVyYXRvcjogX19hc3luY0dlbmVyYXRvcixcclxuICAgIF9fYXN5bmNEZWxlZ2F0b3I6IF9fYXN5bmNEZWxlZ2F0b3IsXHJcbiAgICBfX2FzeW5jVmFsdWVzOiBfX2FzeW5jVmFsdWVzLFxyXG4gICAgX19tYWtlVGVtcGxhdGVPYmplY3Q6IF9fbWFrZVRlbXBsYXRlT2JqZWN0LFxyXG4gICAgX19pbXBvcnRTdGFyOiBfX2ltcG9ydFN0YXIsXHJcbiAgICBfX2ltcG9ydERlZmF1bHQ6IF9faW1wb3J0RGVmYXVsdCxcclxuICAgIF9fY2xhc3NQcml2YXRlRmllbGRHZXQ6IF9fY2xhc3NQcml2YXRlRmllbGRHZXQsXHJcbiAgICBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0OiBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0LFxyXG4gICAgX19jbGFzc1ByaXZhdGVGaWVsZEluOiBfX2NsYXNzUHJpdmF0ZUZpZWxkSW4sXHJcbiAgICBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZTogX19hZGREaXNwb3NhYmxlUmVzb3VyY2UsXHJcbiAgICBfX2Rpc3Bvc2VSZXNvdXJjZXM6IF9fZGlzcG9zZVJlc291cmNlcyxcclxuICAgIF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uOiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbixcclxufTtcclxuIiwiaW1wb3J0IHtcbiAgQXBwLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIFRGb2xkZXIsXG4gIFRGaWxlLFxuICBNb2RhbCxcbiAgVGV4dENvbXBvbmVudCxcbiAgTm90aWNlLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcblxuaW50ZXJmYWNlIFRhZ0l0U2V0dGluZ3Mge1xuICBpbmhlcml0YW5jZU1vZGU6IFwibm9uZVwiIHwgXCJpbW1lZGlhdGVcIiB8IFwiYWxsXCI7XG4gIGV4Y2x1ZGVkRm9sZGVyczogc3RyaW5nW107XG4gIHNob3dGb2xkZXJJY29uczogYm9vbGVhbjtcbiAgYXV0b0FwcGx5VGFnczogYm9vbGVhbjtcbiAgZGVidWdNb2RlOiBib29sZWFuO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBUYWdJdFNldHRpbmdzID0ge1xuICBpbmhlcml0YW5jZU1vZGU6IFwiaW1tZWRpYXRlXCIsXG4gIGV4Y2x1ZGVkRm9sZGVyczogW10sXG4gIHNob3dGb2xkZXJJY29uczogdHJ1ZSxcbiAgYXV0b0FwcGx5VGFnczogdHJ1ZSxcbiAgZGVidWdNb2RlOiBmYWxzZSxcbn07XG5cbi8vIEFkZCB0aGlzIHR5cGUgZGVmaW5pdGlvblxudHlwZSBGb2xkZXJUYWdzID0geyBbZm9sZGVyUGF0aDogc3RyaW5nXTogc3RyaW5nW10gfTtcblxuaW50ZXJmYWNlIFBsdWdpbkRhdGEge1xuICBzZXR0aW5nczogVGFnSXRTZXR0aW5ncztcbiAgZm9sZGVyVGFnczogRm9sZGVyVGFncztcbiAgdmVyc2lvbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX0RBVEE6IFBsdWdpbkRhdGEgPSB7XG4gIHNldHRpbmdzOiBERUZBVUxUX1NFVFRJTkdTLFxuICBmb2xkZXJUYWdzOiB7fSxcbiAgdmVyc2lvbjogXCIxLjAuMFwiLFxufTtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGFnSXRQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogVGFnSXRTZXR0aW5ncztcbiAgZm9sZGVyVGFnczogRm9sZGVyVGFncyA9IHt9O1xuICBwcml2YXRlIGlzSW5pdGlhbExvYWQ6IGJvb2xlYW4gPSB0cnVlO1xuICBwcml2YXRlIG5ld0ZvbGRlclF1ZXVlOiBURm9sZGVyW10gPSBbXTtcbiAgcHJpdmF0ZSBtb3ZlVGltZW91dDogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgICBhd2FpdCB0aGlzLmxvYWRGb2xkZXJUYWdzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgIFwiRXJyb3IgbG9hZGluZyBwbHVnaW4gZGF0YSwgaW5pdGlhbGl6aW5nIHdpdGggZGVmYXVsdHM6XCIsXG4gICAgICAgIGVycm9yXG4gICAgICApO1xuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplRGF0YUZpbGUoKTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhcImxvYWRpbmcgVGFnSXQgcGx1Z2luXCIpO1xuXG4gICAgLy8gRGVsYXllZCBpbml0aWFsaXphdGlvblxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5pc0luaXRpYWxMb2FkID0gZmFsc2U7XG4gICAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiY3JlYXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZUZvbGRlckNyZWF0aW9uKGZpbGUpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZUZpbGVDcmVhdGlvbihmaWxlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgICAvLyBQcm9jZXNzIHRoZSBxdWV1ZSBldmVyeSAyIHNlY29uZHNcbiAgICAgIHRoaXMucmVnaXN0ZXJJbnRlcnZhbChcbiAgICAgICAgd2luZG93LnNldEludGVydmFsKCgpID0+IHRoaXMucHJvY2Vzc05ld0ZvbGRlclF1ZXVlKCksIDIwMDApXG4gICAgICApO1xuXG4gICAgICAvLyBBZGQgZXZlbnQgbGlzdGVuZXIgZm9yIGZpbGUgbW92ZW1lbnRcbiAgICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZUZpbGVNb3ZlKGZpbGUsIG9sZFBhdGgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSwgMjAwMCk7IC8vIDIgc2Vjb25kIGRlbGF5XG5cbiAgICAvLyBBZGQgY29tbWFuZCB0byBvcGVuIHRhZyBtb2RhbCBmb3IgY3VycmVudCBmb2xkZXJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi1mb2xkZXItdGFnLW1vZGFsXCIsXG4gICAgICBuYW1lOiBcIkFkZC9FZGl0IHRhZ3MgZm9yIGN1cnJlbnQgZm9sZGVyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgY29uc3QgZm9sZGVyID0gYWN0aXZlRmlsZSA/IGFjdGl2ZUZpbGUucGFyZW50IDogbnVsbDtcbiAgICAgICAgdGhpcy5vcGVuRm9sZGVyVGFnTW9kYWwoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY29tbWFuZCB0byByZW1vdmUgYWxsIHRhZ3MgZnJvbSBjdXJyZW50IGZvbGRlclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJyZW1vdmUtZm9sZGVyLXRhZ3NcIixcbiAgICAgIG5hbWU6IFwiUmVtb3ZlIGFsbCB0YWdzIGZyb20gY3VycmVudCBmb2xkZXJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFjdGl2ZUZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBjb25zdCBmb2xkZXIgPSBhY3RpdmVGaWxlID8gYWN0aXZlRmlsZS5wYXJlbnQgOiBudWxsO1xuICAgICAgICB0aGlzLnJlbW92ZUZvbGRlclRhZ3MoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY29tbWFuZCB0byBhcHBseSBmaWxlIHRhZ3MgdG8gZm9sZGVyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImFwcGx5LWZpbGUtdGFncy10by1mb2xkZXJcIixcbiAgICAgIG5hbWU6IFwiQXBwbHkgZmlsZSB0YWdzIHRvIGZvbGRlclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmIChhY3RpdmVGaWxlKSB7XG4gICAgICAgICAgdGhpcy5hcHBseUZpbGVUYWdzVG9Gb2xkZXIoYWN0aXZlRmlsZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIGFjdGl2ZSBmaWxlXCIpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbW1hbmQgdG8gY29udmVydCBpbmxpbmUgdGFncyB0byBZQU1MXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImNvbnZlcnQtaW5saW5lLXRhZ3MtdG8teWFtbFwiLFxuICAgICAgbmFtZTogXCJDb252ZXJ0IGlubGluZSB0YWdzIHRvIFlBTUxcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFjdGl2ZUZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBpZiAoYWN0aXZlRmlsZSkge1xuICAgICAgICAgIHRoaXMuY29udmVydElubGluZVRhZ3NUb1lBTUwoYWN0aXZlRmlsZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIGFjdGl2ZSBmaWxlXCIpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gUmVnaXN0ZXIgY29udGV4dCBtZW51IGV2ZW50c1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImZpbGUtbWVudVwiLCAobWVudSwgZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGb2xkZXIpIHtcbiAgICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+IHtcbiAgICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQWRkL0VkaXQgRm9sZGVyIFRhZ3NcIilcbiAgICAgICAgICAgICAgLnNldEljb24oXCJ0YWdcIilcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5vcGVuRm9sZGVyVGFnTW9kYWwoZmlsZSkpO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIlJlbW92ZSBBbGwgRm9sZGVyIFRhZ3NcIilcbiAgICAgICAgICAgICAgLnNldEljb24oXCJ0cmFzaFwiKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnJlbW92ZUZvbGRlclRhZ3MoZmlsZSkpO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIkFwcGx5IEZvbGRlciBUYWdzIHRvIE5vdGVzXCIpXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwiZmlsZS1wbHVzXCIpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuYXBwbHlGb2xkZXJUYWdzVG9Ob3RlcyhmaWxlKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgIC5zZXRUaXRsZShcIkFwcGx5IFRhZ3MgdG8gRm9sZGVyXCIpXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwidGFnXCIpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuYXBwbHlGaWxlVGFnc1RvRm9sZGVyKGZpbGUpKTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJDb252ZXJ0IElubGluZSBUYWdzIHRvIFlBTUxcIilcbiAgICAgICAgICAgICAgLnNldEljb24oXCJ0YWdcIilcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5jb252ZXJ0SW5saW5lVGFnc1RvWUFNTChmaWxlKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFRoaXMgYWRkcyBhIHNldHRpbmdzIHRhYiBzbyB0aGUgdXNlciBjYW4gY29uZmlndXJlIHZhcmlvdXMgYXNwZWN0cyBvZiB0aGUgcGx1Z2luXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUYWdJdFNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgICAgIHRoaXMuaGFuZGxlRm9sZGVyRGVsZXRpb24oZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFVwZGF0ZSBmb2xkZXIgaWNvbnMgd2hlbiB0aGUgcGx1Z2luIGxvYWRzXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy51cGRhdGVGb2xkZXJJY29ucygpO1xuICAgIH0pO1xuXG4gICAgLy8gVXBkYXRlIGZvbGRlciBpY29ucyB3aGVuIGZpbGVzIGFyZSBjcmVhdGVkLCBkZWxldGVkLCBvciByZW5hbWVkXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJkZWxldGVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG5cbiAgICAvLyBBZGQgdGhpcyBsaW5lIHRvIHVwZGF0ZSB0YWdzIHdoZW4gdGhlIHBsdWdpbiBsb2Fkc1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpKTtcblxuICAgIC8vIFVwZGF0ZSBmb2xkZXIgaWNvbnMgYmFzZWQgb24gdGhlIHNob3dGb2xkZXJJY29ucyBzZXR0aW5nXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd0ZvbGRlckljb25zKSB7XG4gICAgICAgIHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge1xuICAgIGNvbnNvbGUubG9nKFwidW5sb2FkaW5nIFRhZ0l0IHBsdWdpblwiKTtcbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGF0YSA9IChhd2FpdCB0aGlzLmxvYWREYXRhKCkpIGFzIFBsdWdpbkRhdGE7XG4gICAgICBpZiAoZGF0YSkge1xuICAgICAgICB0aGlzLnNldHRpbmdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLCAuLi5kYXRhLnNldHRpbmdzIH07XG4gICAgICAgIHRoaXMuZm9sZGVyVGFncyA9IGRhdGEuZm9sZGVyVGFncyB8fCB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICAgICAgICB0aGlzLmZvbGRlclRhZ3MgPSB7fTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBsb2FkIHBsdWdpbiBkYXRhOlwiLCBlcnJvcik7XG4gICAgICB0aGlzLnNldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HUztcbiAgICAgIHRoaXMuZm9sZGVyVGFncyA9IHt9O1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcbiAgICBjb25zdCBkYXRhOiBQbHVnaW5EYXRhID0ge1xuICAgICAgc2V0dGluZ3M6IHRoaXMuc2V0dGluZ3MsXG4gICAgICBmb2xkZXJUYWdzOiB0aGlzLmZvbGRlclRhZ3MsXG4gICAgICB2ZXJzaW9uOiBcIjEuMC4wXCIsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKGRhdGEpO1xuICB9XG5cbiAgYXN5bmMgbG9hZEZvbGRlclRhZ3MoKSB7XG4gICAgLy8gVGhpcyBtZXRob2QgaXMgbm93IHJlZHVuZGFudCBhcyB3ZSdyZSBsb2FkaW5nIGJvdGggc2V0dGluZ3MgYW5kIGZvbGRlclRhZ3MgaW4gbG9hZFNldHRpbmdzXG4gICAgLy8gS2VlcGluZyBpdCBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgICBjb25zb2xlLmxvZyhcIkZvbGRlciB0YWdzIGxvYWRlZCBpbiBsb2FkU2V0dGluZ3MgbWV0aG9kXCIpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZUZvbGRlclRhZ3MoKSB7XG4gICAgY29uc3QgZGF0YTogUGx1Z2luRGF0YSA9IHtcbiAgICAgIHNldHRpbmdzOiB0aGlzLnNldHRpbmdzLFxuICAgICAgZm9sZGVyVGFnczogdGhpcy5mb2xkZXJUYWdzLFxuICAgICAgdmVyc2lvbjogXCIxLjAuMFwiLFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YShkYXRhKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlRm9sZGVyQ3JlYXRpb24oZm9sZGVyOiBURm9sZGVyKSB7XG4gICAgaWYgKCF0aGlzLmlzSW5pdGlhbExvYWQpIHtcbiAgICAgIG5ldyBGb2xkZXJUYWdNb2RhbCh0aGlzLmFwcCwgZm9sZGVyLCB0aGlzLCB0cnVlKS5vcGVuKCk7XG4gICAgfVxuICB9XG5cbiAgc2V0Rm9sZGVyVGFncyhmb2xkZXJQYXRoOiBzdHJpbmcsIHRhZ3M6IHN0cmluZ1tdKSB7XG4gICAgY29uc3QgdW5pcXVlVGFncyA9IHRoaXMucmVtb3ZlRHVwbGljYXRlVGFncyh0YWdzKTtcbiAgICB0aGlzLmZvbGRlclRhZ3NbZm9sZGVyUGF0aF0gPSB1bmlxdWVUYWdzO1xuICAgIHRoaXMuc2F2ZUZvbGRlclRhZ3MoKTtcbiAgICB0aGlzLnVwZGF0ZUZvbGRlckljb25zKCk7XG4gICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gIH1cblxuICBnZXRGb2xkZXJUYWdzKGZvbGRlclBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gdGhpcy5mb2xkZXJUYWdzW2ZvbGRlclBhdGhdIHx8IFtdO1xuICB9XG5cbiAgb3BlbkZvbGRlclRhZ01vZGFsKGZvbGRlcjogVEZvbGRlciB8IG51bGwpIHtcbiAgICBpZiAoZm9sZGVyKSB7XG4gICAgICBuZXcgRm9sZGVyVGFnTW9kYWwodGhpcy5hcHAsIGZvbGRlciwgdGhpcykub3BlbigpO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gZm9sZGVyIHNlbGVjdGVkXCIpO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZUZvbGRlclRhZ3MoZm9sZGVyOiBURm9sZGVyIHwgbnVsbCkge1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIHRoaXMuc2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCwgW10pO1xuICAgICAgbmV3IE5vdGljZShgUmVtb3ZlZCBhbGwgdGFncyBmcm9tIGZvbGRlcjogJHtmb2xkZXIucGF0aH1gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IE5vdGljZShcIk5vIGZvbGRlciBzZWxlY3RlZFwiKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBoYW5kbGVGaWxlQ3JlYXRpb24oZmlsZTogVEZpbGUpIHtcbiAgICAvLyBBZGQgbW9yZSB0aG9yb3VnaCBmaWxlIHR5cGUgY2hlY2tpbmdcbiAgICBpZiAoXG4gICAgICAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgfHxcbiAgICAgICFmaWxlLmV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpLm1hdGNoKC9eKG1kfG1hcmtkb3duKSQvKVxuICAgICkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5zZXR0aW5ncy5hdXRvQXBwbHlUYWdzKSB7XG4gICAgICByZXR1cm47IC8vIERvbid0IGFwcGx5IHRhZ3MgaWYgdGhlIHNldHRpbmcgaXMgb2ZmXG4gICAgfVxuXG4gICAgY29uc3QgZm9sZGVyID0gZmlsZS5wYXJlbnQ7XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgY29uc3QgZm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShmb2xkZXIucGF0aCk7XG4gICAgICBpZiAoZm9sZGVyVGFncy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWRkVGFnc1RvRmlsZShmaWxlLCBmb2xkZXJUYWdzKTtcbiAgICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgaGFuZGxlRmlsZU1vdmUoZmlsZTogVEZpbGUsIG9sZFBhdGg6IHN0cmluZykge1xuICAgIGNvbnNvbGUubG9nKGBGaWxlIG1vdmVkOiAke29sZFBhdGh9IC0+ICR7ZmlsZS5wYXRofWApO1xuXG4gICAgY29uc3Qgb2xkRm9sZGVyUGF0aCA9IG9sZFBhdGguc3Vic3RyaW5nKDAsIG9sZFBhdGgubGFzdEluZGV4T2YoXCIvXCIpKTtcbiAgICBjb25zdCBuZXdGb2xkZXIgPSBmaWxlLnBhcmVudDtcblxuICAgIGNvbnNvbGUubG9nKFxuICAgICAgYE9sZCBmb2xkZXIgcGF0aDogJHtvbGRGb2xkZXJQYXRofSwgTmV3IGZvbGRlcjogJHtuZXdGb2xkZXI/LnBhdGh9YFxuICAgICk7XG5cbiAgICBpZiAob2xkRm9sZGVyUGF0aCAhPT0gbmV3Rm9sZGVyPy5wYXRoKSB7XG4gICAgICBjb25zdCBvbGRGb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzV2l0aEluaGVyaXRhbmNlKG9sZEZvbGRlclBhdGgpO1xuICAgICAgY29uc3QgbmV3Rm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShcbiAgICAgICAgbmV3Rm9sZGVyPy5wYXRoIHx8IFwiXCJcbiAgICAgICk7XG5cbiAgICAgIC8vIE9ubHkgcHJvY2VlZCBpZiB0aGUgdGFncyBhcmUgZGlmZmVyZW50XG4gICAgICBpZiAoXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KG9sZEZvbGRlclRhZ3Muc29ydCgpKSAhPT1cbiAgICAgICAgSlNPTi5zdHJpbmdpZnkobmV3Rm9sZGVyVGFncy5zb3J0KCkpXG4gICAgICApIHtcbiAgICAgICAgY29uc29sZS5sb2coYE9sZCBmb2xkZXIgdGFnczogJHtvbGRGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICAgICAgY29uc29sZS5sb2coYE5ldyBmb2xkZXIgdGFnczogJHtuZXdGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgICAgICBjb25zdCBjb25mbGljdGluZ1RhZ3MgPSB0aGlzLmRldGVjdENvbmZsaWN0aW5nVGFncyhmaWxlKTtcbiAgICAgICAgY29uc29sZS5sb2coYENvbmZsaWN0aW5nIHRhZ3M6ICR7Y29uZmxpY3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgICAgICBpZiAoY29uZmxpY3RpbmdUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBuZXcgQ29uZmxpY3RSZXNvbHV0aW9uTW9kYWwoXG4gICAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICAgIGZpbGUsXG4gICAgICAgICAgICBjb25mbGljdGluZ1RhZ3MsXG4gICAgICAgICAgICB0aGlzXG4gICAgICAgICAgKS5vcGVuKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbmV3IEZpbGVNb3ZlZE1vZGFsKFxuICAgICAgICAgICAgdGhpcy5hcHAsXG4gICAgICAgICAgICBmaWxlLFxuICAgICAgICAgICAgb2xkRm9sZGVyVGFncyxcbiAgICAgICAgICAgIG5ld0ZvbGRlclRhZ3MsXG4gICAgICAgICAgICB0aGlzXG4gICAgICAgICAgKS5vcGVuKCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiRm9sZGVyIHRhZ3MgYXJlIHRoZSBzYW1lLCBubyB1cGRhdGUgbmVlZGVkXCIpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmxvZyhcIkZpbGUgbm90IG1vdmVkIGJldHdlZW4gZm9sZGVycyBvciBmb2xkZXJzIGFyZSB0aGUgc2FtZVwiKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhZGRUYWdzVG9GaWxlKGZpbGU6IFRGaWxlLCB0YWdzVG9BZGQ6IHN0cmluZ1tdKSB7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuICAgIGNvbnN0IGFsbFRhZ3MgPSB0aGlzLnJlbW92ZUR1cGxpY2F0ZVRhZ3MoWy4uLmV4aXN0aW5nVGFncywgLi4udGFnc1RvQWRkXSk7XG4gICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgYWxsVGFncyk7XG4gICAgaWYgKGNvbnRlbnQgIT09IHVwZGF0ZWRDb250ZW50KSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdXBkYXRlRmlsZVRhZ3MoXG4gICAgZmlsZTogVEZpbGUsXG4gICAgb2xkRm9sZGVyVGFnczogc3RyaW5nW10sXG4gICAgbmV3Rm9sZGVyVGFnczogc3RyaW5nW11cbiAgKSB7XG4gICAgY29uc29sZS5sb2coYFVwZGF0aW5nIHRhZ3MgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIGNvbnNvbGUubG9nKGBPbGQgZm9sZGVyIHRhZ3M6ICR7b2xkRm9sZGVyVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgY29uc29sZS5sb2coYE5ldyBmb2xkZXIgdGFnczogJHtuZXdGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgIGNvbnNvbGUubG9nKGBFeGlzdGluZyB0YWdzOiAke2V4aXN0aW5nVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAvLyBSZW1vdmUgb2xkIGZvbGRlciB0YWdzIGFuZCBrZWVwIG1hbnVhbCB0YWdzXG4gICAgY29uc3QgbWFudWFsVGFncyA9IGV4aXN0aW5nVGFncy5maWx0ZXIoXG4gICAgICAodGFnKSA9PiAhb2xkRm9sZGVyVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgKTtcblxuICAgIC8vIEFkZCBuZXcgZm9sZGVyIHRhZ3NcbiAgICBjb25zdCB1cGRhdGVkVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5tYW51YWxUYWdzLCAuLi5uZXdGb2xkZXJUYWdzXSldO1xuXG4gICAgY29uc29sZS5sb2coYE1hbnVhbCB0YWdzOiAke21hbnVhbFRhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIHRhZ3M6ICR7dXBkYXRlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgdXBkYXRlZFRhZ3MpO1xuXG4gICAgaWYgKGNvbnRlbnQgIT09IHVwZGF0ZWRDb250ZW50KSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgY29uc29sZS5sb2coYFRhZ3MgdXBkYXRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKGBObyBjaGFuZ2VzIG5lZWRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgdXBkYXRlVGFnc0luQ29udGVudChjb250ZW50OiBzdHJpbmcsIHRhZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgICBjb25zdCB1bmlxdWVUYWdzID0gWy4uLm5ldyBTZXQodGFncyldO1xuXG4gICAgaWYgKHVuaXF1ZVRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZW1vdmVZYW1sRnJvbnRNYXR0ZXIoY29udGVudCk7XG4gICAgfVxuXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgIGNvbnN0IHRhZ1NlY3Rpb24gPSB1bmlxdWVUYWdzLm1hcCgodGFnKSA9PiBgICAtICR7dGFnfWApLmpvaW4oXCJcXG5cIik7XG5cbiAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgY29uc3QgdXBkYXRlZEZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXIucmVwbGFjZShcbiAgICAgICAgL3RhZ3M6W1xcc1xcU10qPyhcXG58JCkvLFxuICAgICAgICBgdGFnczpcXG4ke3RhZ1NlY3Rpb259XFxuYFxuICAgICAgKTtcbiAgICAgIHJldHVybiBjb250ZW50LnJlcGxhY2UoXG4gICAgICAgIGZyb250bWF0dGVyUmVnZXgsXG4gICAgICAgIGAtLS1cXG4ke3VwZGF0ZWRGcm9udG1hdHRlcn1cXG4tLS1gXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYC0tLVxcbnRhZ3M6XFxuJHt0YWdTZWN0aW9ufVxcbi0tLVxcblxcbiR7Y29udGVudH1gO1xuICAgIH1cbiAgfVxuXG4gIGFkZFRhZ3NUb0NvbnRlbnQoY29udGVudDogc3RyaW5nLCB0YWdzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gICAgaWYgKHRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gY29udGVudDtcbiAgICB9XG5cbiAgICBjb25zdCB0YWdTZWN0aW9uID0gdGFncy5tYXAoKHRhZykgPT4gYCAgLSAke3RhZ31gKS5qb2luKFwiXFxuXCIpO1xuICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG5cbiAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgY29uc3QgdXBkYXRlZEZyb250bWF0dGVyID0gYCR7ZnJvbnRtYXR0ZXIudHJpbSgpfVxcbnRhZ3M6XFxuJHt0YWdTZWN0aW9ufWA7XG4gICAgICByZXR1cm4gY29udGVudC5yZXBsYWNlKFxuICAgICAgICBmcm9udG1hdHRlclJlZ2V4LFxuICAgICAgICBgLS0tXFxuJHt1cGRhdGVkRnJvbnRtYXR0ZXJ9XFxuLS0tYFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGAtLS1cXG50YWdzOlxcbiR7dGFnU2VjdGlvbn1cXG4tLS1cXG5cXG4ke2NvbnRlbnR9YDtcbiAgICB9XG4gIH1cblxuICByZW1vdmVUYWdzRnJvbUNvbnRlbnQoY29udGVudDogc3RyaW5nLCB0YWdzVG9SZW1vdmU6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IGZyb250bWF0dGVyLm1hdGNoKC90YWdzOlxccypcXFsoLio/KVxcXS8pO1xuXG4gICAgICBpZiAoZXhpc3RpbmdUYWdzKSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRUYWdzID0gZXhpc3RpbmdUYWdzWzFdLnNwbGl0KFwiLFwiKS5tYXAoKHRhZykgPT4gdGFnLnRyaW0oKSk7XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRUYWdzID0gY3VycmVudFRhZ3MuZmlsdGVyKFxuICAgICAgICAgICh0YWcpID0+ICF0YWdzVG9SZW1vdmUuaW5jbHVkZXModGFnKVxuICAgICAgICApO1xuICAgICAgICBjb25zdCB1cGRhdGVkRnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlci5yZXBsYWNlKFxuICAgICAgICAgIC90YWdzOlxccypcXFsuKj9cXF0vLFxuICAgICAgICAgIGB0YWdzOiBbJHt1cGRhdGVkVGFncy5qb2luKFwiLCBcIil9XWBcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZShcbiAgICAgICAgICBmcm9udG1hdHRlclJlZ2V4LFxuICAgICAgICAgIGAtLS1cXG4ke3VwZGF0ZWRGcm9udG1hdHRlcn1cXG4tLS1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH1cblxuICBhc3luYyBhcHBseUZpbGVUYWdzVG9Gb2xkZXIoZmlsZTogVEZpbGUpIHtcbiAgICBjb25zdCBmb2xkZXIgPSBmaWxlLnBhcmVudDtcbiAgICBpZiAoIWZvbGRlcikge1xuICAgICAgbmV3IE5vdGljZShcIkZpbGUgaXMgbm90IGluIGEgZm9sZGVyXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGZpbGVUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgY29uc29sZS5sb2coYEV4dHJhY3RlZCB0YWdzIGZyb20gZmlsZTogJHtmaWxlVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBpZiAoZmlsZVRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gdGFncyBmb3VuZCBpbiB0aGUgZmlsZVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBHZXQgdGFncyBvbmx5IGZyb20gdGhlIGltbWVkaWF0ZSBwYXJlbnQgZm9sZGVyXG4gICAgY29uc3QgZm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCk7XG4gICAgY29uc3QgbmV3VGFncyA9IFsuLi5uZXcgU2V0KFsuLi5mb2xkZXJUYWdzLCAuLi5maWxlVGFnc10pXTtcbiAgICBjb25zdCBhZGRlZFRhZ3MgPSBuZXdUYWdzLmZpbHRlcigodGFnKSA9PiAhZm9sZGVyVGFncy5pbmNsdWRlcyh0YWcpKTtcblxuICAgIGNvbnNvbGUubG9nKGBFeGlzdGluZyBmb2xkZXIgdGFnczogJHtmb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICBjb25zb2xlLmxvZyhgTmV3IHRhZ3MgdG8gYWRkOiAke2FkZGVkVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBpZiAoYWRkZWRUYWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbmV3IE5vdGljZShcIk5vIG5ldyB0YWdzIHRvIGFkZCB0byB0aGUgZm9sZGVyXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ldyBUYWdTZWxlY3Rpb25Nb2RhbChcbiAgICAgIHRoaXMuYXBwLFxuICAgICAgYFNlbGVjdCB0YWdzIHRvIGFkZCBmcm9tIHRoZSBmaWxlIFwiJHtmaWxlLm5hbWV9XCIgdG8gdGhlIGZvbGRlciBcIiR7Zm9sZGVyLm5hbWV9XCI6YCxcbiAgICAgIGFkZGVkVGFncyxcbiAgICAgIChzZWxlY3RlZFRhZ3MpID0+IHtcbiAgICAgICAgY29uc3QgdXBkYXRlZFRhZ3MgPSBbLi4ubmV3IFNldChbLi4uZm9sZGVyVGFncywgLi4uc2VsZWN0ZWRUYWdzXSldO1xuICAgICAgICB0aGlzLnNldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgsIHVwZGF0ZWRUYWdzKTtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICBgQXBwbGllZCAke3NlbGVjdGVkVGFncy5sZW5ndGh9IHRhZ3MgZnJvbSBmaWxlIHRvIGZvbGRlcjogJHtmb2xkZXIubmFtZX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgKS5vcGVuKCk7XG4gIH1cblxuICBleHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgbGV0IHRhZ3M6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgLy8gTWF0Y2ggYm90aCBhcnJheS1zdHlsZSBhbmQgbGlzdC1zdHlsZSBZQU1MIHRhZ3NcbiAgICAgIGNvbnN0IHlhbWxUYWdzID0gZnJvbnRtYXR0ZXIubWF0Y2goL3RhZ3M6XFxzKihcXFsuKj9cXF18KFxcblxccyotXFxzKi4rKSspLyk7XG4gICAgICBpZiAoeWFtbFRhZ3MpIHtcbiAgICAgICAgY29uc3QgdGFnQ29udGVudCA9IHlhbWxUYWdzWzFdO1xuICAgICAgICBpZiAodGFnQ29udGVudC5zdGFydHNXaXRoKFwiW1wiKSkge1xuICAgICAgICAgIC8vIEFycmF5LXN0eWxlIHRhZ3NcbiAgICAgICAgICB0YWdzID0gdGFnQ29udGVudFxuICAgICAgICAgICAgLnNsaWNlKDEsIC0xKVxuICAgICAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAgICAgLm1hcCgodGFnKSA9PiB0YWcudHJpbSgpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBMaXN0LXN0eWxlIHRhZ3NcbiAgICAgICAgICB0YWdzID0gdGFnQ29udGVudFxuICAgICAgICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAgICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnJlcGxhY2UoL15cXHMqLVxccyovLCBcIlwiKS50cmltKCkpXG4gICAgICAgICAgICAuZmlsdGVyKCh0YWcpID0+IHRhZyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IGlubGluZSB0YWdzXG4gICAgY29uc3QgaW5saW5lVGFncyA9IGNvbnRlbnQubWF0Y2goLyNbXlxccyNdKy9nKTtcbiAgICBpZiAoaW5saW5lVGFncykge1xuICAgICAgdGFncyA9IFsuLi50YWdzLCAuLi5pbmxpbmVUYWdzLm1hcCgodGFnKSA9PiB0YWcuc3Vic3RyaW5nKDEpKV07XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRhZ3MpXTsgLy8gUmVtb3ZlIGR1cGxpY2F0ZXNcbiAgfVxuXG4gIGFzeW5jIGNvbnZlcnRJbmxpbmVUYWdzVG9ZQU1MKGZpbGU6IFRGaWxlKSB7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgaW5saW5lVGFncyA9IGNvbnRlbnQubWF0Y2goLyNbXlxccyNdKy9nKTtcblxuICAgIGlmICghaW5saW5lVGFncykge1xuICAgICAgbmV3IE5vdGljZShcIk5vIGlubGluZSB0YWdzIGZvdW5kIGluIHRoZSBmaWxlXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG5ld1RhZ3MgPSBpbmxpbmVUYWdzLm1hcCgodGFnKSA9PiB0YWcuc3Vic3RyaW5nKDEpKTtcblxuICAgIG5ldyBDb25maXJtYXRpb25Nb2RhbChcbiAgICAgIHRoaXMuYXBwLFxuICAgICAgYFRoaXMgd2lsbCBjb252ZXJ0ICR7bmV3VGFncy5sZW5ndGh9IGlubGluZSB0YWdzIHRvIFlBTUwgZnJvbnQgbWF0dGVyIGFuZCByZW1vdmUgdGhlbSBmcm9tIHRoZSBjb250ZW50LiBBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gcHJvY2VlZD9gLFxuICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICBuZXcgVGFnU2VsZWN0aW9uTW9kYWwoXG4gICAgICAgICAgdGhpcy5hcHAsXG4gICAgICAgICAgYFNlbGVjdCBpbmxpbmUgdGFncyB0byBjb252ZXJ0IHRvIFlBTUwgZnJvbnQgbWF0dGVyOmAsXG4gICAgICAgICAgbmV3VGFncyxcbiAgICAgICAgICBhc3luYyAoc2VsZWN0ZWRUYWdzKSA9PiB7XG4gICAgICAgICAgICBpZiAoc2VsZWN0ZWRUYWdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiTm8gdGFncyBzZWxlY3RlZCBmb3IgY29udmVyc2lvblwiKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGV4aXN0aW5nIFlBTUwgdGFnc1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgICAgICAgICAvLyBDb21iaW5lIGV4aXN0aW5nIGFuZCBuZXcgdGFncywgcmVtb3ZpbmcgZHVwbGljYXRlc1xuICAgICAgICAgICAgY29uc3QgYWxsVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5leGlzdGluZ1RhZ3MsIC4uLnNlbGVjdGVkVGFnc10pXTtcblxuICAgICAgICAgICAgbGV0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy5hZGRUYWdzVG9Db250ZW50KGNvbnRlbnQsIGFsbFRhZ3MpO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgc2VsZWN0ZWQgaW5saW5lIHRhZ3MgZnJvbSB0aGUgY29udGVudFxuICAgICAgICAgICAgc2VsZWN0ZWRUYWdzLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAoYCMke3RhZ31cXFxcYmAsIFwiZ1wiKTtcbiAgICAgICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKHJlZ2V4LCBcIlwiKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICAgICAgYENvbnZlcnRlZCAke3NlbGVjdGVkVGFncy5sZW5ndGh9IGlubGluZSB0YWdzIHRvIFlBTUwgZnJvbnQgbWF0dGVyYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICkub3BlbigpO1xuICAgICAgfVxuICAgICkub3BlbigpO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVGb2xkZXJEZWxldGlvbihmb2xkZXI6IFRGb2xkZXIpIHtcbiAgICBkZWxldGUgdGhpcy5mb2xkZXJUYWdzW2ZvbGRlci5wYXRoXTtcbiAgICB0aGlzLnNhdmVGb2xkZXJUYWdzKCk7XG4gIH1cblxuICBhc3luYyBhcHBseUZvbGRlclRhZ3NUb0NvbnRlbnRzKGZvbGRlcjogVEZvbGRlciB8IG51bGwpIHtcbiAgICBpZiAoIWZvbGRlcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIkZvbGRlciBpcyBudWxsIG9yIHVuZGVmaW5lZFwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoKTtcbiAgICBjb25zdCBmaWxlcyA9IGZvbGRlci5jaGlsZHJlbi5maWx0ZXIoXG4gICAgICAoY2hpbGQpOiBjaGlsZCBpcyBURmlsZSA9PiBjaGlsZCBpbnN0YW5jZW9mIFRGaWxlXG4gICAgKTtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgYXdhaXQgdGhpcy5hZGRUYWdzVG9GaWxlKGZpbGUsIGZvbGRlclRhZ3MpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemVEYXRhRmlsZSgpIHtcbiAgICBjb25zdCBpbml0aWFsRGF0YSA9IHtcbiAgICAgIHNldHRpbmdzOiBERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgZm9sZGVyVGFnczoge30sXG4gICAgfTtcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUyk7XG4gICAgdGhpcy5mb2xkZXJUYWdzID0ge307XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YShpbml0aWFsRGF0YSk7XG4gICAgY29uc29sZS5sb2coXCJJbml0aWFsaXplZCBkYXRhIGZpbGUgd2l0aCBkZWZhdWx0IHZhbHVlc1wiKTtcbiAgfVxuXG4gIHF1ZXVlTmV3Rm9sZGVyKGZvbGRlcjogVEZvbGRlcikge1xuICAgIC8vIEVuc3VyZSB3ZSBoYXZlIHRoZSBtb3N0IHVwLXRvLWRhdGUgZm9sZGVyIG9iamVjdFxuICAgIGNvbnN0IHVwZGF0ZWRGb2xkZXIgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZm9sZGVyLnBhdGgpO1xuICAgIGlmICh1cGRhdGVkRm9sZGVyIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgdGhpcy5uZXdGb2xkZXJRdWV1ZS5wdXNoKHVwZGF0ZWRGb2xkZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICBgRmFpbGVkIHRvIGdldCB1cGRhdGVkIGZvbGRlciBvYmplY3QgZm9yIHBhdGg6ICR7Zm9sZGVyLnBhdGh9YFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBwcm9jZXNzTmV3Rm9sZGVyUXVldWUoKSB7XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgdGhpcy5uZXdGb2xkZXJRdWV1ZSkge1xuICAgICAgYXdhaXQgdGhpcy5wcm9tcHRGb3JGb2xkZXJUYWdzKGZvbGRlcik7XG4gICAgfVxuICAgIHRoaXMubmV3Rm9sZGVyUXVldWUgPSBbXTsgLy8gQ2xlYXIgdGhlIHF1ZXVlXG4gIH1cblxuICBhc3luYyBwcm9tcHRGb3JGb2xkZXJUYWdzKGZvbGRlcjogVEZvbGRlcikge1xuICAgIG5ldyBGb2xkZXJUYWdNb2RhbCh0aGlzLmFwcCwgZm9sZGVyLCB0aGlzLCB0cnVlKS5vcGVuKCk7XG4gIH1cblxuICBnZXRGb2xkZXJUYWdzV2l0aEluaGVyaXRhbmNlKGZvbGRlclBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5pbmhlcml0YW5jZU1vZGUgPT09IFwibm9uZVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlclBhdGgpO1xuICAgIH1cblxuICAgIGxldCB0YWdzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGxldCBjdXJyZW50UGF0aCA9IGZvbGRlclBhdGg7XG5cbiAgICB3aGlsZSAoY3VycmVudFBhdGgpIHtcbiAgICAgIGlmICghdGhpcy5zZXR0aW5ncy5leGNsdWRlZEZvbGRlcnMuaW5jbHVkZXMoY3VycmVudFBhdGgpKSB7XG4gICAgICAgIHRhZ3MgPSBbLi4ubmV3IFNldChbLi4udGFncywgLi4udGhpcy5nZXRGb2xkZXJUYWdzKGN1cnJlbnRQYXRoKV0pXTtcbiAgICAgIH1cblxuICAgICAgaWYgKFxuICAgICAgICB0aGlzLnNldHRpbmdzLmluaGVyaXRhbmNlTW9kZSA9PT0gXCJpbW1lZGlhdGVcIiAmJlxuICAgICAgICBjdXJyZW50UGF0aCAhPT0gZm9sZGVyUGF0aFxuICAgICAgKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnRQYXRoID0gY3VycmVudFBhdGguc3Vic3RyaW5nKDAsIGN1cnJlbnRQYXRoLmxhc3RJbmRleE9mKFwiL1wiKSk7XG4gICAgICBpZiAocGFyZW50UGF0aCA9PT0gY3VycmVudFBhdGgpIHtcbiAgICAgICAgYnJlYWs7IC8vIFdlJ3ZlIHJlYWNoZWQgdGhlIHJvb3RcbiAgICAgIH1cbiAgICAgIGN1cnJlbnRQYXRoID0gcGFyZW50UGF0aDtcbiAgICB9XG5cbiAgICByZXR1cm4gdGFncztcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZUZvbGRlckljb25zKCkge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy5zaG93Rm9sZGVySWNvbnMpIHtcbiAgICAgIC8vIFJlbW92ZSBhbGwgZm9sZGVyIGljb25zIGlmIHRoZSBzZXR0aW5nIGlzIG9mZlxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtZXhwbG9yZXJcIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgICBjb25zdCBmaWxlRXhwbG9yZXJWaWV3ID0gbGVhZi52aWV3IGFzIGFueTtcbiAgICAgICAgY29uc3QgZmlsZUl0ZW1zID0gZmlsZUV4cGxvcmVyVmlldy5maWxlSXRlbXM7XG4gICAgICAgIGZvciAoY29uc3QgWywgaXRlbV0gb2YgT2JqZWN0LmVudHJpZXMoZmlsZUl0ZW1zKSkge1xuICAgICAgICAgIGlmIChpdGVtICYmIHR5cGVvZiBpdGVtID09PSBcIm9iamVjdFwiICYmIFwiZWxcIiBpbiBpdGVtKSB7XG4gICAgICAgICAgICBjb25zdCBmb2xkZXJFbCA9IGl0ZW0uZWwgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgICBjb25zdCBpY29uRWwgPSBmb2xkZXJFbC5xdWVyeVNlbGVjdG9yKFxuICAgICAgICAgICAgICBcIi5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIlxuICAgICAgICAgICAgKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgICAgICBpZiAoaWNvbkVsKSB7XG4gICAgICAgICAgICAgIGljb25FbC5yZW1vdmVDbGFzcyhcInRhZ2dlZC1mb2xkZXJcIik7XG4gICAgICAgICAgICAgIGljb25FbC5yZW1vdmVBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZUV4cGxvcmVyID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtZXhwbG9yZXJcIilbMF07XG4gICAgaWYgKCFmaWxlRXhwbG9yZXIpIHJldHVybjtcblxuICAgIGNvbnN0IGZpbGVFeHBsb3JlclZpZXcgPSBmaWxlRXhwbG9yZXIudmlldyBhcyBhbnk7XG4gICAgY29uc3QgZmlsZUl0ZW1zID0gZmlsZUV4cGxvcmVyVmlldy5maWxlSXRlbXM7XG5cbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBpdGVtXSBvZiBPYmplY3QuZW50cmllcyhmaWxlSXRlbXMpKSB7XG4gICAgICBpZiAoXG4gICAgICAgIGl0ZW0gJiZcbiAgICAgICAgdHlwZW9mIGl0ZW0gPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJlbFwiIGluIGl0ZW0gJiZcbiAgICAgICAgXCJmaWxlXCIgaW4gaXRlbSAmJlxuICAgICAgICBpdGVtLmZpbGUgaW5zdGFuY2VvZiBURm9sZGVyXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgZm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFnc1dpdGhJbmhlcml0YW5jZShwYXRoIGFzIHN0cmluZyk7XG4gICAgICAgIGNvbnN0IGZvbGRlckVsID0gaXRlbS5lbCBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgY29uc3QgaWNvbkVsID0gZm9sZGVyRWwucXVlcnlTZWxlY3RvcihcbiAgICAgICAgICBcIi5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIlxuICAgICAgICApIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcblxuICAgICAgICBpZiAoaWNvbkVsKSB7XG4gICAgICAgICAgaWYgKGZvbGRlclRhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgaWNvbkVsLmFkZENsYXNzKFwidGFnZ2VkLWZvbGRlclwiKTtcbiAgICAgICAgICAgIGljb25FbC5zZXRBdHRyaWJ1dGUoXG4gICAgICAgICAgICAgIFwiYXJpYS1sYWJlbFwiLFxuICAgICAgICAgICAgICBgVGFnZ2VkIGZvbGRlcjogJHtmb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpY29uRWwucmVtb3ZlQ2xhc3MoXCJ0YWdnZWQtZm9sZGVyXCIpO1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnNvbGUud2FybihgQ291bGQgbm90IGZpbmQgaWNvbiBlbGVtZW50IGZvciBmb2xkZXI6ICR7cGF0aH1gKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEFkZCB0aGlzIG5ldyBtZXRob2RcbiAgYXN5bmMgdXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpIHtcbiAgICB0cnkge1xuICAgICAgLy8gVHJpZ2dlciBtZXRhZGF0YSBjYWNoZSB1cGRhdGVcbiAgICAgIHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUudHJpZ2dlcihcImNoYW5nZWRcIik7XG5cbiAgICAgIC8vIFRyeSB0byByZWZyZXNoIHRoZSB0YWcgcGFuZSBpZiBpdCBleGlzdHNcbiAgICAgIGNvbnN0IHRhZ1BhbmVMZWF2ZXMgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwidGFnXCIpO1xuICAgICAgaWYgKHRhZ1BhbmVMZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBVc2UgdGhlIHdvcmtzcGFjZSB0cmlnZ2VyIGluc3RlYWQgb2YgZGlyZWN0bHkgY2FsbGluZyByZWZyZXNoXG4gICAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwidGFncy11cGRhdGVkXCIpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy5kZWJ1Z01vZGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byB1cGRhdGUgdGFnIGNhY2hlOlwiLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIHRoaXMgbmV3IG1ldGhvZFxuICBnZXRBbGxGb2xkZXJUYWdzKCk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhbGxUYWdzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCB0YWdzIG9mIE9iamVjdC52YWx1ZXModGhpcy5mb2xkZXJUYWdzKSkge1xuICAgICAgdGFncy5mb3JFYWNoKCh0YWc6IHN0cmluZykgPT4gYWxsVGFncy5hZGQodGFnKSk7XG4gICAgfVxuICAgIHJldHVybiBBcnJheS5mcm9tKGFsbFRhZ3MpO1xuICB9XG5cbiAgYXN5bmMgcmVwbGFjZUFsbFRhZ3MoZmlsZTogVEZpbGUsIG5ld1RhZ3M6IHN0cmluZ1tdKSB7XG4gICAgY29uc29sZS5sb2coYFJlcGxhY2luZyBhbGwgdGFncyBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgY29uc29sZS5sb2coYE5ldyB0YWdzOiAke25ld1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG5cbiAgICAvLyBSZW1vdmUgYWxsIGV4aXN0aW5nIHRhZ3MgZnJvbSB0aGUgY29udGVudFxuICAgIGxldCB1cGRhdGVkQ29udGVudCA9IHRoaXMucmVtb3ZlQWxsVGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgLy8gQWRkIG5ldyB0YWdzXG4gICAgaWYgKG5ld1RhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSB1cGRhdGVkQ29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgICBjb25zdCBuZXdUYWdzU2VjdGlvbiA9IGB0YWdzOlxcbiR7bmV3VGFnc1xuICAgICAgICAgIC5tYXAoKHRhZykgPT4gYCAgLSAke3RhZ31gKVxuICAgICAgICAgIC5qb2luKFwiXFxuXCIpfWA7XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRGcm9udG1hdHRlciA9IGAke2Zyb250bWF0dGVyLnRyaW0oKX1cXG4ke25ld1RhZ3NTZWN0aW9ufWA7XG4gICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShcbiAgICAgICAgICBmcm9udG1hdHRlclJlZ2V4LFxuICAgICAgICAgIGAtLS1cXG4ke3VwZGF0ZWRGcm9udG1hdHRlcn1cXG4tLS1gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuZXdUYWdzU2VjdGlvbiA9IGB0YWdzOlxcbiR7bmV3VGFnc1xuICAgICAgICAgIC5tYXAoKHRhZykgPT4gYCAgLSAke3RhZ31gKVxuICAgICAgICAgIC5qb2luKFwiXFxuXCIpfWA7XG4gICAgICAgIHVwZGF0ZWRDb250ZW50ID0gYC0tLVxcbiR7bmV3VGFnc1NlY3Rpb259XFxuLS0tXFxuXFxuJHt1cGRhdGVkQ29udGVudH1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgbmV3IE5vdGljZShgVGFncyByZXBsYWNlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gIH1cblxuICByZW1vdmVBbGxUYWdzRnJvbUNvbnRlbnQoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgIGxldCBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG4gICAgICAvLyBSZW1vdmUgYm90aCBsaXN0LXN0eWxlIGFuZCBhcnJheS1zdHlsZSB0YWcgZGVjbGFyYXRpb25zXG4gICAgICBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyLnJlcGxhY2UoL150YWdzOltcXHNcXFNdKj8oXFxuW15cXHNdfFxcbiQpL20sIFwiJDFcIik7XG4gICAgICBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyLnJlcGxhY2UoL14tIC4qXFxuPy9nbSwgXCJcIik7XG4gICAgICBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyLnRyaW0oKTtcblxuICAgICAgaWYgKGZyb250bWF0dGVyKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50LnJlcGxhY2UoZnJvbnRtYXR0ZXJSZWdleCwgYC0tLVxcbiR7ZnJvbnRtYXR0ZXJ9XFxuLS0tYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZiBmcm9udG1hdHRlciBpcyBlbXB0eSBhZnRlciByZW1vdmluZyB0YWdzLCByZW1vdmUgdGhlIGVudGlyZSBmcm9udG1hdHRlclxuICAgICAgICByZXR1cm4gY29udGVudC5yZXBsYWNlKGZyb250bWF0dGVyUmVnZXgsIFwiXCIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb250ZW50O1xuICB9XG5cbiAgYXN5bmMgbWVyZ2VUYWdzKGZpbGU6IFRGaWxlLCBvbGRUYWdzOiBzdHJpbmdbXSwgbmV3VGFnczogc3RyaW5nW10pIHtcbiAgICBjb25zb2xlLmxvZyhgTWVyZ2luZyB0YWdzIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICBjb25zb2xlLmxvZyhgT2xkIHRhZ3M6ICR7b2xkVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgY29uc29sZS5sb2coYE5ldyB0YWdzOiAke25ld1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgY29uc29sZS5sb2coYEV4aXN0aW5nIHRhZ3M6ICR7ZXhpc3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIC8vIFJlbW92ZSBvbGQgZm9sZGVyIHRhZ3NcbiAgICBjb25zdCBtYW51YWxUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcigodGFnKSA9PiAhb2xkVGFncy5pbmNsdWRlcyh0YWcpKTtcblxuICAgIC8vIE1lcmdlIG1hbnVhbCB0YWdzIHdpdGggbmV3IGZvbGRlciB0YWdzLCBlbnN1cmluZyBubyBkdXBsaWNhdGVzXG4gICAgY29uc3QgbWVyZ2VkVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5tYW51YWxUYWdzLCAuLi5uZXdUYWdzXSldO1xuXG4gICAgY29uc29sZS5sb2coYE1lcmdlZCB0YWdzOiAke21lcmdlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgaWYgKFxuICAgICAgSlNPTi5zdHJpbmdpZnkoZXhpc3RpbmdUYWdzLnNvcnQoKSkgIT09IEpTT04uc3RyaW5naWZ5KG1lcmdlZFRhZ3Muc29ydCgpKVxuICAgICkge1xuICAgICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgbWVyZ2VkVGFncyk7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgICBuZXcgTm90aWNlKGBUYWdzIG1lcmdlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKGBObyBjaGFuZ2VzIG5lZWRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYXBwbHlGb2xkZXJUYWdzVG9Ob3Rlcyhmb2xkZXI6IFRGb2xkZXIpIHtcbiAgICBjb25zdCBmb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoKTtcbiAgICBpZiAoZm9sZGVyVGFncy5sZW5ndGggPT09IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGZvbGRlciBoYXMgbm8gdGFncyB0byBhcHBseS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZXMgPSBmb2xkZXIuY2hpbGRyZW4uZmlsdGVyKFxuICAgICAgKGNoaWxkKTogY2hpbGQgaXMgVEZpbGUgPT4gY2hpbGQgaW5zdGFuY2VvZiBURmlsZVxuICAgICk7XG4gICAgbGV0IHVwZGF0ZWRDb3VudCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuICAgICAgY29uc3QgbWVyZ2VkVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5leGlzdGluZ1RhZ3MsIC4uLmZvbGRlclRhZ3NdKV07XG5cbiAgICAgIGlmIChtZXJnZWRUYWdzLmxlbmd0aCA+IGV4aXN0aW5nVGFncy5sZW5ndGgpIHtcbiAgICAgICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgbWVyZ2VkVGFncyk7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICAgIHVwZGF0ZWRDb3VudCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXG4gICAgICBgQXBwbGllZCBmb2xkZXIgdGFncyB0byAke3VwZGF0ZWRDb3VudH0gZmlsZShzKSBpbiAke2ZvbGRlci5uYW1lfWBcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlVGFnc0Zyb21GaWxlKGZpbGU6IFRGaWxlLCB0YWdzVG9SZW1vdmU6IHN0cmluZ1tdKSB7XG4gICAgY29uc29sZS5sb2coYFJlbW92aW5nIGZvbGRlciB0YWdzIGZyb20gZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgY29uc29sZS5sb2coYFRhZ3MgdG8gcmVtb3ZlOiAke3RhZ3NUb1JlbW92ZS5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICBjb25zb2xlLmxvZyhgRXhpc3RpbmcgdGFnczogJHtleGlzdGluZ1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgLy8gS2VlcCBhbGwgdGFncyB0aGF0IGFyZSBub3QgaW4gdGFnc1RvUmVtb3ZlXG4gICAgY29uc3QgdXBkYXRlZFRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKFxuICAgICAgKHRhZykgPT4gIXRhZ3NUb1JlbW92ZS5pbmNsdWRlcyh0YWcpXG4gICAgKTtcblxuICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIHRhZ3M6ICR7dXBkYXRlZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgLy8gVXNlIHVwZGF0ZVRhZ3NJbkNvbnRlbnQgdG8gdXBkYXRlIHRoZSBmaWxlJ3MgY29udGVudFxuICAgIGxldCB1cGRhdGVkQ29udGVudDogc3RyaW5nO1xuICAgIGlmICh1cGRhdGVkVGFncy5sZW5ndGggPiAwKSB7XG4gICAgICB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudChjb250ZW50LCB1cGRhdGVkVGFncyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIG5vIHRhZ3MgcmVtYWluLCByZW1vdmUgdGhlIGVudGlyZSBZQU1MIGZyb250IG1hdHRlclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnJlbW92ZVlhbWxGcm9udE1hdHRlcihjb250ZW50KTtcbiAgICB9XG5cbiAgICAvLyBPbmx5IG1vZGlmeSB0aGUgZmlsZSBpZiB0aGUgY29udGVudCBoYXMgY2hhbmdlZFxuICAgIGlmIChjb250ZW50ICE9PSB1cGRhdGVkQ29udGVudCkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIGNvbnRlbnQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgdGhpcy51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgICBuZXcgTm90aWNlKGBSZW1vdmVkIGZvbGRlciB0YWdzIGZyb20gZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKGBObyBjaGFuZ2VzIG5lZWRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlWWFtbEZyb250TWF0dGVyKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuW1xcc1xcU10qP1xcbi0tLVxcbi87XG4gICAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZShmcm9udG1hdHRlclJlZ2V4LCBcIlwiKTtcbiAgfVxuXG4gIGRldGVjdENvbmZsaWN0aW5nVGFncyhmaWxlOiBURmlsZSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwYXJlbnRGb2xkZXJzID0gdGhpcy5nZXRQYXJlbnRGb2xkZXJzKGZpbGUpO1xuICAgIGNvbnN0IGFsbFRhZ3MgPSBwYXJlbnRGb2xkZXJzLmZsYXRNYXAoKGZvbGRlcikgPT5cbiAgICAgIHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aClcbiAgICApO1xuICAgIHJldHVybiBhbGxUYWdzLmZpbHRlcigodGFnLCBpbmRleCwgc2VsZikgPT4gc2VsZi5pbmRleE9mKHRhZykgIT09IGluZGV4KTtcbiAgfVxuXG4gIGdldFBhcmVudEZvbGRlcnMoZmlsZTogVEZpbGUpOiBURm9sZGVyW10ge1xuICAgIGNvbnN0IGZvbGRlcnM6IFRGb2xkZXJbXSA9IFtdO1xuICAgIGxldCBjdXJyZW50Rm9sZGVyID0gZmlsZS5wYXJlbnQ7XG4gICAgd2hpbGUgKGN1cnJlbnRGb2xkZXIpIHtcbiAgICAgIGZvbGRlcnMucHVzaChjdXJyZW50Rm9sZGVyKTtcbiAgICAgIGN1cnJlbnRGb2xkZXIgPSBjdXJyZW50Rm9sZGVyLnBhcmVudDtcbiAgICB9XG4gICAgcmV0dXJuIGZvbGRlcnM7XG4gIH1cblxuICBwcml2YXRlIHJlbW92ZUR1cGxpY2F0ZVRhZ3ModGFnczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRhZ3MpXTtcbiAgfVxuXG4gIHJlbW92ZUZvbGRlckljb25zKCkge1xuICAgIC8vIEN1cnJlbnQgaW1wbGVtZW50YXRpb24gbWlnaHQgbWlzcyBzb21lIGVsZW1lbnRzXG4gICAgLy8gQWRkIG1vcmUgcm9idXN0IGVsZW1lbnQgc2VsZWN0aW9uIGFuZCBjbGVhbnVwXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtZXhwbG9yZXJcIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgY29uc3QgZmlsZUV4cGxvcmVyVmlldyA9IGxlYWYudmlldyBhcyBhbnk7XG4gICAgICBjb25zdCBmaWxlSXRlbXMgPSBmaWxlRXhwbG9yZXJWaWV3LmZpbGVJdGVtcztcbiAgICAgIGZvciAoY29uc3QgWywgaXRlbV0gb2YgT2JqZWN0LmVudHJpZXMoZmlsZUl0ZW1zKSkge1xuICAgICAgICBpZiAoaXRlbSAmJiB0eXBlb2YgaXRlbSA9PT0gXCJvYmplY3RcIiAmJiBcImVsXCIgaW4gaXRlbSkge1xuICAgICAgICAgIGNvbnN0IGZvbGRlckVsID0gaXRlbS5lbCBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICBjb25zdCBpY29uRWwgPSBmb2xkZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiKTtcbiAgICAgICAgICBpZiAoaWNvbkVsKSB7XG4gICAgICAgICAgICBpY29uRWwucmVtb3ZlQ2xhc3MoXCJ0YWdnZWQtZm9sZGVyXCIpO1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIik7XG4gICAgICAgICAgICAvLyBBbHNvIHJlbW92ZSBhbnkgb3RoZXIgY3VzdG9tIGNsYXNzZXMgb3IgYXR0cmlidXRlc1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUF0dHJpYnV0ZShcImRhdGEtdGFnaXRcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBoYW5kbGVGaWxlTW92ZW1lbnQoZmlsZTogVEZpbGUpIHtcbiAgICAvLyBBZGQgZGVib3VuY2luZyB0byBwcmV2ZW50IG11bHRpcGxlIHJhcGlkIGZpbGUgbW92ZW1lbnRzIGZyb20gY2F1c2luZyBpc3N1ZXNcbiAgICBpZiAodGhpcy5tb3ZlVGltZW91dCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMubW92ZVRpbWVvdXQpO1xuICAgIH1cbiAgICB0aGlzLm1vdmVUaW1lb3V0ID0gc2V0VGltZW91dChhc3luYyAoKSA9PiB7XG4gICAgICAvLyBFeGlzdGluZyBmaWxlIG1vdmVtZW50IGxvZ2ljXG4gICAgfSwgMzAwKTtcbiAgfVxuXG4gIGFzeW5jIG1pZ3JhdGVTZXR0aW5ncyhvbGREYXRhOiBhbnkpOiBQcm9taXNlPFRhZ0l0U2V0dGluZ3M+IHtcbiAgICBjb25zb2xlLmxvZyhcIk1pZ3JhdGluZyBzZXR0aW5ncyBmcm9tIG9sZCB2ZXJzaW9uXCIpO1xuICAgIC8vIEZvciBub3csIGp1c3QgcmV0dXJuIHRoZSBkZWZhdWx0IHNldHRpbmdzIG1lcmdlZCB3aXRoIGFueSB2YWxpZCBvbGQgc2V0dGluZ3NcbiAgICByZXR1cm4ge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIC4uLntcbiAgICAgICAgaW5oZXJpdGFuY2VNb2RlOlxuICAgICAgICAgIG9sZERhdGEuaW5oZXJpdGFuY2VNb2RlIHx8IERFRkFVTFRfU0VUVElOR1MuaW5oZXJpdGFuY2VNb2RlLFxuICAgICAgICBleGNsdWRlZEZvbGRlcnM6XG4gICAgICAgICAgb2xkRGF0YS5leGNsdWRlZEZvbGRlcnMgfHwgREVGQVVMVF9TRVRUSU5HUy5leGNsdWRlZEZvbGRlcnMsXG4gICAgICAgIHNob3dGb2xkZXJJY29uczpcbiAgICAgICAgICBvbGREYXRhLnNob3dGb2xkZXJJY29ucyB8fCBERUZBVUxUX1NFVFRJTkdTLnNob3dGb2xkZXJJY29ucyxcbiAgICAgICAgYXV0b0FwcGx5VGFnczogb2xkRGF0YS5hdXRvQXBwbHlUYWdzIHx8IERFRkFVTFRfU0VUVElOR1MuYXV0b0FwcGx5VGFncyxcbiAgICAgICAgZGVidWdNb2RlOiBvbGREYXRhLmRlYnVnTW9kZSB8fCBERUZBVUxUX1NFVFRJTkdTLmRlYnVnTW9kZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxufVxuXG5jbGFzcyBGb2xkZXJUYWdNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgZm9sZGVyOiBURm9sZGVyO1xuICBwbHVnaW46IFRhZ0l0UGx1Z2luO1xuICBmb2xkZXJOYW1lSW5wdXQ6IFRleHRDb21wb25lbnQ7XG4gIHRhZ3NJbnB1dDogVGV4dENvbXBvbmVudDtcbiAgdGFnczogc3RyaW5nID0gXCJcIjtcbiAgaXNOZXdGb2xkZXI6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgZm9sZGVyOiBURm9sZGVyLFxuICAgIHBsdWdpbjogVGFnSXRQbHVnaW4sXG4gICAgaXNOZXdGb2xkZXI6IGJvb2xlYW4gPSBmYWxzZVxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuZm9sZGVyID0gZm9sZGVyO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuaXNOZXdGb2xkZXIgPSBpc05ld0ZvbGRlcjtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJBZGQvRWRpdCBGb2xkZXIgVGFnc1wiIH0pO1xuXG4gICAgLy8gRm9sZGVyIG5hbWUgZmllbGRcbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpLnNldE5hbWUoXCJGb2xkZXIgTmFtZVwiKS5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICB0aGlzLmZvbGRlck5hbWVJbnB1dCA9IHRleHQ7XG4gICAgICB0ZXh0LnNldFZhbHVlKHRoaXMuZm9sZGVyLm5hbWUpO1xuICAgICAgdGV4dC5pbnB1dEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIHRoaXMuaGFuZGxlRW50ZXIuYmluZCh0aGlzKSk7XG4gICAgICByZXR1cm4gdGV4dDtcbiAgICB9KTtcblxuICAgIC8vIFRhZ3MgZmllbGRcbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpLnNldE5hbWUoXCJUYWdzXCIpLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgIHRoaXMudGFnc0lucHV0ID0gdGV4dDtcbiAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMucGx1Z2luLmdldEZvbGRlclRhZ3ModGhpcy5mb2xkZXIucGF0aCk7XG4gICAgICB0aGlzLnRhZ3MgPSBleGlzdGluZ1RhZ3Muam9pbihcIiwgXCIpO1xuICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLnRhZ3MpO1xuICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIkVudGVyIHRhZ3MsIGNvbW1hLXNlcGFyYXRlZFwiKS5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgdGhpcy50YWdzID0gdmFsdWU7XG4gICAgICB9KTtcbiAgICAgIHRleHQuaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCB0aGlzLmhhbmRsZUVudGVyLmJpbmQodGhpcykpO1xuICAgICAgcmV0dXJuIHRleHQ7XG4gICAgfSk7XG5cbiAgICAvLyBDYW5jZWwgYW5kIFNhdmUgYnV0dG9ucyAob3JkZXIgc3dhcHBlZClcbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJTYXZlXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zYXZlRm9sZGVyVGFncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgaGFuZGxlRW50ZXIoZXZlbnQ6IEtleWJvYXJkRXZlbnQpIHtcbiAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KSB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgdGhpcy5zYXZlRm9sZGVyVGFncygpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNhdmVGb2xkZXJUYWdzKCkge1xuICAgIGNvbnN0IG5ld0ZvbGRlck5hbWUgPSB0aGlzLmZvbGRlck5hbWVJbnB1dC5nZXRWYWx1ZSgpO1xuICAgIGxldCBmb2xkZXJQYXRoID0gdGhpcy5mb2xkZXIucGF0aDtcblxuICAgIGlmIChuZXdGb2xkZXJOYW1lICE9PSB0aGlzLmZvbGRlci5uYW1lKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBuZXdQYXRoID0gdGhpcy5mb2xkZXIucGFyZW50XG4gICAgICAgICAgPyBgJHt0aGlzLmZvbGRlci5wYXJlbnQucGF0aH0vJHtuZXdGb2xkZXJOYW1lfWBcbiAgICAgICAgICA6IG5ld0ZvbGRlck5hbWU7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZUZpbGUodGhpcy5mb2xkZXIsIG5ld1BhdGgpO1xuICAgICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgICBgUmVuYW1lZCBmb2xkZXIgZnJvbSAke3RoaXMuZm9sZGVyLm5hbWV9IHRvICR7bmV3Rm9sZGVyTmFtZX1gXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gV2FpdCBmb3IgYSBzaG9ydCB0aW1lIHRvIGFsbG93IHRoZSBmaWxlIHN5c3RlbSB0byB1cGRhdGVcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7XG5cbiAgICAgICAgLy8gVXBkYXRlIGZvbGRlciByZWZlcmVuY2UgYW5kIHBhdGhcbiAgICAgICAgY29uc3QgbmV3Rm9sZGVyID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG5ld1BhdGgpO1xuICAgICAgICBpZiAobmV3Rm9sZGVyIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgICAgIHRoaXMuZm9sZGVyID0gbmV3Rm9sZGVyO1xuICAgICAgICAgIGZvbGRlclBhdGggPSBuZXdQYXRoO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgIGBDb3VsZCBub3QgZ2V0IG5ldyBmb2xkZXIgb2JqZWN0LCB1c2luZyBuZXcgcGF0aDogJHtuZXdQYXRofWBcbiAgICAgICAgICApO1xuICAgICAgICAgIGZvbGRlclBhdGggPSBuZXdQYXRoO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gcmVuYW1lIGZvbGRlcjogJHtlcnJvcn1gKTtcbiAgICAgICAgbmV3IE5vdGljZShgRmFpbGVkIHRvIHJlbmFtZSBmb2xkZXI6ICR7ZXJyb3J9YCk7XG4gICAgICAgIC8vIENvbnRpbnVlIHdpdGggdGhlIG9yaWdpbmFsIGZvbGRlciBuYW1lIGFuZCBwYXRoXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRW5zdXJlIGZvbGRlclBhdGggZG9lc24ndCBzdGFydCB3aXRoICcvLydcbiAgICBmb2xkZXJQYXRoID0gZm9sZGVyUGF0aC5yZXBsYWNlKC9eXFwvKy8sIFwiXCIpO1xuXG4gICAgY29uc3QgdGFnQXJyYXkgPSB0aGlzLnRhZ3NcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5tYXAoKHRhZykgPT4gdGFnLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKHRhZykgPT4gdGFnICE9PSBcIlwiKTtcblxuICAgIC8vIENoZWNrIGZvciBudW1iZXItb25seSB0YWdzXG4gICAgY29uc3QgbnVtYmVyT25seVRhZ3MgPSB0YWdBcnJheS5maWx0ZXIoKHRhZykgPT4gL15cXGQrJC8udGVzdCh0YWcpKTtcbiAgICBpZiAobnVtYmVyT25seVRhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYEVycm9yOiBOdW1iZXItb25seSB0YWdzIGFyZSBub3QgYWxsb3dlZC4gUGxlYXNlIHJlbW92ZTogJHtudW1iZXJPbmx5VGFncy5qb2luKFxuICAgICAgICAgIFwiLCBcIlxuICAgICAgICApfWBcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5wbHVnaW4uc2V0Rm9sZGVyVGFncyhmb2xkZXJQYXRoLCB0YWdBcnJheSk7XG4gICAgY29uc29sZS5sb2coYFNhdmVkIHRhZ3MgZm9yIGZvbGRlciAke2ZvbGRlclBhdGh9OiAke3RhZ0FycmF5LmpvaW4oXCIsIFwiKX1gKTtcbiAgICBuZXcgTm90aWNlKGBUYWdzIHNhdmVkIGZvciBmb2xkZXI6ICR7Zm9sZGVyUGF0aH1gKTtcblxuICAgIGlmICh0aGlzLmlzTmV3Rm9sZGVyKSB7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseUZvbGRlclRhZ3NUb0NvbnRlbnRzKHRoaXMuZm9sZGVyKTtcbiAgICAgIGNvbnNvbGUubG9nKGBBcHBsaWVkIHRhZ3MgdG8gY29udGVudHMgb2YgbmV3IGZvbGRlcjogJHtmb2xkZXJQYXRofWApO1xuICAgIH1cblxuICAgIHRoaXMuY2xvc2UoKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuY2xhc3MgVGFnSXRTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogVGFnSXRQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVGFnSXRQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIC8vIEFkZCBsb2dvIGNvbnRhaW5lciB3aXRoIHNwZWNpZmljIHN0eWxpbmdcbiAgICBjb25zdCBsb2dvQ29udGFpbmVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KFwidGFnaXQtbG9nby1jb250YWluZXJcIik7XG4gICAgbG9nb0NvbnRhaW5lci5pbm5lckhUTUwgPSBgXG4gICAgICA8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjogY2VudGVyOyBtYXJnaW4tYm90dG9tOiAyZW07XCI+XG4gICAgICAgIDxzdmcgd2lkdGg9XCI1MlwiIGhlaWdodD1cIjIxXCIgdmlld0JveD1cIjAgMCA1MiAyMVwiIGZpbGw9XCJub25lXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiPiBcbiAgICAgICAgICA8cGF0aCBmaWxsLXJ1bGU9XCJldmVub2RkXCIgY2xpcC1ydWxlPVwiZXZlbm9kZFwiIGQ9XCJNMS4wNDc2MyA0LjE1MDhDMC4zODI2ODggNC43MjA3NSAwIDUuNTUyOCAwIDYuNDI4NTdWMTcuMDQ4OEMwIDE4LjcwNTYgMS4zNDMxNSAyMC4wNDg4IDMgMjAuMDQ4OEgxMUMxMi42NTY5IDIwLjA0ODggMTQgMTguNzA1NiAxNCAxNy4wNDg4VjYuNDI4NTdDMTQgNS41NTI4IDEzLjYxNzMgNC43MjA3NSAxMi45NTI0IDQuMTUwOEw4Ljk1MjM3IDAuNzIyMjNDNy44Mjg5MSAtMC4yNDA3NDMgNi4xNzExIC0wLjI0MDc0NCA1LjA0NzYzIDAuNzIyMjNMMS4wNDc2MyA0LjE1MDhaTTcuMTAzMTggMTMuNjA5Mkw2LjY3NTY4IDE2LjA0ODhIOC42NDcwNkw5LjA3ODAxIDEzLjYwOTJIMTAuNTU0OFYxMS45NjU5SDkuMzY4MjlMOS41NDkxNSAxMC45NDJIMTFWOS4zMTE0MUg5LjgzNzJMMTAuMjM2OSA3LjA0ODc3SDguMjUyNzhMNy44NTYyOSA5LjMxMTQxSDYuODQyTDcuMjM1MjkgNy4wNDg3N0g1LjI3NjYzTDQuODc2OTQgOS4zMTE0MUgzLjQ1Nzg3VjEwLjk0Mkg0LjU4ODlMNC40MDgwMyAxMS45NjU5SDNWMTMuNjA5Mkg0LjExNzc1TDMuNjg2OCAxNi4wNDg4SDUuNjcwOTFMNi4wOTQ5NiAxMy42MDkySDcuMTAzMThaTTcuMzkxMTMgMTEuOTY1OUw3LjU3MDU1IDEwLjk0Mkg2LjU1ODU2TDYuMzgwNTkgMTEuOTY1OUg3LjM5MTEzWlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk0zNS42OTgzIDE1LjQ0MjRDMzUuMTE0MyAxNS40NDI0IDM0LjU5NDMgMTUuMzM0NCAzNC4xMzgzIDE1LjExODRDMzMuNjkwMyAxNC45MDI0IDMzLjMzMDMgMTQuNTk4NCAzMy4wNTgzIDE0LjIwNjRMMzMuNzU0MyAxMy40OTg0QzMzLjk4NjMgMTMuNzk0NCAzNC4yNjIzIDE0LjAxODQgMzQuNTgyMyAxNC4xNzA0QzM0LjkwMjMgMTQuMzMwNCAzNS4yODIzIDE0LjQxMDQgMzUuNzIyMyAxNC40MTA0QzM2LjMwNjMgMTQuNDEwNCAzNi43NjYzIDE0LjI1NDQgMzcuMTAyMyAxMy45NDI0QzM3LjQ0NjMgMTMuNjM4NCAzNy42MTgzIDEzLjIyNjQgMzcuNjE4MyAxMi43MDY0VjExLjI5MDRMMzcuODEwMyAxMC4wMDY0TDM3LjYxODMgOC43MzQzOFY3LjIzNDM4SDM4LjY5ODNWMTIuNzA2NEMzOC42OTgzIDEzLjI1MDQgMzguNTcwMyAxMy43MjY0IDM4LjMxNDMgMTQuMTM0NEMzOC4wNjYzIDE0LjU0MjQgMzcuNzE0MyAxNC44NjI0IDM3LjI1ODMgMTUuMDk0NEMzNi44MTAzIDE1LjMyNjQgMzYuMjkwMyAxNS40NDI0IDM1LjY5ODMgMTUuNDQyNFpNMzUuNjk4MyAxMi44Mzg0QzM1LjE3ODMgMTIuODM4NCAzNC43MTAzIDEyLjcxNDQgMzQuMjk0MyAxMi40NjY0QzMzLjg4NjMgMTIuMjE4NCAzMy41NjIzIDExLjg3ODQgMzMuMzIyMyAxMS40NDY0QzMzLjA4MjMgMTEuMDA2NCAzMi45NjIzIDEwLjUxNDQgMzIuOTYyMyA5Ljk3MDM4QzMyLjk2MjMgOS40MjYzOCAzMy4wODIzIDguOTQyMzggMzMuMzIyMyA4LjUxODM4QzMzLjU2MjMgOC4wODYzOCAzMy44ODYzIDcuNzQ2MzggMzQuMjk0MyA3LjQ5ODM4QzM0LjcxMDMgNy4yNDIzOCAzNS4xNzgzIDcuMTE0MzggMzUuNjk4MyA3LjExNDM4QzM2LjE0NjMgNy4xMTQzOCAzNi41NDIzIDcuMjAyMzggMzYuODg2MyA3LjM3ODM4QzM3LjIzMDMgNy41NTQzOCAzNy41MDIzIDcuODAyMzggMzcuNzAyMyA4LjEyMjM4QzM3LjkxMDMgOC40MzQzOCAzOC4wMjIzIDguODAyMzggMzguMDM4MyA5LjIyNjM4VjEwLjczODRDMzguMDE0MyAxMS4xNTQ0IDM3Ljg5ODMgMTEuNTIyNCAzNy42OTAzIDExLjg0MjRDMzcuNDkwMyAxMi4xNTQ0IDM3LjIxODMgMTIuMzk4NCAzNi44NzQzIDEyLjU3NDRDMzYuNTMwMyAxMi43NTA0IDM2LjEzODMgMTIuODM4NCAzNS42OTgzIDEyLjgzODRaTTM1LjkxNDMgMTEuODE4NEMzNi4yNjYzIDExLjgxODQgMzYuNTc0MyAxMS43NDI0IDM2LjgzODMgMTEuNTkwNEMzNy4xMTAzIDExLjQzODQgMzcuMzE4MyAxMS4yMjY0IDM3LjQ2MjMgMTAuOTU0NEMzNy42MDYzIDEwLjY3NDQgMzcuNjc4MyAxMC4zNTA0IDM3LjY3ODMgOS45ODIzOEMzNy42NzgzIDkuNjE0MzggMzcuNjAyMyA5LjI5NDM4IDM3LjQ1MDMgOS4wMjIzOEMzNy4zMDYzIDguNzQyMzggMzcuMTAyMyA4LjUyNjM4IDM2LjgzODMgOC4zNzQzOEMzNi41NzQzIDguMjE0MzggMzYuMjYyMyA4LjEzNDM4IDM1LjkwMjMgOC4xMzQzOEMzNS41NDIzIDguMTM0MzggMzUuMjI2MyA4LjIxNDM4IDM0Ljk1NDMgOC4zNzQzOEMzNC42ODIzIDguNTI2MzggMzQuNDY2MyA4Ljc0MjM4IDM0LjMwNjMgOS4wMjIzOEMzNC4xNTQzIDkuMjk0MzggMzQuMDc4MyA5LjYxMDM4IDM0LjA3ODMgOS45NzAzOEMzNC4wNzgzIDEwLjMzMDQgMzQuMTU0MyAxMC42NTA0IDM0LjMwNjMgMTAuOTMwNEMzNC40NjYzIDExLjIxMDQgMzQuNjgyMyAxMS40MzA0IDM0Ljk1NDMgMTEuNTkwNEMzNS4yMzQzIDExLjc0MjQgMzUuNTU0MyAxMS44MTg0IDM1LjkxNDMgMTEuODE4NFpcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMjguNzc0IDEzLjA1NDRDMjguMjU0IDEzLjA1NDQgMjcuNzgyIDEyLjkyNjQgMjcuMzU4IDEyLjY3MDRDMjYuOTM0IDEyLjQwNjQgMjYuNTk4IDEyLjA1MDQgMjYuMzUgMTEuNjAyNEMyNi4xMSAxMS4xNTQ0IDI1Ljk5IDEwLjY1MDQgMjUuOTkgMTAuMDkwNEMyNS45OSA5LjUzMDM4IDI2LjExIDkuMDI2MzggMjYuMzUgOC41NzgzOEMyNi41OTggOC4xMzAzOCAyNi45MyA3Ljc3NDM4IDI3LjM0NiA3LjUxMDM4QzI3Ljc3IDcuMjQ2MzggMjguMjQ2IDcuMTE0MzggMjguNzc0IDcuMTE0MzhDMjkuMjA2IDcuMTE0MzggMjkuNTkgNy4yMDYzOCAyOS45MjYgNy4zOTAzOEMzMC4yNyA3LjU2NjM4IDMwLjU0NiA3LjgxNDM4IDMwLjc1NCA4LjEzNDM4QzMwLjk2MiA4LjQ0NjM4IDMxLjA3OCA4LjgxMDM4IDMxLjEwMiA5LjIyNjM4VjEwLjk0MjRDMzEuMDc4IDExLjM1MDQgMzAuOTYyIDExLjcxNDQgMzAuNzU0IDEyLjAzNDRDMzAuNTU0IDEyLjM1NDQgMzAuMjgyIDEyLjYwNjQgMjkuOTM4IDEyLjc5MDRDMjkuNjAyIDEyLjk2NjQgMjkuMjE0IDEzLjA1NDQgMjguNzc0IDEzLjA1NDRaTTI4Ljk1NCAxMi4wMzQ0QzI5LjQ5IDEyLjAzNDQgMjkuOTIyIDExLjg1NDQgMzAuMjUgMTEuNDk0NEMzMC41NzggMTEuMTI2NCAzMC43NDIgMTAuNjU4NCAzMC43NDIgMTAuMDkwNEMzMC43NDIgOS42OTgzOCAzMC42NjYgOS4zNTgzOCAzMC41MTQgOS4wNzAzOEMzMC4zNyA4Ljc3NDM4IDMwLjE2MiA4LjU0NjM4IDI5Ljg5IDguMzg2MzhDMjkuNjE4IDguMjE4MzggMjkuMzAyIDguMTM0MzggMjguOTQyIDguMTM0MzhDMjguNTgyIDguMTM0MzggMjguMjYyIDguMjE4MzggMjcuOTgyIDguMzg2MzhDMjcuNzEgOC41NTQzOCAyNy40OTQgOC43ODYzOCAyNy4zMzQgOS4wODIzOEMyNy4xODIgOS4zNzAzOCAyNy4xMDYgOS43MDIzOCAyNy4xMDYgMTAuMDc4NEMyNy4xMDYgMTAuNDYyNCAyNy4xODIgMTAuODAyNCAyNy4zMzQgMTEuMDk4NEMyNy40OTQgMTEuMzg2NCAyNy43MTQgMTEuNjE0NCAyNy45OTQgMTEuNzgyNEMyOC4yNzQgMTEuOTUwNCAyOC41OTQgMTIuMDM0NCAyOC45NTQgMTIuMDM0NFpNMzAuNjcgMTIuOTM0NFYxMS4zOTg0TDMwLjg3NCAxMC4wMDY0TDMwLjY3IDguNjI2MzhWNy4yMzQzOEgzMS43NjJWMTIuOTM0NEgzMC42N1pcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMjIuODMyIDEyLjkzNDRWNC44NDYzOEgyMy45NlYxMi45MzQ0SDIyLjgzMlpNMjAgNS42MzgzOFY0LjYwNjM4SDI2Ljc4VjUuNjM4MzhIMjBaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQwLjY5ODMgMTIuOTk2NFY0LjQ1MjM5SDQzLjA5ODNWMTIuOTk2NEg0MC42OTgzWlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk00Ni42NTQzIDEyLjk5NjRWNC40NTIzOUg0OS4wNTQzVjEyLjk5NjRINDYuNjU0M1pNNDQuMDk4MyA2LjQ5MjM5VjQuNDUyMzlINTEuNjIyM1Y2LjQ5MjM5SDQ0LjA5ODNaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICA8L2Rpdj5cbiAgICBgO1xuXG4gICAgLy8gUmVzdCBvZiB5b3VyIHNldHRpbmdzIGNvZGUuLi5cblxuICAgIC8vIFJlc3Qgb2YgeW91ciBzZXR0aW5ncy4uLlxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJUYWcgSW5oZXJpdGFuY2UgTW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgaG93IHRhZ3MgYXJlIGluaGVyaXRlZCBpbiBuZXN0ZWQgZm9sZGVyc1wiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5vIGluaGVyaXRhbmNlXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImltbWVkaWF0ZVwiLCBcIkluaGVyaXQgZnJvbSBpbW1lZGlhdGUgcGFyZW50XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImFsbFwiLCBcIkluaGVyaXQgZnJvbSBhbGwgcGFyZW50c1wiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmhlcml0YW5jZU1vZGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5oZXJpdGFuY2VNb2RlID0gdmFsdWUgYXNcbiAgICAgICAgICAgICAgfCBcIm5vbmVcIlxuICAgICAgICAgICAgICB8IFwiaW1tZWRpYXRlXCJcbiAgICAgICAgICAgICAgfCBcImFsbFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRXhjbHVkZWQgRm9sZGVyc1wiKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFwiRW50ZXIgZm9sZGVyIHBhdGhzIHRvIGV4Y2x1ZGUgZnJvbSB0YWcgaW5oZXJpdGFuY2UgKG9uZSBwZXIgbGluZSlcIlxuICAgICAgKVxuICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiZm9sZGVyMVxcbmZvbGRlcjIvc3ViZm9sZGVyXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmV4Y2x1ZGVkRm9sZGVycy5qb2luKFwiXFxuXCIpKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmV4Y2x1ZGVkRm9sZGVycyA9IHZhbHVlXG4gICAgICAgICAgICAgIC5zcGxpdChcIlxcblwiKVxuICAgICAgICAgICAgICAuZmlsdGVyKChmKSA9PiBmLnRyaW0oKSAhPT0gXCJcIik7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJTaG93IEZvbGRlciBJY29uc1wiKVxuICAgICAgLnNldERlc2MoXCJEaXNwbGF5IGljb25zIG5leHQgdG8gZm9sZGVycyB3aXRoIHRhZ3NcIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dGb2xkZXJJY29ucylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93Rm9sZGVySWNvbnMgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnVwZGF0ZUZvbGRlckljb25zKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZW1vdmVGb2xkZXJJY29ucygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkF1dG8tYXBwbHkgVGFnc1wiKVxuICAgICAgLnNldERlc2MoXCJBdXRvbWF0aWNhbGx5IGFwcGx5IGZvbGRlciB0YWdzIHRvIG5ldyBmaWxlc1wiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGVcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b0FwcGx5VGFncylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvQXBwbHlUYWdzID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJEZWJ1ZyBNb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkVuYWJsZSBkZXRhaWxlZCBsb2dnaW5nIGZvciB0cm91Ymxlc2hvb3RpbmdcIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlYnVnTW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWJ1Z01vZGUgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbmNsYXNzIENvbmZpcm1hdGlvbk1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBvbkNvbmZpcm06ICgpID0+IHZvaWQ7XG4gIG1lc3NhZ2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWVzc2FnZTogc3RyaW5nLCBvbkNvbmZpcm06ICgpID0+IHZvaWQpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IHRoaXMubWVzc2FnZSB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNvbmZpcm1cIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICB0aGlzLm9uQ29uZmlybSgpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBUYWdTZWxlY3Rpb25Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgdGFnczogc3RyaW5nW107XG4gIG9uQ29uZmlybTogKHNlbGVjdGVkVGFnczogc3RyaW5nW10pID0+IHZvaWQ7XG4gIG1lc3NhZ2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgdGFnczogc3RyaW5nW10sXG4gICAgb25Db25maXJtOiAoc2VsZWN0ZWRUYWdzOiBzdHJpbmdbXSkgPT4gdm9pZFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgdGhpcy50YWdzID0gdGFncztcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogdGhpcy5tZXNzYWdlIH0pO1xuXG4gICAgY29uc3QgdGFnQ29udGFpbmVyID0gY29udGVudEVsLmNyZWF0ZURpdihcInRhZy1jb250YWluZXJcIik7XG4gICAgdGhpcy50YWdzLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgY29uc3QgdGFnRWwgPSB0YWdDb250YWluZXIuY3JlYXRlRWwoXCJkaXZcIiwgeyBjbHM6IFwidGFnXCIgfSk7XG4gICAgICB0YWdFbC5jcmVhdGVTcGFuKHsgdGV4dDogdGFnIH0pO1xuICAgICAgY29uc3QgcmVtb3ZlQnV0dG9uID0gdGFnRWwuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlhcIiB9KTtcbiAgICAgIHJlbW92ZUJ1dHRvbi5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgICB0aGlzLnRhZ3MgPSB0aGlzLnRhZ3MuZmlsdGVyKCh0KSA9PiB0ICE9PSB0YWcpO1xuICAgICAgICB0YWdFbC5yZW1vdmUoKTtcbiAgICAgIH07XG4gICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDb25maXJtXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgICAgdGhpcy5vbkNvbmZpcm0odGhpcy50YWdzKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICB0aGlzLnRpdGxlRWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBGaWxlTW92ZWRNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgZmlsZTogVEZpbGU7XG4gIG9sZFRhZ3M6IHN0cmluZ1tdO1xuICBuZXdUYWdzOiBzdHJpbmdbXTtcbiAgcGx1Z2luOiBUYWdJdFBsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBmaWxlOiBURmlsZSxcbiAgICBvbGRUYWdzOiBzdHJpbmdbXSxcbiAgICBuZXdUYWdzOiBzdHJpbmdbXSxcbiAgICBwbHVnaW46IFRhZ0l0UGx1Z2luXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5maWxlID0gZmlsZTtcbiAgICB0aGlzLm9sZFRhZ3MgPSBvbGRUYWdzO1xuICAgIHRoaXMubmV3VGFncyA9IG5ld1RhZ3M7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRmlsZSBNb3ZlZFwiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogYEZpbGUgXCIke3RoaXMuZmlsZS5uYW1lfVwiIGhhcyBiZWVuIG1vdmVkLmAsXG4gICAgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiSG93IHdvdWxkIHlvdSBsaWtlIHRvIGhhbmRsZSB0aGUgdGFncz9cIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiUmVwbGFjZSBBbGxcIilcbiAgICAgIC5zZXREZXNjKFwiUmVwbGFjZSBhbGwgZXhpc3RpbmcgdGFncyB3aXRoIG5ldyBmb2xkZXIgdGFnc1wiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlcGxhY2UgQWxsXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVwbGFjZUFsbFRhZ3ModGhpcy5maWxlLCB0aGlzLm5ld1RhZ3MpO1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJNZXJnZVwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIGV4aXN0aW5nIHRhZ3MgYW5kIGFkZCBuZXcgZm9sZGVyIHRhZ3NcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJNZXJnZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLm1lcmdlVGFncyh0aGlzLmZpbGUsIHRoaXMub2xkVGFncywgdGhpcy5uZXdUYWdzKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiTm8gQWN0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcIktlZXAgdGFncyBhcyB0aGV5IGFyZVwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIk5vIEFjdGlvblwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBDb25mbGljdFJlc29sdXRpb25Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgZmlsZTogVEZpbGU7XG4gIGNvbmZsaWN0aW5nVGFnczogc3RyaW5nW107XG4gIHBsdWdpbjogVGFnSXRQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgZmlsZTogVEZpbGUsXG4gICAgY29uZmxpY3RpbmdUYWdzOiBzdHJpbmdbXSxcbiAgICBwbHVnaW46IFRhZ0l0UGx1Z2luXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5maWxlID0gZmlsZTtcbiAgICB0aGlzLmNvbmZsaWN0aW5nVGFncyA9IGNvbmZsaWN0aW5nVGFncztcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJUYWcgQ29uZmxpY3QgRGV0ZWN0ZWRcIiB9KTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IGBUaGUgZm9sbG93aW5nIHRhZ3MgYXJlIGFzc2lnbmVkIGJ5IG11bHRpcGxlIHBhcmVudCBmb2xkZXJzOmAsXG4gICAgfSk7XG5cbiAgICBjb25zdCB0YWdMaXN0ID0gY29udGVudEVsLmNyZWF0ZUVsKFwidWxcIik7XG4gICAgdGhpcy5jb25mbGljdGluZ1RhZ3MuZm9yRWFjaCgodGFnKSA9PiB7XG4gICAgICB0YWdMaXN0LmNyZWF0ZUVsKFwibGlcIiwgeyB0ZXh0OiB0YWcgfSk7XG4gICAgfSk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IFwiSG93IHdvdWxkIHlvdSBsaWtlIHRvIGhhbmRsZSB0aGVzZSBjb25mbGljdHM/XCIsXG4gICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgQWxsXCIpXG4gICAgICAuc2V0RGVzYyhcIktlZXAgYWxsIGluc3RhbmNlcyBvZiBjb25mbGljdGluZyB0YWdzXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiS2VlcCBBbGxcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVDb25mbGljdChcImtlZXBBbGxcIik7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgT25lXCIpXG4gICAgICAuc2V0RGVzYyhcIktlZXAgb25seSBvbmUgaW5zdGFuY2Ugb2YgZWFjaCBjb25mbGljdGluZyB0YWdcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJLZWVwIE9uZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZUNvbmZsaWN0KFwia2VlcE9uZVwiKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiUmVtb3ZlIEFsbFwiKVxuICAgICAgLnNldERlc2MoXCJSZW1vdmUgYWxsIGluc3RhbmNlcyBvZiBjb25mbGljdGluZyB0YWdzXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVtb3ZlIEFsbFwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZUNvbmZsaWN0KFwicmVtb3ZlQWxsXCIpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgYXN5bmMgcmVzb2x2ZUNvbmZsaWN0KHJlc29sdXRpb246IFwia2VlcEFsbFwiIHwgXCJrZWVwT25lXCIgfCBcInJlbW92ZUFsbFwiKSB7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMucGx1Z2luLmFwcC52YXVsdC5yZWFkKHRoaXMuZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5wbHVnaW4uZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcbiAgICBsZXQgdXBkYXRlZFRhZ3M6IHN0cmluZ1tdO1xuXG4gICAgc3dpdGNoIChyZXNvbHV0aW9uKSB7XG4gICAgICBjYXNlIFwia2VlcEFsbFwiOlxuICAgICAgICB1cGRhdGVkVGFncyA9IGV4aXN0aW5nVGFncztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwia2VlcE9uZVwiOlxuICAgICAgICB1cGRhdGVkVGFncyA9IFsuLi5uZXcgU2V0KGV4aXN0aW5nVGFncyldO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJyZW1vdmVBbGxcIjpcbiAgICAgICAgdXBkYXRlZFRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKFxuICAgICAgICAgICh0YWcpID0+ICF0aGlzLmNvbmZsaWN0aW5nVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgICAgICk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy5wbHVnaW4udXBkYXRlVGFnc0luQ29udGVudChcbiAgICAgIGNvbnRlbnQsXG4gICAgICB1cGRhdGVkVGFnc1xuICAgICk7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwLnZhdWx0Lm1vZGlmeSh0aGlzLmZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICB0aGlzLnBsdWdpbi51cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCk7XG4gICAgbmV3IE5vdGljZShgUmVzb2x2ZWQgdGFnIGNvbmZsaWN0cyBmb3IgZmlsZTogJHt0aGlzLmZpbGUubmFtZX1gKTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG4iXSwibmFtZXMiOlsiUGx1Z2luIiwiVEZvbGRlciIsIlRGaWxlIiwiTm90aWNlIiwiTW9kYWwiLCJTZXR0aW5nIiwiUGx1Z2luU2V0dGluZ1RhYiJdLCJtYXBwaW5ncyI6Ijs7OztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFvR0E7QUFDTyxTQUFTLFNBQVMsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUU7QUFDN0QsSUFBSSxTQUFTLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxPQUFPLEtBQUssWUFBWSxDQUFDLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxDQUFDLFVBQVUsT0FBTyxFQUFFLEVBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUs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
