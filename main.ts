import {
  App,
  Plugin,
  TFolder,
  TFile,
  Modal,
  Notice,
  TextComponent,
  PluginSettingTab,
  Setting,
} from "obsidian";

interface TagITSettings {
  folderTags: Record<string, string[]>;
  debugMode: boolean;
  useFrontMatter: boolean; // New setting
}

const DEFAULT_SETTINGS: TagITSettings = {
  folderTags: {},
  debugMode: false,
  useFrontMatter: true, // Default to using front matter
};

export default class TagITPlugin extends Plugin {
  settings: TagITSettings;

  async onload() {
    console.log("TagIT: Starting to load plugin");
    try {
      console.log("TagIT: Loading settings");
      await this.loadSettings();
      console.log("TagIT: Settings loaded successfully");

      console.log("TagIT: Registering event listeners");
      this.registerEventListeners();
      console.log("TagIT: Event listeners registered");

      console.log("TagIT: Adding commands");
      this.addCommands();
      console.log("TagIT: Commands added");

      console.log("TagIT: Setting up context menu");
      this.setupContextMenu();
      console.log("TagIT: Context menu set up");

      if (this.settings.debugMode) {
        console.log("TagIT: Debug mode is on, adding test tags");
        await this.addTagsToFolder("Adaki/Supply-Chain", ["supply", "chain"]);
        await this.addTagsToFolder("Adaki/Supply-Chain/Packaging", [
          "packaging",
        ]);
      }

      console.log("TagIT plugin loaded successfully");
    } catch (error) {
      console.error("TagIT: Error during plugin load", error);
    }

    this.addSettingTab(new TagITSettingTab(this.app, this));
  }

