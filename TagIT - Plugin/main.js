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
        this.urgencyLevels = [
            { emoji: "⚪️", label: "Default" },
            { emoji: "🟢", label: "Low" },
            { emoji: "🟡", label: "Moderate" },
            { emoji: "🟠", label: "Important" },
            { emoji: "🔴", label: "Critical" },
        ];
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
                            new BatchConversionInheritanceModal(this.app, file, this).open();
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
            // Add editor menu event handler
            this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
                const selection = editor.getSelection();
                if (this.containsChecklistItems(selection)) {
                    // Existing "Apply Tag" menu item
                    menu.addItem((item) => {
                        item
                            .setTitle("Apply Tag")
                            .setIcon("tag")
                            .onClick(() => {
                            new ChecklistTagModal(this.app, editor, selection, this.urgencyLevels, (tag, urgency) => __awaiter(this, void 0, void 0, function* () {
                                yield this.applyTagToChecklist(editor, selection, tag, urgency);
                            })).open();
                        });
                    });
                    // Updated "Change Urgency" menu item
                    menu.addItem((item) => {
                        item
                            .setTitle("Change Urgency")
                            .setIcon("alert-circle")
                            .onClick(() => {
                            new UrgencyModal(this.app, editor, selection, this.urgencyLevels, (urgency) => {
                                this.changeChecklistUrgency(editor, selection, urgency);
                            }).open();
                        });
                    });
                }
            }));
            // In the onload() method, add these commands after the existing commands
            this.addCommand({
                id: "apply-checklist-tag",
                name: "Apply tag to checklist items",
                editorCallback: (editor) => {
                    const selection = editor.getSelection();
                    if (this.containsChecklistItems(selection)) {
                        new ChecklistTagModal(this.app, editor, selection, this.urgencyLevels, (tag, urgency) => __awaiter(this, void 0, void 0, function* () {
                            yield this.applyTagToChecklist(editor, selection, tag, urgency);
                        })).open();
                    }
                    else {
                        new obsidian.Notice("Please select checklist items");
                    }
                },
            });
            this.addCommand({
                id: "change-checklist-urgency",
                name: "Change urgency of checklist items",
                editorCallback: (editor) => {
                    const selection = editor.getSelection();
                    if (this.containsChecklistItems(selection)) {
                        new UrgencyModal(this.app, editor, selection, this.urgencyLevels, (urgency) => {
                            this.changeChecklistUrgency(editor, selection, urgency);
                        }).open();
                    }
                    else {
                        new obsidian.Notice("Please select checklist items");
                    }
                },
            });
            // Add individual urgency commands
            this.urgencyLevels.forEach((level) => {
                this.addCommand({
                    id: `set-checklist-urgency-${level.label.toLowerCase()}`,
                    name: `Set checklist urgency to ${level.emoji} ${level.label}`,
                    editorCallback: (editor) => {
                        const selection = editor.getSelection();
                        if (this.containsChecklistItems(selection)) {
                            this.changeChecklistUrgency(editor, selection, level);
                        }
                        else {
                            new obsidian.Notice("Please select checklist items");
                        }
                    },
                });
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
        // Extract tags from YAML front matter
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            // Match both array-style and list-style YAML tags
            const yamlArrayMatch = frontmatter.match(/tags:\s*\[(.*?)\]/);
            const yamlListMatch = frontmatter.match(/tags:\s*\n((?:\s*-\s*.+\n?)*)/);
            if (yamlArrayMatch) {
                // Handle array-style tags [tag1, tag2]
                tags = yamlArrayMatch[1]
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);
            }
            else if (yamlListMatch) {
                // Handle list-style tags
                // - tag1
                // - tag2
                tags = yamlListMatch[1]
                    .split("\n")
                    .map((line) => line.replace(/^\s*-\s*/, "").trim())
                    .filter((tag) => tag.length > 0);
            }
        }
        // Extract inline tags from content
        const contentWithoutFrontmatter = frontmatterMatch
            ? content.slice(frontmatterMatch[0].length)
            : content;
        // More comprehensive regex for inline tags
        const inlineTagRegex = /#[a-zA-Z0-9_/\-]+(?=[^a-zA-Z0-9_/\-]|$)/g;
        const inlineTags = contentWithoutFrontmatter.match(inlineTagRegex);
        if (inlineTags) {
            tags = [...tags, ...inlineTags.map((tag) => tag.substring(1))];
        }
        // Remove duplicates and empty tags
        return [...new Set(tags)].filter((tag) => tag.length > 0);
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
    // Add this method to the TagItPlugin class
    batchConvertWithInheritance(folder, includeSubfolders) {
        return __awaiter(this, void 0, void 0, function* () {
            // Collect all markdown files based on the inheritance option
            const files = [];
            const collectFiles = (currentFolder) => {
                currentFolder.children.forEach((child) => {
                    if (child instanceof obsidian.TFile && child.extension.toLowerCase() === "md") {
                        files.push(child);
                    }
                    else if (child instanceof obsidian.TFolder && includeSubfolders) {
                        collectFiles(child);
                    }
                });
            };
            collectFiles(folder);
            // Use the existing batch conversion method
            yield this.batchConvertInlineTagsToYAML(files);
        });
    }
    containsChecklistItems(text) {
        // Check if the text contains at least one checklist item
        const checklistRegex = /^(\s*)?- \[(x| )\]/m;
        return checklistRegex.test(text);
    }
    applyTagToChecklist(editor, selection, tag, urgency) {
        return __awaiter(this, void 0, void 0, function* () {
            const lines = selection.split("\n");
            const checklistRegex = /^(\s*)?- \[(x| )\]/;
            const updatedLines = lines.map((line) => {
                if (checklistRegex.test(line)) {
                    // Remove any existing tags and urgency indicators
                    const cleanLine = line.replace(/#\w+\s*[🟢🟡🟠🔴⚪️]?\s*$/, "").trim();
                    // Add new tag and urgency (if not default)
                    const urgencyEmoji = urgency.emoji !== "⚪️" ? ` ${urgency.emoji}` : "";
                    return `${cleanLine} #${tag}${urgencyEmoji}`;
                }
                return line;
            });
            // Replace the selection with updated content
            editor.replaceSelection(updatedLines.join("\n"));
        });
    }
    // Add this new method to the TagItPlugin class
    changeChecklistUrgency(editor, selection, urgency) {
        return __awaiter(this, void 0, void 0, function* () {
            const lines = selection.split("\n");
            const checklistRegex = /^(\s*)?- \[(x| )\]/;
            const updatedLines = lines.map((line) => {
                if (checklistRegex.test(line)) {
                    // First remove any existing urgency indicators
                    let cleanLine = line;
                    // Remove any existing urgency emojis
                    this.urgencyLevels.forEach((level) => {
                        const emojiRegex = new RegExp(`\\s*${level.emoji}\\s*$`);
                        cleanLine = cleanLine.replace(emojiRegex, "");
                    });
                    // Trim any trailing spaces
                    cleanLine = cleanLine.replace(/\s+$/, "");
                    // Add new urgency (if not default)
                    if (urgency.emoji !== "⚪️") {
                        cleanLine = `${cleanLine} ${urgency.emoji}`;
                    }
                    return cleanLine;
                }
                return line;
            });
            // Replace the selection with updated content
            editor.replaceSelection(updatedLines.join("\n"));
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
            .setClass("tagit-button-container")
            .addButton((btn) => {
            btn.setButtonText("Cancel").onClick(() => {
                this.close();
            });
        })
            .addButton((btn) => {
            btn
                .setButtonText("Confirm")
                .setCta()
                .onClick(() => {
                this.close();
                this.onConfirm();
            });
        });
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
        // Standardize header style
        contentEl.createEl("h2", { text: "Select Tags" });
        // Add consistent spacing
        const modalContent = contentEl.createDiv({ cls: "tagit-modal-content" });
        modalContent.createEl("p", {
            text: this.message,
            cls: "tagit-description",
        });
        // Create tag container with consistent styling
        const tagContainer = modalContent.createDiv("tagit-tag-container");
        this.tags.forEach((tag) => {
            const tagEl = tagContainer.createEl("div", { cls: "tagit-tag" });
            tagEl.createSpan({ text: tag });
            const removeButton = tagEl.createEl("button", {
                text: "×",
                cls: "tagit-tag-remove",
            });
            removeButton.onclick = () => {
                this.tags = this.tags.filter((t) => t !== tag);
                tagEl.remove();
            };
        });
        // Standardize button container
        new obsidian.Setting(contentEl)
            .setClass("tagit-button-container")
            .addButton((btn) => {
            btn.setButtonText("Cancel").onClick(() => {
                this.close();
            });
        })
            .addButton((btn) => {
            btn
                .setButtonText("Confirm")
                .setCta()
                .onClick(() => {
                this.close();
                this.onConfirm(this.tags);
            });
        });
    }
    onClose() {
        this.contentEl.empty();
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
        // Standardize header style
        contentEl.createEl("h2", { text: "Batch Conversion Complete" });
        // Add consistent spacing
        const statsContainer = contentEl.createDiv({ cls: "tagit-modal-content" });
        // Standardize text styles
        statsContainer.createEl("p", {
            text: `Processed: ${this.processedCount} files`,
            cls: "tagit-stats",
        });
        statsContainer.createEl("p", {
            text: `Successfully converted: ${this.successCount} files`,
            cls: "tagit-stats",
        });
        if (this.errorCount > 0) {
            const errorSection = contentEl.createDiv({ cls: "tagit-error-section" });
            errorSection.createEl("p", {
                text: `Failed to process ${this.errorCount} files:`,
                cls: "tagit-error-header",
            });
            const errorList = errorSection.createEl("ul", {
                cls: "tagit-error-list",
            });
            this.errors.forEach((fileName) => {
                errorList.createEl("li", { text: fileName });
            });
        }
        // Standardize button container
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
        // Standardize header style
        contentEl.createEl("h2", { text: "Batch Convert Tags to YAML" });
        // Add consistent spacing
        const warningContent = contentEl.createDiv({ cls: "tagit-modal-content" });
        warningContent.createEl("p", {
            text: `This will convert inline tags to YAML front matter in ${this.files.length} file(s). This action cannot be automatically undone.`,
            cls: "tagit-warning",
        });
        // Standardize toggle style
        new obsidian.Setting(contentEl)
            .setClass("tagit-setting")
            .addToggle((toggle) => toggle
            .setValue(true)
            .setTooltip("Show this warning next time")
            .onChange((value) => {
            this.plugin.settings.showBatchConversionWarning = value;
            this.plugin.saveSettings();
        }))
            .setName("Show this warning next time");
        // Standardize button container
        new obsidian.Setting(contentEl)
            .setClass("tagit-button-container")
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
class BatchConversionInheritanceModal extends obsidian.Modal {
    constructor(app, folder, plugin) {
        super(app);
        this.folder = folder;
        this.plugin = plugin;
        this.fileCount = {
            all: 0,
            immediate: 0,
        };
    }
    onOpen() {
        return __awaiter(this, void 0, void 0, function* () {
            const { contentEl } = this;
            contentEl.empty();
            // Calculate file counts
            this.fileCount.all = this.countMarkdownFiles(this.folder, true);
            this.fileCount.immediate = this.countMarkdownFiles(this.folder, false);
            // Standardize header style
            contentEl.createEl("h2", { text: "Convert Tags to YAML" });
            // Add consistent spacing
            const modalContent = contentEl.createDiv({ cls: "tagit-modal-content" });
            modalContent.createEl("p", {
                text: "Choose how you would like to convert inline tags to YAML front matter:",
                cls: "tagit-description",
            });
            // Standardize option styles
            new obsidian.Setting(modalContent)
                .setClass("tagit-setting")
                .setName(`Convert All (${this.fileCount.all} files)`)
                .setDesc("Convert tags in this folder and all subfolders")
                .addButton((btn) => btn
                .setButtonText("Convert All")
                .setCta()
                .onClick(() => __awaiter(this, void 0, void 0, function* () {
                this.close();
                yield this.plugin.batchConvertWithInheritance(this.folder, true);
            })));
            new obsidian.Setting(modalContent)
                .setClass("tagit-setting")
                .setName(`Convert Folder Only (${this.fileCount.immediate} files)`)
                .setDesc("Convert tags only in this folder (excluding subfolders)")
                .addButton((btn) => btn
                .setButtonText("Convert Folder")
                .setCta()
                .onClick(() => __awaiter(this, void 0, void 0, function* () {
                this.close();
                yield this.plugin.batchConvertWithInheritance(this.folder, false);
            })));
            // Standardize button container
            new obsidian.Setting(contentEl).setClass("tagit-button-container").addButton((btn) => btn.setButtonText("Cancel").onClick(() => {
                this.close();
            }));
        });
    }
    countMarkdownFiles(folder, includeSubfolders) {
        let count = 0;
        // Count immediate markdown files
        folder.children.forEach((child) => {
            if (child instanceof obsidian.TFile && child.extension.toLowerCase() === "md") {
                count++;
            }
        });
        // If including subfolders, recursively count their files
        if (includeSubfolders) {
            folder.children.forEach((child) => {
                if (child instanceof obsidian.TFolder) {
                    count += this.countMarkdownFiles(child, true);
                }
            });
        }
        return count;
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
// Add the new ChecklistTagModal class
class ChecklistTagModal extends obsidian.Modal {
    constructor(app, editor, selection, urgencyLevels, onSubmit) {
        super(app);
        this.editor = editor;
        this.selection = selection;
        this.urgencyLevels = urgencyLevels;
        this.onSubmit = onSubmit;
        this.selectedUrgency = urgencyLevels[0];
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Apply Tag to Checklist" });
        const modalContent = contentEl.createDiv({ cls: "tagit-modal-content" });
        new obsidian.Setting(modalContent)
            .setName("Tag")
            .setDesc("Enter a tag (without #)")
            .addText((text) => {
            this.tagInput = text;
            text.onChange((value) => {
                text.setValue(value.replace(/[^a-zA-Z0-9_-]/g, ""));
            });
            text.inputEl.addEventListener("keydown", (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    this.handleSubmit();
                }
            });
        });
        new obsidian.Setting(modalContent)
            .setName("Urgency")
            .setDesc("Select urgency level")
            .addDropdown((dropdown) => {
            this.urgencyLevels.forEach((level) => {
                dropdown.addOption(level.emoji, `${level.emoji} ${level.label}`);
            });
            dropdown.setValue(this.selectedUrgency.emoji);
            dropdown.onChange((value) => {
                this.selectedUrgency =
                    this.urgencyLevels.find((level) => level.emoji === value) ||
                        this.urgencyLevels[0];
            });
        });
        new obsidian.Setting(contentEl)
            .setClass("tagit-button-container")
            .addButton((btn) => {
            btn.setButtonText("Cancel").onClick(() => {
                this.close();
            });
        })
            .addButton((btn) => {
            btn
                .setButtonText("Apply")
                .setCta()
                .onClick(() => {
                this.handleSubmit();
            });
        });
    }
    handleSubmit() {
        const tag = this.tagInput.getValue();
        if (tag) {
            this.onSubmit(tag, this.selectedUrgency);
            this.close();
        }
        else {
            new obsidian.Notice("Please enter a tag");
        }
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
// Add this new modal class
class UrgencyModal extends obsidian.Modal {
    constructor(app, editor, selection, urgencyLevels, onSubmit) {
        super(app);
        this.editor = editor;
        this.selection = selection;
        this.urgencyLevels = urgencyLevels;
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Change Urgency Level" });
        const modalContent = contentEl.createDiv({ cls: "tagit-modal-content" });
        // Create container for horizontal buttons
        const buttonsContainer = modalContent.createDiv({
            cls: "urgency-buttons-container",
        });
        // Create a button for each urgency level
        this.urgencyLevels.forEach((level) => {
            const buttonDiv = buttonsContainer.createDiv({
                cls: "urgency-button",
                attr: { "aria-label": level.label },
            });
            // Add emoji
            buttonDiv.createDiv({
                cls: "urgency-emoji",
                text: level.emoji,
            });
            // Add label
            buttonDiv.createDiv({
                cls: "urgency-label",
                text: level.label,
            });
            // Add click handler
            buttonDiv.addEventListener("click", () => {
                this.onSubmit(level);
                this.close();
            });
        });
        // Add cancel button at the bottom
        new obsidian.Setting(contentEl)
            .setClass("tagit-button-container")
            .addButton((btn) => {
            btn.setButtonText("Cancel").onClick(() => {
                this.close();
            });
        });
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

module.exports = TagItPlugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3RzbGliL3RzbGliLmVzNi5qcyIsIm1haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG5Db3B5cmlnaHQgKGMpIE1pY3Jvc29mdCBDb3Jwb3JhdGlvbi5cclxuXHJcblBlcm1pc3Npb24gdG8gdXNlLCBjb3B5LCBtb2RpZnksIGFuZC9vciBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUgZm9yIGFueVxyXG5wdXJwb3NlIHdpdGggb3Igd2l0aG91dCBmZWUgaXMgaGVyZWJ5IGdyYW50ZWQuXHJcblxyXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiIEFORCBUSEUgQVVUSE9SIERJU0NMQUlNUyBBTEwgV0FSUkFOVElFUyBXSVRIXHJcblJFR0FSRCBUTyBUSElTIFNPRlRXQVJFIElOQ0xVRElORyBBTEwgSU1QTElFRCBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWVxyXG5BTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsXHJcbklORElSRUNULCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgT1IgQU5ZIERBTUFHRVMgV0hBVFNPRVZFUiBSRVNVTFRJTkcgRlJPTVxyXG5MT1NTIE9GIFVTRSwgREFUQSBPUiBQUk9GSVRTLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgTkVHTElHRU5DRSBPUlxyXG5PVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SXHJcblBFUkZPUk1BTkNFIE9GIFRISVMgU09GVFdBUkUuXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqICovXHJcbi8qIGdsb2JhbCBSZWZsZWN0LCBQcm9taXNlLCBTdXBwcmVzc2VkRXJyb3IsIFN5bWJvbCwgSXRlcmF0b3IgKi9cclxuXHJcbnZhciBleHRlbmRTdGF0aWNzID0gZnVuY3Rpb24oZCwgYikge1xyXG4gICAgZXh0ZW5kU3RhdGljcyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fFxyXG4gICAgICAgICh7IF9fcHJvdG9fXzogW10gfSBpbnN0YW5jZW9mIEFycmF5ICYmIGZ1bmN0aW9uIChkLCBiKSB7IGQuX19wcm90b19fID0gYjsgfSkgfHxcclxuICAgICAgICBmdW5jdGlvbiAoZCwgYikgeyBmb3IgKHZhciBwIGluIGIpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYiwgcCkpIGRbcF0gPSBiW3BdOyB9O1xyXG4gICAgcmV0dXJuIGV4dGVuZFN0YXRpY3MoZCwgYik7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHRlbmRzKGQsIGIpIHtcclxuICAgIGlmICh0eXBlb2YgYiAhPT0gXCJmdW5jdGlvblwiICYmIGIgIT09IG51bGwpXHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNsYXNzIGV4dGVuZHMgdmFsdWUgXCIgKyBTdHJpbmcoYikgKyBcIiBpcyBub3QgYSBjb25zdHJ1Y3RvciBvciBudWxsXCIpO1xyXG4gICAgZXh0ZW5kU3RhdGljcyhkLCBiKTtcclxuICAgIGZ1bmN0aW9uIF9fKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gZDsgfVxyXG4gICAgZC5wcm90b3R5cGUgPSBiID09PSBudWxsID8gT2JqZWN0LmNyZWF0ZShiKSA6IChfXy5wcm90b3R5cGUgPSBiLnByb3RvdHlwZSwgbmV3IF9fKCkpO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fYXNzaWduID0gZnVuY3Rpb24oKSB7XHJcbiAgICBfX2Fzc2lnbiA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gX19hc3NpZ24odCkge1xyXG4gICAgICAgIGZvciAodmFyIHMsIGkgPSAxLCBuID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xyXG4gICAgICAgICAgICBzID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkpIHRbcF0gPSBzW3BdO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdDtcclxuICAgIH1cclxuICAgIHJldHVybiBfX2Fzc2lnbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZXN0KHMsIGUpIHtcclxuICAgIHZhciB0ID0ge307XHJcbiAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkgJiYgZS5pbmRleE9mKHApIDwgMClcclxuICAgICAgICB0W3BdID0gc1twXTtcclxuICAgIGlmIChzICE9IG51bGwgJiYgdHlwZW9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocyk7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmIChlLmluZGV4T2YocFtpXSkgPCAwICYmIE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChzLCBwW2ldKSlcclxuICAgICAgICAgICAgICAgIHRbcFtpXV0gPSBzW3BbaV1dO1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiB0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYykge1xyXG4gICAgdmFyIGMgPSBhcmd1bWVudHMubGVuZ3RoLCByID0gYyA8IDMgPyB0YXJnZXQgOiBkZXNjID09PSBudWxsID8gZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodGFyZ2V0LCBrZXkpIDogZGVzYywgZDtcclxuICAgIGlmICh0eXBlb2YgUmVmbGVjdCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgUmVmbGVjdC5kZWNvcmF0ZSA9PT0gXCJmdW5jdGlvblwiKSByID0gUmVmbGVjdC5kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYyk7XHJcbiAgICBlbHNlIGZvciAodmFyIGkgPSBkZWNvcmF0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoZCA9IGRlY29yYXRvcnNbaV0pIHIgPSAoYyA8IDMgPyBkKHIpIDogYyA+IDMgPyBkKHRhcmdldCwga2V5LCByKSA6IGQodGFyZ2V0LCBrZXkpKSB8fCByO1xyXG4gICAgcmV0dXJuIGMgPiAzICYmIHIgJiYgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCByKSwgcjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcGFyYW0ocGFyYW1JbmRleCwgZGVjb3JhdG9yKSB7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldCwga2V5KSB7IGRlY29yYXRvcih0YXJnZXQsIGtleSwgcGFyYW1JbmRleCk7IH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZXNEZWNvcmF0ZShjdG9yLCBkZXNjcmlwdG9ySW4sIGRlY29yYXRvcnMsIGNvbnRleHRJbiwgaW5pdGlhbGl6ZXJzLCBleHRyYUluaXRpYWxpemVycykge1xyXG4gICAgZnVuY3Rpb24gYWNjZXB0KGYpIHsgaWYgKGYgIT09IHZvaWQgMCAmJiB0eXBlb2YgZiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnVuY3Rpb24gZXhwZWN0ZWRcIik7IHJldHVybiBmOyB9XHJcbiAgICB2YXIga2luZCA9IGNvbnRleHRJbi5raW5kLCBrZXkgPSBraW5kID09PSBcImdldHRlclwiID8gXCJnZXRcIiA6IGtpbmQgPT09IFwic2V0dGVyXCIgPyBcInNldFwiIDogXCJ2YWx1ZVwiO1xyXG4gICAgdmFyIHRhcmdldCA9ICFkZXNjcmlwdG9ySW4gJiYgY3RvciA/IGNvbnRleHRJbltcInN0YXRpY1wiXSA/IGN0b3IgOiBjdG9yLnByb3RvdHlwZSA6IG51bGw7XHJcbiAgICB2YXIgZGVzY3JpcHRvciA9IGRlc2NyaXB0b3JJbiB8fCAodGFyZ2V0ID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih0YXJnZXQsIGNvbnRleHRJbi5uYW1lKSA6IHt9KTtcclxuICAgIHZhciBfLCBkb25lID0gZmFsc2U7XHJcbiAgICBmb3IgKHZhciBpID0gZGVjb3JhdG9ycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgIHZhciBjb250ZXh0ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4pIGNvbnRleHRbcF0gPSBwID09PSBcImFjY2Vzc1wiID8ge30gOiBjb250ZXh0SW5bcF07XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4uYWNjZXNzKSBjb250ZXh0LmFjY2Vzc1twXSA9IGNvbnRleHRJbi5hY2Nlc3NbcF07XHJcbiAgICAgICAgY29udGV4dC5hZGRJbml0aWFsaXplciA9IGZ1bmN0aW9uIChmKSB7IGlmIChkb25lKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IGFkZCBpbml0aWFsaXplcnMgYWZ0ZXIgZGVjb3JhdGlvbiBoYXMgY29tcGxldGVkXCIpOyBleHRyYUluaXRpYWxpemVycy5wdXNoKGFjY2VwdChmIHx8IG51bGwpKTsgfTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKDAsIGRlY29yYXRvcnNbaV0pKGtpbmQgPT09IFwiYWNjZXNzb3JcIiA/IHsgZ2V0OiBkZXNjcmlwdG9yLmdldCwgc2V0OiBkZXNjcmlwdG9yLnNldCB9IDogZGVzY3JpcHRvcltrZXldLCBjb250ZXh0KTtcclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJhY2Nlc3NvclwiKSB7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IHZvaWQgMCkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZFwiKTtcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmdldCkpIGRlc2NyaXB0b3IuZ2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LnNldCkpIGRlc2NyaXB0b3Iuc2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmluaXQpKSBpbml0aWFsaXplcnMudW5zaGlmdChfKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoXyA9IGFjY2VwdChyZXN1bHQpKSB7XHJcbiAgICAgICAgICAgIGlmIChraW5kID09PSBcImZpZWxkXCIpIGluaXRpYWxpemVycy51bnNoaWZ0KF8pO1xyXG4gICAgICAgICAgICBlbHNlIGRlc2NyaXB0b3Jba2V5XSA9IF87XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRhcmdldCkgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgY29udGV4dEluLm5hbWUsIGRlc2NyaXB0b3IpO1xyXG4gICAgZG9uZSA9IHRydWU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19ydW5Jbml0aWFsaXplcnModGhpc0FyZywgaW5pdGlhbGl6ZXJzLCB2YWx1ZSkge1xyXG4gICAgdmFyIHVzZVZhbHVlID0gYXJndW1lbnRzLmxlbmd0aCA+IDI7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGluaXRpYWxpemVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhbHVlID0gdXNlVmFsdWUgPyBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnLCB2YWx1ZSkgOiBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1c2VWYWx1ZSA/IHZhbHVlIDogdm9pZCAwO1xyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcHJvcEtleSh4KSB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHggPT09IFwic3ltYm9sXCIgPyB4IDogXCJcIi5jb25jYXQoeCk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zZXRGdW5jdGlvbk5hbWUoZiwgbmFtZSwgcHJlZml4KSB7XHJcbiAgICBpZiAodHlwZW9mIG5hbWUgPT09IFwic3ltYm9sXCIpIG5hbWUgPSBuYW1lLmRlc2NyaXB0aW9uID8gXCJbXCIuY29uY2F0KG5hbWUuZGVzY3JpcHRpb24sIFwiXVwiKSA6IFwiXCI7XHJcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGYsIFwibmFtZVwiLCB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IHByZWZpeCA/IFwiXCIuY29uY2F0KHByZWZpeCwgXCIgXCIsIG5hbWUpIDogbmFtZSB9KTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX21ldGFkYXRhKG1ldGFkYXRhS2V5LCBtZXRhZGF0YVZhbHVlKSB7XHJcbiAgICBpZiAodHlwZW9mIFJlZmxlY3QgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIFJlZmxlY3QubWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFJlZmxlY3QubWV0YWRhdGEobWV0YWRhdGFLZXksIG1ldGFkYXRhVmFsdWUpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikge1xyXG4gICAgZnVuY3Rpb24gYWRvcHQodmFsdWUpIHsgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgUCA/IHZhbHVlIDogbmV3IFAoZnVuY3Rpb24gKHJlc29sdmUpIHsgcmVzb2x2ZSh2YWx1ZSk7IH0pOyB9XHJcbiAgICByZXR1cm4gbmV3IChQIHx8IChQID0gUHJvbWlzZSkpKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gcmVqZWN0ZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3JbXCJ0aHJvd1wiXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gc3RlcChyZXN1bHQpIHsgcmVzdWx0LmRvbmUgPyByZXNvbHZlKHJlc3VsdC52YWx1ZSkgOiBhZG9wdChyZXN1bHQudmFsdWUpLnRoZW4oZnVsZmlsbGVkLCByZWplY3RlZCk7IH1cclxuICAgICAgICBzdGVwKChnZW5lcmF0b3IgPSBnZW5lcmF0b3IuYXBwbHkodGhpc0FyZywgX2FyZ3VtZW50cyB8fCBbXSkpLm5leHQoKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZ2VuZXJhdG9yKHRoaXNBcmcsIGJvZHkpIHtcclxuICAgIHZhciBfID0geyBsYWJlbDogMCwgc2VudDogZnVuY3Rpb24oKSB7IGlmICh0WzBdICYgMSkgdGhyb3cgdFsxXTsgcmV0dXJuIHRbMV07IH0sIHRyeXM6IFtdLCBvcHM6IFtdIH0sIGYsIHksIHQsIGcgPSBPYmplY3QuY3JlYXRlKCh0eXBlb2YgSXRlcmF0b3IgPT09IFwiZnVuY3Rpb25cIiA/IEl0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpO1xyXG4gICAgcmV0dXJuIGcubmV4dCA9IHZlcmIoMCksIGdbXCJ0aHJvd1wiXSA9IHZlcmIoMSksIGdbXCJyZXR1cm5cIl0gPSB2ZXJiKDIpLCB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgKGdbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSksIGc7XHJcbiAgICBmdW5jdGlvbiB2ZXJiKG4pIHsgcmV0dXJuIGZ1bmN0aW9uICh2KSB7IHJldHVybiBzdGVwKFtuLCB2XSk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHN0ZXAob3ApIHtcclxuICAgICAgICBpZiAoZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkdlbmVyYXRvciBpcyBhbHJlYWR5IGV4ZWN1dGluZy5cIik7XHJcbiAgICAgICAgd2hpbGUgKGcgJiYgKGcgPSAwLCBvcFswXSAmJiAoXyA9IDApKSwgXykgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKGYgPSAxLCB5ICYmICh0ID0gb3BbMF0gJiAyID8geVtcInJldHVyblwiXSA6IG9wWzBdID8geVtcInRocm93XCJdIHx8ICgodCA9IHlbXCJyZXR1cm5cIl0pICYmIHQuY2FsbCh5KSwgMCkgOiB5Lm5leHQpICYmICEodCA9IHQuY2FsbCh5LCBvcFsxXSkpLmRvbmUpIHJldHVybiB0O1xyXG4gICAgICAgICAgICBpZiAoeSA9IDAsIHQpIG9wID0gW29wWzBdICYgMiwgdC52YWx1ZV07XHJcbiAgICAgICAgICAgIHN3aXRjaCAob3BbMF0pIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgMDogY2FzZSAxOiB0ID0gb3A7IGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSA0OiBfLmxhYmVsKys7IHJldHVybiB7IHZhbHVlOiBvcFsxXSwgZG9uZTogZmFsc2UgfTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNTogXy5sYWJlbCsrOyB5ID0gb3BbMV07IG9wID0gWzBdOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNzogb3AgPSBfLm9wcy5wb3AoKTsgXy50cnlzLnBvcCgpOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEodCA9IF8udHJ5cywgdCA9IHQubGVuZ3RoID4gMCAmJiB0W3QubGVuZ3RoIC0gMV0pICYmIChvcFswXSA9PT0gNiB8fCBvcFswXSA9PT0gMikpIHsgXyA9IDA7IGNvbnRpbnVlOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wWzBdID09PSAzICYmICghdCB8fCAob3BbMV0gPiB0WzBdICYmIG9wWzFdIDwgdFszXSkpKSB7IF8ubGFiZWwgPSBvcFsxXTsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAob3BbMF0gPT09IDYgJiYgXy5sYWJlbCA8IHRbMV0pIHsgXy5sYWJlbCA9IHRbMV07IHQgPSBvcDsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiBfLmxhYmVsIDwgdFsyXSkgeyBfLmxhYmVsID0gdFsyXTsgXy5vcHMucHVzaChvcCk7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRbMl0pIF8ub3BzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIF8udHJ5cy5wb3AoKTsgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3AgPSBib2R5LmNhbGwodGhpc0FyZywgXyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkgeyBvcCA9IFs2LCBlXTsgeSA9IDA7IH0gZmluYWxseSB7IGYgPSB0ID0gMDsgfVxyXG4gICAgICAgIGlmIChvcFswXSAmIDUpIHRocm93IG9wWzFdOyByZXR1cm4geyB2YWx1ZTogb3BbMF0gPyBvcFsxXSA6IHZvaWQgMCwgZG9uZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fY3JlYXRlQmluZGluZyA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgbSwgaywgazIpIHtcclxuICAgIGlmIChrMiA9PT0gdW5kZWZpbmVkKSBrMiA9IGs7XHJcbiAgICB2YXIgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IobSwgayk7XHJcbiAgICBpZiAoIWRlc2MgfHwgKFwiZ2V0XCIgaW4gZGVzYyA/ICFtLl9fZXNNb2R1bGUgOiBkZXNjLndyaXRhYmxlIHx8IGRlc2MuY29uZmlndXJhYmxlKSkge1xyXG4gICAgICAgIGRlc2MgPSB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiBtW2tdOyB9IH07XHJcbiAgICB9XHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgazIsIGRlc2MpO1xyXG59KSA6IChmdW5jdGlvbihvLCBtLCBrLCBrMikge1xyXG4gICAgaWYgKGsyID09PSB1bmRlZmluZWQpIGsyID0gaztcclxuICAgIG9bazJdID0gbVtrXTtcclxufSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHBvcnRTdGFyKG0sIG8pIHtcclxuICAgIGZvciAodmFyIHAgaW4gbSkgaWYgKHAgIT09IFwiZGVmYXVsdFwiICYmICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgcCkpIF9fY3JlYXRlQmluZGluZyhvLCBtLCBwKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fdmFsdWVzKG8pIHtcclxuICAgIHZhciBzID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIFN5bWJvbC5pdGVyYXRvciwgbSA9IHMgJiYgb1tzXSwgaSA9IDA7XHJcbiAgICBpZiAobSkgcmV0dXJuIG0uY2FsbChvKTtcclxuICAgIGlmIChvICYmIHR5cGVvZiBvLmxlbmd0aCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHtcclxuICAgICAgICBuZXh0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChvICYmIGkgPj0gby5sZW5ndGgpIG8gPSB2b2lkIDA7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBvICYmIG9baSsrXSwgZG9uZTogIW8gfTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihzID8gXCJPYmplY3QgaXMgbm90IGl0ZXJhYmxlLlwiIDogXCJTeW1ib2wuaXRlcmF0b3IgaXMgbm90IGRlZmluZWQuXCIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZWFkKG8sIG4pIHtcclxuICAgIHZhciBtID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIG9bU3ltYm9sLml0ZXJhdG9yXTtcclxuICAgIGlmICghbSkgcmV0dXJuIG87XHJcbiAgICB2YXIgaSA9IG0uY2FsbChvKSwgciwgYXIgPSBbXSwgZTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgd2hpbGUgKChuID09PSB2b2lkIDAgfHwgbi0tID4gMCkgJiYgIShyID0gaS5uZXh0KCkpLmRvbmUpIGFyLnB1c2goci52YWx1ZSk7XHJcbiAgICB9XHJcbiAgICBjYXRjaCAoZXJyb3IpIHsgZSA9IHsgZXJyb3I6IGVycm9yIH07IH1cclxuICAgIGZpbmFsbHkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChyICYmICFyLmRvbmUgJiYgKG0gPSBpW1wicmV0dXJuXCJdKSkgbS5jYWxsKGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaW5hbGx5IHsgaWYgKGUpIHRocm93IGUuZXJyb3I7IH1cclxuICAgIH1cclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZCgpIHtcclxuICAgIGZvciAodmFyIGFyID0gW10sIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKVxyXG4gICAgICAgIGFyID0gYXIuY29uY2F0KF9fcmVhZChhcmd1bWVudHNbaV0pKTtcclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZEFycmF5cygpIHtcclxuICAgIGZvciAodmFyIHMgPSAwLCBpID0gMCwgaWwgPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgaWw7IGkrKykgcyArPSBhcmd1bWVudHNbaV0ubGVuZ3RoO1xyXG4gICAgZm9yICh2YXIgciA9IEFycmF5KHMpLCBrID0gMCwgaSA9IDA7IGkgPCBpbDsgaSsrKVxyXG4gICAgICAgIGZvciAodmFyIGEgPSBhcmd1bWVudHNbaV0sIGogPSAwLCBqbCA9IGEubGVuZ3RoOyBqIDwgamw7IGorKywgaysrKVxyXG4gICAgICAgICAgICByW2tdID0gYVtqXTtcclxuICAgIHJldHVybiByO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zcHJlYWRBcnJheSh0bywgZnJvbSwgcGFjaykge1xyXG4gICAgaWYgKHBhY2sgfHwgYXJndW1lbnRzLmxlbmd0aCA9PT0gMikgZm9yICh2YXIgaSA9IDAsIGwgPSBmcm9tLmxlbmd0aCwgYXI7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XHJcbiAgICAgICAgICAgIGlmICghYXIpIGFyID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSwgMCwgaSk7XHJcbiAgICAgICAgICAgIGFyW2ldID0gZnJvbVtpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdG8uY29uY2F0KGFyIHx8IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fYXdhaXQodikge1xyXG4gICAgcmV0dXJuIHRoaXMgaW5zdGFuY2VvZiBfX2F3YWl0ID8gKHRoaXMudiA9IHYsIHRoaXMpIDogbmV3IF9fYXdhaXQodik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jR2VuZXJhdG9yKHRoaXNBcmcsIF9hcmd1bWVudHMsIGdlbmVyYXRvcikge1xyXG4gICAgaWYgKCFTeW1ib2wuYXN5bmNJdGVyYXRvcikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0l0ZXJhdG9yIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgIHZhciBnID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pLCBpLCBxID0gW107XHJcbiAgICByZXR1cm4gaSA9IE9iamVjdC5jcmVhdGUoKHR5cGVvZiBBc3luY0l0ZXJhdG9yID09PSBcImZ1bmN0aW9uXCIgPyBBc3luY0l0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpLCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIsIGF3YWl0UmV0dXJuKSwgaVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0gPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzOyB9LCBpO1xyXG4gICAgZnVuY3Rpb24gYXdhaXRSZXR1cm4oZikgeyByZXR1cm4gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh2KS50aGVuKGYsIHJlamVjdCk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpZiAoZ1tuXSkgeyBpW25dID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChhLCBiKSB7IHEucHVzaChbbiwgdiwgYSwgYl0pID4gMSB8fCByZXN1bWUobiwgdik7IH0pOyB9OyBpZiAoZikgaVtuXSA9IGYoaVtuXSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gcmVzdW1lKG4sIHYpIHsgdHJ5IHsgc3RlcChnW25dKHYpKTsgfSBjYXRjaCAoZSkgeyBzZXR0bGUocVswXVszXSwgZSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gc3RlcChyKSB7IHIudmFsdWUgaW5zdGFuY2VvZiBfX2F3YWl0ID8gUHJvbWlzZS5yZXNvbHZlKHIudmFsdWUudikudGhlbihmdWxmaWxsLCByZWplY3QpIDogc2V0dGxlKHFbMF1bMl0sIHIpOyB9XHJcbiAgICBmdW5jdGlvbiBmdWxmaWxsKHZhbHVlKSB7IHJlc3VtZShcIm5leHRcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiByZWplY3QodmFsdWUpIHsgcmVzdW1lKFwidGhyb3dcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiBzZXR0bGUoZiwgdikgeyBpZiAoZih2KSwgcS5zaGlmdCgpLCBxLmxlbmd0aCkgcmVzdW1lKHFbMF1bMF0sIHFbMF1bMV0pOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jRGVsZWdhdG9yKG8pIHtcclxuICAgIHZhciBpLCBwO1xyXG4gICAgcmV0dXJuIGkgPSB7fSwgdmVyYihcIm5leHRcIiksIHZlcmIoXCJ0aHJvd1wiLCBmdW5jdGlvbiAoZSkgeyB0aHJvdyBlOyB9KSwgdmVyYihcInJldHVyblwiKSwgaVtTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfSwgaTtcclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpW25dID0gb1tuXSA/IGZ1bmN0aW9uICh2KSB7IHJldHVybiAocCA9ICFwKSA/IHsgdmFsdWU6IF9fYXdhaXQob1tuXSh2KSksIGRvbmU6IGZhbHNlIH0gOiBmID8gZih2KSA6IHY7IH0gOiBmOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jVmFsdWVzKG8pIHtcclxuICAgIGlmICghU3ltYm9sLmFzeW5jSXRlcmF0b3IpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNJdGVyYXRvciBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICB2YXIgbSA9IG9bU3ltYm9sLmFzeW5jSXRlcmF0b3JdLCBpO1xyXG4gICAgcmV0dXJuIG0gPyBtLmNhbGwobykgOiAobyA9IHR5cGVvZiBfX3ZhbHVlcyA9PT0gXCJmdW5jdGlvblwiID8gX192YWx1ZXMobykgOiBvW1N5bWJvbC5pdGVyYXRvcl0oKSwgaSA9IHt9LCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIpLCBpW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXM7IH0sIGkpO1xyXG4gICAgZnVuY3Rpb24gdmVyYihuKSB7IGlbbl0gPSBvW25dICYmIGZ1bmN0aW9uICh2KSB7IHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHYgPSBvW25dKHYpLCBzZXR0bGUocmVzb2x2ZSwgcmVqZWN0LCB2LmRvbmUsIHYudmFsdWUpOyB9KTsgfTsgfVxyXG4gICAgZnVuY3Rpb24gc2V0dGxlKHJlc29sdmUsIHJlamVjdCwgZCwgdikgeyBQcm9taXNlLnJlc29sdmUodikudGhlbihmdW5jdGlvbih2KSB7IHJlc29sdmUoeyB2YWx1ZTogdiwgZG9uZTogZCB9KTsgfSwgcmVqZWN0KTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19tYWtlVGVtcGxhdGVPYmplY3QoY29va2VkLCByYXcpIHtcclxuICAgIGlmIChPYmplY3QuZGVmaW5lUHJvcGVydHkpIHsgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvb2tlZCwgXCJyYXdcIiwgeyB2YWx1ZTogcmF3IH0pOyB9IGVsc2UgeyBjb29rZWQucmF3ID0gcmF3OyB9XHJcbiAgICByZXR1cm4gY29va2VkO1xyXG59O1xyXG5cclxudmFyIF9fc2V0TW9kdWxlRGVmYXVsdCA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgdikge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sIFwiZGVmYXVsdFwiLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2IH0pO1xyXG59KSA6IGZ1bmN0aW9uKG8sIHYpIHtcclxuICAgIG9bXCJkZWZhdWx0XCJdID0gdjtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydFN0YXIobW9kKSB7XHJcbiAgICBpZiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSByZXR1cm4gbW9kO1xyXG4gICAgdmFyIHJlc3VsdCA9IHt9O1xyXG4gICAgaWYgKG1vZCAhPSBudWxsKSBmb3IgKHZhciBrIGluIG1vZCkgaWYgKGsgIT09IFwiZGVmYXVsdFwiICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb2QsIGspKSBfX2NyZWF0ZUJpbmRpbmcocmVzdWx0LCBtb2QsIGspO1xyXG4gICAgX19zZXRNb2R1bGVEZWZhdWx0KHJlc3VsdCwgbW9kKTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2ltcG9ydERlZmF1bHQobW9kKSB7XHJcbiAgICByZXR1cm4gKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgPyBtb2QgOiB7IGRlZmF1bHQ6IG1vZCB9O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEdldChyZWNlaXZlciwgc3RhdGUsIGtpbmQsIGYpIHtcclxuICAgIGlmIChraW5kID09PSBcImFcIiAmJiAhZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlByaXZhdGUgYWNjZXNzb3Igd2FzIGRlZmluZWQgd2l0aG91dCBhIGdldHRlclwiKTtcclxuICAgIGlmICh0eXBlb2Ygc3RhdGUgPT09IFwiZnVuY3Rpb25cIiA/IHJlY2VpdmVyICE9PSBzdGF0ZSB8fCAhZiA6ICFzdGF0ZS5oYXMocmVjZWl2ZXIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHJlYWQgcHJpdmF0ZSBtZW1iZXIgZnJvbSBhbiBvYmplY3Qgd2hvc2UgY2xhc3MgZGlkIG5vdCBkZWNsYXJlIGl0XCIpO1xyXG4gICAgcmV0dXJuIGtpbmQgPT09IFwibVwiID8gZiA6IGtpbmQgPT09IFwiYVwiID8gZi5jYWxsKHJlY2VpdmVyKSA6IGYgPyBmLnZhbHVlIDogc3RhdGUuZ2V0KHJlY2VpdmVyKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fY2xhc3NQcml2YXRlRmllbGRTZXQocmVjZWl2ZXIsIHN0YXRlLCB2YWx1ZSwga2luZCwgZikge1xyXG4gICAgaWYgKGtpbmQgPT09IFwibVwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBtZXRob2QgaXMgbm90IHdyaXRhYmxlXCIpO1xyXG4gICAgaWYgKGtpbmQgPT09IFwiYVwiICYmICFmKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBhY2Nlc3NvciB3YXMgZGVmaW5lZCB3aXRob3V0IGEgc2V0dGVyXCIpO1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gXCJmdW5jdGlvblwiID8gcmVjZWl2ZXIgIT09IHN0YXRlIHx8ICFmIDogIXN0YXRlLmhhcyhyZWNlaXZlcikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3Qgd3JpdGUgcHJpdmF0ZSBtZW1iZXIgdG8gYW4gb2JqZWN0IHdob3NlIGNsYXNzIGRpZCBub3QgZGVjbGFyZSBpdFwiKTtcclxuICAgIHJldHVybiAoa2luZCA9PT0gXCJhXCIgPyBmLmNhbGwocmVjZWl2ZXIsIHZhbHVlKSA6IGYgPyBmLnZhbHVlID0gdmFsdWUgOiBzdGF0ZS5zZXQocmVjZWl2ZXIsIHZhbHVlKSksIHZhbHVlO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZEluKHN0YXRlLCByZWNlaXZlcikge1xyXG4gICAgaWYgKHJlY2VpdmVyID09PSBudWxsIHx8ICh0eXBlb2YgcmVjZWl2ZXIgIT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHJlY2VpdmVyICE9PSBcImZ1bmN0aW9uXCIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IHVzZSAnaW4nIG9wZXJhdG9yIG9uIG5vbi1vYmplY3RcIik7XHJcbiAgICByZXR1cm4gdHlwZW9mIHN0YXRlID09PSBcImZ1bmN0aW9uXCIgPyByZWNlaXZlciA9PT0gc3RhdGUgOiBzdGF0ZS5oYXMocmVjZWl2ZXIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hZGREaXNwb3NhYmxlUmVzb3VyY2UoZW52LCB2YWx1ZSwgYXN5bmMpIHtcclxuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdm9pZCAwKSB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZC5cIik7XHJcbiAgICAgICAgdmFyIGRpc3Bvc2UsIGlubmVyO1xyXG4gICAgICAgIGlmIChhc3luYykge1xyXG4gICAgICAgICAgICBpZiAoIVN5bWJvbC5hc3luY0Rpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNEaXNwb3NlIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgICAgICAgICAgZGlzcG9zZSA9IHZhbHVlW1N5bWJvbC5hc3luY0Rpc3Bvc2VdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZGlzcG9zZSA9PT0gdm9pZCAwKSB7XHJcbiAgICAgICAgICAgIGlmICghU3ltYm9sLmRpc3Bvc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuZGlzcG9zZSBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICAgICAgICAgIGRpc3Bvc2UgPSB2YWx1ZVtTeW1ib2wuZGlzcG9zZV07XHJcbiAgICAgICAgICAgIGlmIChhc3luYykgaW5uZXIgPSBkaXNwb3NlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAodHlwZW9mIGRpc3Bvc2UgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBub3QgZGlzcG9zYWJsZS5cIik7XHJcbiAgICAgICAgaWYgKGlubmVyKSBkaXNwb3NlID0gZnVuY3Rpb24oKSB7IHRyeSB7IGlubmVyLmNhbGwodGhpcyk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIFByb21pc2UucmVqZWN0KGUpOyB9IH07XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyB2YWx1ZTogdmFsdWUsIGRpc3Bvc2U6IGRpc3Bvc2UsIGFzeW5jOiBhc3luYyB9KTtcclxuICAgIH1cclxuICAgIGVsc2UgaWYgKGFzeW5jKSB7XHJcbiAgICAgICAgZW52LnN0YWNrLnB1c2goeyBhc3luYzogdHJ1ZSB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiB2YWx1ZTtcclxuXHJcbn1cclxuXHJcbnZhciBfU3VwcHJlc3NlZEVycm9yID0gdHlwZW9mIFN1cHByZXNzZWRFcnJvciA9PT0gXCJmdW5jdGlvblwiID8gU3VwcHJlc3NlZEVycm9yIDogZnVuY3Rpb24gKGVycm9yLCBzdXBwcmVzc2VkLCBtZXNzYWdlKSB7XHJcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuICAgIHJldHVybiBlLm5hbWUgPSBcIlN1cHByZXNzZWRFcnJvclwiLCBlLmVycm9yID0gZXJyb3IsIGUuc3VwcHJlc3NlZCA9IHN1cHByZXNzZWQsIGU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kaXNwb3NlUmVzb3VyY2VzKGVudikge1xyXG4gICAgZnVuY3Rpb24gZmFpbChlKSB7XHJcbiAgICAgICAgZW52LmVycm9yID0gZW52Lmhhc0Vycm9yID8gbmV3IF9TdXBwcmVzc2VkRXJyb3IoZSwgZW52LmVycm9yLCBcIkFuIGVycm9yIHdhcyBzdXBwcmVzc2VkIGR1cmluZyBkaXNwb3NhbC5cIikgOiBlO1xyXG4gICAgICAgIGVudi5oYXNFcnJvciA9IHRydWU7XHJcbiAgICB9XHJcbiAgICB2YXIgciwgcyA9IDA7XHJcbiAgICBmdW5jdGlvbiBuZXh0KCkge1xyXG4gICAgICAgIHdoaWxlIChyID0gZW52LnN0YWNrLnBvcCgpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXIuYXN5bmMgJiYgcyA9PT0gMSkgcmV0dXJuIHMgPSAwLCBlbnYuc3RhY2sucHVzaChyKSwgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihuZXh0KTtcclxuICAgICAgICAgICAgICAgIGlmIChyLmRpc3Bvc2UpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgcmVzdWx0ID0gci5kaXNwb3NlLmNhbGwoci52YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHIuYXN5bmMpIHJldHVybiBzIHw9IDIsIFByb21pc2UucmVzb2x2ZShyZXN1bHQpLnRoZW4obmV4dCwgZnVuY3Rpb24oZSkgeyBmYWlsKGUpOyByZXR1cm4gbmV4dCgpOyB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgcyB8PSAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICBmYWlsKGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChzID09PSAxKSByZXR1cm4gZW52Lmhhc0Vycm9yID8gUHJvbWlzZS5yZWplY3QoZW52LmVycm9yKSA6IFByb21pc2UucmVzb2x2ZSgpO1xyXG4gICAgICAgIGlmIChlbnYuaGFzRXJyb3IpIHRocm93IGVudi5lcnJvcjtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXh0KCk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbihwYXRoLCBwcmVzZXJ2ZUpzeCkge1xyXG4gICAgaWYgKHR5cGVvZiBwYXRoID09PSBcInN0cmluZ1wiICYmIC9eXFwuXFwuP1xcLy8udGVzdChwYXRoKSkge1xyXG4gICAgICAgIHJldHVybiBwYXRoLnJlcGxhY2UoL1xcLih0c3gpJHwoKD86XFwuZCk/KSgoPzpcXC5bXi4vXSs/KT8pXFwuKFtjbV0/KXRzJC9pLCBmdW5jdGlvbiAobSwgdHN4LCBkLCBleHQsIGNtKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0c3ggPyBwcmVzZXJ2ZUpzeCA/IFwiLmpzeFwiIDogXCIuanNcIiA6IGQgJiYgKCFleHQgfHwgIWNtKSA/IG0gOiAoZCArIGV4dCArIFwiLlwiICsgY20udG9Mb3dlckNhc2UoKSArIFwianNcIik7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGF0aDtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQge1xyXG4gICAgX19leHRlbmRzOiBfX2V4dGVuZHMsXHJcbiAgICBfX2Fzc2lnbjogX19hc3NpZ24sXHJcbiAgICBfX3Jlc3Q6IF9fcmVzdCxcclxuICAgIF9fZGVjb3JhdGU6IF9fZGVjb3JhdGUsXHJcbiAgICBfX3BhcmFtOiBfX3BhcmFtLFxyXG4gICAgX19lc0RlY29yYXRlOiBfX2VzRGVjb3JhdGUsXHJcbiAgICBfX3J1bkluaXRpYWxpemVyczogX19ydW5Jbml0aWFsaXplcnMsXHJcbiAgICBfX3Byb3BLZXk6IF9fcHJvcEtleSxcclxuICAgIF9fc2V0RnVuY3Rpb25OYW1lOiBfX3NldEZ1bmN0aW9uTmFtZSxcclxuICAgIF9fbWV0YWRhdGE6IF9fbWV0YWRhdGEsXHJcbiAgICBfX2F3YWl0ZXI6IF9fYXdhaXRlcixcclxuICAgIF9fZ2VuZXJhdG9yOiBfX2dlbmVyYXRvcixcclxuICAgIF9fY3JlYXRlQmluZGluZzogX19jcmVhdGVCaW5kaW5nLFxyXG4gICAgX19leHBvcnRTdGFyOiBfX2V4cG9ydFN0YXIsXHJcbiAgICBfX3ZhbHVlczogX192YWx1ZXMsXHJcbiAgICBfX3JlYWQ6IF9fcmVhZCxcclxuICAgIF9fc3ByZWFkOiBfX3NwcmVhZCxcclxuICAgIF9fc3ByZWFkQXJyYXlzOiBfX3NwcmVhZEFycmF5cyxcclxuICAgIF9fc3ByZWFkQXJyYXk6IF9fc3ByZWFkQXJyYXksXHJcbiAgICBfX2F3YWl0OiBfX2F3YWl0LFxyXG4gICAgX19hc3luY0dlbmVyYXRvcjogX19hc3luY0dlbmVyYXRvcixcclxuICAgIF9fYXN5bmNEZWxlZ2F0b3I6IF9fYXN5bmNEZWxlZ2F0b3IsXHJcbiAgICBfX2FzeW5jVmFsdWVzOiBfX2FzeW5jVmFsdWVzLFxyXG4gICAgX19tYWtlVGVtcGxhdGVPYmplY3Q6IF9fbWFrZVRlbXBsYXRlT2JqZWN0LFxyXG4gICAgX19pbXBvcnRTdGFyOiBfX2ltcG9ydFN0YXIsXHJcbiAgICBfX2ltcG9ydERlZmF1bHQ6IF9faW1wb3J0RGVmYXVsdCxcclxuICAgIF9fY2xhc3NQcml2YXRlRmllbGRHZXQ6IF9fY2xhc3NQcml2YXRlRmllbGRHZXQsXHJcbiAgICBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0OiBfX2NsYXNzUHJpdmF0ZUZpZWxkU2V0LFxyXG4gICAgX19jbGFzc1ByaXZhdGVGaWVsZEluOiBfX2NsYXNzUHJpdmF0ZUZpZWxkSW4sXHJcbiAgICBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZTogX19hZGREaXNwb3NhYmxlUmVzb3VyY2UsXHJcbiAgICBfX2Rpc3Bvc2VSZXNvdXJjZXM6IF9fZGlzcG9zZVJlc291cmNlcyxcclxuICAgIF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uOiBfX3Jld3JpdGVSZWxhdGl2ZUltcG9ydEV4dGVuc2lvbixcclxufTtcclxuIiwiaW1wb3J0IHtcbiAgQXBwLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIFRGb2xkZXIsXG4gIFRGaWxlLFxuICBNb2RhbCxcbiAgVGV4dENvbXBvbmVudCxcbiAgTm90aWNlLFxuICBUQWJzdHJhY3RGaWxlLFxuICBNZW51LFxuICBNZW51SXRlbSxcbiAgRWRpdG9yLFxuICBFZGl0b3JQb3NpdGlvbixcbiAgQnV0dG9uQ29tcG9uZW50LFxufSBmcm9tIFwib2JzaWRpYW5cIjtcblxuaW50ZXJmYWNlIFRhZ0l0U2V0dGluZ3Mge1xuICBpbmhlcml0YW5jZU1vZGU6IFwibm9uZVwiIHwgXCJpbW1lZGlhdGVcIiB8IFwiYWxsXCI7XG4gIGV4Y2x1ZGVkRm9sZGVyczogc3RyaW5nW107XG4gIHNob3dGb2xkZXJJY29uczogYm9vbGVhbjtcbiAgYXV0b0FwcGx5VGFnczogYm9vbGVhbjtcbiAgZGVidWdNb2RlOiBib29sZWFuO1xuICBzaG93QmF0Y2hDb252ZXJzaW9uV2FybmluZzogYm9vbGVhbjtcbiAgc2hvd05ld0ZvbGRlck1vZGFsOiBib29sZWFuO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBUYWdJdFNldHRpbmdzID0ge1xuICBpbmhlcml0YW5jZU1vZGU6IFwiaW1tZWRpYXRlXCIsXG4gIGV4Y2x1ZGVkRm9sZGVyczogW10sXG4gIHNob3dGb2xkZXJJY29uczogdHJ1ZSxcbiAgYXV0b0FwcGx5VGFnczogdHJ1ZSxcbiAgZGVidWdNb2RlOiBmYWxzZSxcbiAgc2hvd0JhdGNoQ29udmVyc2lvbldhcm5pbmc6IHRydWUsXG4gIHNob3dOZXdGb2xkZXJNb2RhbDogdHJ1ZSxcbn07XG5cbi8vIEFkZCB0aGlzIHR5cGUgZGVmaW5pdGlvblxudHlwZSBGb2xkZXJUYWdzID0geyBbZm9sZGVyUGF0aDogc3RyaW5nXTogc3RyaW5nW10gfTtcblxuaW50ZXJmYWNlIFBsdWdpbkRhdGEge1xuICBzZXR0aW5nczogVGFnSXRTZXR0aW5ncztcbiAgZm9sZGVyVGFnczogRm9sZGVyVGFncztcbiAgdmVyc2lvbjogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX0RBVEE6IFBsdWdpbkRhdGEgPSB7XG4gIHNldHRpbmdzOiBERUZBVUxUX1NFVFRJTkdTLFxuICBmb2xkZXJUYWdzOiB7fSxcbiAgdmVyc2lvbjogXCIxLjAuMFwiLFxufTtcblxuLy8gQWRkIHRoaXMgaW50ZXJmYWNlIHRvIGRlZmluZSB0aGUgdXJnZW5jeSBsZXZlbHNcbmludGVyZmFjZSBVcmdlbmN5TGV2ZWwge1xuICBlbW9qaTogc3RyaW5nO1xuICBsYWJlbDogc3RyaW5nO1xufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBUYWdJdFBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBUYWdJdFNldHRpbmdzO1xuICBmb2xkZXJUYWdzOiBGb2xkZXJUYWdzID0ge307XG4gIHByaXZhdGUgaXNJbml0aWFsTG9hZDogYm9vbGVhbiA9IHRydWU7XG4gIHByaXZhdGUgbmV3Rm9sZGVyUXVldWU6IFRGb2xkZXJbXSA9IFtdO1xuICBwcml2YXRlIG1vdmVUaW1lb3V0OiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgdXJnZW5jeUxldmVsczogVXJnZW5jeUxldmVsW10gPSBbXG4gICAgeyBlbW9qaTogXCLimqrvuI9cIiwgbGFiZWw6IFwiRGVmYXVsdFwiIH0sXG4gICAgeyBlbW9qaTogXCLwn5+iXCIsIGxhYmVsOiBcIkxvd1wiIH0sXG4gICAgeyBlbW9qaTogXCLwn5+hXCIsIGxhYmVsOiBcIk1vZGVyYXRlXCIgfSxcbiAgICB7IGVtb2ppOiBcIvCfn6BcIiwgbGFiZWw6IFwiSW1wb3J0YW50XCIgfSxcbiAgICB7IGVtb2ppOiBcIvCflLRcIiwgbGFiZWw6IFwiQ3JpdGljYWxcIiB9LFxuICBdO1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICAgIGF3YWl0IHRoaXMubG9hZEZvbGRlclRhZ3MoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgXCJFcnJvciBsb2FkaW5nIHBsdWdpbiBkYXRhLCBpbml0aWFsaXppbmcgd2l0aCBkZWZhdWx0czpcIixcbiAgICAgICAgZXJyb3JcbiAgICAgICk7XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemVEYXRhRmlsZSgpO1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKFwibG9hZGluZyBUYWdJdCBwbHVnaW5cIik7XG5cbiAgICAvLyBEZWxheWVkIGluaXRpYWxpemF0aW9uXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLmlzSW5pdGlhbExvYWQgPSBmYWxzZTtcbiAgICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKGZpbGUpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGb2xkZXIpIHtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlRm9sZGVyQ3JlYXRpb24oZmlsZSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlRmlsZUNyZWF0aW9uKGZpbGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICAgIC8vIFByb2Nlc3MgdGhlIHF1ZXVlIGV2ZXJ5IDIgc2Vjb25kc1xuICAgICAgdGhpcy5yZWdpc3RlckludGVydmFsKFxuICAgICAgICB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5wcm9jZXNzTmV3Rm9sZGVyUXVldWUoKSwgMjAwMClcbiAgICAgICk7XG5cbiAgICAgIC8vIEFkZCBldmVudCBsaXN0ZW5lciBmb3IgZmlsZSBtb3ZlbWVudFxuICAgICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgICB0aGlzLmFwcC52YXVsdC5vbihcInJlbmFtZVwiLCAoZmlsZSwgb2xkUGF0aCkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlRmlsZU1vdmUoZmlsZSwgb2xkUGF0aCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9LCAyMDAwKTsgLy8gMiBzZWNvbmQgZGVsYXlcblxuICAgIC8vIEFkZCBjb21tYW5kIHRvIG9wZW4gdGFnIG1vZGFsIGZvciBjdXJyZW50IGZvbGRlclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJvcGVuLWZvbGRlci10YWctbW9kYWxcIixcbiAgICAgIG5hbWU6IFwiQWRkL0VkaXQgdGFncyBmb3IgY3VycmVudCBmb2xkZXJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFjdGl2ZUZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBjb25zdCBmb2xkZXIgPSBhY3RpdmVGaWxlID8gYWN0aXZlRmlsZS5wYXJlbnQgOiBudWxsO1xuICAgICAgICB0aGlzLm9wZW5Gb2xkZXJUYWdNb2RhbChmb2xkZXIpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb21tYW5kIHRvIHJlbW92ZSBhbGwgdGFncyBmcm9tIGN1cnJlbnQgZm9sZGVyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInJlbW92ZS1mb2xkZXItdGFnc1wiLFxuICAgICAgbmFtZTogXCJSZW1vdmUgYWxsIHRhZ3MgZnJvbSBjdXJyZW50IGZvbGRlclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGNvbnN0IGZvbGRlciA9IGFjdGl2ZUZpbGUgPyBhY3RpdmVGaWxlLnBhcmVudCA6IG51bGw7XG4gICAgICAgIHRoaXMucmVtb3ZlRm9sZGVyVGFncyhmb2xkZXIpO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb21tYW5kIHRvIGFwcGx5IGZpbGUgdGFncyB0byBmb2xkZXJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwiYXBwbHktZmlsZS10YWdzLXRvLWZvbGRlclwiLFxuICAgICAgbmFtZTogXCJBcHBseSBmaWxlIHRhZ3MgdG8gZm9sZGVyXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKGFjdGl2ZUZpbGUpIHtcbiAgICAgICAgICB0aGlzLmFwcGx5RmlsZVRhZ3NUb0ZvbGRlcihhY3RpdmVGaWxlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiTm8gYWN0aXZlIGZpbGVcIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY29tbWFuZCB0byBjb252ZXJ0IGlubGluZSB0YWdzIHRvIFlBTUxcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwiY29udmVydC1pbmxpbmUtdGFncy10by15YW1sXCIsXG4gICAgICBuYW1lOiBcIkNvbnZlcnQgaW5saW5lIHRhZ3MgdG8gWUFNTFwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcbiAgICAgICAgY29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmIChhY3RpdmVGaWxlKSB7XG4gICAgICAgICAgdGhpcy5jb252ZXJ0SW5saW5lVGFnc1RvWUFNTChhY3RpdmVGaWxlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiTm8gYWN0aXZlIGZpbGVcIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBSZWdpc3RlciBjb250ZXh0IG1lbnUgZXZlbnRzXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFxuICAgICAgICBcImZpbGUtbWVudVwiLFxuICAgICAgICAobWVudTogTWVudSwgZmlsZTogVEFic3RyYWN0RmlsZSwgc291cmNlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGb2xkZXIpIHtcbiAgICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbTogTWVudUl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAgIC5zZXRUaXRsZShcIkFkZC9FZGl0IEZvbGRlciBUYWdzXCIpXG4gICAgICAgICAgICAgICAgLnNldEljb24oXCJ0YWdcIilcbiAgICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLm9wZW5Gb2xkZXJUYWdNb2RhbChmaWxlKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiUmVtb3ZlIEFsbCBGb2xkZXIgVGFnc1wiKVxuICAgICAgICAgICAgICAgIC5zZXRJY29uKFwidHJhc2hcIilcbiAgICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnJlbW92ZUZvbGRlclRhZ3MoZmlsZSkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbTogTWVudUl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAgIC5zZXRUaXRsZShcIkFwcGx5IEZvbGRlciBUYWdzIHRvIE5vdGVzXCIpXG4gICAgICAgICAgICAgICAgLnNldEljb24oXCJmaWxlLXBsdXNcIilcbiAgICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLmFwcGx5Rm9sZGVyVGFnc1RvTm90ZXMoZmlsZSkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbTogTWVudUl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAgIC5zZXRUaXRsZShcIkNvbnZlcnQgQWxsIE5vdGVzIHRvIFlBTUxcIilcbiAgICAgICAgICAgICAgICAuc2V0SWNvbihcInRhZ1wiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgIG5ldyBCYXRjaENvbnZlcnNpb25Jbmhlcml0YW5jZU1vZGFsKFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICAgICAgICAgICAgZmlsZSxcbiAgICAgICAgICAgICAgICAgICAgdGhpc1xuICAgICAgICAgICAgICAgICAgKS5vcGVuKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQ2hlY2sgZm9yIER1cGxpY2F0ZSBUYWdzXCIpXG4gICAgICAgICAgICAgICAgLnNldEljb24oXCJzZWFyY2hcIilcbiAgICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLmNoZWNrQW5kUmVtb3ZlRHVwbGljYXRlVGFncyhmaWxlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCkgPT09IFwibWRcIikge1xuICAgICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQXBwbHkgVGFncyB0byBGb2xkZXJcIilcbiAgICAgICAgICAgICAgICAuc2V0SWNvbihcInRhZ1wiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuYXBwbHlGaWxlVGFnc1RvRm9sZGVyKGZpbGUpKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW06IE1lbnVJdGVtKSA9PiB7XG4gICAgICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJDb252ZXJ0IHRvIFlBTUxcIilcbiAgICAgICAgICAgICAgICAuc2V0SWNvbihcInRhZ1wiKVxuICAgICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuYmF0Y2hDb252ZXJ0V2l0aENvbmZpcm1hdGlvbihbZmlsZV0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICApXG4gICAgKTtcblxuICAgIC8vIFRoaXMgYWRkcyBhIHNldHRpbmdzIHRhYiBzbyB0aGUgdXNlciBjYW4gY29uZmlndXJlIHZhcmlvdXMgYXNwZWN0cyBvZiB0aGUgcGx1Z2luXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUYWdJdFNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZvbGRlcikge1xuICAgICAgICAgIHRoaXMuaGFuZGxlRm9sZGVyRGVsZXRpb24oZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFVwZGF0ZSBmb2xkZXIgaWNvbnMgd2hlbiB0aGUgcGx1Z2luIGxvYWRzXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy51cGRhdGVGb2xkZXJJY29ucygpO1xuICAgIH0pO1xuXG4gICAgLy8gVXBkYXRlIGZvbGRlciBpY29ucyB3aGVuIGZpbGVzIGFyZSBjcmVhdGVkLCBkZWxldGVkLCBvciByZW5hbWVkXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJkZWxldGVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKCkgPT4gdGhpcy51cGRhdGVGb2xkZXJJY29ucygpKVxuICAgICk7XG5cbiAgICAvLyBBZGQgdGhpcyBsaW5lIHRvIHVwZGF0ZSB0YWdzIHdoZW4gdGhlIHBsdWdpbiBsb2Fkc1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpKTtcblxuICAgIC8vIFVwZGF0ZSBmb2xkZXIgaWNvbnMgYmFzZWQgb24gdGhlIHNob3dGb2xkZXJJY29ucyBzZXR0aW5nXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd0ZvbGRlckljb25zKSB7XG4gICAgICAgIHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEFkZCBlZGl0b3IgbWVudSBldmVudCBoYW5kbGVyXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLW1lbnVcIiwgKG1lbnU6IE1lbnUsIGVkaXRvcjogRWRpdG9yKSA9PiB7XG4gICAgICAgIGNvbnN0IHNlbGVjdGlvbiA9IGVkaXRvci5nZXRTZWxlY3Rpb24oKTtcblxuICAgICAgICBpZiAodGhpcy5jb250YWluc0NoZWNrbGlzdEl0ZW1zKHNlbGVjdGlvbikpIHtcbiAgICAgICAgICAvLyBFeGlzdGluZyBcIkFwcGx5IFRhZ1wiIG1lbnUgaXRlbVxuICAgICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbTogTWVudUl0ZW0pID0+IHtcbiAgICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgICAgLnNldFRpdGxlKFwiQXBwbHkgVGFnXCIpXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwidGFnXCIpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICBuZXcgQ2hlY2tsaXN0VGFnTW9kYWwoXG4gICAgICAgICAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICAgICAgICAgIGVkaXRvcixcbiAgICAgICAgICAgICAgICAgIHNlbGVjdGlvbixcbiAgICAgICAgICAgICAgICAgIHRoaXMudXJnZW5jeUxldmVscyxcbiAgICAgICAgICAgICAgICAgIGFzeW5jICh0YWc6IHN0cmluZywgdXJnZW5jeTogVXJnZW5jeUxldmVsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuYXBwbHlUYWdUb0NoZWNrbGlzdChcbiAgICAgICAgICAgICAgICAgICAgICBlZGl0b3IsXG4gICAgICAgICAgICAgICAgICAgICAgc2VsZWN0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgIHRhZyxcbiAgICAgICAgICAgICAgICAgICAgICB1cmdlbmN5XG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgKS5vcGVuKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gVXBkYXRlZCBcIkNoYW5nZSBVcmdlbmN5XCIgbWVudSBpdGVtXG4gICAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtOiBNZW51SXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbVxuICAgICAgICAgICAgICAuc2V0VGl0bGUoXCJDaGFuZ2UgVXJnZW5jeVwiKVxuICAgICAgICAgICAgICAuc2V0SWNvbihcImFsZXJ0LWNpcmNsZVwiKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgbmV3IFVyZ2VuY3lNb2RhbChcbiAgICAgICAgICAgICAgICAgIHRoaXMuYXBwLFxuICAgICAgICAgICAgICAgICAgZWRpdG9yLFxuICAgICAgICAgICAgICAgICAgc2VsZWN0aW9uLFxuICAgICAgICAgICAgICAgICAgdGhpcy51cmdlbmN5TGV2ZWxzLFxuICAgICAgICAgICAgICAgICAgKHVyZ2VuY3k6IFVyZ2VuY3lMZXZlbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNoYW5nZUNoZWNrbGlzdFVyZ2VuY3koZWRpdG9yLCBzZWxlY3Rpb24sIHVyZ2VuY3kpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICkub3BlbigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gSW4gdGhlIG9ubG9hZCgpIG1ldGhvZCwgYWRkIHRoZXNlIGNvbW1hbmRzIGFmdGVyIHRoZSBleGlzdGluZyBjb21tYW5kc1xuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJhcHBseS1jaGVja2xpc3QtdGFnXCIsXG4gICAgICBuYW1lOiBcIkFwcGx5IHRhZyB0byBjaGVja2xpc3QgaXRlbXNcIixcbiAgICAgIGVkaXRvckNhbGxiYWNrOiAoZWRpdG9yOiBFZGl0b3IpID0+IHtcbiAgICAgICAgY29uc3Qgc2VsZWN0aW9uID0gZWRpdG9yLmdldFNlbGVjdGlvbigpO1xuICAgICAgICBpZiAodGhpcy5jb250YWluc0NoZWNrbGlzdEl0ZW1zKHNlbGVjdGlvbikpIHtcbiAgICAgICAgICBuZXcgQ2hlY2tsaXN0VGFnTW9kYWwoXG4gICAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICAgIGVkaXRvcixcbiAgICAgICAgICAgIHNlbGVjdGlvbixcbiAgICAgICAgICAgIHRoaXMudXJnZW5jeUxldmVscyxcbiAgICAgICAgICAgIGFzeW5jICh0YWc6IHN0cmluZywgdXJnZW5jeTogVXJnZW5jeUxldmVsKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuYXBwbHlUYWdUb0NoZWNrbGlzdChlZGl0b3IsIHNlbGVjdGlvbiwgdGFnLCB1cmdlbmN5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApLm9wZW4oKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiUGxlYXNlIHNlbGVjdCBjaGVja2xpc3QgaXRlbXNcIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwiY2hhbmdlLWNoZWNrbGlzdC11cmdlbmN5XCIsXG4gICAgICBuYW1lOiBcIkNoYW5nZSB1cmdlbmN5IG9mIGNoZWNrbGlzdCBpdGVtc1wiLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3I6IEVkaXRvcikgPT4ge1xuICAgICAgICBjb25zdCBzZWxlY3Rpb24gPSBlZGl0b3IuZ2V0U2VsZWN0aW9uKCk7XG4gICAgICAgIGlmICh0aGlzLmNvbnRhaW5zQ2hlY2tsaXN0SXRlbXMoc2VsZWN0aW9uKSkge1xuICAgICAgICAgIG5ldyBVcmdlbmN5TW9kYWwoXG4gICAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICAgIGVkaXRvcixcbiAgICAgICAgICAgIHNlbGVjdGlvbixcbiAgICAgICAgICAgIHRoaXMudXJnZW5jeUxldmVscyxcbiAgICAgICAgICAgICh1cmdlbmN5OiBVcmdlbmN5TGV2ZWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jaGFuZ2VDaGVja2xpc3RVcmdlbmN5KGVkaXRvciwgc2VsZWN0aW9uLCB1cmdlbmN5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApLm9wZW4oKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiUGxlYXNlIHNlbGVjdCBjaGVja2xpc3QgaXRlbXNcIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgaW5kaXZpZHVhbCB1cmdlbmN5IGNvbW1hbmRzXG4gICAgdGhpcy51cmdlbmN5TGV2ZWxzLmZvckVhY2goKGxldmVsKSA9PiB7XG4gICAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgICBpZDogYHNldC1jaGVja2xpc3QtdXJnZW5jeS0ke2xldmVsLmxhYmVsLnRvTG93ZXJDYXNlKCl9YCxcbiAgICAgICAgbmFtZTogYFNldCBjaGVja2xpc3QgdXJnZW5jeSB0byAke2xldmVsLmVtb2ppfSAke2xldmVsLmxhYmVsfWAsXG4gICAgICAgIGVkaXRvckNhbGxiYWNrOiAoZWRpdG9yOiBFZGl0b3IpID0+IHtcbiAgICAgICAgICBjb25zdCBzZWxlY3Rpb24gPSBlZGl0b3IuZ2V0U2VsZWN0aW9uKCk7XG4gICAgICAgICAgaWYgKHRoaXMuY29udGFpbnNDaGVja2xpc3RJdGVtcyhzZWxlY3Rpb24pKSB7XG4gICAgICAgICAgICB0aGlzLmNoYW5nZUNoZWNrbGlzdFVyZ2VuY3koZWRpdG9yLCBzZWxlY3Rpb24sIGxldmVsKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIlBsZWFzZSBzZWxlY3QgY2hlY2tsaXN0IGl0ZW1zXCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKSB7XG4gICAgY29uc29sZS5sb2coXCJ1bmxvYWRpbmcgVGFnSXQgcGx1Z2luXCIpO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkYXRhID0gKGF3YWl0IHRoaXMubG9hZERhdGEoKSkgYXMgUGx1Z2luRGF0YTtcbiAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MgPSB7IC4uLkRFRkFVTFRfU0VUVElOR1MsIC4uLmRhdGEuc2V0dGluZ3MgfTtcbiAgICAgICAgdGhpcy5mb2xkZXJUYWdzID0gZGF0YS5mb2xkZXJUYWdzIHx8IHt9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gICAgICAgIHRoaXMuZm9sZGVyVGFncyA9IHt9O1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIGxvYWQgcGx1Z2luIGRhdGE6XCIsIGVycm9yKTtcbiAgICAgIHRoaXMuc2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICAgICAgdGhpcy5mb2xkZXJUYWdzID0ge307XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgIGNvbnN0IGRhdGE6IFBsdWdpbkRhdGEgPSB7XG4gICAgICBzZXR0aW5nczogdGhpcy5zZXR0aW5ncyxcbiAgICAgIGZvbGRlclRhZ3M6IHRoaXMuZm9sZGVyVGFncyxcbiAgICAgIHZlcnNpb246IFwiMS4wLjBcIixcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEoZGF0YSk7XG4gIH1cblxuICBhc3luYyBsb2FkRm9sZGVyVGFncygpIHtcbiAgICAvLyBUaGlzIG1ldGhvZCBpcyBub3cgcmVkdW5kYW50IGFzIHdlJ3JlIGxvYWRpbmcgYm90aCBzZXR0aW5ncyBhbmQgZm9sZGVyVGFncyBpbiBsb2FkU2V0dGluZ3NcbiAgICAvLyBLZWVwaW5nIGl0IGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eVxuICAgIGNvbnNvbGUubG9nKFwiRm9sZGVyIHRhZ3MgbG9hZGVkIGluIGxvYWRTZXR0aW5ncyBtZXRob2RcIik7XG4gIH1cblxuICBhc3luYyBzYXZlRm9sZGVyVGFncygpIHtcbiAgICBjb25zdCBkYXRhOiBQbHVnaW5EYXRhID0ge1xuICAgICAgc2V0dGluZ3M6IHRoaXMuc2V0dGluZ3MsXG4gICAgICBmb2xkZXJUYWdzOiB0aGlzLmZvbGRlclRhZ3MsXG4gICAgICB2ZXJzaW9uOiBcIjEuMC4wXCIsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKGRhdGEpO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVGb2xkZXJDcmVhdGlvbihmb2xkZXI6IFRGb2xkZXIpIHtcbiAgICBpZiAoIXRoaXMuaXNJbml0aWFsTG9hZCAmJiB0aGlzLnNldHRpbmdzLnNob3dOZXdGb2xkZXJNb2RhbCkge1xuICAgICAgbmV3IEZvbGRlclRhZ01vZGFsKHRoaXMuYXBwLCBmb2xkZXIsIHRoaXMsIHRydWUpLm9wZW4oKTtcbiAgICB9XG4gIH1cblxuICBzZXRGb2xkZXJUYWdzKGZvbGRlclBhdGg6IHN0cmluZywgdGFnczogc3RyaW5nW10pIHtcbiAgICBjb25zdCB1bmlxdWVUYWdzID0gdGhpcy5yZW1vdmVEdXBsaWNhdGVUYWdzKHRhZ3MpO1xuICAgIHRoaXMuZm9sZGVyVGFnc1tmb2xkZXJQYXRoXSA9IHVuaXF1ZVRhZ3M7XG4gICAgdGhpcy5zYXZlRm9sZGVyVGFncygpO1xuICAgIHRoaXMudXBkYXRlRm9sZGVySWNvbnMoKTtcbiAgICB0aGlzLnVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKTtcbiAgfVxuXG4gIGdldEZvbGRlclRhZ3MoZm9sZGVyUGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIHJldHVybiB0aGlzLmZvbGRlclRhZ3NbZm9sZGVyUGF0aF0gfHwgW107XG4gIH1cblxuICBvcGVuRm9sZGVyVGFnTW9kYWwoZm9sZGVyOiBURm9sZGVyIHwgbnVsbCkge1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIG5ldyBGb2xkZXJUYWdNb2RhbCh0aGlzLmFwcCwgZm9sZGVyLCB0aGlzKS5vcGVuKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBmb2xkZXIgc2VsZWN0ZWRcIik7XG4gICAgfVxuICB9XG5cbiAgcmVtb3ZlRm9sZGVyVGFncyhmb2xkZXI6IFRGb2xkZXIgfCBudWxsKSB7XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgdGhpcy5zZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoLCBbXSk7XG4gICAgICBuZXcgTm90aWNlKGBSZW1vdmVkIGFsbCB0YWdzIGZyb20gZm9sZGVyOiAke2ZvbGRlci5wYXRofWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gZm9sZGVyIHNlbGVjdGVkXCIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGhhbmRsZUZpbGVDcmVhdGlvbihmaWxlOiBURmlsZSkge1xuICAgIC8vIEFkZCBtb3JlIHRob3JvdWdoIGZpbGUgdHlwZSBjaGVja2luZ1xuICAgIGlmIChcbiAgICAgICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB8fFxuICAgICAgIWZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCkubWF0Y2goL14obWR8bWFya2Rvd24pJC8pXG4gICAgKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLmF1dG9BcHBseVRhZ3MpIHtcbiAgICAgIHJldHVybjsgLy8gRG9uJ3QgYXBwbHkgdGFncyBpZiB0aGUgc2V0dGluZyBpcyBvZmZcbiAgICB9XG5cbiAgICBjb25zdCBmb2xkZXIgPSBmaWxlLnBhcmVudDtcbiAgICBpZiAoZm9sZGVyKSB7XG4gICAgICBjb25zdCBmb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzV2l0aEluaGVyaXRhbmNlKGZvbGRlci5wYXRoKTtcbiAgICAgIGlmIChmb2xkZXJUYWdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZGRUYWdzVG9GaWxlKGZpbGUsIGZvbGRlclRhZ3MpO1xuICAgICAgICB0aGlzLnVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyBoYW5kbGVGaWxlTW92ZShmaWxlOiBURmlsZSwgb2xkUGF0aDogc3RyaW5nKSB7XG4gICAgY29uc29sZS5sb2coYEZpbGUgbW92ZWQ6ICR7b2xkUGF0aH0gLT4gJHtmaWxlLnBhdGh9YCk7XG5cbiAgICBjb25zdCBvbGRGb2xkZXJQYXRoID0gb2xkUGF0aC5zdWJzdHJpbmcoMCwgb2xkUGF0aC5sYXN0SW5kZXhPZihcIi9cIikpO1xuICAgIGNvbnN0IG5ld0ZvbGRlciA9IGZpbGUucGFyZW50O1xuXG4gICAgY29uc29sZS5sb2coXG4gICAgICBgT2xkIGZvbGRlciBwYXRoOiAke29sZEZvbGRlclBhdGh9LCBOZXcgZm9sZGVyOiAke25ld0ZvbGRlcj8ucGF0aH1gXG4gICAgKTtcblxuICAgIGlmIChvbGRGb2xkZXJQYXRoICE9PSBuZXdGb2xkZXI/LnBhdGgpIHtcbiAgICAgIGNvbnN0IG9sZEZvbGRlclRhZ3MgPSB0aGlzLmdldEZvbGRlclRhZ3NXaXRoSW5oZXJpdGFuY2Uob2xkRm9sZGVyUGF0aCk7XG4gICAgICBjb25zdCBuZXdGb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzV2l0aEluaGVyaXRhbmNlKFxuICAgICAgICBuZXdGb2xkZXI/LnBhdGggfHwgXCJcIlxuICAgICAgKTtcblxuICAgICAgLy8gT25seSBwcm9jZWVkIGlmIHRoZSB0YWdzIGFyZSBkaWZmZXJlbnRcbiAgICAgIGlmIChcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkob2xkRm9sZGVyVGFncy5zb3J0KCkpICE9PVxuICAgICAgICBKU09OLnN0cmluZ2lmeShuZXdGb2xkZXJUYWdzLnNvcnQoKSlcbiAgICAgICkge1xuICAgICAgICBjb25zb2xlLmxvZyhgT2xkIGZvbGRlciB0YWdzOiAke29sZEZvbGRlclRhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgTmV3IGZvbGRlciB0YWdzOiAke25ld0ZvbGRlclRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgICAgIGNvbnN0IGNvbmZsaWN0aW5nVGFncyA9IHRoaXMuZGV0ZWN0Q29uZmxpY3RpbmdUYWdzKGZpbGUpO1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29uZmxpY3RpbmcgdGFnczogJHtjb25mbGljdGluZ1RhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgICAgIGlmIChjb25mbGljdGluZ1RhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgIG5ldyBDb25mbGljdFJlc29sdXRpb25Nb2RhbChcbiAgICAgICAgICAgIHRoaXMuYXBwLFxuICAgICAgICAgICAgZmlsZSxcbiAgICAgICAgICAgIGNvbmZsaWN0aW5nVGFncyxcbiAgICAgICAgICAgIHRoaXNcbiAgICAgICAgICApLm9wZW4oKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBuZXcgRmlsZU1vdmVkTW9kYWwoXG4gICAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICAgIGZpbGUsXG4gICAgICAgICAgICBvbGRGb2xkZXJUYWdzLFxuICAgICAgICAgICAgbmV3Rm9sZGVyVGFncyxcbiAgICAgICAgICAgIHRoaXNcbiAgICAgICAgICApLm9wZW4oKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJGb2xkZXIgdGFncyBhcmUgdGhlIHNhbWUsIG5vIHVwZGF0ZSBuZWVkZWRcIik7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiRmlsZSBub3QgbW92ZWQgYmV0d2VlbiBmb2xkZXJzIG9yIGZvbGRlcnMgYXJlIHRoZSBzYW1lXCIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFkZFRhZ3NUb0ZpbGUoZmlsZTogVEZpbGUsIHRhZ3NUb0FkZDogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICAvLyBPbmx5IGFkZCB0YWdzIHRoYXQgZG9uJ3QgYWxyZWFkeSBleGlzdFxuICAgIGNvbnN0IG5ld1RhZ3MgPSB0YWdzVG9BZGQuZmlsdGVyKFxuICAgICAgKHRhZzogc3RyaW5nKSA9PiAhZXhpc3RpbmdUYWdzLmluY2x1ZGVzKHRhZylcbiAgICApO1xuICAgIGNvbnN0IGFsbFRhZ3MgPSBbLi4uZXhpc3RpbmdUYWdzLCAuLi5uZXdUYWdzXTtcblxuICAgIC8vIE9ubHkgdXBkYXRlIGlmIHRoZXJlIGFyZSBuZXcgdGFncyB0byBhZGRcbiAgICBpZiAobmV3VGFncy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudChjb250ZW50LCBhbGxUYWdzKTtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICB0aGlzLnVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKTtcblxuICAgICAgaWYgKHRoaXMuc2V0dGluZ3MuZGVidWdNb2RlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBBZGRlZCBuZXcgdGFncyB0byAke2ZpbGUubmFtZX06YCwgbmV3VGFncyk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLnNldHRpbmdzLmRlYnVnTW9kZSkge1xuICAgICAgY29uc29sZS5sb2coYE5vIG5ldyB0YWdzIHRvIGFkZCB0byAke2ZpbGUubmFtZX1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyB1cGRhdGVGaWxlVGFncyhcbiAgICBmaWxlOiBURmlsZSxcbiAgICBvbGRGb2xkZXJUYWdzOiBzdHJpbmdbXSxcbiAgICBuZXdGb2xkZXJUYWdzOiBzdHJpbmdbXVxuICApIHtcbiAgICBjb25zb2xlLmxvZyhgVXBkYXRpbmcgdGFncyBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgY29uc29sZS5sb2coYE9sZCBmb2xkZXIgdGFnczogJHtvbGRGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICBjb25zb2xlLmxvZyhgTmV3IGZvbGRlciB0YWdzOiAke25ld0ZvbGRlclRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgY29uc29sZS5sb2coYEV4aXN0aW5nIHRhZ3M6ICR7ZXhpc3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIC8vIFJlbW92ZSBvbGQgZm9sZGVyIHRhZ3MgYW5kIGtlZXAgbWFudWFsIHRhZ3NcbiAgICBjb25zdCBtYW51YWxUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcihcbiAgICAgICh0YWcpID0+ICFvbGRGb2xkZXJUYWdzLmluY2x1ZGVzKHRhZylcbiAgICApO1xuXG4gICAgLy8gQWRkIG5ldyBmb2xkZXIgdGFnc1xuICAgIGNvbnN0IHVwZGF0ZWRUYWdzID0gWy4uLm5ldyBTZXQoWy4uLm1hbnVhbFRhZ3MsIC4uLm5ld0ZvbGRlclRhZ3NdKV07XG5cbiAgICBjb25zb2xlLmxvZyhgTWFudWFsIHRhZ3M6ICR7bWFudWFsVGFncy5qb2luKFwiLCBcIil9YCk7XG4gICAgY29uc29sZS5sb2coYFVwZGF0ZWQgdGFnczogJHt1cGRhdGVkVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudChjb250ZW50LCB1cGRhdGVkVGFncyk7XG5cbiAgICBpZiAoY29udGVudCAhPT0gdXBkYXRlZENvbnRlbnQpIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICBjb25zb2xlLmxvZyhgVGFncyB1cGRhdGVkIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5sb2coYE5vIGNoYW5nZXMgbmVlZGVkIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICB9XG4gIH1cblxuICB1cGRhdGVUYWdzSW5Db250ZW50KGNvbnRlbnQ6IHN0cmluZywgdGFnczogc3RyaW5nW10pOiBzdHJpbmcge1xuICAgIC8vIEVuc3VyZSB0YWdzIGFyZSB1bmlxdWUgd2hpbGUgcHJlc2VydmluZyBvcmRlclxuICAgIGNvbnN0IHVuaXF1ZVRhZ3MgPSBbLi4ubmV3IFNldCh0YWdzKV07XG5cbiAgICBpZiAodW5pcXVlVGFncy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiB0aGlzLnJlbW92ZVlhbWxGcm9udE1hdHRlcihjb250ZW50KTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSB0YWdzIHNlY3Rpb24gaW4gWUFNTCBmb3JtYXRcbiAgICBjb25zdCB0YWdTZWN0aW9uID0gdW5pcXVlVGFncy5tYXAoKHRhZykgPT4gYCAgLSAke3RhZ31gKS5qb2luKFwiXFxuXCIpO1xuXG4gICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgIC8vIFJlbW92ZSBleGlzdGluZyB0YWdzIHNlY3Rpb24gd2hpbGUgcHJlc2VydmluZyBvdGhlciBmcm9udG1hdHRlclxuICAgICAgY29uc3QgY2xlYW5lZEZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJcbiAgICAgICAgLnJlcGxhY2UoL3RhZ3M6W1xcc1xcU10qPyg/PVxcblteXFxzXXxcXG4kKS9tLCBcIlwiKVxuICAgICAgICAucmVwbGFjZSgvXFxuKy9nLCBcIlxcblwiKVxuICAgICAgICAudHJpbSgpO1xuXG4gICAgICAvLyBBZGQgbmV3IHRhZ3Mgc2VjdGlvblxuICAgICAgY29uc3QgdXBkYXRlZEZyb250bWF0dGVyID0gY2xlYW5lZEZyb250bWF0dGVyXG4gICAgICAgID8gYCR7Y2xlYW5lZEZyb250bWF0dGVyfVxcbnRhZ3M6XFxuJHt0YWdTZWN0aW9ufWBcbiAgICAgICAgOiBgdGFnczpcXG4ke3RhZ1NlY3Rpb259YDtcblxuICAgICAgcmV0dXJuIGNvbnRlbnQucmVwbGFjZShcbiAgICAgICAgZnJvbnRtYXR0ZXJSZWdleCxcbiAgICAgICAgYC0tLVxcbiR7dXBkYXRlZEZyb250bWF0dGVyfVxcbi0tLWBcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBgLS0tXFxudGFnczpcXG4ke3RhZ1NlY3Rpb259XFxuLS0tXFxuXFxuJHtjb250ZW50fWA7XG4gICAgfVxuICB9XG5cbiAgYWRkVGFnc1RvQ29udGVudChjb250ZW50OiBzdHJpbmcsIHRhZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgICBpZiAodGFncy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBjb250ZW50O1xuICAgIH1cblxuICAgIGNvbnN0IHRhZ1NlY3Rpb24gPSB0YWdzLm1hcCgodGFnKSA9PiBgICAtICR7dGFnfWApLmpvaW4oXCJcXG5cIik7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcblxuICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICBjb25zdCBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG4gICAgICBjb25zdCB1cGRhdGVkRnJvbnRtYXR0ZXIgPSBgJHtmcm9udG1hdHRlci50cmltKCl9XFxudGFnczpcXG4ke3RhZ1NlY3Rpb259YDtcbiAgICAgIHJldHVybiBjb250ZW50LnJlcGxhY2UoXG4gICAgICAgIGZyb250bWF0dGVyUmVnZXgsXG4gICAgICAgIGAtLS1cXG4ke3VwZGF0ZWRGcm9udG1hdHRlcn1cXG4tLS1gXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYC0tLVxcbnRhZ3M6XFxuJHt0YWdTZWN0aW9ufVxcbi0tLVxcblxcbiR7Y29udGVudH1gO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZVRhZ3NGcm9tQ29udGVudChjb250ZW50OiBzdHJpbmcsIHRhZ3NUb1JlbW92ZTogc3RyaW5nW10pOiBzdHJpbmcge1xuICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG5cbiAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gZnJvbnRtYXR0ZXIubWF0Y2goL3RhZ3M6XFxzKlxcWyguKj8pXFxdLyk7XG5cbiAgICAgIGlmIChleGlzdGluZ1RhZ3MpIHtcbiAgICAgICAgY29uc3QgY3VycmVudFRhZ3MgPSBleGlzdGluZ1RhZ3NbMV0uc3BsaXQoXCIsXCIpLm1hcCgodGFnKSA9PiB0YWcudHJpbSgpKTtcbiAgICAgICAgY29uc3QgdXBkYXRlZFRhZ3MgPSBjdXJyZW50VGFncy5maWx0ZXIoXG4gICAgICAgICAgKHRhZykgPT4gIXRhZ3NUb1JlbW92ZS5pbmNsdWRlcyh0YWcpXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IHVwZGF0ZWRGcm9udG1hdHRlciA9IGZyb250bWF0dGVyLnJlcGxhY2UoXG4gICAgICAgICAgL3RhZ3M6XFxzKlxcWy4qP1xcXS8sXG4gICAgICAgICAgYHRhZ3M6IFske3VwZGF0ZWRUYWdzLmpvaW4oXCIsIFwiKX1dYFxuICAgICAgICApO1xuICAgICAgICByZXR1cm4gY29udGVudC5yZXBsYWNlKFxuICAgICAgICAgIGZyb250bWF0dGVyUmVnZXgsXG4gICAgICAgICAgYC0tLVxcbiR7dXBkYXRlZEZyb250bWF0dGVyfVxcbi0tLWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY29udGVudDtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5RmlsZVRhZ3NUb0ZvbGRlcihmaWxlOiBURmlsZSkge1xuICAgIGNvbnN0IGZvbGRlciA9IGZpbGUucGFyZW50O1xuICAgIGlmICghZm9sZGVyKSB7XG4gICAgICBuZXcgTm90aWNlKFwiRmlsZSBpcyBub3QgaW4gYSBmb2xkZXJcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgZmlsZVRhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICBjb25zb2xlLmxvZyhgRXh0cmFjdGVkIHRhZ3MgZnJvbSBmaWxlOiAke2ZpbGVUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGlmIChmaWxlVGFncy5sZW5ndGggPT09IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyB0YWdzIGZvdW5kIGluIHRoZSBmaWxlXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEdldCB0YWdzIG9ubHkgZnJvbSB0aGUgaW1tZWRpYXRlIHBhcmVudCBmb2xkZXJcbiAgICBjb25zdCBmb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzKGZvbGRlci5wYXRoKTtcbiAgICBjb25zdCBuZXdUYWdzID0gWy4uLm5ldyBTZXQoWy4uLmZvbGRlclRhZ3MsIC4uLmZpbGVUYWdzXSldO1xuICAgIGNvbnN0IGFkZGVkVGFncyA9IG5ld1RhZ3MuZmlsdGVyKCh0YWcpID0+ICFmb2xkZXJUYWdzLmluY2x1ZGVzKHRhZykpO1xuXG4gICAgY29uc29sZS5sb2coYEV4aXN0aW5nIGZvbGRlciB0YWdzOiAke2ZvbGRlclRhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgIGNvbnNvbGUubG9nKGBOZXcgdGFncyB0byBhZGQ6ICR7YWRkZWRUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGlmIChhZGRlZFRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gbmV3IHRhZ3MgdG8gYWRkIHRvIHRoZSBmb2xkZXJcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3IFRhZ1NlbGVjdGlvbk1vZGFsKFxuICAgICAgdGhpcy5hcHAsXG4gICAgICBgU2VsZWN0IHRhZ3MgdG8gYWRkIGZyb20gdGhlIGZpbGUgXCIke2ZpbGUubmFtZX1cIiB0byB0aGUgZm9sZGVyIFwiJHtmb2xkZXIubmFtZX1cIjpgLFxuICAgICAgYWRkZWRUYWdzLFxuICAgICAgKHNlbGVjdGVkVGFncykgPT4ge1xuICAgICAgICBjb25zdCB1cGRhdGVkVGFncyA9IFsuLi5uZXcgU2V0KFsuLi5mb2xkZXJUYWdzLCAuLi5zZWxlY3RlZFRhZ3NdKV07XG4gICAgICAgIHRoaXMuc2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCwgdXBkYXRlZFRhZ3MpO1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgIGBBcHBsaWVkICR7c2VsZWN0ZWRUYWdzLmxlbmd0aH0gdGFncyBmcm9tIGZpbGUgdG8gZm9sZGVyOiAke2ZvbGRlci5uYW1lfWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICApLm9wZW4oKTtcbiAgfVxuXG4gIGV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG4gICAgbGV0IHRhZ3M6IHN0cmluZ1tdID0gW107XG5cbiAgICAvLyBFeHRyYWN0IHRhZ3MgZnJvbSBZQU1MIGZyb250IG1hdHRlclxuICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICBjb25zdCBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG5cbiAgICAgIC8vIE1hdGNoIGJvdGggYXJyYXktc3R5bGUgYW5kIGxpc3Qtc3R5bGUgWUFNTCB0YWdzXG4gICAgICBjb25zdCB5YW1sQXJyYXlNYXRjaCA9IGZyb250bWF0dGVyLm1hdGNoKC90YWdzOlxccypcXFsoLio/KVxcXS8pO1xuICAgICAgY29uc3QgeWFtbExpc3RNYXRjaCA9IGZyb250bWF0dGVyLm1hdGNoKC90YWdzOlxccypcXG4oKD86XFxzKi1cXHMqLitcXG4/KSopLyk7XG5cbiAgICAgIGlmICh5YW1sQXJyYXlNYXRjaCkge1xuICAgICAgICAvLyBIYW5kbGUgYXJyYXktc3R5bGUgdGFncyBbdGFnMSwgdGFnMl1cbiAgICAgICAgdGFncyA9IHlhbWxBcnJheU1hdGNoWzFdXG4gICAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKHRhZykgPT4gdGFnLnRyaW0oKSlcbiAgICAgICAgICAuZmlsdGVyKCh0YWcpID0+IHRhZy5sZW5ndGggPiAwKTtcbiAgICAgIH0gZWxzZSBpZiAoeWFtbExpc3RNYXRjaCkge1xuICAgICAgICAvLyBIYW5kbGUgbGlzdC1zdHlsZSB0YWdzXG4gICAgICAgIC8vIC0gdGFnMVxuICAgICAgICAvLyAtIHRhZzJcbiAgICAgICAgdGFncyA9IHlhbWxMaXN0TWF0Y2hbMV1cbiAgICAgICAgICAuc3BsaXQoXCJcXG5cIilcbiAgICAgICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnJlcGxhY2UoL15cXHMqLVxccyovLCBcIlwiKS50cmltKCkpXG4gICAgICAgICAgLmZpbHRlcigodGFnKSA9PiB0YWcubGVuZ3RoID4gMCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBpbmxpbmUgdGFncyBmcm9tIGNvbnRlbnRcbiAgICBjb25zdCBjb250ZW50V2l0aG91dEZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXJNYXRjaFxuICAgICAgPyBjb250ZW50LnNsaWNlKGZyb250bWF0dGVyTWF0Y2hbMF0ubGVuZ3RoKVxuICAgICAgOiBjb250ZW50O1xuXG4gICAgLy8gTW9yZSBjb21wcmVoZW5zaXZlIHJlZ2V4IGZvciBpbmxpbmUgdGFnc1xuICAgIGNvbnN0IGlubGluZVRhZ1JlZ2V4ID0gLyNbYS16QS1aMC05Xy9cXC1dKyg/PVteYS16QS1aMC05Xy9cXC1dfCQpL2c7XG4gICAgY29uc3QgaW5saW5lVGFncyA9IGNvbnRlbnRXaXRob3V0RnJvbnRtYXR0ZXIubWF0Y2goaW5saW5lVGFnUmVnZXgpO1xuXG4gICAgaWYgKGlubGluZVRhZ3MpIHtcbiAgICAgIHRhZ3MgPSBbLi4udGFncywgLi4uaW5saW5lVGFncy5tYXAoKHRhZykgPT4gdGFnLnN1YnN0cmluZygxKSldO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBkdXBsaWNhdGVzIGFuZCBlbXB0eSB0YWdzXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRhZ3MpXS5maWx0ZXIoKHRhZykgPT4gdGFnLmxlbmd0aCA+IDApO1xuICB9XG5cbiAgYXN5bmMgY29udmVydElubGluZVRhZ3NUb1lBTUwoZmlsZTogVEZpbGUpIHtcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBpbmxpbmVUYWdzID0gY29udGVudC5tYXRjaCgvI1teXFxzI10rL2cpO1xuXG4gICAgaWYgKCFpbmxpbmVUYWdzKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gaW5saW5lIHRhZ3MgZm91bmQgaW4gdGhlIGZpbGVcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbmV3VGFncyA9IGlubGluZVRhZ3MubWFwKCh0YWcpID0+IHRhZy5zdWJzdHJpbmcoMSkpO1xuXG4gICAgbmV3IENvbmZpcm1hdGlvbk1vZGFsKFxuICAgICAgdGhpcy5hcHAsXG4gICAgICBgVGhpcyB3aWxsIGNvbnZlcnQgJHtuZXdUYWdzLmxlbmd0aH0gaW5saW5lIHRhZ3MgdG8gWUFNTCBmcm9udCBtYXR0ZXIgYW5kIHJlbW92ZSB0aGVtIGZyb20gdGhlIGNvbnRlbnQuIEFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBwcm9jZWVkP2AsXG4gICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgIG5ldyBUYWdTZWxlY3Rpb25Nb2RhbChcbiAgICAgICAgICB0aGlzLmFwcCxcbiAgICAgICAgICBgU2VsZWN0IGlubGluZSB0YWdzIHRvIGNvbnZlcnQgdG8gWUFNTCBmcm9udCBtYXR0ZXI6YCxcbiAgICAgICAgICBuZXdUYWdzLFxuICAgICAgICAgIGFzeW5jIChzZWxlY3RlZFRhZ3MpID0+IHtcbiAgICAgICAgICAgIGlmIChzZWxlY3RlZFRhZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyB0YWdzIHNlbGVjdGVkIGZvciBjb252ZXJzaW9uXCIpO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4dHJhY3QgZXhpc3RpbmcgWUFNTCB0YWdzXG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICAgICAgICAgIC8vIENvbWJpbmUgZXhpc3RpbmcgYW5kIG5ldyB0YWdzLCByZW1vdmluZyBkdXBsaWNhdGVzXG4gICAgICAgICAgICBjb25zdCBhbGxUYWdzID0gWy4uLm5ldyBTZXQoWy4uLmV4aXN0aW5nVGFncywgLi4uc2VsZWN0ZWRUYWdzXSldO1xuXG4gICAgICAgICAgICBsZXQgdXBkYXRlZENvbnRlbnQgPSB0aGlzLmFkZFRhZ3NUb0NvbnRlbnQoY29udGVudCwgYWxsVGFncyk7XG5cbiAgICAgICAgICAgIC8vIFJlbW92ZSBzZWxlY3RlZCBpbmxpbmUgdGFncyBmcm9tIHRoZSBjb250ZW50XG4gICAgICAgICAgICBzZWxlY3RlZFRhZ3MuZm9yRWFjaCgodGFnKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gbmV3IFJlZ0V4cChgIyR7dGFnfVxcXFxiYCwgXCJnXCIpO1xuICAgICAgICAgICAgICB1cGRhdGVkQ29udGVudCA9IHVwZGF0ZWRDb250ZW50LnJlcGxhY2UocmVnZXgsIFwiXCIpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgICAgICBgQ29udmVydGVkICR7c2VsZWN0ZWRUYWdzLmxlbmd0aH0gaW5saW5lIHRhZ3MgdG8gWUFNTCBmcm9udCBtYXR0ZXJgXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgKS5vcGVuKCk7XG4gICAgICB9XG4gICAgKS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUZvbGRlckRlbGV0aW9uKGZvbGRlcjogVEZvbGRlcikge1xuICAgIGRlbGV0ZSB0aGlzLmZvbGRlclRhZ3NbZm9sZGVyLnBhdGhdO1xuICAgIHRoaXMuc2F2ZUZvbGRlclRhZ3MoKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5Rm9sZGVyVGFnc1RvQ29udGVudHMoZm9sZGVyOiBURm9sZGVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFmb2xkZXIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJGb2xkZXIgaXMgbnVsbCBvciB1bmRlZmluZWRcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZm9sZGVyVGFncyA9IHRoaXMuZ2V0Rm9sZGVyVGFncyhmb2xkZXIucGF0aCk7XG4gICAgY29uc3QgZmlsZXMgPSBmb2xkZXIuY2hpbGRyZW4uZmlsdGVyKChjaGlsZCkgPT4gY2hpbGQgaW5zdGFuY2VvZiBURmlsZSk7XG5cbiAgICBsZXQgdXBkYXRlZENvdW50ID0gMDtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcbiAgICAgICAgY29uc3QgbmV3VGFncyA9IGZvbGRlclRhZ3MuZmlsdGVyKFxuICAgICAgICAgICh0YWc6IHN0cmluZykgPT4gIWV4aXN0aW5nVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKG5ld1RhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuYWRkVGFnc1RvRmlsZShmaWxlLCBuZXdUYWdzKTtcbiAgICAgICAgICB1cGRhdGVkQ291bnQrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh1cGRhdGVkQ291bnQgPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKGBVcGRhdGVkIHRhZ3MgZm9yICR7dXBkYXRlZENvdW50fSBmaWxlKHMpYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBmaWxlcyBuZWVkZWQgdGFnIHVwZGF0ZXNcIik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZURhdGFGaWxlKCkge1xuICAgIGNvbnN0IGluaXRpYWxEYXRhID0ge1xuICAgICAgc2V0dGluZ3M6IERFRkFVTFRfU0VUVElOR1MsXG4gICAgICBmb2xkZXJUYWdzOiB7fSxcbiAgICB9O1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTKTtcbiAgICB0aGlzLmZvbGRlclRhZ3MgPSB7fTtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKGluaXRpYWxEYXRhKTtcbiAgICBjb25zb2xlLmxvZyhcIkluaXRpYWxpemVkIGRhdGEgZmlsZSB3aXRoIGRlZmF1bHQgdmFsdWVzXCIpO1xuICB9XG5cbiAgcXVldWVOZXdGb2xkZXIoZm9sZGVyOiBURm9sZGVyKSB7XG4gICAgLy8gRW5zdXJlIHdlIGhhdmUgdGhlIG1vc3QgdXAtdG8tZGF0ZSBmb2xkZXIgb2JqZWN0XG4gICAgY29uc3QgdXBkYXRlZEZvbGRlciA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmb2xkZXIucGF0aCk7XG4gICAgaWYgKHVwZGF0ZWRGb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICB0aGlzLm5ld0ZvbGRlclF1ZXVlLnB1c2godXBkYXRlZEZvbGRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgIGBGYWlsZWQgdG8gZ2V0IHVwZGF0ZWQgZm9sZGVyIG9iamVjdCBmb3IgcGF0aDogJHtmb2xkZXIucGF0aH1gXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHByb2Nlc3NOZXdGb2xkZXJRdWV1ZSgpIHtcbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiB0aGlzLm5ld0ZvbGRlclF1ZXVlKSB7XG4gICAgICBhd2FpdCB0aGlzLnByb21wdEZvckZvbGRlclRhZ3MoZm9sZGVyKTtcbiAgICB9XG4gICAgdGhpcy5uZXdGb2xkZXJRdWV1ZSA9IFtdOyAvLyBDbGVhciB0aGUgcXVldWVcbiAgfVxuXG4gIGFzeW5jIHByb21wdEZvckZvbGRlclRhZ3MoZm9sZGVyOiBURm9sZGVyKSB7XG4gICAgbmV3IEZvbGRlclRhZ01vZGFsKHRoaXMuYXBwLCBmb2xkZXIsIHRoaXMsIHRydWUpLm9wZW4oKTtcbiAgfVxuXG4gIGdldEZvbGRlclRhZ3NXaXRoSW5oZXJpdGFuY2UoZm9sZGVyUGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGlmICh0aGlzLnNldHRpbmdzLmluaGVyaXRhbmNlTW9kZSA9PT0gXCJub25lXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldEZvbGRlclRhZ3MoZm9sZGVyUGF0aCk7XG4gICAgfVxuXG4gICAgbGV0IHRhZ3M6IHN0cmluZ1tdID0gW107XG4gICAgbGV0IGN1cnJlbnRQYXRoID0gZm9sZGVyUGF0aDtcblxuICAgIHdoaWxlIChjdXJyZW50UGF0aCkge1xuICAgICAgaWYgKCF0aGlzLnNldHRpbmdzLmV4Y2x1ZGVkRm9sZGVycy5pbmNsdWRlcyhjdXJyZW50UGF0aCkpIHtcbiAgICAgICAgdGFncyA9IFsuLi5uZXcgU2V0KFsuLi50YWdzLCAuLi50aGlzLmdldEZvbGRlclRhZ3MoY3VycmVudFBhdGgpXSldO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIHRoaXMuc2V0dGluZ3MuaW5oZXJpdGFuY2VNb2RlID09PSBcImltbWVkaWF0ZVwiICYmXG4gICAgICAgIGN1cnJlbnRQYXRoICE9PSBmb2xkZXJQYXRoXG4gICAgICApIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudFBhdGggPSBjdXJyZW50UGF0aC5zdWJzdHJpbmcoMCwgY3VycmVudFBhdGgubGFzdEluZGV4T2YoXCIvXCIpKTtcbiAgICAgIGlmIChwYXJlbnRQYXRoID09PSBjdXJyZW50UGF0aCkge1xuICAgICAgICBicmVhazsgLy8gV2UndmUgcmVhY2hlZCB0aGUgcm9vdFxuICAgICAgfVxuICAgICAgY3VycmVudFBhdGggPSBwYXJlbnRQYXRoO1xuICAgIH1cblxuICAgIHJldHVybiB0YWdzO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlRm9sZGVySWNvbnMoKSB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnNob3dGb2xkZXJJY29ucykge1xuICAgICAgLy8gUmVtb3ZlIGFsbCBmb2xkZXIgaWNvbnMgaWYgdGhlIHNldHRpbmcgaXMgb2ZmXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwiZmlsZS1leHBsb3JlclwiKS5mb3JFYWNoKChsZWFmKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGVFeHBsb3JlclZpZXcgPSBsZWFmLnZpZXcgYXMgYW55O1xuICAgICAgICBjb25zdCBmaWxlSXRlbXMgPSBmaWxlRXhwbG9yZXJWaWV3LmZpbGVJdGVtcztcbiAgICAgICAgZm9yIChjb25zdCBbLCBpdGVtXSBvZiBPYmplY3QuZW50cmllcyhmaWxlSXRlbXMpKSB7XG4gICAgICAgICAgaWYgKGl0ZW0gJiYgdHlwZW9mIGl0ZW0gPT09IFwib2JqZWN0XCIgJiYgXCJlbFwiIGluIGl0ZW0pIHtcbiAgICAgICAgICAgIGNvbnN0IGZvbGRlckVsID0gaXRlbS5lbCBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICAgIGNvbnN0IGljb25FbCA9IGZvbGRlckVsLnF1ZXJ5U2VsZWN0b3IoXG4gICAgICAgICAgICAgIFwiLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiXG4gICAgICAgICAgICApIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAgICAgICAgIGlmIChpY29uRWwpIHtcbiAgICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUNsYXNzKFwidGFnZ2VkLWZvbGRlclwiKTtcbiAgICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlRXhwbG9yZXIgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwiZmlsZS1leHBsb3JlclwiKVswXTtcbiAgICBpZiAoIWZpbGVFeHBsb3JlcikgcmV0dXJuO1xuXG4gICAgY29uc3QgZmlsZUV4cGxvcmVyVmlldyA9IGZpbGVFeHBsb3Jlci52aWV3IGFzIGFueTtcbiAgICBjb25zdCBmaWxlSXRlbXMgPSBmaWxlRXhwbG9yZXJWaWV3LmZpbGVJdGVtcztcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGl0ZW1dIG9mIE9iamVjdC5lbnRyaWVzKGZpbGVJdGVtcykpIHtcbiAgICAgIGlmIChcbiAgICAgICAgaXRlbSAmJlxuICAgICAgICB0eXBlb2YgaXRlbSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcImVsXCIgaW4gaXRlbSAmJlxuICAgICAgICBcImZpbGVcIiBpbiBpdGVtICYmXG4gICAgICAgIGl0ZW0uZmlsZSBpbnN0YW5jZW9mIFRGb2xkZXJcbiAgICAgICkge1xuICAgICAgICBjb25zdCBmb2xkZXJUYWdzID0gdGhpcy5nZXRGb2xkZXJUYWdzV2l0aEluaGVyaXRhbmNlKHBhdGggYXMgc3RyaW5nKTtcbiAgICAgICAgY29uc3QgZm9sZGVyRWwgPSBpdGVtLmVsIGFzIEhUTUxFbGVtZW50O1xuICAgICAgICBjb25zdCBpY29uRWwgPSBmb2xkZXJFbC5xdWVyeVNlbGVjdG9yKFxuICAgICAgICAgIFwiLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiXG4gICAgICAgICkgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuXG4gICAgICAgIGlmIChpY29uRWwpIHtcbiAgICAgICAgICBpZiAoZm9sZGVyVGFncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBpY29uRWwuYWRkQ2xhc3MoXCJ0YWdnZWQtZm9sZGVyXCIpO1xuICAgICAgICAgICAgaWNvbkVsLnNldEF0dHJpYnV0ZShcbiAgICAgICAgICAgICAgXCJhcmlhLWxhYmVsXCIsXG4gICAgICAgICAgICAgIGBUYWdnZWQgZm9sZGVyOiAke2ZvbGRlclRhZ3Muam9pbihcIiwgXCIpfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGljb25FbC5yZW1vdmVDbGFzcyhcInRhZ2dlZC1mb2xkZXJcIik7XG4gICAgICAgICAgICBpY29uRWwucmVtb3ZlQXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKGBDb3VsZCBub3QgZmluZCBpY29uIGVsZW1lbnQgZm9yIGZvbGRlcjogJHtwYXRofWApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIHRoaXMgbmV3IG1ldGhvZFxuICBhc3luYyB1cGRhdGVPYnNpZGlhblRhZ0NhY2hlKCkge1xuICAgIHRyeSB7XG4gICAgICAvLyBUcmlnZ2VyIG1ldGFkYXRhIGNhY2hlIHVwZGF0ZVxuICAgICAgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS50cmlnZ2VyKFwiY2hhbmdlZFwiKTtcblxuICAgICAgLy8gVHJ5IHRvIHJlZnJlc2ggdGhlIHRhZyBwYW5lIGlmIGl0IGV4aXN0c1xuICAgICAgY29uc3QgdGFnUGFuZUxlYXZlcyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJ0YWdcIik7XG4gICAgICBpZiAodGFnUGFuZUxlYXZlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIFVzZSB0aGUgd29ya3NwYWNlIHRyaWdnZXIgaW5zdGVhZCBvZiBkaXJlY3RseSBjYWxsaW5nIHJlZnJlc2hcbiAgICAgICAgdGhpcy5hcHAud29ya3NwYWNlLnRyaWdnZXIoXCJ0YWdzLXVwZGF0ZWRcIik7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLmRlYnVnTW9kZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIHVwZGF0ZSB0YWcgY2FjaGU6XCIsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBBZGQgdGhpcyBuZXcgbWV0aG9kXG4gIGdldEFsbEZvbGRlclRhZ3MoKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGFsbFRhZ3MgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IHRhZ3Mgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmZvbGRlclRhZ3MpKSB7XG4gICAgICB0YWdzLmZvckVhY2goKHRhZzogc3RyaW5nKSA9PiBhbGxUYWdzLmFkZCh0YWcpKTtcbiAgICB9XG4gICAgcmV0dXJuIEFycmF5LmZyb20oYWxsVGFncyk7XG4gIH1cblxuICBhc3luYyByZXBsYWNlQWxsVGFncyhmaWxlOiBURmlsZSwgbmV3VGFnczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zb2xlLmxvZyhgUmVwbGFjaW5nIGFsbCB0YWdzIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICBjb25zb2xlLmxvZyhgTmV3IHRhZ3M6ICR7bmV3VGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcblxuICAgIC8vIFJlbW92ZSBhbGwgZXhpc3RpbmcgdGFncyBmcm9tIHRoZSBjb250ZW50XG4gICAgbGV0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy5yZW1vdmVBbGxUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG5cbiAgICAvLyBBZGQgbmV3IHRhZ3NcbiAgICBpZiAobmV3VGFncy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IHVwZGF0ZWRDb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgICBjb25zdCBmcm9udG1hdHRlciA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG4gICAgICAgIGNvbnN0IG5ld1RhZ3NTZWN0aW9uID0gYHRhZ3M6XFxuJHtuZXdUYWdzXG4gICAgICAgICAgLm1hcCgodGFnKSA9PiBgICAtICR7dGFnfWApXG4gICAgICAgICAgLmpvaW4oXCJcXG5cIil9YDtcbiAgICAgICAgY29uc3QgdXBkYXRlZEZyb250bWF0dGVyID0gYCR7ZnJvbnRtYXR0ZXIudHJpbSgpfVxcbiR7bmV3VGFnc1NlY3Rpb259YDtcbiAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKFxuICAgICAgICAgIGZyb250bWF0dGVyUmVnZXgsXG4gICAgICAgICAgYC0tLVxcbiR7dXBkYXRlZEZyb250bWF0dGVyfVxcbi0tLWBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5ld1RhZ3NTZWN0aW9uID0gYHRhZ3M6XFxuJHtuZXdUYWdzXG4gICAgICAgICAgLm1hcCgodGFnKSA9PiBgICAtICR7dGFnfWApXG4gICAgICAgICAgLmpvaW4oXCJcXG5cIil9YDtcbiAgICAgICAgdXBkYXRlZENvbnRlbnQgPSBgLS0tXFxuJHtuZXdUYWdzU2VjdGlvbn1cXG4tLS1cXG5cXG4ke3VwZGF0ZWRDb250ZW50fWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICB0aGlzLnVwZGF0ZU9ic2lkaWFuVGFnQ2FjaGUoKTtcbiAgICBuZXcgTm90aWNlKGBUYWdzIHJlcGxhY2VkIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgfVxuXG4gIHJlbW92ZUFsbFRhZ3NGcm9tQ29udGVudChjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbltcXHNcXFNdKj9cXG4tLS1cXG4vO1xuICAgIHJldHVybiBjb250ZW50LnJlcGxhY2UoZnJvbnRtYXR0ZXJSZWdleCwgXCJcIik7XG4gIH1cblxuICBhc3luYyBtZXJnZVRhZ3MoXG4gICAgZmlsZTogVEZpbGUsXG4gICAgb2xkVGFnczogc3RyaW5nW10sXG4gICAgbmV3VGFnczogc3RyaW5nW11cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc29sZS5sb2coYE1lcmdpbmcgdGFncyBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgY29uc29sZS5sb2coYE9sZCB0YWdzOiAke29sZFRhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgIGNvbnNvbGUubG9nKGBOZXcgdGFnczogJHtuZXdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgIGNvbnNvbGUubG9nKGBFeGlzdGluZyB0YWdzOiAke2V4aXN0aW5nVGFncy5qb2luKFwiLCBcIil9YCk7XG5cbiAgICAvLyBSZW1vdmUgb2xkIGZvbGRlciB0YWdzXG4gICAgY29uc3QgbWFudWFsVGFncyA9IGV4aXN0aW5nVGFncy5maWx0ZXIoKHRhZykgPT4gIW9sZFRhZ3MuaW5jbHVkZXModGFnKSk7XG5cbiAgICAvLyBNZXJnZSBtYW51YWwgdGFncyB3aXRoIG5ldyBmb2xkZXIgdGFncywgZW5zdXJpbmcgbm8gZHVwbGljYXRlc1xuICAgIGNvbnN0IG1lcmdlZFRhZ3MgPSBbLi4ubmV3IFNldChbLi4ubWFudWFsVGFncywgLi4ubmV3VGFnc10pXTtcblxuICAgIGNvbnNvbGUubG9nKGBNZXJnZWQgdGFnczogJHttZXJnZWRUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGlmIChcbiAgICAgIEpTT04uc3RyaW5naWZ5KGV4aXN0aW5nVGFncy5zb3J0KCkpICE9PSBKU09OLnN0cmluZ2lmeShtZXJnZWRUYWdzLnNvcnQoKSlcbiAgICApIHtcbiAgICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVUYWdzSW5Db250ZW50KGNvbnRlbnQsIG1lcmdlZFRhZ3MpO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgIHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuICAgICAgbmV3IE5vdGljZShgVGFncyBtZXJnZWQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmxvZyhgTm8gY2hhbmdlcyBuZWVkZWQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFwcGx5Rm9sZGVyVGFnc1RvTm90ZXMoZm9sZGVyOiBURm9sZGVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY3VycmVudEZvbGRlclRhZ3MgPSB0aGlzLmdldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgpO1xuICAgIGNvbnNvbGUubG9nKGBDdXJyZW50IGZvbGRlciB0YWdzOiAke2N1cnJlbnRGb2xkZXJUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIGlmIChjdXJyZW50Rm9sZGVyVGFncy5sZW5ndGggPT09IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGZvbGRlciBoYXMgbm8gdGFncyB0byBhcHBseS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZXMgPSBmb2xkZXIuY2hpbGRyZW4uZmlsdGVyKFxuICAgICAgKGNoaWxkKTogY2hpbGQgaXMgVEZpbGUgPT4gY2hpbGQgaW5zdGFuY2VvZiBURmlsZVxuICAgICk7XG4gICAgbGV0IHVwZGF0ZWRDb3VudCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgICAgIC8vIEdldCB0aGUgY3VycmVudCBmb2xkZXIncyBleGlzdGluZyB0YWdzIGluIHRoZSBmaWxlXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nRm9sZGVyVGFncyA9IGV4aXN0aW5nVGFncy5maWx0ZXIoKHRhZykgPT5cbiAgICAgICAgICB0aGlzLmdldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgpLmluY2x1ZGVzKHRhZylcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBHZXQgbWFudWFsbHkgYWRkZWQgdGFncyAodGFncyB0aGF0IGFyZW4ndCBmcm9tIHRoZSBmb2xkZXIpXG4gICAgICAgIGNvbnN0IG1hbnVhbFRhZ3MgPSBleGlzdGluZ1RhZ3MuZmlsdGVyKFxuICAgICAgICAgICh0YWcpID0+ICFleGlzdGluZ0ZvbGRlclRhZ3MuaW5jbHVkZXModGFnKVxuICAgICAgICApO1xuXG4gICAgICAgIC8vIENvbWJpbmUgbWFudWFsIHRhZ3Mgd2l0aCBjdXJyZW50IGZvbGRlciB0YWdzXG4gICAgICAgIGNvbnN0IHVwZGF0ZWRUYWdzID0gWy4uLm1hbnVhbFRhZ3MsIC4uLmN1cnJlbnRGb2xkZXJUYWdzXTtcblxuICAgICAgICAvLyBPbmx5IHVwZGF0ZSBpZiB0aGVyZSBhcmUgY2hhbmdlc1xuICAgICAgICBpZiAoXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXhpc3RpbmdUYWdzLnNvcnQoKSkgIT09XG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkodXBkYXRlZFRhZ3Muc29ydCgpKVxuICAgICAgICApIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRXhpc3RpbmcgdGFnczogJHtleGlzdGluZ1RhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBNYW51YWwgdGFnczogJHttYW51YWxUYWdzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCB0YWdzOiAke3VwZGF0ZWRUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgICAgICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVUYWdzSW5Db250ZW50KGNvbnRlbnQsIHVwZGF0ZWRUYWdzKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgdXBkYXRlZENvbnRlbnQpO1xuICAgICAgICAgIHVwZGF0ZWRDb3VudCsrO1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIHRhZ3MgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBObyBjaGFuZ2VzIG5lZWRlZCBmb3IgZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgZmlsZSAke2ZpbGUubmFtZX06YCwgZXJyb3IpO1xuICAgICAgICBuZXcgTm90aWNlKGBFcnJvciB1cGRhdGluZyB0YWdzIGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodXBkYXRlZENvdW50ID4gMCkge1xuICAgICAgbmV3IE5vdGljZShgVXBkYXRlZCB0YWdzIGZvciAke3VwZGF0ZWRDb3VudH0gZmlsZShzKSBpbiAke2ZvbGRlci5uYW1lfWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgTm90aWNlKGBObyBmaWxlcyBuZWVkZWQgdGFnIHVwZGF0ZXMgaW4gJHtmb2xkZXIubmFtZX1gKTtcbiAgICB9XG4gIH1cblxuICAvLyBBZGQgdGhpcyBoZWxwZXIgbWV0aG9kIHRvIGNoZWNrIGlmIGEgdGFnIGlzIHVzZWQgYnkgYW55IGZvbGRlclxuICBwcml2YXRlIGlzQW55Rm9sZGVyVGFnKHRhZzogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5mb2xkZXJUYWdzKS5zb21lKChmb2xkZXJUYWdzKSA9PlxuICAgICAgZm9sZGVyVGFncy5pbmNsdWRlcyh0YWcpXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZVRhZ3NGcm9tRmlsZShmaWxlOiBURmlsZSwgdGFnc1RvUmVtb3ZlOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnNvbGUubG9nKGBSZW1vdmluZyBmb2xkZXIgdGFncyBmcm9tIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIGNvbnNvbGUubG9nKGBUYWdzIHRvIHJlbW92ZTogJHt0YWdzVG9SZW1vdmUuam9pbihcIiwgXCIpfWApO1xuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5leHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQpO1xuXG4gICAgY29uc29sZS5sb2coYEV4aXN0aW5nIHRhZ3M6ICR7ZXhpc3RpbmdUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIC8vIEtlZXAgYWxsIHRhZ3MgdGhhdCBhcmUgbm90IGluIHRhZ3NUb1JlbW92ZVxuICAgIGNvbnN0IHVwZGF0ZWRUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcihcbiAgICAgICh0YWcpID0+ICF0YWdzVG9SZW1vdmUuaW5jbHVkZXModGFnKVxuICAgICk7XG5cbiAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCB0YWdzOiAke3VwZGF0ZWRUYWdzLmpvaW4oXCIsIFwiKX1gKTtcblxuICAgIC8vIFVzZSB1cGRhdGVUYWdzSW5Db250ZW50IHRvIHVwZGF0ZSB0aGUgZmlsZSdzIGNvbnRlbnRcbiAgICBsZXQgdXBkYXRlZENvbnRlbnQ6IHN0cmluZztcbiAgICBpZiAodXBkYXRlZFRhZ3MubGVuZ3RoID4gMCkge1xuICAgICAgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoY29udGVudCwgdXBkYXRlZFRhZ3MpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBubyB0YWdzIHJlbWFpbiwgcmVtb3ZlIHRoZSBlbnRpcmUgWUFNTCBmcm9udCBtYXR0ZXJcbiAgICAgIHVwZGF0ZWRDb250ZW50ID0gdGhpcy5yZW1vdmVZYW1sRnJvbnRNYXR0ZXIoY29udGVudCk7XG4gICAgfVxuXG4gICAgLy8gT25seSBtb2RpZnkgdGhlIGZpbGUgaWYgdGhlIGNvbnRlbnQgaGFzIGNoYW5nZWRcbiAgICBpZiAoY29udGVudCAhPT0gdXBkYXRlZENvbnRlbnQpIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCBjb250ZW50IGZvciBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgIHRoaXMudXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuICAgICAgbmV3IE5vdGljZShgUmVtb3ZlZCBmb2xkZXIgdGFncyBmcm9tIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmxvZyhgTm8gY2hhbmdlcyBuZWVkZWQgZm9yIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgIH1cbiAgfVxuXG4gIHJlbW92ZVlhbWxGcm9udE1hdHRlcihjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbltcXHNcXFNdKj9cXG4tLS1cXG4vO1xuICAgIHJldHVybiBjb250ZW50LnJlcGxhY2UoZnJvbnRtYXR0ZXJSZWdleCwgXCJcIik7XG4gIH1cblxuICBkZXRlY3RDb25mbGljdGluZ1RhZ3MoZmlsZTogVEZpbGUpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcGFyZW50Rm9sZGVycyA9IHRoaXMuZ2V0UGFyZW50Rm9sZGVycyhmaWxlKTtcbiAgICBjb25zdCBhbGxUYWdzID0gcGFyZW50Rm9sZGVycy5mbGF0TWFwKChmb2xkZXIpID0+XG4gICAgICB0aGlzLmdldEZvbGRlclRhZ3MoZm9sZGVyLnBhdGgpXG4gICAgKTtcbiAgICByZXR1cm4gYWxsVGFncy5maWx0ZXIoKHRhZywgaW5kZXgsIHNlbGYpID0+IHNlbGYuaW5kZXhPZih0YWcpICE9PSBpbmRleCk7XG4gIH1cblxuICBnZXRQYXJlbnRGb2xkZXJzKGZpbGU6IFRGaWxlKTogVEZvbGRlcltdIHtcbiAgICBjb25zdCBmb2xkZXJzOiBURm9sZGVyW10gPSBbXTtcbiAgICBsZXQgY3VycmVudEZvbGRlciA9IGZpbGUucGFyZW50O1xuICAgIHdoaWxlIChjdXJyZW50Rm9sZGVyKSB7XG4gICAgICBmb2xkZXJzLnB1c2goY3VycmVudEZvbGRlcik7XG4gICAgICBjdXJyZW50Rm9sZGVyID0gY3VycmVudEZvbGRlci5wYXJlbnQ7XG4gICAgfVxuICAgIHJldHVybiBmb2xkZXJzO1xuICB9XG5cbiAgcHJpdmF0ZSByZW1vdmVEdXBsaWNhdGVUYWdzKHRhZ3M6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldCh0YWdzKV07XG4gIH1cblxuICByZW1vdmVGb2xkZXJJY29ucygpIHtcbiAgICAvLyBDdXJyZW50IGltcGxlbWVudGF0aW9uIG1pZ2h0IG1pc3Mgc29tZSBlbGVtZW50c1xuICAgIC8vIEFkZCBtb3JlIHJvYnVzdCBlbGVtZW50IHNlbGVjdGlvbiBhbmQgY2xlYW51cFxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJmaWxlLWV4cGxvcmVyXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IGZpbGVFeHBsb3JlclZpZXcgPSBsZWFmLnZpZXcgYXMgYW55O1xuICAgICAgY29uc3QgZmlsZUl0ZW1zID0gZmlsZUV4cGxvcmVyVmlldy5maWxlSXRlbXM7XG4gICAgICBmb3IgKGNvbnN0IFssIGl0ZW1dIG9mIE9iamVjdC5lbnRyaWVzKGZpbGVJdGVtcykpIHtcbiAgICAgICAgaWYgKGl0ZW0gJiYgdHlwZW9mIGl0ZW0gPT09IFwib2JqZWN0XCIgJiYgXCJlbFwiIGluIGl0ZW0pIHtcbiAgICAgICAgICBjb25zdCBmb2xkZXJFbCA9IGl0ZW0uZWwgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgY29uc3QgaWNvbkVsID0gZm9sZGVyRWwucXVlcnlTZWxlY3RvcihcIi5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIik7XG4gICAgICAgICAgaWYgKGljb25FbCkge1xuICAgICAgICAgICAgaWNvbkVsLnJlbW92ZUNsYXNzKFwidGFnZ2VkLWZvbGRlclwiKTtcbiAgICAgICAgICAgIGljb25FbC5yZW1vdmVBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIpO1xuICAgICAgICAgICAgLy8gQWxzbyByZW1vdmUgYW55IG90aGVyIGN1c3RvbSBjbGFzc2VzIG9yIGF0dHJpYnV0ZXNcbiAgICAgICAgICAgIGljb25FbC5yZW1vdmVBdHRyaWJ1dGUoXCJkYXRhLXRhZ2l0XCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgaGFuZGxlRmlsZU1vdmVtZW50KGZpbGU6IFRGaWxlKSB7XG4gICAgLy8gQWRkIGRlYm91bmNpbmcgdG8gcHJldmVudCBtdWx0aXBsZSByYXBpZCBmaWxlIG1vdmVtZW50cyBmcm9tIGNhdXNpbmcgaXNzdWVzXG4gICAgaWYgKHRoaXMubW92ZVRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLm1vdmVUaW1lb3V0KTtcbiAgICB9XG4gICAgdGhpcy5tb3ZlVGltZW91dCA9IHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gRXhpc3RpbmcgZmlsZSBtb3ZlbWVudCBsb2dpY1xuICAgIH0sIDMwMCk7XG4gIH1cblxuICBhc3luYyBtaWdyYXRlU2V0dGluZ3Mob2xkRGF0YTogYW55KTogUHJvbWlzZTxUYWdJdFNldHRpbmdzPiB7XG4gICAgY29uc29sZS5sb2coXCJNaWdyYXRpbmcgc2V0dGluZ3MgZnJvbSBvbGQgdmVyc2lvblwiKTtcbiAgICAvLyBGb3Igbm93LCBqdXN0IHJldHVybiB0aGUgZGVmYXVsdCBzZXR0aW5ncyBtZXJnZWQgd2l0aCBhbnkgdmFsaWQgb2xkIHNldHRpbmdzXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLkRFRkFVTFRfU0VUVElOR1MsXG4gICAgICAuLi57XG4gICAgICAgIGluaGVyaXRhbmNlTW9kZTpcbiAgICAgICAgICBvbGREYXRhLmluaGVyaXRhbmNlTW9kZSB8fCBERUZBVUxUX1NFVFRJTkdTLmluaGVyaXRhbmNlTW9kZSxcbiAgICAgICAgZXhjbHVkZWRGb2xkZXJzOlxuICAgICAgICAgIG9sZERhdGEuZXhjbHVkZWRGb2xkZXJzIHx8IERFRkFVTFRfU0VUVElOR1MuZXhjbHVkZWRGb2xkZXJzLFxuICAgICAgICBzaG93Rm9sZGVySWNvbnM6XG4gICAgICAgICAgb2xkRGF0YS5zaG93Rm9sZGVySWNvbnMgfHwgREVGQVVMVF9TRVRUSU5HUy5zaG93Rm9sZGVySWNvbnMsXG4gICAgICAgIGF1dG9BcHBseVRhZ3M6IG9sZERhdGEuYXV0b0FwcGx5VGFncyB8fCBERUZBVUxUX1NFVFRJTkdTLmF1dG9BcHBseVRhZ3MsXG4gICAgICAgIGRlYnVnTW9kZTogb2xkRGF0YS5kZWJ1Z01vZGUgfHwgREVGQVVMVF9TRVRUSU5HUy5kZWJ1Z01vZGUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBhc3luYyBjaGVja0FuZFJlbW92ZUR1cGxpY2F0ZVRhZ3MoZm9sZGVyOiBURm9sZGVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZXMgPSBmb2xkZXIuY2hpbGRyZW4uZmlsdGVyKFxuICAgICAgKGNoaWxkKTogY2hpbGQgaXMgVEZpbGUgPT4gY2hpbGQgaW5zdGFuY2VvZiBURmlsZVxuICAgICk7XG4gICAgbGV0IHByb2Nlc3NlZENvdW50ID0gMDtcbiAgICBsZXQgZHVwbGljYXRlc0ZvdW5kID0gMDtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coYENoZWNraW5nIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcblxuICAgICAgICAvLyBFeHRyYWN0IFlBTUwgZnJvbnQgbWF0dGVyXG4gICAgICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuXG4gICAgICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMuZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcblxuICAgICAgICAgIC8vIENoZWNrIGZvciBkdXBsaWNhdGVzIGJ5IGNvbXBhcmluZyBsZW5ndGhzXG4gICAgICAgICAgY29uc3QgdW5pcXVlVGFncyA9IFsuLi5uZXcgU2V0KGV4aXN0aW5nVGFncyldO1xuXG4gICAgICAgICAgaWYgKHVuaXF1ZVRhZ3MubGVuZ3RoIDwgZXhpc3RpbmdUYWdzLmxlbmd0aCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kIGR1cGxpY2F0ZXMgaW4gZmlsZTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgT3JpZ2luYWwgdGFnczogJHtleGlzdGluZ1RhZ3Muam9pbihcIiwgXCIpfWApO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFVuaXF1ZSB0YWdzOiAke3VuaXF1ZVRhZ3Muam9pbihcIiwgXCIpfWApO1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgbmV3IFlBTUwgZnJvbnQgbWF0dGVyIHdpdGggdW5pcXVlIHRhZ3NcbiAgICAgICAgICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVUYWdzSW5Db250ZW50KFxuICAgICAgICAgICAgICBjb250ZW50LFxuICAgICAgICAgICAgICB1bmlxdWVUYWdzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIHVwZGF0ZWRDb250ZW50KTtcbiAgICAgICAgICAgIGR1cGxpY2F0ZXNGb3VuZCsrO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFJlbW92ZWQgZHVwbGljYXRlIHRhZ3MgZnJvbSBmaWxlOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzc2VkQ291bnQrKztcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgZmlsZSAke2ZpbGUubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChkdXBsaWNhdGVzRm91bmQgPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBgUmVtb3ZlZCBkdXBsaWNhdGVzIGZyb20gJHtkdXBsaWNhdGVzRm91bmR9IG91dCBvZiAke3Byb2Nlc3NlZENvdW50fSBmaWxlcy5gXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgTm90aWNlKGBObyBkdXBsaWNhdGVzIGZvdW5kIGluICR7cHJvY2Vzc2VkQ291bnR9IGZpbGVzLmApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGJhdGNoQ29udmVydElubGluZVRhZ3NUb1lBTUwoZmlsZXM6IFRGaWxlW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgcHJvY2Vzc2VkQ291bnQgPSAwO1xuICAgIGxldCBzdWNjZXNzQ291bnQgPSAwO1xuICAgIGxldCBlcnJvckNvdW50ID0gMDtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChmaWxlLmV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpICE9PSBcIm1kXCIpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIGZpbGU6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcblxuICAgICAgICAvLyBTa2lwIFlBTUwgZnJvbnQgbWF0dGVyIGlmIGl0IGV4aXN0c1xuICAgICAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG5bXFxzXFxTXSo/XFxuLS0tXFxuLztcbiAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRXaXRob3V0WWFtbCA9IGZyb250bWF0dGVyTWF0Y2hcbiAgICAgICAgICA/IGNvbnRlbnQuc2xpY2UoZnJvbnRtYXR0ZXJNYXRjaFswXS5sZW5ndGgpXG4gICAgICAgICAgOiBjb250ZW50O1xuXG4gICAgICAgIC8vIEdldCBmaXJzdCB0aHJlZSBsaW5lcyBhZnRlciBZQU1MXG4gICAgICAgIGNvbnN0IGZpcnN0VGhyZWVMaW5lcyA9IGNvbnRlbnRXaXRob3V0WWFtbC5zcGxpdChcIlxcblwiLCAzKS5qb2luKFwiXFxuXCIpO1xuICAgICAgICBjb25zdCBpbmxpbmVUYWdzID0gZmlyc3RUaHJlZUxpbmVzLm1hdGNoKC8jW15cXHMjXSsvZyk7XG5cbiAgICAgICAgaWYgKCFpbmxpbmVUYWdzKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coXG4gICAgICAgICAgICBgTm8gaW5saW5lIHRhZ3MgZm91bmQgaW4gZmlyc3QgdGhyZWUgbGluZXMgb2Y6ICR7ZmlsZS5uYW1lfWBcbiAgICAgICAgICApO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbmV3VGFncyA9IGlubGluZVRhZ3MubWFwKCh0YWcpID0+IHRhZy5zdWJzdHJpbmcoMSkpO1xuICAgICAgICBjb25zdCBleGlzdGluZ1RhZ3MgPSB0aGlzLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG4gICAgICAgIGNvbnN0IGFsbFRhZ3MgPSBbLi4ubmV3IFNldChbLi4uZXhpc3RpbmdUYWdzLCAuLi5uZXdUYWdzXSldO1xuXG4gICAgICAgIC8vIFJlbW92ZSBpbmxpbmUgdGFncyBmcm9tIGZpcnN0IHRocmVlIGxpbmVzIHdoaWxlIHByZXNlcnZpbmcgWUFNTFxuICAgICAgICBsZXQgdXBkYXRlZENvbnRlbnQgPSBjb250ZW50O1xuICAgICAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnRMaW5lcyA9IGNvbnRlbnRXaXRob3V0WWFtbC5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE1hdGgubWluKDMsIGNvbnRlbnRMaW5lcy5sZW5ndGgpOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnRlbnRMaW5lc1tpXSA9IGNvbnRlbnRMaW5lc1tpXS5yZXBsYWNlKC8jW15cXHMjXSsvZywgXCJcIikudHJpbSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB1cGRhdGVkQ29udGVudCA9XG4gICAgICAgICAgICBmcm9udG1hdHRlck1hdGNoWzBdICsgdGhpcy5jbGVhbkVtcHR5TGluZXMoY29udGVudExpbmVzLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnRMaW5lcyA9IGNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbigzLCBjb250ZW50TGluZXMubGVuZ3RoKTsgaSsrKSB7XG4gICAgICAgICAgICBjb250ZW50TGluZXNbaV0gPSBjb250ZW50TGluZXNbaV0ucmVwbGFjZSgvI1teXFxzI10rL2csIFwiXCIpLnRyaW0oKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB0aGlzLmNsZWFuRW1wdHlMaW5lcyhjb250ZW50TGluZXMuam9pbihcIlxcblwiKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgdGFncyB0byBZQU1MIGZyb250IG1hdHRlclxuICAgICAgICB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlVGFnc0luQ29udGVudCh1cGRhdGVkQ29udGVudCwgYWxsVGFncyk7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCB1cGRhdGVkQ29udGVudCk7XG5cbiAgICAgICAgc3VjY2Vzc0NvdW50Kys7XG4gICAgICAgIGNvbnNvbGUubG9nKGBTdWNjZXNzZnVsbHkgY29udmVydGVkIHRhZ3MgaW46ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBmaWxlICR7ZmlsZS5uYW1lfTpgLCBlcnJvcik7XG4gICAgICAgIGVycm9yQ291bnQrKztcbiAgICAgICAgZXJyb3JzLnB1c2goZmlsZS5uYW1lKTtcbiAgICAgIH1cbiAgICAgIHByb2Nlc3NlZENvdW50Kys7XG4gICAgfVxuXG4gICAgLy8gU2hvdyBzdW1tYXJ5IHBvcHVwXG4gICAgbmV3IEJhdGNoQ29udmVyc2lvblJlc3VsdE1vZGFsKFxuICAgICAgdGhpcy5hcHAsXG4gICAgICBwcm9jZXNzZWRDb3VudCxcbiAgICAgIHN1Y2Nlc3NDb3VudCxcbiAgICAgIGVycm9yQ291bnQsXG4gICAgICBlcnJvcnNcbiAgICApLm9wZW4oKTtcbiAgfVxuXG4gIGFzeW5jIGJhdGNoQ29udmVydFdpdGhDb25maXJtYXRpb24oZmlsZXM6IFRGaWxlW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5zaG93QmF0Y2hDb252ZXJzaW9uV2FybmluZykge1xuICAgICAgbmV3IEJhdGNoQ29udmVyc2lvbldhcm5pbmdNb2RhbCh0aGlzLmFwcCwgZmlsZXMsIHRoaXMpLm9wZW4oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5iYXRjaENvbnZlcnRJbmxpbmVUYWdzVG9ZQU1MKGZpbGVzKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNsZWFuRW1wdHlMaW5lcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBjb250ZW50XG4gICAgICAuc3BsaXQoXCJcXG5cIilcbiAgICAgIC5maWx0ZXIoKGxpbmUsIGluZGV4LCBhcnJheSkgPT4ge1xuICAgICAgICAvLyBLZWVwIG5vbi1lbXB0eSBsaW5lc1xuICAgICAgICBpZiAobGluZS50cmltKCkpIHJldHVybiB0cnVlO1xuICAgICAgICAvLyBLZWVwIHNpbmdsZSBlbXB0eSBsaW5lcyBiZXR3ZWVuIGNvbnRlbnRcbiAgICAgICAgaWYgKGluZGV4ID4gMCAmJiBpbmRleCA8IGFycmF5Lmxlbmd0aCAtIDEpIHtcbiAgICAgICAgICBjb25zdCBwcmV2TGluZSA9IGFycmF5W2luZGV4IC0gMV0udHJpbSgpO1xuICAgICAgICAgIGNvbnN0IG5leHRMaW5lID0gYXJyYXlbaW5kZXggKyAxXS50cmltKCk7XG4gICAgICAgICAgcmV0dXJuIHByZXZMaW5lICYmIG5leHRMaW5lO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pXG4gICAgICAuam9pbihcIlxcblwiKTtcbiAgfVxuXG4gIC8vIEFkZCB0aGlzIG1ldGhvZCB0byB0aGUgVGFnSXRQbHVnaW4gY2xhc3NcbiAgYXN5bmMgYmF0Y2hDb252ZXJ0V2l0aEluaGVyaXRhbmNlKFxuICAgIGZvbGRlcjogVEZvbGRlcixcbiAgICBpbmNsdWRlU3ViZm9sZGVyczogYm9vbGVhblxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBDb2xsZWN0IGFsbCBtYXJrZG93biBmaWxlcyBiYXNlZCBvbiB0aGUgaW5oZXJpdGFuY2Ugb3B0aW9uXG4gICAgY29uc3QgZmlsZXM6IFRGaWxlW10gPSBbXTtcblxuICAgIGNvbnN0IGNvbGxlY3RGaWxlcyA9IChjdXJyZW50Rm9sZGVyOiBURm9sZGVyKSA9PiB7XG4gICAgICBjdXJyZW50Rm9sZGVyLmNoaWxkcmVuLmZvckVhY2goKGNoaWxkKSA9PiB7XG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIFRGaWxlICYmIGNoaWxkLmV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpID09PSBcIm1kXCIpIHtcbiAgICAgICAgICBmaWxlcy5wdXNoKGNoaWxkKTtcbiAgICAgICAgfSBlbHNlIGlmIChjaGlsZCBpbnN0YW5jZW9mIFRGb2xkZXIgJiYgaW5jbHVkZVN1YmZvbGRlcnMpIHtcbiAgICAgICAgICBjb2xsZWN0RmlsZXMoY2hpbGQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgY29sbGVjdEZpbGVzKGZvbGRlcik7XG5cbiAgICAvLyBVc2UgdGhlIGV4aXN0aW5nIGJhdGNoIGNvbnZlcnNpb24gbWV0aG9kXG4gICAgYXdhaXQgdGhpcy5iYXRjaENvbnZlcnRJbmxpbmVUYWdzVG9ZQU1MKGZpbGVzKTtcbiAgfVxuXG4gIHByaXZhdGUgY29udGFpbnNDaGVja2xpc3RJdGVtcyh0ZXh0OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAvLyBDaGVjayBpZiB0aGUgdGV4dCBjb250YWlucyBhdCBsZWFzdCBvbmUgY2hlY2tsaXN0IGl0ZW1cbiAgICBjb25zdCBjaGVja2xpc3RSZWdleCA9IC9eKFxccyopPy0gXFxbKHh8IClcXF0vbTtcbiAgICByZXR1cm4gY2hlY2tsaXN0UmVnZXgudGVzdCh0ZXh0KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlUYWdUb0NoZWNrbGlzdChcbiAgICBlZGl0b3I6IEVkaXRvcixcbiAgICBzZWxlY3Rpb246IHN0cmluZyxcbiAgICB0YWc6IHN0cmluZyxcbiAgICB1cmdlbmN5OiBVcmdlbmN5TGV2ZWxcbiAgKSB7XG4gICAgY29uc3QgbGluZXMgPSBzZWxlY3Rpb24uc3BsaXQoXCJcXG5cIik7XG4gICAgY29uc3QgY2hlY2tsaXN0UmVnZXggPSAvXihcXHMqKT8tIFxcWyh4fCApXFxdLztcblxuICAgIGNvbnN0IHVwZGF0ZWRMaW5lcyA9IGxpbmVzLm1hcCgobGluZSkgPT4ge1xuICAgICAgaWYgKGNoZWNrbGlzdFJlZ2V4LnRlc3QobGluZSkpIHtcbiAgICAgICAgLy8gUmVtb3ZlIGFueSBleGlzdGluZyB0YWdzIGFuZCB1cmdlbmN5IGluZGljYXRvcnNcbiAgICAgICAgY29uc3QgY2xlYW5MaW5lID0gbGluZS5yZXBsYWNlKC8jXFx3K1xccypb8J+fovCfn6Hwn5+g8J+UtOKaqu+4j10/XFxzKiQvLCBcIlwiKS50cmltKCk7XG5cbiAgICAgICAgLy8gQWRkIG5ldyB0YWcgYW5kIHVyZ2VuY3kgKGlmIG5vdCBkZWZhdWx0KVxuICAgICAgICBjb25zdCB1cmdlbmN5RW1vamkgPSB1cmdlbmN5LmVtb2ppICE9PSBcIuKaqu+4j1wiID8gYCAke3VyZ2VuY3kuZW1vaml9YCA6IFwiXCI7XG4gICAgICAgIHJldHVybiBgJHtjbGVhbkxpbmV9ICMke3RhZ30ke3VyZ2VuY3lFbW9qaX1gO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGxpbmU7XG4gICAgfSk7XG5cbiAgICAvLyBSZXBsYWNlIHRoZSBzZWxlY3Rpb24gd2l0aCB1cGRhdGVkIGNvbnRlbnRcbiAgICBlZGl0b3IucmVwbGFjZVNlbGVjdGlvbih1cGRhdGVkTGluZXMuam9pbihcIlxcblwiKSk7XG4gIH1cblxuICAvLyBBZGQgdGhpcyBuZXcgbWV0aG9kIHRvIHRoZSBUYWdJdFBsdWdpbiBjbGFzc1xuICBwcml2YXRlIGFzeW5jIGNoYW5nZUNoZWNrbGlzdFVyZ2VuY3koXG4gICAgZWRpdG9yOiBFZGl0b3IsXG4gICAgc2VsZWN0aW9uOiBzdHJpbmcsXG4gICAgdXJnZW5jeTogVXJnZW5jeUxldmVsXG4gICkge1xuICAgIGNvbnN0IGxpbmVzID0gc2VsZWN0aW9uLnNwbGl0KFwiXFxuXCIpO1xuICAgIGNvbnN0IGNoZWNrbGlzdFJlZ2V4ID0gL14oXFxzKik/LSBcXFsoeHwgKVxcXS87XG4gICAgY29uc3QgdXJnZW5jeVJlZ2V4ID0gL1xccypb8J+fovCfn6Hwn5+g8J+UtOKaqu+4j11cXHMqJC87XG5cbiAgICBjb25zdCB1cGRhdGVkTGluZXMgPSBsaW5lcy5tYXAoKGxpbmUpID0+IHtcbiAgICAgIGlmIChjaGVja2xpc3RSZWdleC50ZXN0KGxpbmUpKSB7XG4gICAgICAgIC8vIEZpcnN0IHJlbW92ZSBhbnkgZXhpc3RpbmcgdXJnZW5jeSBpbmRpY2F0b3JzXG4gICAgICAgIGxldCBjbGVhbkxpbmUgPSBsaW5lO1xuXG4gICAgICAgIC8vIFJlbW92ZSBhbnkgZXhpc3RpbmcgdXJnZW5jeSBlbW9qaXNcbiAgICAgICAgdGhpcy51cmdlbmN5TGV2ZWxzLmZvckVhY2goKGxldmVsKSA9PiB7XG4gICAgICAgICAgY29uc3QgZW1vamlSZWdleCA9IG5ldyBSZWdFeHAoYFxcXFxzKiR7bGV2ZWwuZW1vaml9XFxcXHMqJGApO1xuICAgICAgICAgIGNsZWFuTGluZSA9IGNsZWFuTGluZS5yZXBsYWNlKGVtb2ppUmVnZXgsIFwiXCIpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBUcmltIGFueSB0cmFpbGluZyBzcGFjZXNcbiAgICAgICAgY2xlYW5MaW5lID0gY2xlYW5MaW5lLnJlcGxhY2UoL1xccyskLywgXCJcIik7XG5cbiAgICAgICAgLy8gQWRkIG5ldyB1cmdlbmN5IChpZiBub3QgZGVmYXVsdClcbiAgICAgICAgaWYgKHVyZ2VuY3kuZW1vamkgIT09IFwi4pqq77iPXCIpIHtcbiAgICAgICAgICBjbGVhbkxpbmUgPSBgJHtjbGVhbkxpbmV9ICR7dXJnZW5jeS5lbW9qaX1gO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNsZWFuTGluZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBsaW5lO1xuICAgIH0pO1xuXG4gICAgLy8gUmVwbGFjZSB0aGUgc2VsZWN0aW9uIHdpdGggdXBkYXRlZCBjb250ZW50XG4gICAgZWRpdG9yLnJlcGxhY2VTZWxlY3Rpb24odXBkYXRlZExpbmVzLmpvaW4oXCJcXG5cIikpO1xuICB9XG59XG5cbmNsYXNzIEZvbGRlclRhZ01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBmb2xkZXI6IFRGb2xkZXI7XG4gIHBsdWdpbjogVGFnSXRQbHVnaW47XG4gIGZvbGRlck5hbWVJbnB1dDogVGV4dENvbXBvbmVudDtcbiAgdGFnc0lucHV0OiBUZXh0Q29tcG9uZW50O1xuICB0YWdzOiBzdHJpbmcgPSBcIlwiO1xuICBpc05ld0ZvbGRlcjogYm9vbGVhbjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBmb2xkZXI6IFRGb2xkZXIsXG4gICAgcGx1Z2luOiBUYWdJdFBsdWdpbixcbiAgICBpc05ld0ZvbGRlcjogYm9vbGVhbiA9IGZhbHNlXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5mb2xkZXIgPSBmb2xkZXI7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5pc05ld0ZvbGRlciA9IGlzTmV3Rm9sZGVyO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIkFkZC9FZGl0IEZvbGRlciBUYWdzXCIgfSk7XG5cbiAgICAvLyBGb2xkZXIgbmFtZSBmaWVsZFxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuc2V0TmFtZShcIkZvbGRlciBOYW1lXCIpLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgIHRoaXMuZm9sZGVyTmFtZUlucHV0ID0gdGV4dDtcbiAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5mb2xkZXIubmFtZSk7XG4gICAgICB0ZXh0LmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgdGhpcy5oYW5kbGVFbnRlci5iaW5kKHRoaXMpKTtcbiAgICAgIHJldHVybiB0ZXh0O1xuICAgIH0pO1xuXG4gICAgLy8gVGFncyBmaWVsZFxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuc2V0TmFtZShcIlRhZ3NcIikuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgdGhpcy50YWdzSW5wdXQgPSB0ZXh0O1xuICAgICAgY29uc3QgZXhpc3RpbmdUYWdzID0gdGhpcy5wbHVnaW4uZ2V0Rm9sZGVyVGFncyh0aGlzLmZvbGRlci5wYXRoKTtcbiAgICAgIHRoaXMudGFncyA9IGV4aXN0aW5nVGFncy5qb2luKFwiLCBcIik7XG4gICAgICB0ZXh0LnNldFZhbHVlKHRoaXMudGFncyk7XG4gICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiRW50ZXIgdGFncywgY29tbWEtc2VwYXJhdGVkXCIpLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICB0aGlzLnRhZ3MgPSB2YWx1ZTtcbiAgICAgIH0pO1xuICAgICAgdGV4dC5pbnB1dEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIHRoaXMuaGFuZGxlRW50ZXIuYmluZCh0aGlzKSk7XG4gICAgICByZXR1cm4gdGV4dDtcbiAgICB9KTtcblxuICAgIC8vIENhbmNlbCBhbmQgU2F2ZSBidXR0b25zIChvcmRlciBzd2FwcGVkKVxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlNhdmVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNhdmVGb2xkZXJUYWdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cblxuICBoYW5kbGVFbnRlcihldmVudDogS2V5Ym9hcmRFdmVudCkge1xuICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZXZlbnQuc2hpZnRLZXkpIHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICB0aGlzLnNhdmVGb2xkZXJUYWdzKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2F2ZUZvbGRlclRhZ3MoKSB7XG4gICAgY29uc3QgbmV3Rm9sZGVyTmFtZSA9IHRoaXMuZm9sZGVyTmFtZUlucHV0LmdldFZhbHVlKCk7XG4gICAgbGV0IGZvbGRlclBhdGggPSB0aGlzLmZvbGRlci5wYXRoO1xuXG4gICAgaWYgKG5ld0ZvbGRlck5hbWUgIT09IHRoaXMuZm9sZGVyLm5hbWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG5ld1BhdGggPSB0aGlzLmZvbGRlci5wYXJlbnRcbiAgICAgICAgICA/IGAke3RoaXMuZm9sZGVyLnBhcmVudC5wYXRofS8ke25ld0ZvbGRlck5hbWV9YFxuICAgICAgICAgIDogbmV3Rm9sZGVyTmFtZTtcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIucmVuYW1lRmlsZSh0aGlzLmZvbGRlciwgbmV3UGF0aCk7XG4gICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgIGBSZW5hbWVkIGZvbGRlciBmcm9tICR7dGhpcy5mb2xkZXIubmFtZX0gdG8gJHtuZXdGb2xkZXJOYW1lfWBcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBXYWl0IGZvciBhIHNob3J0IHRpbWUgdG8gYWxsb3cgdGhlIGZpbGUgc3lzdGVtIHRvIHVwZGF0ZVxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTtcblxuICAgICAgICAvLyBVcGRhdGUgZm9sZGVyIHJlZmVyZW5jZSBhbmQgcGF0aFxuICAgICAgICBjb25zdCBuZXdGb2xkZXIgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobmV3UGF0aCk7XG4gICAgICAgIGlmIChuZXdGb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICAgICAgdGhpcy5mb2xkZXIgPSBuZXdGb2xkZXI7XG4gICAgICAgICAgZm9sZGVyUGF0aCA9IG5ld1BhdGg7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgICAgYENvdWxkIG5vdCBnZXQgbmV3IGZvbGRlciBvYmplY3QsIHVzaW5nIG5ldyBwYXRoOiAke25ld1BhdGh9YFxuICAgICAgICAgICk7XG4gICAgICAgICAgZm9sZGVyUGF0aCA9IG5ld1BhdGg7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byByZW5hbWUgZm9sZGVyOiAke2Vycm9yfWApO1xuICAgICAgICBuZXcgTm90aWNlKGBGYWlsZWQgdG8gcmVuYW1lIGZvbGRlcjogJHtlcnJvcn1gKTtcbiAgICAgICAgLy8gQ29udGludWUgd2l0aCB0aGUgb3JpZ2luYWwgZm9sZGVyIG5hbWUgYW5kIHBhdGhcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBFbnN1cmUgZm9sZGVyUGF0aCBkb2Vzbid0IHN0YXJ0IHdpdGggJy8vJ1xuICAgIGZvbGRlclBhdGggPSBmb2xkZXJQYXRoLnJlcGxhY2UoL15cXC8rLywgXCJcIik7XG5cbiAgICBjb25zdCB0YWdBcnJheSA9IHRoaXMudGFnc1xuICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgLm1hcCgodGFnKSA9PiB0YWcudHJpbSgpKVxuICAgICAgLmZpbHRlcigodGFnKSA9PiB0YWcgIT09IFwiXCIpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIG51bWJlci1vbmx5IHRhZ3NcbiAgICBjb25zdCBudW1iZXJPbmx5VGFncyA9IHRhZ0FycmF5LmZpbHRlcigodGFnKSA9PiAvXlxcZCskLy50ZXN0KHRhZykpO1xuICAgIGlmIChudW1iZXJPbmx5VGFncy5sZW5ndGggPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBgRXJyb3I6IE51bWJlci1vbmx5IHRhZ3MgYXJlIG5vdCBhbGxvd2VkLiBQbGVhc2UgcmVtb3ZlOiAke251bWJlck9ubHlUYWdzLmpvaW4oXG4gICAgICAgICAgXCIsIFwiXG4gICAgICAgICl9YFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnBsdWdpbi5zZXRGb2xkZXJUYWdzKGZvbGRlclBhdGgsIHRhZ0FycmF5KTtcbiAgICBjb25zb2xlLmxvZyhgU2F2ZWQgdGFncyBmb3IgZm9sZGVyICR7Zm9sZGVyUGF0aH06ICR7dGFnQXJyYXkuam9pbihcIiwgXCIpfWApO1xuICAgIG5ldyBOb3RpY2UoYFRhZ3Mgc2F2ZWQgZm9yIGZvbGRlcjogJHtmb2xkZXJQYXRofWApO1xuXG4gICAgaWYgKHRoaXMuaXNOZXdGb2xkZXIpIHtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5Rm9sZGVyVGFnc1RvQ29udGVudHModGhpcy5mb2xkZXIpO1xuICAgICAgY29uc29sZS5sb2coYEFwcGxpZWQgdGFncyB0byBjb250ZW50cyBvZiBuZXcgZm9sZGVyOiAke2ZvbGRlclBhdGh9YCk7XG4gICAgfVxuXG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBUYWdJdFNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBUYWdJdFBsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBUYWdJdFBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgLy8gQWRkIGxvZ28gY29udGFpbmVyIHdpdGggc3BlY2lmaWMgc3R5bGluZ1xuICAgIGNvbnN0IGxvZ29Db250YWluZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoXCJ0YWdpdC1sb2dvLWNvbnRhaW5lclwiKTtcbiAgICBsb2dvQ29udGFpbmVyLmlubmVySFRNTCA9IGBcbiAgICAgIDxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOiBjZW50ZXI7IG1hcmdpbi1ib3R0b206IDJlbTtcIj5cbiAgICAgICAgPHN2ZyB3aWR0aD1cIjUyXCIgaGVpZ2h0PVwiMjFcIiB2aWV3Qm94PVwiMCAwIDUyIDIxXCIgZmlsbD1cIm5vbmVcIiB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCI+IFxuICAgICAgICAgIDxwYXRoIGZpbGwtcnVsZT1cImV2ZW5vZGRcIiBjbGlwLXJ1bGU9XCJldmVub2RkXCIgZD1cIk0xLjA0NzYzIDQuMTUwOEMwLjM4MjY4OCA0LjcyMDc1IDAgNS41NTI4IDAgNi40Mjg1N1YxNy4wNDg4QzAgMTguNzA1NiAxLjM0MzE1IDIwLjA0ODggMyAyMC4wNDg4SDExQzEyLjY1NjkgMjAuMDQ4OCAxNCAxOC43MDU2IDE0IDE3LjA0ODhWNi40Mjg1N0MxNCA1LjU1MjggMTMuNjE3MyA0LjcyMDc1IDEyLjk1MjQgNC4xNTA4TDguOTUyMzcgMC43MjIyM0M3LjgyODkxIC0wLjI0MDc0MyA2LjE3MTEgLTAuMjQwNzQ0IDUuMDQ3NjMgMC43MjIyM0wxLjA0NzYzIDQuMTUwOFpNNy4xMDMxOCAxMy42MDkyTDYuNjc1NjggMTYuMDQ4OEg4LjY0NzA2TDkuMDc4MDEgMTMuNjA5MkgxMC41NTQ4VjExLjk2NTlIOS4zNjgyOUw5LjU0OTE1IDEwLjk0MkgxMVY5LjMxMTQxSDkuODM3MkwxMC4yMzY5IDcuMDQ4NzdIOC4yNTI3OEw3Ljg1NjI5IDkuMzExNDFINi44NDJMNy4yMzUyOSA3LjA0ODc3SDUuMjc2NjNMNC44NzY5NCA5LjMxMTQxSDMuNDU3ODdWMTAuOTQySDQuNTg4OUw0LjQwODAzIDExLjk2NTlIM1YxMy42MDkySDQuMTE3NzVMMy42ODY4IDE2LjA0ODhINS42NzA5MUw2LjA5NDk2IDEzLjYwOTJINy4xMDMxOFpNNy4zOTExMyAxMS45NjU5TDcuNTcwNTUgMTAuOTQySDYuNTU4NTZMNi4zODA1OSAxMS45NjU5SDcuMzkxMTNaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTM1LjY5ODMgMTUuNDQyNEMzNS4xMTQzIDE1LjQ0MjQgMzQuNTk0MyAxNS4zMzQ0IDM0LjEzODMgMTUuMTE4NEMzMy42OTAzIDE0LjkwMjQgMzMuMzMwMyAxNC41OTg0IDMzLjA1ODMgMTQuMjA2NEwzMy43NTQzIDEzLjQ5ODRDMzMuOTg2MyAxMy43OTQ0IDM0LjI2MjMgMTQuMDE4NCAzNC41ODIzIDE0LjE3MDRDMzQuOTAyMyAxNC4zMzA0IDM1LjI4MjMgMTQuNDEwNCAzNS43MjIzIDE0LjQxMDRDMzYuMzA2MyAxNC40MTA0IDM2Ljc2NjMgMTQuMjU0NCAzNy4xMDIzIDEzLjk0MjRDMzcuNDQ2MyAxMy42Mzg0IDM3LjYxODMgMTMuMjI2NCAzNy42MTgzIDEyLjcwNjRWMTEuMjkwNEwzNy44MTAzIDEwLjAwNjRMMzcuNjE4MyA4LjczNDM4VjcuMjM0MzhIMzguNjk4M1YxMi43MDY0QzM4LjY5ODMgMTMuMjUwNCAzOC41NzAzIDEzLjcyNjQgMzguMzE0MyAxNC4xMzQ0QzM4LjA2NjMgMTQuNTQyNCAzNy43MTQzIDE0Ljg2MjQgMzcuMjU4MyAxNS4wOTQ0QzM2LjgxMDMgMTUuMzI2NCAzNi4yOTAzIDE1LjQ0MjQgMzUuNjk4MyAxNS40NDI0Wk0zNS42OTgzIDEyLjgzODRDMzUuMTc4MyAxMi44Mzg0IDM0LjcxMDMgMTIuNzE0NCAzNC4yOTQzIDEyLjQ2NjRDMzMuODg2MyAxMi4yMTg0IDMzLjU2MjMgMTEuODc4NCAzMy4zMjIzIDExLjQ0NjRDMzMuMDgyMyAxMS4wMDY0IDMyLjk2MjMgMTAuNTE0NCAzMi45NjIzIDkuOTcwMzhDMzIuOTYyMyA5LjQyNjM4IDMzLjA4MjMgOC45NDIzOCAzMy4zMjIzIDguNTE4MzhDMzMuNTYyMyA4LjA4NjM4IDMzLjg4NjMgNy43NDYzOCAzNC4yOTQzIDcuNDk4MzhDMzQuNzEwMyA3LjI0MjM4IDM1LjE3ODMgNy4xMTQzOCAzNS42OTgzIDcuMTE0MzhDMzYuMTQ2MyA3LjExNDM4IDM2LjU0MjMgNy4yMDIzOCAzNi44ODYzIDcuMzc4MzhDMzcuMjMwMyA3LjU1NDM4IDM3LjUwMjMgNy44MDIzOCAzNy43MDIzIDguMTIyMzhDMzcuOTEwMyA4LjQzNDM4IDM4LjAyMjMgOC44MDIzOCAzOC4wMzgzIDkuMjI2MzhWMTAuNzM4NEMzOC4wMTQzIDExLjE1NDQgMzcuODk4MyAxMS41MjI0IDM3LjY5MDMgMTEuODQyNEMzNy40OTAzIDEyLjE1NDQgMzcuMjE4MyAxMi4zOTg0IDM2Ljg3NDMgMTIuNTc0NEMzNi41MzAzIDEyLjc1MDQgMzYuMTM4MyAxMi44Mzg0IDM1LjY5ODMgMTIuODM4NFpNMzUuOTE0MyAxMS44MTg0QzM2LjI2NjMgMTEuODE4NCAzNi41NzQzIDExLjc0MjQgMzYuODM4MyAxMS41OTA0QzM3LjExMDMgMTEuNDM4NCAzNy4zMTgzIDExLjIyNjQgMzcuNDYyMyAxMC45NTQ0QzM3LjYwNjMgMTAuNjc0NCAzNy42NzgzIDEwLjM1MDQgMzcuNjc4MyA5Ljk4MjM4QzM3LjY3ODMgOS42MTQzOCAzNy42MDIzIDkuMjk0MzggMzcuNDUwMyA5LjAyMjM4QzM3LjMwNjMgOC43NDIzOCAzNy4xMDIzIDguNTI2MzggMzYuODM4MyA4LjM3NDM4QzM2LjU3NDMgOC4yMTQzOCAzNi4yNjIzIDguMTM0MzggMzUuOTAyMyA4LjEzNDM4QzM1LjU0MjMgOC4xMzQzOCAzNS4yMjYzIDguMjE0MzggMzQuOTU0MyA4LjM3NDM4QzM0LjY4MjMgOC41MjYzOCAzNC40NjYzIDguNzQyMzggMzQuMzA2MyA5LjAyMjM4QzM0LjE1NDMgOS4yOTQzOCAzNC4wNzgzIDkuNjEwMzggMzQuMDc4MyA5Ljk3MDM4QzM0LjA3ODMgMTAuMzMwNCAzNC4xNTQzIDEwLjY1MDQgMzQuMzA2MyAxMC45MzA0QzM0LjQ2NjMgMTEuMjEwNCAzNC42ODIzIDExLjQzMDQgMzQuOTU0MyAxMS41OTA0QzM1LjIzNDMgMTEuNzQyNCAzNS41NTQzIDExLjgxODQgMzUuOTE0MyAxMS44MTg0WlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk0yOC43NzQgMTMuMDU0NEMyOC4yNTQgMTMuMDU0NCAyNy43ODIgMTIuOTI2NCAyNy4zNTggMTIuNjcwNEMyNi45MzQgMTIuNDA2NCAyNi41OTggMTIuMDUwNCAyNi4zNSAxMS42MDI0QzI2LjExIDExLjE1NDQgMjUuOTkgMTAuNjUwNCAyNS45OSAxMC4wOTA0QzI1Ljk5IDkuNTMwMzggMjYuMTEgOS4wMjYzOCAyNi4zNSA4LjU3ODM4QzI2LjU5OCA4LjEzMDM4IDI2LjkzIDcuNzc0MzggMjcuMzQ2IDcuNTEwMzhDMjcuNzcgNy4yNDYzOCAyOC4yNDYgNy4xMTQzOCAyOC43NzQgNy4xMTQzOEMyOS4yMDYgNy4xMTQzOCAyOS41OSA3LjIwNjM4IDI5LjkyNiA3LjM5MDM4QzMwLjI3IDcuNTY2MzggMzAuNTQ2IDcuODE0MzggMzAuNzU0IDguMTM0MzhDMzAuOTYyIDguNDQ2MzggMzEuMDc4IDguODEwMzggMzEuMTAyIDkuMjI2MzhWMTAuOTQyNEMzMS4wNzggMTEuMzUwNCAzMC45NjIgMTEuNzE0NCAzMC43NTQgMTIuMDM0NEMzMC41NTQgMTIuMzU0NCAzMC4yODIgMTIuNjA2NCAyOS45MzggMTIuNzkwNEMzOS42MDIgMTIuOTY2NCAyOS4yMTQgMTMuMDU0NCAyOC43NzQgMTMuMDU0NFpNMjguOTU0IDEyLjAzNDRDMjkuNDkgMTIuMDM0NCAyOS45MjIgMTEuODU0NCAzMC4yNSAxMS40OTQ0QzMwLjU3OCAxMS4xMjY0IDMwLjc0MiAxMC42NTg0IDMwLjc0MiAxMC4wOTA0QzMwLjc0MiA5LjY5ODM4IDMwLjY2NiA5LjM1ODM4IDMwLjUxNCA5LjA3MDM4QzMwLjM3IDguNzc0MzggMzAuMTYyIDguNTQ2MzggMjkuODkgOC4zODYzOEMyOS42MTggOC4yMTgzOCAyOS4zMDIgOC4xMzQzOCAyOC45NDIgOC4xMzQzOEMyOC41ODIgOC4xMzQzOCAyOC4yNjIgOC4yMTgzOCAyNy45ODIgOC4zODYzOEMyNy43MSA4LjU1NDM4IDI3LjQ5NCA4Ljc4NjM4IDI3LjMzNCA5LjA4MjM4QzI3LjE4MiA5LjM3MDM4IDI3LjEwNiA5LjcwMjM4IDI3LjEwNiAxMC4wNzg0QzI3LjEwNiAxMC40NjI0IDI3LjE4MiAxMC44MDI0IDI3LjMzNCAxMS4wOTg0QzI3LjQ5NCAxMS4zODY0IDI3LjcxNCAxMS42MTQ0IDI3Ljk5NCAxMS43ODI0QzI4LjI3NCAxMS45NTA0IDI4LjU5NCAxMi4wMzQ0IDI4Ljk1NCAxMi4wMzQ0Wk0zMC42NyAxMi45MzQ0VjExLjM5ODRMMzAuODc0IDEwLjAwNjRMMzAuNjcgOC42MjYzOFY3LjIzNDM4SDMxLjc2MlYxMi45MzQ0SDMwLjY3WlwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk0yMi44MzIgMTIuOTM0NFY0Ljg0NjM4SDIzLjk2VjEyLjkzNDRIMjIuODMyWk0yMCA1LjYzODM4VjQuNjA2MzhIMjYuNzhWNS42MzgzOEgyMFpcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNDAuNjk4MyAxMi45OTY0VjQuNDUyMzlINDMuMDk4M1YxMi45OTY0SDQwLjY5ODNaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQ2LjY1NDMgMTIuOTk2NFY0LjQ1MjM5SDQ5LjA1NDNWMTIuOTk2NEg0Ni42NTQzWk00NC4wOTgzIDYuNDkyMzlWNC40NTIzOUg1MS42MjIzVjYuNDkyMzlINDQuMDk4M1pcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvZGl2PlxuICAgIGA7XG5cbiAgICAvLyBSZXN0IG9mIHlvdXIgc2V0dGluZ3MgY29kZS4uLlxuXG4gICAgLy8gUmVzdCBvZiB5b3VyIHNldHRpbmdzLi4uXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlRhZyBJbmhlcml0YW5jZSBNb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSBob3cgdGFncyBhcmUgaW5oZXJpdGVkIGluIG5lc3RlZCBmb2xkZXJzXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJub25lXCIsIFwiTm8gaW5oZXJpdGFuY2VcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiaW1tZWRpYXRlXCIsIFwiSW5oZXJpdCBmcm9tIGltbWVkaWF0ZSBwYXJlbnRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiYWxsXCIsIFwiSW5oZXJpdCBmcm9tIGFsbCBwYXJlbnRzXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmluaGVyaXRhbmNlTW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmhlcml0YW5jZU1vZGUgPSB2YWx1ZSBhc1xuICAgICAgICAgICAgICB8IFwibm9uZVwiXG4gICAgICAgICAgICAgIHwgXCJpbW1lZGlhdGVcIlxuICAgICAgICAgICAgICB8IFwiYWxsXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFeGNsdWRlZCBGb2xkZXJzXCIpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgXCJFbnRlciBmb2xkZXIgcGF0aHMgdG8gZXhjbHVkZSBmcm9tIHRhZyBpbmhlcml0YW5jZSAob25lIHBlciBsaW5lKVwiXG4gICAgICApXG4gICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJmb2xkZXIxXFxuZm9sZGVyMi9zdWJmb2xkZXJcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZXhjbHVkZWRGb2xkZXJzLmpvaW4oXCJcXG5cIikpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZXhjbHVkZWRGb2xkZXJzID0gdmFsdWVcbiAgICAgICAgICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAgICAgICAgIC5maWx0ZXIoKGYpID0+IGYudHJpbSgpICE9PSBcIlwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlNob3cgRm9sZGVyIEljb25zXCIpXG4gICAgICAuc2V0RGVzYyhcIkRpc3BsYXkgaWNvbnMgbmV4dCB0byBmb2xkZXJzIHdpdGggdGFnc1wiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGVcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd0ZvbGRlckljb25zKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dGb2xkZXJJY29ucyA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4udXBkYXRlRm9sZGVySWNvbnMoKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlbW92ZUZvbGRlckljb25zKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQXV0by1hcHBseSBUYWdzXCIpXG4gICAgICAuc2V0RGVzYyhcIkF1dG9tYXRpY2FsbHkgYXBwbHkgZm9sZGVyIHRhZ3MgdG8gbmV3IGZpbGVzXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvQXBwbHlUYWdzKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9BcHBseVRhZ3MgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkRlYnVnIE1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiRW5hYmxlIGRldGFpbGVkIGxvZ2dpbmcgZm9yIHRyb3VibGVzaG9vdGluZ1wiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGVcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVidWdNb2RlKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlYnVnTW9kZSA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICAvLyBBZGQgdGhpcyBuZXcgc2V0dGluZyBzZWN0aW9uXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkJhdGNoIENvbnZlcnNpb24gV2FybmluZ1wiKVxuICAgICAgLnNldERlc2MoXCJSZS1lbmFibGUgdGhlIHdhcm5pbmcgd2hlbiBjb252ZXJ0aW5nIGlubGluZSB0YWdzIHRvIFlBTUxcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJSZXNldCBXYXJuaW5nXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dCYXRjaENvbnZlcnNpb25XYXJuaW5nID0gdHJ1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQmF0Y2ggY29udmVyc2lvbiB3YXJuaW5nIGhhcyBiZWVuIHJlLWVuYWJsZWRcIik7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIk5ldyBGb2xkZXIgTW9kYWxcIilcbiAgICAgIC5zZXREZXNjKFwiU2hvdyB0YWcgbW9kYWwgd2hlbiBjcmVhdGluZyBuZXcgZm9sZGVyc1wiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGVcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd05ld0ZvbGRlck1vZGFsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dOZXdGb2xkZXJNb2RhbCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cblxuY2xhc3MgQ29uZmlybWF0aW9uTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIG9uQ29uZmlybTogKCkgPT4gdm9pZDtcbiAgbWVzc2FnZTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBtZXNzYWdlOiBzdHJpbmcsIG9uQ29uZmlybTogKCkgPT4gdm9pZCkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogdGhpcy5tZXNzYWdlIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldENsYXNzKFwidGFnaXQtYnV0dG9uLWNvbnRhaW5lclwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuOiBCdXR0b25Db21wb25lbnQpID0+IHtcbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuYWRkQnV0dG9uKChidG46IEJ1dHRvbkNvbXBvbmVudCkgPT4ge1xuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNvbmZpcm1cIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICB0aGlzLm9uQ29uZmlybSgpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbmNsYXNzIFRhZ1NlbGVjdGlvbk1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICB0YWdzOiBzdHJpbmdbXTtcbiAgb25Db25maXJtOiAoc2VsZWN0ZWRUYWdzOiBzdHJpbmdbXSkgPT4gdm9pZDtcbiAgbWVzc2FnZTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICB0YWdzOiBzdHJpbmdbXSxcbiAgICBvbkNvbmZpcm06IChzZWxlY3RlZFRhZ3M6IHN0cmluZ1tdKSA9PiB2b2lkXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICB0aGlzLnRhZ3MgPSB0YWdzO1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgLy8gU3RhbmRhcmRpemUgaGVhZGVyIHN0eWxlXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIlNlbGVjdCBUYWdzXCIgfSk7XG5cbiAgICAvLyBBZGQgY29uc2lzdGVudCBzcGFjaW5nXG4gICAgY29uc3QgbW9kYWxDb250ZW50ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0YWdpdC1tb2RhbC1jb250ZW50XCIgfSk7XG4gICAgbW9kYWxDb250ZW50LmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiB0aGlzLm1lc3NhZ2UsXG4gICAgICBjbHM6IFwidGFnaXQtZGVzY3JpcHRpb25cIixcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSB0YWcgY29udGFpbmVyIHdpdGggY29uc2lzdGVudCBzdHlsaW5nXG4gICAgY29uc3QgdGFnQ29udGFpbmVyID0gbW9kYWxDb250ZW50LmNyZWF0ZURpdihcInRhZ2l0LXRhZy1jb250YWluZXJcIik7XG4gICAgdGhpcy50YWdzLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgY29uc3QgdGFnRWwgPSB0YWdDb250YWluZXIuY3JlYXRlRWwoXCJkaXZcIiwgeyBjbHM6IFwidGFnaXQtdGFnXCIgfSk7XG4gICAgICB0YWdFbC5jcmVhdGVTcGFuKHsgdGV4dDogdGFnIH0pO1xuICAgICAgY29uc3QgcmVtb3ZlQnV0dG9uID0gdGFnRWwuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgICB0ZXh0OiBcIsOXXCIsXG4gICAgICAgIGNsczogXCJ0YWdpdC10YWctcmVtb3ZlXCIsXG4gICAgICB9KTtcbiAgICAgIHJlbW92ZUJ1dHRvbi5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgICB0aGlzLnRhZ3MgPSB0aGlzLnRhZ3MuZmlsdGVyKCh0KSA9PiB0ICE9PSB0YWcpO1xuICAgICAgICB0YWdFbC5yZW1vdmUoKTtcbiAgICAgIH07XG4gICAgfSk7XG5cbiAgICAvLyBTdGFuZGFyZGl6ZSBidXR0b24gY29udGFpbmVyXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldENsYXNzKFwidGFnaXQtYnV0dG9uLWNvbnRhaW5lclwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuOiBCdXR0b25Db21wb25lbnQpID0+IHtcbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuYWRkQnV0dG9uKChidG46IEJ1dHRvbkNvbXBvbmVudCkgPT4ge1xuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNvbmZpcm1cIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICB0aGlzLm9uQ29uZmlybSh0aGlzLnRhZ3MpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuY2xhc3MgRmlsZU1vdmVkTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZpbGU6IFRGaWxlO1xuICBvbGRUYWdzOiBzdHJpbmdbXTtcbiAgbmV3VGFnczogc3RyaW5nW107XG4gIHBsdWdpbjogVGFnSXRQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgZmlsZTogVEZpbGUsXG4gICAgb2xkVGFnczogc3RyaW5nW10sXG4gICAgbmV3VGFnczogc3RyaW5nW10sXG4gICAgcGx1Z2luOiBUYWdJdFBsdWdpblxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gICAgdGhpcy5vbGRUYWdzID0gb2xkVGFncztcbiAgICB0aGlzLm5ld1RhZ3MgPSBuZXdUYWdzO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIkZpbGUgTW92ZWRcIiB9KTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIHRleHQ6IGBGaWxlIFwiJHt0aGlzLmZpbGUubmFtZX1cIiBoYXMgYmVlbiBtb3ZlZC5gLFxuICAgIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIkhvdyB3b3VsZCB5b3UgbGlrZSB0byBoYW5kbGUgdGhlIHRhZ3M/XCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlJlcGxhY2UgQWxsXCIpXG4gICAgICAuc2V0RGVzYyhcIlJlcGxhY2UgYWxsIGV4aXN0aW5nIHRhZ3Mgd2l0aCBuZXcgZm9sZGVyIHRhZ3NcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJSZXBsYWNlIEFsbFwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlcGxhY2VBbGxUYWdzKHRoaXMuZmlsZSwgdGhpcy5uZXdUYWdzKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiTWVyZ2VcIilcbiAgICAgIC5zZXREZXNjKFwiS2VlcCBleGlzdGluZyB0YWdzIGFuZCBhZGQgbmV3IGZvbGRlciB0YWdzXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiTWVyZ2VcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5tZXJnZVRhZ3ModGhpcy5maWxlLCB0aGlzLm9sZFRhZ3MsIHRoaXMubmV3VGFncyk7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIk5vIEFjdGlvblwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIHRhZ3MgYXMgdGhleSBhcmVcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJObyBBY3Rpb25cIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuY2xhc3MgQ29uZmxpY3RSZXNvbHV0aW9uTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZpbGU6IFRGaWxlO1xuICBjb25mbGljdGluZ1RhZ3M6IHN0cmluZ1tdO1xuICBwbHVnaW46IFRhZ0l0UGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIGZpbGU6IFRGaWxlLFxuICAgIGNvbmZsaWN0aW5nVGFnczogc3RyaW5nW10sXG4gICAgcGx1Z2luOiBUYWdJdFBsdWdpblxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuZmlsZSA9IGZpbGU7XG4gICAgdGhpcy5jb25mbGljdGluZ1RhZ3MgPSBjb25mbGljdGluZ1RhZ3M7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiVGFnIENvbmZsaWN0IERldGVjdGVkXCIgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBgVGhlIGZvbGxvd2luZyB0YWdzIGFyZSBhc3NpZ25lZCBieSBtdWx0aXBsZSBwYXJlbnQgZm9sZGVyczpgLFxuICAgIH0pO1xuXG4gICAgY29uc3QgdGFnTGlzdCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInVsXCIpO1xuICAgIHRoaXMuY29uZmxpY3RpbmdUYWdzLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgdGFnTGlzdC5jcmVhdGVFbChcImxpXCIsIHsgdGV4dDogdGFnIH0pO1xuICAgIH0pO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcIkhvdyB3b3VsZCB5b3UgbGlrZSB0byBoYW5kbGUgdGhlc2UgY29uZmxpY3RzP1wiLFxuICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIEFsbFwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIGFsbCBpbnN0YW5jZXMgb2YgY29uZmxpY3RpbmcgdGFnc1wiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIktlZXAgQWxsXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlQ29uZmxpY3QoXCJrZWVwQWxsXCIpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIE9uZVwiKVxuICAgICAgLnNldERlc2MoXCJLZWVwIG9ubHkgb25lIGluc3RhbmNlIG9mIGVhY2ggY29uZmxpY3RpbmcgdGFnXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiS2VlcCBPbmVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVDb25mbGljdChcImtlZXBPbmVcIik7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIlJlbW92ZSBBbGxcIilcbiAgICAgIC5zZXREZXNjKFwiUmVtb3ZlIGFsbCBpbnN0YW5jZXMgb2YgY29uZmxpY3RpbmcgdGFnc1wiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlbW92ZSBBbGxcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVDb25mbGljdChcInJlbW92ZUFsbFwiKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIGFzeW5jIHJlc29sdmVDb25mbGljdChyZXNvbHV0aW9uOiBcImtlZXBBbGxcIiB8IFwia2VlcE9uZVwiIHwgXCJyZW1vdmVBbGxcIikge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLnBsdWdpbi5hcHAudmF1bHQucmVhZCh0aGlzLmZpbGUpO1xuICAgIGNvbnN0IGV4aXN0aW5nVGFncyA9IHRoaXMucGx1Z2luLmV4dHJhY3RUYWdzRnJvbUNvbnRlbnQoY29udGVudCk7XG4gICAgbGV0IHVwZGF0ZWRUYWdzOiBzdHJpbmdbXTtcblxuICAgIHN3aXRjaCAocmVzb2x1dGlvbikge1xuICAgICAgY2FzZSBcImtlZXBBbGxcIjpcbiAgICAgICAgdXBkYXRlZFRhZ3MgPSBleGlzdGluZ1RhZ3M7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcImtlZXBPbmVcIjpcbiAgICAgICAgdXBkYXRlZFRhZ3MgPSBbLi4ubmV3IFNldChleGlzdGluZ1RhZ3MpXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwicmVtb3ZlQWxsXCI6XG4gICAgICAgIHVwZGF0ZWRUYWdzID0gZXhpc3RpbmdUYWdzLmZpbHRlcihcbiAgICAgICAgICAodGFnKSA9PiAhdGhpcy5jb25mbGljdGluZ1RhZ3MuaW5jbHVkZXModGFnKVxuICAgICAgICApO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMucGx1Z2luLnVwZGF0ZVRhZ3NJbkNvbnRlbnQoXG4gICAgICBjb250ZW50LFxuICAgICAgdXBkYXRlZFRhZ3NcbiAgICApO1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcC52YXVsdC5tb2RpZnkodGhpcy5maWxlLCB1cGRhdGVkQ29udGVudCk7XG4gICAgdGhpcy5wbHVnaW4udXBkYXRlT2JzaWRpYW5UYWdDYWNoZSgpO1xuICAgIG5ldyBOb3RpY2UoYFJlc29sdmVkIHRhZyBjb25mbGljdHMgZm9yIGZpbGU6ICR7dGhpcy5maWxlLm5hbWV9YCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBCYXRjaENvbnZlcnNpb25SZXN1bHRNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJvY2Vzc2VkQ291bnQ6IG51bWJlcjtcbiAgc3VjY2Vzc0NvdW50OiBudW1iZXI7XG4gIGVycm9yQ291bnQ6IG51bWJlcjtcbiAgZXJyb3JzOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcm9jZXNzZWRDb3VudDogbnVtYmVyLFxuICAgIHN1Y2Nlc3NDb3VudDogbnVtYmVyLFxuICAgIGVycm9yQ291bnQ6IG51bWJlcixcbiAgICBlcnJvcnM6IHN0cmluZ1tdXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wcm9jZXNzZWRDb3VudCA9IHByb2Nlc3NlZENvdW50O1xuICAgIHRoaXMuc3VjY2Vzc0NvdW50ID0gc3VjY2Vzc0NvdW50O1xuICAgIHRoaXMuZXJyb3JDb3VudCA9IGVycm9yQ291bnQ7XG4gICAgdGhpcy5lcnJvcnMgPSBlcnJvcnM7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICAvLyBTdGFuZGFyZGl6ZSBoZWFkZXIgc3R5bGVcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiQmF0Y2ggQ29udmVyc2lvbiBDb21wbGV0ZVwiIH0pO1xuXG4gICAgLy8gQWRkIGNvbnNpc3RlbnQgc3BhY2luZ1xuICAgIGNvbnN0IHN0YXRzQ29udGFpbmVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0YWdpdC1tb2RhbC1jb250ZW50XCIgfSk7XG5cbiAgICAvLyBTdGFuZGFyZGl6ZSB0ZXh0IHN0eWxlc1xuICAgIHN0YXRzQ29udGFpbmVyLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBgUHJvY2Vzc2VkOiAke3RoaXMucHJvY2Vzc2VkQ291bnR9IGZpbGVzYCxcbiAgICAgIGNsczogXCJ0YWdpdC1zdGF0c1wiLFxuICAgIH0pO1xuICAgIHN0YXRzQ29udGFpbmVyLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBgU3VjY2Vzc2Z1bGx5IGNvbnZlcnRlZDogJHt0aGlzLnN1Y2Nlc3NDb3VudH0gZmlsZXNgLFxuICAgICAgY2xzOiBcInRhZ2l0LXN0YXRzXCIsXG4gICAgfSk7XG5cbiAgICBpZiAodGhpcy5lcnJvckNvdW50ID4gMCkge1xuICAgICAgY29uc3QgZXJyb3JTZWN0aW9uID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0YWdpdC1lcnJvci1zZWN0aW9uXCIgfSk7XG4gICAgICBlcnJvclNlY3Rpb24uY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYEZhaWxlZCB0byBwcm9jZXNzICR7dGhpcy5lcnJvckNvdW50fSBmaWxlczpgLFxuICAgICAgICBjbHM6IFwidGFnaXQtZXJyb3ItaGVhZGVyXCIsXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZXJyb3JMaXN0ID0gZXJyb3JTZWN0aW9uLmNyZWF0ZUVsKFwidWxcIiwge1xuICAgICAgICBjbHM6IFwidGFnaXQtZXJyb3ItbGlzdFwiLFxuICAgICAgfSk7XG4gICAgICB0aGlzLmVycm9ycy5mb3JFYWNoKChmaWxlTmFtZSkgPT4ge1xuICAgICAgICBlcnJvckxpc3QuY3JlYXRlRWwoXCJsaVwiLCB7IHRleHQ6IGZpbGVOYW1lIH0pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gU3RhbmRhcmRpemUgYnV0dG9uIGNvbnRhaW5lclxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICBidG5cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDbG9zZVwiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuXG5jbGFzcyBCYXRjaENvbnZlcnNpb25XYXJuaW5nTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZpbGVzOiBURmlsZVtdO1xuICBwbHVnaW46IFRhZ0l0UGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBmaWxlczogVEZpbGVbXSwgcGx1Z2luOiBUYWdJdFBsdWdpbikge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5maWxlcyA9IGZpbGVzO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgLy8gU3RhbmRhcmRpemUgaGVhZGVyIHN0eWxlXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIkJhdGNoIENvbnZlcnQgVGFncyB0byBZQU1MXCIgfSk7XG5cbiAgICAvLyBBZGQgY29uc2lzdGVudCBzcGFjaW5nXG4gICAgY29uc3Qgd2FybmluZ0NvbnRlbnQgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRhZ2l0LW1vZGFsLWNvbnRlbnRcIiB9KTtcbiAgICB3YXJuaW5nQ29udGVudC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogYFRoaXMgd2lsbCBjb252ZXJ0IGlubGluZSB0YWdzIHRvIFlBTUwgZnJvbnQgbWF0dGVyIGluICR7dGhpcy5maWxlcy5sZW5ndGh9IGZpbGUocykuIFRoaXMgYWN0aW9uIGNhbm5vdCBiZSBhdXRvbWF0aWNhbGx5IHVuZG9uZS5gLFxuICAgICAgY2xzOiBcInRhZ2l0LXdhcm5pbmdcIixcbiAgICB9KTtcblxuICAgIC8vIFN0YW5kYXJkaXplIHRvZ2dsZSBzdHlsZVxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXRDbGFzcyhcInRhZ2l0LXNldHRpbmdcIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgLnNldFZhbHVlKHRydWUpXG4gICAgICAgICAgLnNldFRvb2x0aXAoXCJTaG93IHRoaXMgd2FybmluZyBuZXh0IHRpbWVcIilcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93QmF0Y2hDb252ZXJzaW9uV2FybmluZyA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5zZXROYW1lKFwiU2hvdyB0aGlzIHdhcm5pbmcgbmV4dCB0aW1lXCIpO1xuXG4gICAgLy8gU3RhbmRhcmRpemUgYnV0dG9uIGNvbnRhaW5lclxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXRDbGFzcyhcInRhZ2l0LWJ1dHRvbi1jb250YWluZXJcIilcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB0aGlzLmNsb3NlKCkpXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUHJvY2VlZFwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmJhdGNoQ29udmVydElubGluZVRhZ3NUb1lBTUwodGhpcy5maWxlcyk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbmNsYXNzIEJhdGNoQ29udmVyc2lvbkluaGVyaXRhbmNlTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGZvbGRlcjogVEZvbGRlcjtcbiAgcGx1Z2luOiBUYWdJdFBsdWdpbjtcbiAgZmlsZUNvdW50OiB7IGFsbDogbnVtYmVyOyBpbW1lZGlhdGU6IG51bWJlciB9O1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBmb2xkZXI6IFRGb2xkZXIsIHBsdWdpbjogVGFnSXRQbHVnaW4pIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuZm9sZGVyID0gZm9sZGVyO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuZmlsZUNvdW50ID0ge1xuICAgICAgYWxsOiAwLFxuICAgICAgaW1tZWRpYXRlOiAwLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICAvLyBDYWxjdWxhdGUgZmlsZSBjb3VudHNcbiAgICB0aGlzLmZpbGVDb3VudC5hbGwgPSB0aGlzLmNvdW50TWFya2Rvd25GaWxlcyh0aGlzLmZvbGRlciwgdHJ1ZSk7XG4gICAgdGhpcy5maWxlQ291bnQuaW1tZWRpYXRlID0gdGhpcy5jb3VudE1hcmtkb3duRmlsZXModGhpcy5mb2xkZXIsIGZhbHNlKTtcblxuICAgIC8vIFN0YW5kYXJkaXplIGhlYWRlciBzdHlsZVxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJDb252ZXJ0IFRhZ3MgdG8gWUFNTFwiIH0pO1xuXG4gICAgLy8gQWRkIGNvbnNpc3RlbnQgc3BhY2luZ1xuICAgIGNvbnN0IG1vZGFsQ29udGVudCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidGFnaXQtbW9kYWwtY29udGVudFwiIH0pO1xuICAgIG1vZGFsQ29udGVudC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJDaG9vc2UgaG93IHlvdSB3b3VsZCBsaWtlIHRvIGNvbnZlcnQgaW5saW5lIHRhZ3MgdG8gWUFNTCBmcm9udCBtYXR0ZXI6XCIsXG4gICAgICBjbHM6IFwidGFnaXQtZGVzY3JpcHRpb25cIixcbiAgICB9KTtcblxuICAgIC8vIFN0YW5kYXJkaXplIG9wdGlvbiBzdHlsZXNcbiAgICBuZXcgU2V0dGluZyhtb2RhbENvbnRlbnQpXG4gICAgICAuc2V0Q2xhc3MoXCJ0YWdpdC1zZXR0aW5nXCIpXG4gICAgICAuc2V0TmFtZShgQ29udmVydCBBbGwgKCR7dGhpcy5maWxlQ291bnQuYWxsfSBmaWxlcylgKVxuICAgICAgLnNldERlc2MoXCJDb252ZXJ0IHRhZ3MgaW4gdGhpcyBmb2xkZXIgYW5kIGFsbCBzdWJmb2xkZXJzXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ29udmVydCBBbGxcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5iYXRjaENvbnZlcnRXaXRoSW5oZXJpdGFuY2UodGhpcy5mb2xkZXIsIHRydWUpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcobW9kYWxDb250ZW50KVxuICAgICAgLnNldENsYXNzKFwidGFnaXQtc2V0dGluZ1wiKVxuICAgICAgLnNldE5hbWUoYENvbnZlcnQgRm9sZGVyIE9ubHkgKCR7dGhpcy5maWxlQ291bnQuaW1tZWRpYXRlfSBmaWxlcylgKVxuICAgICAgLnNldERlc2MoXCJDb252ZXJ0IHRhZ3Mgb25seSBpbiB0aGlzIGZvbGRlciAoZXhjbHVkaW5nIHN1YmZvbGRlcnMpXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ29udmVydCBGb2xkZXJcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5iYXRjaENvbnZlcnRXaXRoSW5oZXJpdGFuY2UodGhpcy5mb2xkZXIsIGZhbHNlKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIC8vIFN0YW5kYXJkaXplIGJ1dHRvbiBjb250YWluZXJcbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpLnNldENsYXNzKFwidGFnaXQtYnV0dG9uLWNvbnRhaW5lclwiKS5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICB9KVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGNvdW50TWFya2Rvd25GaWxlcyhcbiAgICBmb2xkZXI6IFRGb2xkZXIsXG4gICAgaW5jbHVkZVN1YmZvbGRlcnM6IGJvb2xlYW5cbiAgKTogbnVtYmVyIHtcbiAgICBsZXQgY291bnQgPSAwO1xuXG4gICAgLy8gQ291bnQgaW1tZWRpYXRlIG1hcmtkb3duIGZpbGVzXG4gICAgZm9sZGVyLmNoaWxkcmVuLmZvckVhY2goKGNoaWxkKSA9PiB7XG4gICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBURmlsZSAmJiBjaGlsZC5leHRlbnNpb24udG9Mb3dlckNhc2UoKSA9PT0gXCJtZFwiKSB7XG4gICAgICAgIGNvdW50Kys7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBJZiBpbmNsdWRpbmcgc3ViZm9sZGVycywgcmVjdXJzaXZlbHkgY291bnQgdGhlaXIgZmlsZXNcbiAgICBpZiAoaW5jbHVkZVN1YmZvbGRlcnMpIHtcbiAgICAgIGZvbGRlci5jaGlsZHJlbi5mb3JFYWNoKChjaGlsZCkgPT4ge1xuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICAgICAgY291bnQgKz0gdGhpcy5jb3VudE1hcmtkb3duRmlsZXMoY2hpbGQsIHRydWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnQ7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vIEFkZCB0aGUgbmV3IENoZWNrbGlzdFRhZ01vZGFsIGNsYXNzXG5jbGFzcyBDaGVja2xpc3RUYWdNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBlZGl0b3I6IEVkaXRvcjtcbiAgcHJpdmF0ZSBzZWxlY3Rpb246IHN0cmluZztcbiAgcHJpdmF0ZSB1cmdlbmN5TGV2ZWxzOiBVcmdlbmN5TGV2ZWxbXTtcbiAgcHJpdmF0ZSBvblN1Ym1pdDogKHRhZzogc3RyaW5nLCB1cmdlbmN5OiBVcmdlbmN5TGV2ZWwpID0+IHZvaWQ7XG4gIHByaXZhdGUgdGFnSW5wdXQ6IFRleHRDb21wb25lbnQ7XG4gIHByaXZhdGUgc2VsZWN0ZWRVcmdlbmN5OiBVcmdlbmN5TGV2ZWw7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgZWRpdG9yOiBFZGl0b3IsXG4gICAgc2VsZWN0aW9uOiBzdHJpbmcsXG4gICAgdXJnZW5jeUxldmVsczogVXJnZW5jeUxldmVsW10sXG4gICAgb25TdWJtaXQ6ICh0YWc6IHN0cmluZywgdXJnZW5jeTogVXJnZW5jeUxldmVsKSA9PiB2b2lkXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gICAgdGhpcy5zZWxlY3Rpb24gPSBzZWxlY3Rpb247XG4gICAgdGhpcy51cmdlbmN5TGV2ZWxzID0gdXJnZW5jeUxldmVscztcbiAgICB0aGlzLm9uU3VibWl0ID0gb25TdWJtaXQ7XG4gICAgdGhpcy5zZWxlY3RlZFVyZ2VuY3kgPSB1cmdlbmN5TGV2ZWxzWzBdO1xuICB9XG5cbiAgb25PcGVuKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIkFwcGx5IFRhZyB0byBDaGVja2xpc3RcIiB9KTtcblxuICAgIGNvbnN0IG1vZGFsQ29udGVudCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidGFnaXQtbW9kYWwtY29udGVudFwiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcobW9kYWxDb250ZW50KVxuICAgICAgLnNldE5hbWUoXCJUYWdcIilcbiAgICAgIC5zZXREZXNjKFwiRW50ZXIgYSB0YWcgKHdpdGhvdXQgIylcIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgIHRoaXMudGFnSW5wdXQgPSB0ZXh0O1xuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRleHQuc2V0VmFsdWUodmFsdWUucmVwbGFjZSgvW15hLXpBLVowLTlfLV0vZywgXCJcIikpO1xuICAgICAgICB9KTtcblxuICAgICAgICB0ZXh0LmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50OiBLZXlib2FyZEV2ZW50KSA9PiB7XG4gICAgICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiICYmICFldmVudC5zaGlmdEtleSkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlU3VibWl0KCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcobW9kYWxDb250ZW50KVxuICAgICAgLnNldE5hbWUoXCJVcmdlbmN5XCIpXG4gICAgICAuc2V0RGVzYyhcIlNlbGVjdCB1cmdlbmN5IGxldmVsXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIHRoaXMudXJnZW5jeUxldmVscy5mb3JFYWNoKChsZXZlbCkgPT4ge1xuICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihsZXZlbC5lbW9qaSwgYCR7bGV2ZWwuZW1vaml9ICR7bGV2ZWwubGFiZWx9YCk7XG4gICAgICAgIH0pO1xuICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZSh0aGlzLnNlbGVjdGVkVXJnZW5jeS5lbW9qaSk7XG4gICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMuc2VsZWN0ZWRVcmdlbmN5ID1cbiAgICAgICAgICAgIHRoaXMudXJnZW5jeUxldmVscy5maW5kKChsZXZlbCkgPT4gbGV2ZWwuZW1vamkgPT09IHZhbHVlKSB8fFxuICAgICAgICAgICAgdGhpcy51cmdlbmN5TGV2ZWxzWzBdO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldENsYXNzKFwidGFnaXQtYnV0dG9uLWNvbnRhaW5lclwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQXBwbHlcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZVN1Ym1pdCgpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVN1Ym1pdCgpOiB2b2lkIHtcbiAgICBjb25zdCB0YWcgPSB0aGlzLnRhZ0lucHV0LmdldFZhbHVlKCk7XG4gICAgaWYgKHRhZykge1xuICAgICAgdGhpcy5vblN1Ym1pdCh0YWcsIHRoaXMuc2VsZWN0ZWRVcmdlbmN5KTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IE5vdGljZShcIlBsZWFzZSBlbnRlciBhIHRhZ1wiKTtcbiAgICB9XG4gIH1cblxuICBvbkNsb3NlKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICB9XG59XG5cbi8vIEFkZCB0aGlzIG5ldyBtb2RhbCBjbGFzc1xuY2xhc3MgVXJnZW5jeU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIGVkaXRvcjogRWRpdG9yO1xuICBwcml2YXRlIHNlbGVjdGlvbjogc3RyaW5nO1xuICBwcml2YXRlIHVyZ2VuY3lMZXZlbHM6IFVyZ2VuY3lMZXZlbFtdO1xuICBwcml2YXRlIG9uU3VibWl0OiAodXJnZW5jeTogVXJnZW5jeUxldmVsKSA9PiB2b2lkO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIGVkaXRvcjogRWRpdG9yLFxuICAgIHNlbGVjdGlvbjogc3RyaW5nLFxuICAgIHVyZ2VuY3lMZXZlbHM6IFVyZ2VuY3lMZXZlbFtdLFxuICAgIG9uU3VibWl0OiAodXJnZW5jeTogVXJnZW5jeUxldmVsKSA9PiB2b2lkXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gICAgdGhpcy5zZWxlY3Rpb24gPSBzZWxlY3Rpb247XG4gICAgdGhpcy51cmdlbmN5TGV2ZWxzID0gdXJnZW5jeUxldmVscztcbiAgICB0aGlzLm9uU3VibWl0ID0gb25TdWJtaXQ7XG4gIH1cblxuICBvbk9wZW4oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiQ2hhbmdlIFVyZ2VuY3kgTGV2ZWxcIiB9KTtcbiAgICBjb25zdCBtb2RhbENvbnRlbnQgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRhZ2l0LW1vZGFsLWNvbnRlbnRcIiB9KTtcblxuICAgIC8vIENyZWF0ZSBjb250YWluZXIgZm9yIGhvcml6b250YWwgYnV0dG9uc1xuICAgIGNvbnN0IGJ1dHRvbnNDb250YWluZXIgPSBtb2RhbENvbnRlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJ1cmdlbmN5LWJ1dHRvbnMtY29udGFpbmVyXCIsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYSBidXR0b24gZm9yIGVhY2ggdXJnZW5jeSBsZXZlbFxuICAgIHRoaXMudXJnZW5jeUxldmVscy5mb3JFYWNoKChsZXZlbCkgPT4ge1xuICAgICAgY29uc3QgYnV0dG9uRGl2ID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwidXJnZW5jeS1idXR0b25cIixcbiAgICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogbGV2ZWwubGFiZWwgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgZW1vamlcbiAgICAgIGJ1dHRvbkRpdi5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwidXJnZW5jeS1lbW9qaVwiLFxuICAgICAgICB0ZXh0OiBsZXZlbC5lbW9qaSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgbGFiZWxcbiAgICAgIGJ1dHRvbkRpdi5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwidXJnZW5jeS1sYWJlbFwiLFxuICAgICAgICB0ZXh0OiBsZXZlbC5sYWJlbCxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgY2xpY2sgaGFuZGxlclxuICAgICAgYnV0dG9uRGl2LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMub25TdWJtaXQobGV2ZWwpO1xuICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjYW5jZWwgYnV0dG9uIGF0IHRoZSBib3R0b21cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0Q2xhc3MoXCJ0YWdpdC1idXR0b24tY29udGFpbmVyXCIpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgb25DbG9zZSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuIl0sIm5hbWVzIjpbIlBsdWdpbiIsIlRGb2xkZXIiLCJURmlsZSIsIk5vdGljZSIsIk1vZGFsIiwiU2V0dGluZyIsIlBsdWdpblNldHRpbmdUYWIiXSwibWFwcGluZ3MiOiI7Ozs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBb0dBO0FBQ08sU0FBUyxTQUFTLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFO0FBQzdELElBQUksU0FBUyxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsT0FBTyxLQUFLLFlBQVksQ0FBQyxHQUFHLEtBQUssR0FBRyxJQUFJLENBQUMsQ0FBQyxVQUFVLE9BQU8sRUFBRSxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFO0FBQ2hILElBQUksT0FBTyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsT0FBTyxDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUUsTUFBTSxFQUFFO0FBQy9ELFFBQVEsU0FBUyxTQUFTLENBQUMsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRTtBQUNuRyxRQUFRLFNBQVMsUUFBUSxDQUFDLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRTtBQUN0RyxRQUFRLFNBQVMsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLE1BQU0sQ0FBQyxJQUFJLEdBQUcs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
