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
  mySetting: string;
  inheritanceMode: "none" | "immediate" | "all";
  excludedFolders: string[];
}

interface FolderTags {
  [folderPath: string]: string[];
}

const DEFAULT_SETTINGS: TagItSettings = {
  mySetting: "default",
  inheritanceMode: "immediate",
  excludedFolders: [],
};

export default class TagItPlugin extends Plugin {
  settings: TagItSettings;
  folderTags: FolderTags = {};
  private isInitialLoad: boolean = true;
  private newFolderQueue: TFolder[] = [];

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
            this.queueNewFolder(file);
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
  }

  onunload() {
    console.log("unloading TagIt plugin");
  }

  async loadSettings() {
    try {
      const data = await this.loadData();
      if (data && typeof data === "object") {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
        this.folderTags = data.folderTags || {};
      } else {
        throw new Error("Invalid data format");
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      throw error; // Rethrow to trigger initialization
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loadFolderTags() {
    // This method is now redundant as we're loading both settings and folderTags in loadSettings
    // Keeping it for backwards compatibility
    console.log("Folder tags loaded in loadSettings method");
  }

  async saveFolderTags() {
    await this.saveData({
      settings: this.settings,
      folderTags: this.folderTags,
    });
  }

  private handleFolderCreation(folder: TFolder) {
    if (!this.isInitialLoad) {
      // Ensure we have the most up-to-date folder object
      const updatedFolder = this.app.vault.getAbstractFileByPath(folder.path);
      if (updatedFolder instanceof TFolder) {
        new FolderTagModal(this.app, updatedFolder, this, true).open();
      } else {
        console.error(
          `Failed to get updated folder object for path: ${folder.path}`
        );
      }
    }
  }

  setFolderTags(folderPath: string, tags: string[]) {
    this.folderTags[folderPath] = tags;
    this.saveFolderTags();
    this.updateFolderIcons();
    this.updateObsidianTagCache(); // Add this line
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
    const folder = file.parent;
    if (folder) {
      const folderTags = this.getFolderTagsWithInheritance(folder.path);
      if (folderTags.length > 0) {
        await this.addTagsToFile(file, folderTags);
        this.updateObsidianTagCache(); // Add this line
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

      console.log(`Old folder tags: ${oldFolderTags.join(", ")}`);
      console.log(`New folder tags: ${newFolderTags.join(", ")}`);

      // Remove old folder tags and add new folder tags
      await this.updateFileTags(file, oldFolderTags, newFolderTags);
      this.updateObsidianTagCache(); // Add this line

      new Notice(`Updated tags for file: ${file.name}`);
    } else {
      console.log("File not moved between folders or folders are the same");
    }
  }

  async addTagsToFile(file: TFile, tagsToAdd: string[]) {
    const content = await this.app.vault.read(file);
    const updatedContent = this.addTagsToContent(content, tagsToAdd);
    await this.app.vault.modify(file, updatedContent);
  }

  async updateFileTags(
    file: TFile,
    tagsToRemove: string[],
    tagsToAdd: string[]
  ) {
    console.log(`Updating tags for file: ${file.name}`);
    console.log(`Tags to remove: ${tagsToRemove.join(", ")}`);
    console.log(`Tags to add: ${tagsToAdd.join(", ")}`);

    const content = await this.app.vault.read(file);
    let updatedContent = content;

    if (tagsToRemove.length > 0) {
      updatedContent = this.removeTagsFromContent(updatedContent, tagsToRemove);
    }

    if (tagsToAdd.length > 0) {
      updatedContent = this.addTagsToContent(updatedContent, tagsToAdd);
    }

    if (content !== updatedContent) {
      await this.app.vault.modify(file, updatedContent);
      console.log(`Tags updated for file: ${file.name}`);
    } else {
      console.log(`No changes needed for file: ${file.name}`);
    }
  }

  addTagsToContent(content: string, tagsToAdd: string[]): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const frontmatterMatch = content.match(frontmatterRegex);

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const existingTags = frontmatter.match(/tags:\s*\[(.*?)\]/);

      if (existingTags) {
        const currentTags = existingTags[1].split(",").map((tag) => tag.trim());
        const newTags = [...new Set([...currentTags, ...tagsToAdd])];
        const updatedFrontmatter = frontmatter.replace(
          /tags:\s*\[.*?\]/,
          `tags: [${newTags.join(", ")}]`
        );
        return content.replace(
          frontmatterRegex,
          `---\n${updatedFrontmatter}\n---`
        );
      } else {
        const updatedFrontmatter = `${frontmatter}\ntags: [${tagsToAdd.join(
          ", "
        )}]`;
        return content.replace(
          frontmatterRegex,
          `---\n${updatedFrontmatter}\n---`
        );
      }
    } else {
      return `---\ntags: [${tagsToAdd.join(", ")}]\n---\n\n${content}`;
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

    if (fileTags.length === 0) {
      new Notice("No tags found in the file");
      return;
    }

    const folderTags = this.getFolderTags(folder.path);
    const newTags = [...new Set([...folderTags, ...fileTags])];
    const addedTags = newTags.filter((tag) => !folderTags.includes(tag));

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
      const yamlTags = frontmatter.match(/tags:\s*\[(.*?)\]/);
      if (yamlTags) {
        tags = yamlTags[1].split(",").map((tag) => tag.trim());
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

  async applyFolderTagsToContents(folder: TFolder | null) {
    if (!folder) {
      console.error("Folder is null or undefined");
      return;
    }

    const folderTags = this.getFolderTags(folder.path);
    const files = folder.children.filter(
      (child): child is TFile => child instanceof TFile
    );

    for (const file of files) {
      await this.addTagsToFile(file, folderTags);
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
    const metadataCache = this.app.metadataCache;
    const allTags = this.getAllFolderTags();

    for (const tag of allTags) {
      // Add each folder tag to Obsidian's tag cache
      if (!metadataCache.getTags()[tag]) {
        metadataCache.trigger("create-tag", tag);
      }
    }

    // Refresh the tag pane
    this.app.workspace.trigger("tags-updated");
  }

  // Add this new method
  getAllFolderTags(): string[] {
    const allTags = new Set<string>();
    for (const tags of Object.values(this.folderTags)) {
      tags.forEach((tag) => allTags.add(tag));
    }
    return Array.from(allTags);
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

    containerEl.createEl("h2", { text: "TagIt Settings" });

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
      .setName("Setting")
      .setDesc("It's a setting")
      .addText((text) =>
        text
          .setPlaceholder("Enter your setting")
          .setValue(this.plugin.settings.mySetting)
          .onChange(async (value) => {
            this.plugin.settings.mySetting = value;
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
    const { contentEl } = this;
    contentEl.empty();
  }
}