  onunload() {
    console.log("Unloading TagIT plugin");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async onFolderCreated(folder: TFolder) {
    console.log("Folder created:", folder.path);
    new TagFolderModal(this.app, this, folder, true).open();
  }

  async onFileCreated(file: TFile) {
    console.log("File created:", file.path);
    await this.applyFolderTagsToFile(file);
  }

  async onFileRenamed(file: TFile, oldPath: string) {
    console.log("File renamed:", file.path, "Old path:", oldPath);
    await this.applyFolderTagsToFile(file);
  }

  async applyFolderTagsToFile(file: TFile) {
    console.log("Applying tags to file:", file.path);
    const folderPath = file.parent?.path || "";
    const tags = this.getFolderTags(folderPath);

    console.log("Tags to apply:", tags);

    const content = await this.app.vault.read(file);
    const updatedContent = this.addTagsToContent(content, tags);

    if (content !== updatedContent) {
      await this.app.vault.modify(file, updatedContent);
      console.log("Tags applied to file");
      new Notice(`Tags applied to "${file.name}"`);
    } else {
      console.log("No changes needed for file");
    }
  }

  getFolderTags(folderPath: string): string[] {
    console.log("Getting tags for folder:", folderPath);
    const tags: string[] = [];
    let currentPath = folderPath;

    while (currentPath !== "") {
      console.log("Checking path:", currentPath);
      const folderTags = this.settings.folderTags[currentPath] || [];
      console.log("Found tags:", folderTags);
      tags.push(...folderTags);
      currentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
    }

    console.log("All retrieved tags:", tags);
    return [...new Set(tags)]; // Remove duplicates
  }

  addTagsToFrontMatter(content: string, tagsToAdd: string[]): string {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---/;
    const match = content.match(frontMatterRegex);

    if (match) {
      const frontMatter = match[1];
      const existingTags = frontMatter.match(/tags:\s*\[(.*?)\]/);

      if (existingTags) {
        const currentTags = existingTags[1].split(",").map((tag) => tag.trim());
        const newTags = [...new Set([...currentTags, ...tagsToAdd])];
        const updatedFrontMatter = frontMatter.replace(
          /tags:\s*\[.*?\]/,
          `tags: [${newTags.join(", ")}]`
        );
        return content.replace(
          frontMatterRegex,
          `---\n${updatedFrontMatter}\n---`
        );
      } else {
        const updatedFrontMatter = `${frontMatter}\ntags: [${tagsToAdd.join(
          ", "
        )}]`;
        return content.replace(
          frontMatterRegex,
          `---\n${updatedFrontMatter}\n---`
        );
      }
    } else {
      return `---\ntags: [${tagsToAdd.join(", ")}]\n---\n\n${content}`;
    }
  }

  debugFolderTags() {
    console.log(
      "Current folder tags:",
      JSON.stringify(this.settings.folderTags, null, 2)
    );
  }

  async removeFolderTags(folder: TFolder) {
    delete this.settings.folderTags[folder.path];
    await this.saveSettings();
    console.log(`Tags removed for folder ${folder.path}`);
    new Notice(`Tags removed from "${folder.name}"`);
  }

  async removeTagsFromFile(file: TFile) {
    const content = await this.app.vault.read(file);
    const updatedContent = this.removeTagsFromContent(content);
    await this.app.vault.modify(file, updatedContent);
    console.log(`Tags removed from file ${file.path}`);
    new Notice(`Tags removed from "${file.name}"`);
  }

  removeTagsFromFrontMatter(content: string): string {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---/;
    const match = content.match(frontMatterRegex);

    if (match) {
      const frontMatter = match[1];
      const updatedFrontMatter = frontMatter
        .replace(/tags:.*(\r?\n|\r)?/, "")
        .trim();

      if (updatedFrontMatter === "") {
        // If front matter is empty after removing tags, remove the entire front matter
        return content.replace(frontMatterRegex, "").trim();
      } else {
        // Otherwise, update the front matter without the tags
        return content.replace(
          frontMatterRegex,
          `---\n${updatedFrontMatter}\n---`
        );
      }
    }

    return content;
  }

  async addTagsToFolder(folderPath: string, tags: string[]) {
    if (!this.settings.folderTags[folderPath]) {
      this.settings.folderTags[folderPath] = [];
    }
    this.settings.folderTags[folderPath].push(...tags);
    await this.saveSettings();
    console.log(`Added tags ${tags.join(", ")} to folder ${folderPath}`);
  }

  // Add these new methods to split up the functionality:
  private registerEventListeners() {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFolder) {
          this.onFolderCreated(file);
        } else if (file instanceof TFile && file.extension === "md") {
          this.onFileCreated(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.onFileRenamed(file, oldPath);
        }
      })
    );
  }

  private addCommands() {
    this.addCommand({
      id: "open-tag-modal",
      name: "Add/Edit Tags for Current Folder",
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          const folder = activeFile.parent;
          if (folder) {
            new TagFolderModal(this.app, this, folder).open();
          }
        }
      },
    });

    this.addCommand({
      id: "create-folder-with-tags",
      name: "Create New Folder with Tags",
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        const parentFolder = activeFile?.parent || this.app.vault.getRoot();
        new CreateFolderModal(this.app, this, parentFolder).open();
      },
    });
  }

  private setupContextMenu() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle("Add/Edit Tags")
              .setIcon("tag")
              .onClick(() => {
                new TagFolderModal(this.app, this, file).open();
              });
          });

          menu.addItem((item) => {
            item
              .setTitle("Remove All Tags")
              .setIcon("trash")
              .onClick(() => {
                this.removeFolderTags(file);
              });
          });
        }

        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle("Remove Tags")
              .setIcon("trash")
              .onClick(() => {
                this.removeTagsFromFile(file);
              });
          });
        }

        menu.addItem((item) => {
          item
            .setTitle("Create Folder with Tags")
            .setIcon("folder-plus")
            .onClick(() => {
              const parentFolder =
                file instanceof TFolder
                  ? file
                  : file.parent || this.app.vault.getRoot();
              new CreateFolderModal(this.app, this, parentFolder).open();
            });
        });
      })
    );
  }

  async applyTagsToExistingFiles(folder: TFolder, tagsToAdd: string[]) {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(folder.path));
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const updatedContent = this.addMissingTagsToFrontMatter(
        content,
        tagsToAdd
      );
      if (content !== updatedContent) {
        await this.app.vault.modify(file, updatedContent);
        console.log(`Updated tags for file: ${file.path}`);
      }
    }
  }

  addMissingTagsToFrontMatter(content: string, tagsToAdd: string[]): string {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---/;
    const match = content.match(frontMatterRegex);

    if (match) {
      const frontMatter = match[1];
      const existingTags = frontMatter.match(/tags:\s*\[(.*?)\]/);

      if (existingTags) {
        const currentTags = existingTags[1].split(",").map((tag) => tag.trim());
        const newTags = tagsToAdd.filter((tag) => !currentTags.includes(tag));
        if (newTags.length > 0) {
          const updatedTags = [...currentTags, ...newTags];
          const updatedFrontMatter = frontMatter.replace(
            /tags:\s*\[.*?\]/,
            `tags: [${updatedTags.join(", ")}]`
          );
          return content.replace(
            frontMatterRegex,
            `---\n${updatedFrontMatter}\n---`
          );
        }
      } else {
        const updatedFrontMatter = `${frontMatter}\ntags: [${tagsToAdd.join(
          ", "
        )}]`;
        return content.replace(
          frontMatterRegex,
          `---\n${updatedFrontMatter}\n---`
        );
      }
    } else {
      return `---\ntags: [${tagsToAdd.join(", ")}]\n---\n\n${content}`;
    }

    return content;
  }

  addTagsToContent(content: string, tagsToAdd: string[]): string {
    if (this.settings.useFrontMatter) {
      return this.addTagsToFrontMatter(content, tagsToAdd);
    } else {
      return this.addTagsAsPlainText(content, tagsToAdd);
    }
  }

  addTagsAsPlainText(content: string, tagsToAdd: string[]): string {
    const existingTagsMatch = content.match(/^(#\w+\s*)+/);
    const existingTags = existingTagsMatch
      ? existingTagsMatch[0].split(/\s+/).map((tag) => tag.slice(1))
      : [];

    const newTags = tagsToAdd.filter((tag) => !existingTags.includes(tag));

    if (newTags.length === 0) {
      return content; // No new tags to add
    }

    const newTagString = newTags.map((tag) => `#${tag}`).join(" ");

    if (existingTagsMatch) {
      return content.replace(
        /^(#\w+\s*)+/,
        `${existingTagsMatch[0]} ${newTagString}\n\n`
      );
    } else {
      return `${newTagString}\n\n${content}`;
    }
  }

  removeTagsFromContent(content: string): string {
    if (this.settings.useFrontMatter) {
      return this.removeTagsFromFrontMatter(content);
    } else {
      return this.removeTagsFromPlainText(content);
    }
  }

  removeTagsFromPlainText(content: string): string {
    return content.replace(/^(#\w+\s*)+\n*/, "");
  }
}

class TagFolderModal extends Modal {
  plugin: TagITPlugin;
  folder: TFolder;
  tagInput: TextComponent;
  folderNameInput: TextComponent;
  isNewFolder: boolean;

  constructor(
    app: App,
    plugin: TagITPlugin,
    folder: TFolder,
    isNewFolder: boolean = false
  ) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
    this.isNewFolder = isNewFolder;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tagit-modal");

    // Create header
    const headerEl = contentEl.createEl("div", { cls: "tagit-modal-header" });
    const logoEl = headerEl.createEl("div", { cls: "tagit-logo" });
    logoEl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="css-i6dzq1"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;
    logoEl.createSpan({ text: "TagIT" });

    // Create content container
    const contentContainer = contentEl.createEl("div", {
      cls: "tagit-modal-content",
    });

    const titleEl = contentContainer.createEl("h2", {
      text: this.isNewFolder ? "New Folder Created" : "Edit Folder",
      cls: "modal-title",
    });

    const folderNameContainer = contentContainer.createEl("div", {
      cls: "input-container",
    });
    folderNameContainer.createEl("label", {
      text: "Folder Name:",
      attr: { for: "folder-name-input" },
    });
    this.folderNameInput = new TextComponent(folderNameContainer)
      .setPlaceholder("Enter folder name")
      .setValue(this.folder.name);
    this.folderNameInput.inputEl.id = "folder-name-input";

    const tagContainer = contentContainer.createEl("div", {
      cls: "input-container",
    });
    tagContainer.createEl("label", {
      text: "Tags:",
      attr: { for: "tag-input" },
    });
    this.tagInput = new TextComponent(tagContainer).setPlaceholder(
      "Enter tags (comma-separated)"
    );
    this.tagInput.inputEl.id = "tag-input";

    if (!this.isNewFolder) {
      const currentTags =
        this.plugin.settings.folderTags[this.folder.path] || [];
      this.tagInput.setValue(currentTags.join(", "));
    }

    const buttonContainer = contentContainer.createEl("div", {
      cls: "button-container",
    });

    if (!this.isNewFolder) {
      const removeButton = buttonContainer.createEl("button", {
        text: "Remove All Tags",
        cls: "mod-warning",
      });
      removeButton.addEventListener("click", this.removeTags.bind(this));
    }

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.close());

    const saveButton = buttonContainer.createEl("button", {
      text: this.isNewFolder ? "Create" : "Save",
      cls: "mod-cta",
    });
    saveButton.addEventListener("click", this.saveChanges.bind(this));

    // Add event listener for Enter key
    this.tagInput.inputEl.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.saveChanges();
        }
      }
    );

    this.folderNameInput.inputEl.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.saveChanges();
        }
      }
    );
  }

  async saveChanges() {
    const newFolderName = this.folderNameInput.getValue().trim();
    const tags = this.tagInput
      .getValue()
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag);

    if (newFolderName) {
      try {
        if (this.isNewFolder || newFolderName !== this.folder.name) {
          const newPath = this.folder.parent
            ? `${this.folder.parent.path}/${newFolderName}`
            : newFolderName;
          await this.app.fileManager.renameFile(this.folder, newPath);
          console.log(`Folder renamed to: ${newPath}`);
        }

        const oldTags = this.plugin.settings.folderTags[this.folder.path] || [];
        const newTags = tags.filter((tag) => !oldTags.includes(tag));

        this.plugin.settings.folderTags[this.folder.path] = tags;
        await this.plugin.saveSettings();
        console.log(`Tags saved for folder ${this.folder.path}:`, tags);

        // Apply new tags to existing files
        if (newTags.length > 0) {
          await this.plugin.applyTagsToExistingFiles(this.folder, newTags);
        }

        new Notice(`Folder "${newFolderName}" updated with tags`);
        this.close();
      } catch (error) {
        console.error(`Error updating folder:`, error);
        new Notice(`Error updating folder: ${error}`);
      }
    } else {
      new Notice("Please enter a folder name");
    }
  }

  async removeTags() {
    await this.plugin.removeFolderTags(this.folder);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class CreateFolderModal extends Modal {
  plugin: TagITPlugin;
  parentFolder: TFolder;
  folderNameInput: TextComponent;
  tagInput: TextComponent;

  constructor(app: App, plugin: TagITPlugin, parentFolder: TFolder) {
    super(app);
    this.plugin = plugin;
    this.parentFolder = parentFolder;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tagit-modal");

    // Create header
    const headerEl = contentEl.createEl("div", { cls: "tagit-modal-header" });
    const logoEl = headerEl.createEl("div", { cls: "tagit-logo" });
    logoEl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="css-i6dzq1"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;
    logoEl.createSpan({ text: "TagIT" });

    // Create content container
    const contentContainer = contentEl.createEl("div", {
      cls: "tagit-modal-content",
    });

    const titleEl = contentContainer.createEl("h2", {
      text: "Create Folder with Tags",
      cls: "modal-title",
    });

    const folderNameContainer = contentContainer.createEl("div", {
      cls: "input-container",
    });
    folderNameContainer.createEl("label", {
      text: "Folder Name:",
      attr: { for: "new-folder-name-input" },
    });
    this.folderNameInput = new TextComponent(
      folderNameContainer
    ).setPlaceholder("Enter folder name");
    this.folderNameInput.inputEl.id = "new-folder-name-input";

    const tagContainer = contentContainer.createEl("div", {
      cls: "input-container",
    });
    tagContainer.createEl("label", {
      text: "Tags:",
      attr: { for: "new-tag-input" },
    });
    this.tagInput = new TextComponent(tagContainer).setPlaceholder(
      "Enter tags (comma-separated)"
    );
    this.tagInput.inputEl.id = "new-tag-input";

    const buttonContainer = contentContainer.createEl("div", {
      cls: "button-container",
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.close());

    const createButton = buttonContainer.createEl("button", {
      text: "Create",
      cls: "mod-cta",
    });
    createButton.addEventListener("click", this.createFolder.bind(this));

    // Add event listener for Enter key
    this.tagInput.inputEl.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.createFolder();
        }
      }
    );

    this.folderNameInput.inputEl.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.createFolder();
        }
      }
    );
  }

  async createFolder() {
    const folderName = this.folderNameInput.getValue().trim();
    const tags = this.tagInput
      .getValue()
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag);

    if (folderName) {
      try {
        const newFolder = await this.app.vault.createFolder(
          `${this.parentFolder.path}/${folderName}`
        );
        this.plugin.settings.folderTags[newFolder.path] = tags;
        await this.plugin.saveSettings();
        console.log(`Folder created: ${newFolder.path}, Tags:`, tags);
        new Notice(`Folder "${folderName}" created with tags`);
        this.close();
      } catch (error) {
        console.error(`Error creating folder:`, error);
        new Notice(`Error creating folder: ${error}`);
      }
    } else {
      new Notice("Please enter a folder name");
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class TagITSettingTab extends PluginSettingTab {
  plugin: TagITPlugin;

  constructor(app: App, plugin: TagITPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "TagIT Settings" });

    containerEl.createEl("p", {
      text:
        "TagIT enhances Obsidian's tagging system by associating YAML tags with folders. " +
        "It allows you to automatically apply tags to files based on their location in your vault structure.",
    });

    new Setting(containerEl)
      .setName("Use Front Matter")
      .setDesc("Toggle between using front matter or plain text for tags")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useFrontMatter)
          .onChange(async (value) => {
            this.plugin.settings.useFrontMatter = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
