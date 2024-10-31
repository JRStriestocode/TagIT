import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFolder,
  TFile,
  Modal,
  TextComponent,
  Notice,
} from "obsidian";

interface TagItSettings {
  inheritanceMode: "none" | "immediate" | "all";
  excludedFolders: string[];
  showFolderIcons: boolean;
  autoApplyTags: boolean;
  debugMode: boolean;
}

const DEFAULT_SETTINGS: TagItSettings = {
  inheritanceMode: "immediate",
  excludedFolders: [],
  showFolderIcons: true,
  autoApplyTags: true,
  debugMode: false,
};

// Add this type definition
type FolderTags = { [folderPath: string]: string[] };

interface PluginData {
  settings: TagItSettings;
  folderTags: FolderTags;
  version: string;
}

const DEFAULT_DATA: PluginData = {
  settings: DEFAULT_SETTINGS,
  folderTags: {},
  version: "1.0.0",
};

export default class TagItPlugin extends Plugin {
  settings: TagItSettings;
  folderTags: FolderTags = {};
  private isInitialLoad: boolean = true;
  private newFolderQueue: TFolder[] = [];
  private moveTimeout: NodeJS.Timeout | null = null;

  async onload() {
    try {
      await this.loadSettings();
      await this.loadFolderTags();
    } catch (error) {
      console.error(
        "Error loading plugin data, initializing with defaults:",
        error
      );
      await this.initializeDataFile();
    }

    console.log("loading TagIt plugin");

    // Delayed initialization
    setTimeout(() => {
      this.isInitialLoad = false;
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFolder) {
            this.handleFolderCreation(file);
          } else if (file instanceof TFile) {
            this.handleFileCreation(file);
          }
        })
      );

      // Process the queue every 2 seconds
      this.registerInterval(
        window.setInterval(() => this.processNewFolderQueue(), 2000)
      );

      // Add event listener for file movement
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (file instanceof TFile) {
            this.handleFileMove(file, oldPath);
          }
        })
      );
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
        } else {
          new Notice("No active file");
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
        } else {
          new Notice("No active file");
        }
      },
    });

    // Register context menu events
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
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
              .setTitle("Check for Duplicate Tags")
              .setIcon("search")
              .onClick(() => this.checkAndRemoveDuplicateTags(file));
          });
        }

        if (file instanceof TFile) {
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
      })
    );

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new TagItSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFolder) {
          this.handleFolderDeletion(file);
        }
      })
    );

    // Update folder icons when the plugin loads
    this.app.workspace.onLayoutReady(() => {
      this.updateFolderIcons();
    });

    // Update folder icons when files are created, deleted, or renamed
    this.registerEvent(
      this.app.vault.on("create", () => this.updateFolderIcons())
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.updateFolderIcons())
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.updateFolderIcons())
    );

    // Add this line to update tags when the plugin loads
    this.app.workspace.onLayoutReady(() => this.updateObsidianTagCache());

    // Update folder icons based on the showFolderIcons setting
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.showFolderIcons) {
        this.updateFolderIcons();
      }
    });
  }

  onunload() {
    console.log("unloading TagIt plugin");
  }

  async loadSettings() {
    try {
      const data = (await this.loadData()) as PluginData;
      if (data) {
        this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        this.folderTags = data.folderTags || {};
      } else {
        this.settings = DEFAULT_SETTINGS;
        this.folderTags = {};
      }
    } catch (error) {
      console.error("Failed to load plugin data:", error);
      this.settings = DEFAULT_SETTINGS;
      this.folderTags = {};
    }
  }

  async saveSettings() {
    const data: PluginData = {
      settings: this.settings,
      folderTags: this.folderTags,
      version: "1.0.0",
    };
    await this.saveData(data);
  }

  async loadFolderTags() {
    // This method is now redundant as we're loading both settings and folderTags in loadSettings
    // Keeping it for backwards compatibility
    console.log("Folder tags loaded in loadSettings method");
  }

  async saveFolderTags() {
    const data: PluginData = {
      settings: this.settings,
      folderTags: this.folderTags,
      version: "1.0.0",
    };
    await this.saveData(data);
  }

  private handleFolderCreation(folder: TFolder) {
    if (!this.isInitialLoad) {
      new FolderTagModal(this.app, folder, this, true).open();
    }
  }

  setFolderTags(folderPath: string, tags: string[]) {
    const uniqueTags = this.removeDuplicateTags(tags);
    this.folderTags[folderPath] = uniqueTags;
    this.saveFolderTags();
    this.updateFolderIcons();
    this.updateObsidianTagCache();
  }

  getFolderTags(folderPath: string): string[] {
    return this.folderTags[folderPath] || [];
  }

  openFolderTagModal(folder: TFolder | null) {
    if (folder) {
      new FolderTagModal(this.app, folder, this).open();
    } else {
      new Notice("No folder selected");
    }
  }

  removeFolderTags(folder: TFolder | null) {
    if (folder) {
      this.setFolderTags(folder.path, []);
      new Notice(`Removed all tags from folder: ${folder.path}`);
    } else {
      new Notice("No folder selected");
    }
  }

  async handleFileCreation(file: TFile) {
    // Add more thorough file type checking
    if (
      !(file instanceof TFile) ||
      !file.extension.toLowerCase().match(/^(md|markdown)$/)
    ) {
      return;
    }

    if (!this.settings.autoApplyTags) {
      return; // Don't apply tags if the setting is off
    }

    const folder = file.parent;
    if (folder) {
      const folderTags = this.getFolderTagsWithInheritance(folder.path);
      if (folderTags.length > 0) {
        await this.addTagsToFile(file, folderTags);
        this.updateObsidianTagCache();
      }
    }
  }

  async handleFileMove(file: TFile, oldPath: string) {
    console.log(`File moved: ${oldPath} -> ${file.path}`);

    const oldFolderPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
    const newFolder = file.parent;

    console.log(
      `Old folder path: ${oldFolderPath}, New folder: ${newFolder?.path}`
    );

    if (oldFolderPath !== newFolder?.path) {
      const oldFolderTags = this.getFolderTagsWithInheritance(oldFolderPath);
      const newFolderTags = this.getFolderTagsWithInheritance(
        newFolder?.path || ""
      );

      // Only proceed if the tags are different
      if (
        JSON.stringify(oldFolderTags.sort()) !==
        JSON.stringify(newFolderTags.sort())
      ) {
        console.log(`Old folder tags: ${oldFolderTags.join(", ")}`);
        console.log(`New folder tags: ${newFolderTags.join(", ")}`);

        const conflictingTags = this.detectConflictingTags(file);
        console.log(`Conflicting tags: ${conflictingTags.join(", ")}`);

        if (conflictingTags.length > 0) {
          new ConflictResolutionModal(
            this.app,
            file,
            conflictingTags,
            this
          ).open();
        } else {
          new FileMovedModal(
            this.app,
            file,
            oldFolderTags,
            newFolderTags,
            this
          ).open();
        }
      } else {
        console.log("Folder tags are the same, no update needed");
      }
    } else {
      console.log("File not moved between folders or folders are the same");
    }
  }

  async addTagsToFile(file: TFile, tagsToAdd: string[]): Promise<void> {
    const content = await this.app.vault.read(file);
    const existingTags = this.extractTagsFromContent(content);

    // Only add tags that don't already exist
    const newTags = tagsToAdd.filter(
      (tag: string) => !existingTags.includes(tag)
    );
    const allTags = [...existingTags, ...newTags];

    // Only update if there are new tags to add
    if (newTags.length > 0) {
      const updatedContent = this.updateTagsInContent(content, allTags);
      await this.app.vault.modify(file, updatedContent);
      this.updateObsidianTagCache();

      if (this.settings.debugMode) {
        console.log(`Added new tags to ${file.name}:`, newTags);
      }
    } else if (this.settings.debugMode) {
      console.log(`No new tags to add to ${file.name}`);
    }
  }

  async updateFileTags(
    file: TFile,
    oldFolderTags: string[],
    newFolderTags: string[]
  ) {
    console.log(`Updating tags for file: ${file.name}`);
    console.log(`Old folder tags: ${oldFolderTags.join(", ")}`);
    console.log(`New folder tags: ${newFolderTags.join(", ")}`);

    const content = await this.app.vault.read(file);
    const existingTags = this.extractTagsFromContent(content);

    console.log(`Existing tags: ${existingTags.join(", ")}`);

    // Remove old folder tags and keep manual tags
    const manualTags = existingTags.filter(
      (tag) => !oldFolderTags.includes(tag)
    );

    // Add new folder tags
    const updatedTags = [...new Set([...manualTags, ...newFolderTags])];

    console.log(`Manual tags: ${manualTags.join(", ")}`);
    console.log(`Updated tags: ${updatedTags.join(", ")}`);

    const updatedContent = this.updateTagsInContent(content, updatedTags);

    if (content !== updatedContent) {
      await this.app.vault.modify(file, updatedContent);
      console.log(`Tags updated for file: ${file.name}`);
    } else {
      console.log(`No changes needed for file: ${file.name}`);
    }
  }

  updateTagsInContent(content: string, tags: string[]): string {
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

      return content.replace(
        frontmatterRegex,
        `---\n${updatedFrontmatter}\n---`
      );
    } else {
      return `---\ntags:\n${tagSection}\n---\n\n${content}`;
    }
  }

  addTagsToContent(content: string, tags: string[]): string {
    if (tags.length === 0) {
      return content;
    }

    const tagSection = tags.map((tag) => `  - ${tag}`).join("\n");
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const frontmatterMatch = content.match(frontmatterRegex);

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const updatedFrontmatter = `${frontmatter.trim()}\ntags:\n${tagSection}`;
      return content.replace(
        frontmatterRegex,
        `---\n${updatedFrontmatter}\n---`
      );
    } else {
      return `---\ntags:\n${tagSection}\n---\n\n${content}`;
    }
  }

  removeTagsFromContent(content: string, tagsToRemove: string[]): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const frontmatterMatch = content.match(frontmatterRegex);

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const existingTags = frontmatter.match(/tags:\s*\[(.*?)\]/);

      if (existingTags) {
        const currentTags = existingTags[1].split(",").map((tag) => tag.trim());
        const updatedTags = currentTags.filter(
          (tag) => !tagsToRemove.includes(tag)
        );
        const updatedFrontmatter = frontmatter.replace(
          /tags:\s*\[.*?\]/,
          `tags: [${updatedTags.join(", ")}]`
        );
        return content.replace(
          frontmatterRegex,
          `---\n${updatedFrontmatter}\n---`
        );
      }
    }

    return content;
  }

  async applyFileTagsToFolder(file: TFile) {
    const folder = file.parent;
    if (!folder) {
      new Notice("File is not in a folder");
      return;
    }

    const content = await this.app.vault.read(file);
    const fileTags = this.extractTagsFromContent(content);

    console.log(`Extracted tags from file: ${fileTags.join(", ")}`);

    if (fileTags.length === 0) {
      new Notice("No tags found in the file");
      return;
    }

    // Get tags only from the immediate parent folder
    const folderTags = this.getFolderTags(folder.path);
    const newTags = [...new Set([...folderTags, ...fileTags])];
    const addedTags = newTags.filter((tag) => !folderTags.includes(tag));

    console.log(`Existing folder tags: ${folderTags.join(", ")}`);
    console.log(`New tags to add: ${addedTags.join(", ")}`);

    if (addedTags.length === 0) {
      new Notice("No new tags to add to the folder");
      return;
    }

    new TagSelectionModal(
      this.app,
      `Select tags to add from the file "${file.name}" to the folder "${folder.name}":`,
      addedTags,
      (selectedTags) => {
        const updatedTags = [...new Set([...folderTags, ...selectedTags])];
        this.setFolderTags(folder.path, updatedTags);
        new Notice(
          `Applied ${selectedTags.length} tags from file to folder: ${folder.name}`
        );
      }
    ).open();
  }

  extractTagsFromContent(content: string): string[] {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const frontmatterMatch = content.match(frontmatterRegex);

    let tags: string[] = [];

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
        } else {
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

  async convertInlineTagsToYAML(file: TFile) {
    const content = await this.app.vault.read(file);
    const inlineTags = content.match(/#[^\s#]+/g);

    if (!inlineTags) {
      new Notice("No inline tags found in the file");
      return;
    }

    const newTags = inlineTags.map((tag) => tag.substring(1));

    new ConfirmationModal(
      this.app,
      `This will convert ${newTags.length} inline tags to YAML front matter and remove them from the content. Are you sure you want to proceed?`,
      async () => {
        new TagSelectionModal(
          this.app,
          `Select inline tags to convert to YAML front matter:`,
          newTags,
          async (selectedTags) => {
            if (selectedTags.length === 0) {
              new Notice("No tags selected for conversion");
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

            await this.app.vault.modify(file, updatedContent);
            new Notice(
              `Converted ${selectedTags.length} inline tags to YAML front matter`
            );
          }
        ).open();
      }
    ).open();
  }

  private handleFolderDeletion(folder: TFolder) {
    delete this.folderTags[folder.path];
    this.saveFolderTags();
  }

  async applyFolderTagsToContents(folder: TFolder): Promise<void> {
    if (!folder) {
      console.error("Folder is null or undefined");
      return;
    }

    const folderTags = this.getFolderTags(folder.path);
    const files = folder.children.filter((child) => child instanceof TFile);

    let updatedCount = 0;
    for (const file of files) {
      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        const existingTags = this.extractTagsFromContent(content);
        const newTags = folderTags.filter(
          (tag: string) => !existingTags.includes(tag)
        );

        if (newTags.length > 0) {
          await this.addTagsToFile(file, newTags);
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      new Notice(`Updated tags for ${updatedCount} file(s)`);
    } else {
      new Notice("No files needed tag updates");
    }
  }

  async initializeDataFile() {
    const initialData = {
      settings: DEFAULT_SETTINGS,
      folderTags: {},
    };
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.folderTags = {};
    await this.saveData(initialData);
    console.log("Initialized data file with default values");
  }

  queueNewFolder(folder: TFolder) {
    // Ensure we have the most up-to-date folder object
    const updatedFolder = this.app.vault.getAbstractFileByPath(folder.path);
    if (updatedFolder instanceof TFolder) {
      this.newFolderQueue.push(updatedFolder);
    } else {
      console.error(
        `Failed to get updated folder object for path: ${folder.path}`
      );
    }
  }

  async processNewFolderQueue() {
    for (const folder of this.newFolderQueue) {
      await this.promptForFolderTags(folder);
    }
    this.newFolderQueue = []; // Clear the queue
  }

  async promptForFolderTags(folder: TFolder) {
    new FolderTagModal(this.app, folder, this, true).open();
  }

  getFolderTagsWithInheritance(folderPath: string): string[] {
    if (this.settings.inheritanceMode === "none") {
      return this.getFolderTags(folderPath);
    }

    let tags: string[] = [];
    let currentPath = folderPath;

    while (currentPath) {
      if (!this.settings.excludedFolders.includes(currentPath)) {
        tags = [...new Set([...tags, ...this.getFolderTags(currentPath)])];
      }

      if (
        this.settings.inheritanceMode === "immediate" &&
        currentPath !== folderPath
      ) {
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

  async updateFolderIcons() {
    if (!this.settings.showFolderIcons) {
      // Remove all folder icons if the setting is off
      this.app.workspace.getLeavesOfType("file-explorer").forEach((leaf) => {
        const fileExplorerView = leaf.view as any;
        const fileItems = fileExplorerView.fileItems;
        for (const [, item] of Object.entries(fileItems)) {
          if (item && typeof item === "object" && "el" in item) {
            const folderEl = item.el as HTMLElement;
            const iconEl = folderEl.querySelector(
              ".nav-folder-title-content"
            ) as HTMLElement | null;
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
    if (!fileExplorer) return;

    const fileExplorerView = fileExplorer.view as any;
    const fileItems = fileExplorerView.fileItems;

    for (const [path, item] of Object.entries(fileItems)) {
      if (
        item &&
        typeof item === "object" &&
        "el" in item &&
        "file" in item &&
        item.file instanceof TFolder
      ) {
        const folderTags = this.getFolderTagsWithInheritance(path as string);
        const folderEl = item.el as HTMLElement;
        const iconEl = folderEl.querySelector(
          ".nav-folder-title-content"
        ) as HTMLElement | null;

        if (iconEl) {
          if (folderTags.length > 0) {
            iconEl.addClass("tagged-folder");
            iconEl.setAttribute(
              "aria-label",
              `Tagged folder: ${folderTags.join(", ")}`
            );
          } else {
            iconEl.removeClass("tagged-folder");
            iconEl.removeAttribute("aria-label");
          }
        } else {
          console.warn(`Could not find icon element for folder: ${path}`);
        }
      }
    }
  }

  // Add this new method
  async updateObsidianTagCache() {
    try {
      // Trigger metadata cache update
      this.app.metadataCache.trigger("changed");

      // Try to refresh the tag pane if it exists
      const tagPaneLeaves = this.app.workspace.getLeavesOfType("tag");
      if (tagPaneLeaves.length > 0) {
        // Use the workspace trigger instead of directly calling refresh
        this.app.workspace.trigger("tags-updated");
      }
    } catch (error) {
      if (this.settings.debugMode) {
        console.error("Failed to update tag cache:", error);
      }
    }
  }

  // Add this new method
  getAllFolderTags(): string[] {
    const allTags = new Set<string>();
    for (const tags of Object.values(this.folderTags)) {
      tags.forEach((tag: string) => allTags.add(tag));
    }
    return Array.from(allTags);
  }

  async replaceAllTags(file: TFile, newTags: string[]): Promise<void> {
    console.log(`Replacing all tags for file: ${file.name}`);
    console.log(`New tags: ${newTags.join(", ")}`);

    const content = await this.app.vault.read(file);

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
        updatedContent = updatedContent.replace(
          frontmatterRegex,
          `---\n${updatedFrontmatter}\n---`
        );
      } else {
        const newTagsSection = `tags:\n${newTags
          .map((tag) => `  - ${tag}`)
          .join("\n")}`;
        updatedContent = `---\n${newTagsSection}\n---\n\n${updatedContent}`;
      }
    }

    await this.app.vault.modify(file, updatedContent);
    this.updateObsidianTagCache();
    new Notice(`Tags replaced for file: ${file.name}`);
  }

  removeAllTagsFromContent(content: string): string {
    const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
    return content.replace(frontmatterRegex, "");
  }

  async mergeTags(
    file: TFile,
    oldTags: string[],
    newTags: string[]
  ): Promise<void> {
    console.log(`Merging tags for file: ${file.name}`);
    console.log(`Old tags: ${oldTags.join(", ")}`);
    console.log(`New tags: ${newTags.join(", ")}`);

    const content = await this.app.vault.read(file);
    const existingTags = this.extractTagsFromContent(content);

    console.log(`Existing tags: ${existingTags.join(", ")}`);

    // Remove old folder tags
    const manualTags = existingTags.filter((tag) => !oldTags.includes(tag));

    // Merge manual tags with new folder tags, ensuring no duplicates
    const mergedTags = [...new Set([...manualTags, ...newTags])];

    console.log(`Merged tags: ${mergedTags.join(", ")}`);

    if (
      JSON.stringify(existingTags.sort()) !== JSON.stringify(mergedTags.sort())
    ) {
      const updatedContent = this.updateTagsInContent(content, mergedTags);
      await this.app.vault.modify(file, updatedContent);
      this.updateObsidianTagCache();
      new Notice(`Tags merged for file: ${file.name}`);
    } else {
      console.log(`No changes needed for file: ${file.name}`);
    }
  }

  async applyFolderTagsToNotes(folder: TFolder): Promise<void> {
    const currentFolderTags = this.getFolderTags(folder.path);
    console.log(`Current folder tags: ${currentFolderTags.join(", ")}`);

    if (currentFolderTags.length === 0) {
      new Notice("This folder has no tags to apply.");
      return;
    }

    const files = folder.children.filter(
      (child): child is TFile => child instanceof TFile
    );
    let updatedCount = 0;

    for (const file of files) {
      try {
        console.log(`Processing file: ${file.name}`);
        const content = await this.app.vault.read(file);
        const existingTags = this.extractTagsFromContent(content);

        // Get the current folder's existing tags in the file
        const existingFolderTags = existingTags.filter((tag) =>
          this.getFolderTags(folder.path).includes(tag)
        );

        // Get manually added tags (tags that aren't from the folder)
        const manualTags = existingTags.filter(
          (tag) => !existingFolderTags.includes(tag)
        );

        // Combine manual tags with current folder tags
        const updatedTags = [...manualTags, ...currentFolderTags];

        // Only update if there are changes
        if (
          JSON.stringify(existingTags.sort()) !==
          JSON.stringify(updatedTags.sort())
        ) {
          console.log(`Existing tags: ${existingTags.join(", ")}`);
          console.log(`Manual tags: ${manualTags.join(", ")}`);
          console.log(`Updated tags: ${updatedTags.join(", ")}`);

          const updatedContent = this.updateTagsInContent(content, updatedTags);
          await this.app.vault.modify(file, updatedContent);
          updatedCount++;
          console.log(`Updated tags for file: ${file.name}`);
        } else {
          console.log(`No changes needed for file: ${file.name}`);
        }
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        new Notice(`Error updating tags for file: ${file.name}`);
      }
    }

    if (updatedCount > 0) {
      new Notice(`Updated tags for ${updatedCount} file(s) in ${folder.name}`);
    } else {
      new Notice(`No files needed tag updates in ${folder.name}`);
    }
  }

  // Add this helper method to check if a tag is used by any folder
  private isAnyFolderTag(tag: string): boolean {
    return Object.values(this.folderTags).some((folderTags) =>
      folderTags.includes(tag)
    );
  }

  async removeTagsFromFile(file: TFile, tagsToRemove: string[]): Promise<void> {
    console.log(`Removing folder tags from file: ${file.name}`);
    console.log(`Tags to remove: ${tagsToRemove.join(", ")}`);

    const content = await this.app.vault.read(file);
    const existingTags = this.extractTagsFromContent(content);

    console.log(`Existing tags: ${existingTags.join(", ")}`);

    // Keep all tags that are not in tagsToRemove
    const updatedTags = existingTags.filter(
      (tag) => !tagsToRemove.includes(tag)
    );

    console.log(`Updated tags: ${updatedTags.join(", ")}`);

    // Use updateTagsInContent to update the file's content
    let updatedContent: string;
    if (updatedTags.length > 0) {
      updatedContent = this.updateTagsInContent(content, updatedTags);
    } else {
      // If no tags remain, remove the entire YAML front matter
      updatedContent = this.removeYamlFrontMatter(content);
    }

    // Only modify the file if the content has changed
    if (content !== updatedContent) {
      await this.app.vault.modify(file, updatedContent);
      console.log(`Updated content for file: ${file.name}`);
      this.updateObsidianTagCache();
      new Notice(`Removed folder tags from file: ${file.name}`);
    } else {
      console.log(`No changes needed for file: ${file.name}`);
    }
  }

  removeYamlFrontMatter(content: string): string {
    const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
    return content.replace(frontmatterRegex, "");
  }

  detectConflictingTags(file: TFile): string[] {
    const parentFolders = this.getParentFolders(file);
    const allTags = parentFolders.flatMap((folder) =>
      this.getFolderTags(folder.path)
    );
    return allTags.filter((tag, index, self) => self.indexOf(tag) !== index);
  }

  getParentFolders(file: TFile): TFolder[] {
    const folders: TFolder[] = [];
    let currentFolder = file.parent;
    while (currentFolder) {
      folders.push(currentFolder);
      currentFolder = currentFolder.parent;
    }
    return folders;
  }

  private removeDuplicateTags(tags: string[]): string[] {
    return [...new Set(tags)];
  }

  removeFolderIcons() {
    // Current implementation might miss some elements
    // Add more robust element selection and cleanup
    this.app.workspace.getLeavesOfType("file-explorer").forEach((leaf) => {
      const fileExplorerView = leaf.view as any;
      const fileItems = fileExplorerView.fileItems;
      for (const [, item] of Object.entries(fileItems)) {
        if (item && typeof item === "object" && "el" in item) {
          const folderEl = item.el as HTMLElement;
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

  async handleFileMovement(file: TFile) {
    // Add debouncing to prevent multiple rapid file movements from causing issues
    if (this.moveTimeout) {
      clearTimeout(this.moveTimeout);
    }
    this.moveTimeout = setTimeout(async () => {
      // Existing file movement logic
    }, 300);
  }

  async migrateSettings(oldData: any): Promise<TagItSettings> {
    console.log("Migrating settings from old version");
    // For now, just return the default settings merged with any valid old settings
    return {
      ...DEFAULT_SETTINGS,
      ...{
        inheritanceMode:
          oldData.inheritanceMode || DEFAULT_SETTINGS.inheritanceMode,
        excludedFolders:
          oldData.excludedFolders || DEFAULT_SETTINGS.excludedFolders,
        showFolderIcons:
          oldData.showFolderIcons || DEFAULT_SETTINGS.showFolderIcons,
        autoApplyTags: oldData.autoApplyTags || DEFAULT_SETTINGS.autoApplyTags,
        debugMode: oldData.debugMode || DEFAULT_SETTINGS.debugMode,
      },
    };
  }

  async checkAndRemoveDuplicateTags(folder: TFolder): Promise<void> {
    const files = folder.children.filter(
      (child): child is TFile => child instanceof TFile
    );
    let processedCount = 0;
    let duplicatesFound = 0;

    for (const file of files) {
      try {
        console.log(`Checking file: ${file.name}`);
        const content = await this.app.vault.read(file);

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
            const updatedContent = this.updateTagsInContent(
              content,
              uniqueTags
            );
            await this.app.vault.modify(file, updatedContent);
            duplicatesFound++;
            console.log(`Removed duplicate tags from file: ${file.name}`);
          }
        }
        processedCount++;
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
      }
    }

    if (duplicatesFound > 0) {
      new Notice(
        `Removed duplicates from ${duplicatesFound} out of ${processedCount} files.`
      );
    } else {
      new Notice(`No duplicates found in ${processedCount} files.`);
    }
  }
}

class FolderTagModal extends Modal {
  folder: TFolder;
  plugin: TagItPlugin;
  folderNameInput: TextComponent;
  tagsInput: TextComponent;
  tags: string = "";
  isNewFolder: boolean;

  constructor(
    app: App,
    folder: TFolder,
    plugin: TagItPlugin,
    isNewFolder: boolean = false
  ) {
    super(app);
    this.folder = folder;
    this.plugin = plugin;
    this.isNewFolder = isNewFolder;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Add/Edit Folder Tags" });

    // Folder name field
    new Setting(contentEl).setName("Folder Name").addText((text) => {
      this.folderNameInput = text;
      text.setValue(this.folder.name);
      text.inputEl.addEventListener("keydown", this.handleEnter.bind(this));
      return text;
    });

    // Tags field
    new Setting(contentEl).setName("Tags").addText((text) => {
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
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.saveFolderTags();
          })
      );
  }

  handleEnter(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.saveFolderTags();
    }
  }

  async saveFolderTags() {
    const newFolderName = this.folderNameInput.getValue();
    let folderPath = this.folder.path;

    if (newFolderName !== this.folder.name) {
      try {
        const newPath = this.folder.parent
          ? `${this.folder.parent.path}/${newFolderName}`
          : newFolderName;
        await this.app.fileManager.renameFile(this.folder, newPath);
        console.log(
          `Renamed folder from ${this.folder.name} to ${newFolderName}`
        );

        // Wait for a short time to allow the file system to update
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Update folder reference and path
        const newFolder = this.app.vault.getAbstractFileByPath(newPath);
        if (newFolder instanceof TFolder) {
          this.folder = newFolder;
          folderPath = newPath;
        } else {
          console.warn(
            `Could not get new folder object, using new path: ${newPath}`
          );
          folderPath = newPath;
        }
      } catch (error) {
        console.error(`Failed to rename folder: ${error}`);
        new Notice(`Failed to rename folder: ${error}`);
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
      new Notice(
        `Error: Number-only tags are not allowed. Please remove: ${numberOnlyTags.join(
          ", "
        )}`
      );
      return;
    }

    this.plugin.setFolderTags(folderPath, tagArray);
    console.log(`Saved tags for folder ${folderPath}: ${tagArray.join(", ")}`);
    new Notice(`Tags saved for folder: ${folderPath}`);

    if (this.isNewFolder) {
      await this.plugin.applyFolderTagsToContents(this.folder);
      console.log(`Applied tags to contents of new folder: ${folderPath}`);
    }

    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class TagItSettingTab extends PluginSettingTab {
  plugin: TagItPlugin;

  constructor(app: App, plugin: TagItPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
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
    new Setting(containerEl)
      .setName("Tag Inheritance Mode")
      .setDesc("Choose how tags are inherited in nested folders")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "No inheritance")
          .addOption("immediate", "Inherit from immediate parent")
          .addOption("all", "Inherit from all parents")
          .setValue(this.plugin.settings.inheritanceMode)
          .onChange(async (value) => {
            this.plugin.settings.inheritanceMode = value as
              | "none"
              | "immediate"
              | "all";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Excluded Folders")
      .setDesc(
        "Enter folder paths to exclude from tag inheritance (one per line)"
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("folder1\nfolder2/subfolder")
          .setValue(this.plugin.settings.excludedFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value
              .split("\n")
              .filter((f) => f.trim() !== "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show Folder Icons")
      .setDesc("Display icons next to folders with tags")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFolderIcons)
          .onChange(async (value) => {
            this.plugin.settings.showFolderIcons = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.updateFolderIcons();
            } else {
              this.plugin.removeFolderIcons();
            }
          })
      );

    new Setting(containerEl)
      .setName("Auto-apply Tags")
      .setDesc("Automatically apply folder tags to new files")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoApplyTags)
          .onChange(async (value) => {
            this.plugin.settings.autoApplyTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Debug Mode")
      .setDesc("Enable detailed logging for troubleshooting")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

class ConfirmationModal extends Modal {
  onConfirm: () => void;
  message: string;

  constructor(app: App, message: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: this.message });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Confirm")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class TagSelectionModal extends Modal {
  tags: string[];
  onConfirm: (selectedTags: string[]) => void;
  message: string;

  constructor(
    app: App,
    message: string,
    tags: string[],
    onConfirm: (selectedTags: string[]) => void
  ) {
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

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Confirm")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm(this.tags);
          })
      );
  }

  onClose() {
    this.contentEl.empty();
    this.titleEl.empty();
  }
}

class FileMovedModal extends Modal {
  file: TFile;
  oldTags: string[];
  newTags: string[];
  plugin: TagItPlugin;

  constructor(
    app: App,
    file: TFile,
    oldTags: string[],
    newTags: string[],
    plugin: TagItPlugin
  ) {
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

    new Setting(contentEl)
      .setName("Replace All")
      .setDesc("Replace all existing tags with new folder tags")
      .addButton((btn) =>
        btn
          .setButtonText("Replace All")
          .setCta()
          .onClick(() => {
            this.plugin.replaceAllTags(this.file, this.newTags);
            this.close();
          })
      );

    new Setting(contentEl)
      .setName("Merge")
      .setDesc("Keep existing tags and add new folder tags")
      .addButton((btn) =>
        btn
          .setButtonText("Merge")
          .setCta()
          .onClick(() => {
            this.plugin.mergeTags(this.file, this.oldTags, this.newTags);
            this.close();
          })
      );

    new Setting(contentEl)
      .setName("No Action")
      .setDesc("Keep tags as they are")
      .addButton((btn) =>
        btn.setButtonText("No Action").onClick(() => {
          this.close();
        })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class ConflictResolutionModal extends Modal {
  file: TFile;
  conflictingTags: string[];
  plugin: TagItPlugin;

  constructor(
    app: App,
    file: TFile,
    conflictingTags: string[],
    plugin: TagItPlugin
  ) {
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

    new Setting(contentEl)
      .setName("Keep All")
      .setDesc("Keep all instances of conflicting tags")
      .addButton((btn) =>
        btn
          .setButtonText("Keep All")
          .setCta()
          .onClick(() => {
            this.resolveConflict("keepAll");
          })
      );

    new Setting(contentEl)
      .setName("Keep One")
      .setDesc("Keep only one instance of each conflicting tag")
      .addButton((btn) =>
        btn
          .setButtonText("Keep One")
          .setCta()
          .onClick(() => {
            this.resolveConflict("keepOne");
          })
      );

    new Setting(contentEl)
      .setName("Remove All")
      .setDesc("Remove all instances of conflicting tags")
      .addButton((btn) =>
        btn
          .setButtonText("Remove All")
          .setCta()
          .onClick(() => {
            this.resolveConflict("removeAll");
          })
      );
  }

  async resolveConflict(resolution: "keepAll" | "keepOne" | "removeAll") {
    const content = await this.plugin.app.vault.read(this.file);
    const existingTags = this.plugin.extractTagsFromContent(content);
    let updatedTags: string[];

    switch (resolution) {
      case "keepAll":
        updatedTags = existingTags;
        break;
      case "keepOne":
        updatedTags = [...new Set(existingTags)];
        break;
      case "removeAll":
        updatedTags = existingTags.filter(
          (tag) => !this.conflictingTags.includes(tag)
        );
        break;
    }

    const updatedContent = this.plugin.updateTagsInContent(
      content,
      updatedTags
    );
    await this.plugin.app.vault.modify(this.file, updatedContent);
    this.plugin.updateObsidianTagCache();
    new Notice(`Resolved tag conflicts for file: ${this.file.name}`);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
