# Product Requirements Document (PRD)

## **Project Title:** TagIt - Obsidian Folder Tagging Plugin

---

## **Table of Contents**

1. [Introduction](#introduction)
2. [Objectives and Goals](#objectives-and-goals)
3. [Functional Requirements](#functional-requirements)
   - [Core Functionalities](#core-functionalities)
   - [Additional Functionalities](#additional-functionalities)
4. [Non-Functional Requirements](#non-functional-requirements)
   - [User Experience Enhancements](#user-experience-enhancements)
   - [Technical Considerations](#technical-considerations)
5. [Technical Specifications](#technical-specifications)
   - [Tech Stack](#tech-stack)
   - [Development Tools](#development-tools)
6. [Implementation Plan](#implementation-plan)
   - [Phase 1: Setup and Initialization](#phase-1-setup-and-initialization)
   - [Phase 2: Core Functionalities Implementation](#phase-2-core-functionalities-implementation)
   - [Phase 3: Additional Functionalities Implementation](#phase-3-additional-functionalities-implementation)
   - [Phase 4: Testing and Quality Assurance](#phase-4-testing-and-quality-assurance)
   - [Phase 5: Release and Maintenance](#phase-5-release-and-maintenance)
7. [Potential Issues and Solutions](#potential-issues-and-solutions)
8. [Appendices](#appendices)
   - [Modal Code Example](#modal-code-example)
   - [Current File Structure](#current-file-structure)

---

## **Introduction**

**TagIt** is an Obsidian plugin designed to enhance the note-taking experience by allowing users to associate YAML tags with folders. This facilitates better organization and automation by automatically tagging markdown files based on their containing folder. The plugin provides intuitive UI elements for managing tags and integrates seamlessly with Obsidian's existing features.

---

## **Objectives and Goals**

- **Streamline Tag Management**: Simplify the process of adding and managing tags for files within Obsidian.
- **Enhance Organization**: Automatically apply folder-associated tags to files, improving searchability and categorization.
- **User-Friendly Interface**: Provide intuitive modals and context menu options for ease of use.
- **Customization and Flexibility**: Offer settings and features that cater to different user preferences and workflows.

---

## **Functional Requirements**

### **Core Functionalities**

1. **Folder Creation Popup**

   - **Trigger Popup on Folder Creation**: When a new folder is created, a modal popup appears.
   - **Modal Components**:
     - TagIt logo in the top-left corner.
     - Close button in the top-right corner.
     - 'Folder Name' field (prefilled with the folder name).
     - 'Tags' field for inputting tags.
     - 'Cancel' and 'Save' buttons (pressing Enter saves).
   - **Functionality**:
     - Users can assign tags to the new folder.
     - Tags are stored and associated with the folder.

2. **Adding Tags via Command Palette and Right-Click**

   - **Command Palette Integration**: Commands to add or edit folder tags.
   - **Right-Click Context Menu**:
     - Options to 'Create Folder with Tags' and 'Apply Tags to Folder'.
     - Opens a modal similar to the creation popup.
     - Additional 'Remove All Tags' button to delete tags from the folder and its child files.

3. **Hashtag Management**

   - **Apply File Tags to Folder**:
     - Right-click on a note to add its tags to the containing folder.
     - Popup displays extracted tags with editing capabilities.
     - User confirmation required before applying tags to all files in the folder.
   - **Convert Inline Tags to YAML**:
     - Right-click option 'Convert Tags to YAML' on markdown files.
     - Scans the top three lines for plain text tags.
     - Adds new tags to YAML front matter and removes them from the content.
     - User warning about tag removal before proceeding.

4. **Automatic Application of Folder Tags to Files**

   - **New Files**: Tags are added to the YAML front matter of new files created within tagged folders.
   - **Moved Files**:
     - Files moved into tagged folders are checked for existing tags.
     - Missing tags are added to the YAML front matter.
   - **Existing Tags**: Tags are not duplicated if already present.

5. **Editing and Deleting Folder Tags**

   - **Edit Tags**: Right-click on a folder to edit associated tags via a modal.
   - **Delete Tags**:
     - 'Remove All Tags' button to delete tags from the folder and all child files.
     - Returns the folder to default (no tags).

### **Additional Functionalities**

1. **Automatic Tag Removal When Files Are Moved Out of Folders**

   - **Description**: Option to automatically remove folder-associated tags from a file's YAML front matter when moved out of a tagged folder.
   - **Implementation**:
     - Plugin setting to enable/disable this feature.
     - Listens for file movement events.
     - Removes tags upon detection of movement out of tagged folders.

2. **Tagging Exclusions and Overrides**

   - **Description**: Users can specify files or subfolders to exclude from inheriting tags.
   - **Implementation**:
     - Special front matter property (e.g., `tagit: false`) to exclude files.
     - Option to override inherited tags with file-specific tags.

3. **Visual Indicators for Tagged Folders**

   - **Description**: Display icons or color highlights next to tagged folders in the file explorer.
   - **Implementation**:
     - Custom CSS classes to modify folder appearance.
     - Settings to toggle visual indicators.

4. **Batch Tag Application**

   - **Description**: Apply or remove tags from multiple files or folders simultaneously.
   - **Implementation**:
     - Multi-select feature in the file explorer context menu.
     - Options for bulk tag operations.

5. **Tag Inheritance Customization**

   - **Description**: Customize tag inheritance in nested folders.
     - Inherit tags from all parent folders.
     - Inherit only from the immediate parent.
     - Exclude certain parent folders.
   - **Implementation**:
     - Settings or configuration file to define inheritance rules.
     - UI options for adjustments.

6. **Integration with Obsidian’s Tag Pane**

   - **Description**: Reflect folder-associated tags in Obsidian’s native Tag Pane.
   - **Implementation**:
     - Ensure tags added by the plugin are indexed by Obsidian.
     - Compatibility testing with the Tag Pane.

7. **Customization of Tag Storage Location**

   - **Description**: Users can choose where tags are stored:
     - In the YAML front matter.
     - As inline tags within the document body.
   - **Implementation**:
     - Plugin settings to select storage method.
     - Adjust tag application logic accordingly.

8. **Import and Export of Folder Tag Configurations**

   - **Description**: Export folder-tag mappings and import them into another vault.
   - **Implementation**:
     - Functions to serialize and deserialize mappings.
     - UI options for importing and exporting.

9. **Conflict Resolution Mechanism**

   - **Description**: Handle conflicts when multiple folders assign the same tag differently.
   - **Implementation**:
     - Detect conflicting tag assignments.
     - Prompt user for conflict resolution options.
     - Create duplication handling logic.

10. **Performance Optimization for Large Vaults**

    - **Description**: Optimize plugin performance in large vaults.
    - **Implementation**:
      - Caching folder-tag mappings.
      - Debouncing rapid file operations.
      - Options to limit folder scanning depth.

11. **Enhanced User Interface Elements**

    - **Description**: Improve UI components for better user experience.
      - Drag-and-drop tags in the modal.
      - Dedicated settings tab.
      - Theme compatibility (light/dark modes).
    - **Implementation**:
      - Utilize Obsidian’s UI libraries.
      - Test UI elements across themes and screen sizes.

12. **Detailed Logging and Audit Trail**

    - **Description**: Keep a log of all tagging actions for user review.
    - **Implementation**:
      - Write logs to a designated file within the vault.
      - UI component to view and search logs.

13. **Undo/Redo Functionality**

    - **Description**: Allow users to undo and redo tagging actions.
    - **Implementation**:
      - Implement an action history stack.
      - Integrate with Obsidian’s undo/redo system if possible.

14. **User Notifications and Feedback**

    - **Description**: Provide notifications when tags are applied, edited, or removed.
    - **Implementation**:
      - Use Obsidian’s notification system.
      - Settings to configure notification verbosity.

15. **Integration with Other Plugins**

    - **Description**: Ensure compatibility with popular plugins like Dataview, Templater, and Calendar.
    - **Implementation**:
      - Test compatibility.
      - Provide documentation on integrations.

16. **Automated Tag Updates on Folder Tag Changes**

    - **Description**: Option to automatically update existing files when folder tags change.
    - **Implementation**:
      - Prompt user after changing folder tags.
      - Execute batch updates safely.

---

## **Non-Functional Requirements**

### **User Experience Enhancements**

- **Customizable Keyboard Shortcuts**: Assign shortcuts to common actions (e.g., opening the Tag Input Modal).
- **Accessibility**: Ensure all UI elements are accessible via keyboard navigation and screen readers.
- **Theme Compatibility**: Plugin UI should adapt to Obsidian's light and dark modes.

### **Technical Considerations**

- **Error Handling and Recovery**: Robust error handling to manage file access errors or conflicts.
- **Performance**: Optimize for responsiveness, especially in large vaults.
- **Scalability**: Design the plugin to handle future feature additions and increased user base.
- **Security**: Ensure that file operations are secure and do not corrupt user data.
- **Testing and Quality Assurance**: Develop unit tests and perform extensive testing of file operations.
- **Documentation**: Provide clear documentation for users and developers.

---

## **Technical Specifications**

### **Tech Stack**

**Front End**

- **Language**: **TypeScript**
  - Static typing for error prevention and code maintainability.
- **UI Components**:
  - **Obsidian's Built-in UI Components**: Utilize Modals, Settings, etc.
  - **Custom Styling**: CSS to match Obsidian's themes.

**Back End**

- **Obsidian Plugin API**: Interact with core functionalities like file and folder management.
- **File System Access**: Use Obsidian's `Vault` API for file operations.
- **Event Handling**: Leverage Obsidian's event hooks (`onCreate`, `onModify`, `onDelete`).

**Database**

- **Obsidian Data Storage**:
  - Use `this.loadData()` and `this.saveData()` for plugin settings and mappings.
- **YAML Front Matter**: Store tags within markdown files for compatibility.

### **Development Tools**

- **Build Tools**: **Rollup**
- **Version Control**: **Git**
- **Testing Framework**: **Jest** (optional)
- **Code Linting and Formatting**: **ESLint** and **Prettier**

---

## **Implementation Plan**

### **Phase 1: Setup and Initialization**

1. **Development Environment Setup**

   - Install Node.js and npm.
   - Install Obsidian and create a test vault.

2. **Initialize Plugin Project**

   - Create plugin directory in `.obsidian/plugins/`.
   - Initialize `package.json` and install dependencies.
   - Set up TypeScript and Rollup configurations.

3. **Version Control Setup**

   - Initialize Git repository.
   - Create `.gitignore` and make initial commit.

4. **Basic Plugin Structure**

   - Create `main.ts` and define the plugin class.
   - Add `manifest.json` with plugin metadata.

5. **Build and Test**
   - Build the plugin using Rollup.
   - Load and test the plugin in Obsidian.

### **Phase 2: Core Functionalities Implementation**

6. **Implement Folder Creation Popup**

   - Detect folder creation using Obsidian's API.
   - Create `FolderTagModal` class extending `Modal`.
   - Design modal layout and handle user input.
   - Maintain folder-tag mappings using plugin data storage.

7. **Add Tagging via Command Palette and Right-Click**

   - Register commands in the Command Palette.
   - Add context menu options for folders.
   - Ensure modals prefill existing tags when editing.

8. **Automatic Application of Folder Tags to Files**
   - Listen for file creation and movement events.
   - Retrieve folder tags and update YAML front matter.
   - Handle edge cases and test functionality.

### **Phase 3: Additional Functionalities Implementation**

9. **Hashtag Management Features**

   - Implement 'Convert Inline Tags to YAML' feature.
   - Add right-click context menu option for files.
   - Include user confirmation warnings.

10. **Editing and Deleting Folder Tags**

    - Modify `FolderTagModal` for editing.
    - Implement tag removal logic and update files accordingly.

11. **Implement Additional Functionalities**
    - Automatic tag removal when files are moved out.
    - Tagging exclusions and overrides.
    - Visual indicators for tagged folders.
    - Tag inheritance customization.
    - Integration with Obsidian's Tag Pane.
    - Customization of tag storage location.
    - Import/export of folder tag configurations.
    - Conflict resolution mechanism.
    - Performance optimizations.
    - Enhanced UI elements.
    - Detailed logging and audit trail.
    - Undo/redo functionality.
    - User notifications and feedback.
    - Integration with other plugins.
    - Automated tag updates on folder tag changes.

### **Phase 4: Testing and Quality Assurance**

12. **Implement Testing**

    - Write unit tests using Jest.
    - Perform manual testing across different scenarios.
    - Conduct code reviews for quality assurance.

13. **User Experience Enhancements**
    - Implement customizable keyboard shortcuts.
    - Ensure accessibility and theme compatibility.
    - Provide user documentation and help resources.

### **Phase 5: Release and Maintenance**

14. **Prepare for Release**

    - Update version numbers.
    - Build the final plugin package.

15. **Publish the Plugin**

    - Submit to Obsidian Community Plugins.
    - Provide necessary documentation and metadata.

16. **Ongoing Maintenance**
    - Monitor user feedback and bug reports.
    - Release updates following semantic versioning.

---

## **Potential Issues and Solutions**

### **Issue: Folder Creation Triggering on Load**

- **Problem**: On loading Obsidian, existing folders are treated as newly created, triggering the plugin to check all folders and causing popups for all existing folders.

- **Solution**:

  - **Check for Initial Load**: Implement a flag to detect the initial loading of the vault and prevent the folder creation event from triggering the modal during this phase.
  - **Delayed Initialization**: Introduce a short delay after the plugin loads before attaching the folder creation event listener.
  - **Filter Events**: Modify the event handler to differentiate between actual folder creation events and folder loading events on startup.
  - **Use Obsidian's Metadata**: Utilize Obsidian's metadata to check if a folder creation event is part of the initial vault loading process.

- **Implementation Steps**:

  - Adjust the `onCreate` event listener to include a condition that checks if the plugin is fully loaded and not in the initial loading phase.
  - Test the plugin by restarting Obsidian and ensuring that no unnecessary popups appear.

- **Best Practices**:
  - **Event Debouncing**: Implement debouncing on folder creation events during startup.
  - **User Experience**: Avoid overwhelming the user with popups, enhancing the overall user experience.

---

## **Appendices**

### **Modal Code Example**

```typescript
class FolderCreatedModal extends Modal {
  folder: TFolder;

  constructor(app: App, folder: TFolder) {
    super(app);
    this.folder = folder;
  }

  onOpen() {
    console.log("Modal opened");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New Folder Created" });
    contentEl.createEl("p", {
      text: `You created a new folder: ${this.folder.path}`,
    });
    contentEl.createEl("p", { text: `This folder is currently empty.` });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
```

### **Current File Structure**

.
├── Instuctions.md
├── copy-to-vault.js
├── main.ts
├── manifest.json
├── package-lock.json
├── package.json
├── rollup.config.js
└── tsconfig.json

1 directory, 8 files

---

# **Conclusion**

This PRD outlines the comprehensive plan for developing the **TagIt** Obsidian plugin. By following the structured implementation plan and addressing potential issues, the development process aims to be efficient and user-focused. The plugin is designed to enhance the organizational capabilities of Obsidian, providing users with powerful tools to manage tags at the folder level. Continuous testing and adherence to best practices will ensure a high-quality, reliable plugin that integrates seamlessly into the Obsidian ecosystem.
