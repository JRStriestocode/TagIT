# TagIt - Folder Tags Plugin for Obsidian

[![Release](https://img.shields.io/github/v/release/JRStriestocode/TagIT)](https://github.com/JRStriestocode/TagIT/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Enhance your note-taking experience in [Obsidian](https://obsidian.md/) by associating YAML tags with folders. **TagIt** allows you to automatically manage tags for files based on their folder location, providing better organization and streamlined workflows.

## Features

- **Folder Tagging**: Associate YAML tags with folders to automatically apply them to files within.
- **Automatic Tag Application**: New files inherit tags from their parent folder.
- **Tag Inheritance Customization**: Choose how tags are inherited in nested folders.
  - **None**: No tag inheritance.
  - **Immediate**: Inherit tags from the immediate parent folder.
  - **All**: Inherit tags from all parent folders.
- **Visual Indicators**: Display icons next to folders with tags for easy identification.
- **Inline Tag Conversion**: Convert inline tags within notes to YAML front matter tags.
- **Bulk Tag Application**: Apply folder tags to all existing notes within a folder.
- **File Movement Handling**: Manage tags when moving files between folders with different tags.
- **Obsidian Tag Pane Integration**: Folder tags appear in Obsidian's native tag pane.
- **Advanced Settings**: Customize plugin behavior through a dedicated settings tab.
- **Performance Optimizations**: Efficiently handle large vaults with minimal impact on performance.
- **Theme Compatibility**: Plugin UI adapts to both light and dark themes.

## Installation

### From Obsidian Community Plugins

1. Open **Obsidian** and navigate to **Settings** > **Community plugins**.
2. Click on **Browse** and search for **TagIt**.
3. Click **Install** next to the TagIt plugin.
4. After installation, enable the plugin by toggling it on in the **Installed plugins** list.

### Manual Installation

1. Download the latest release from the [Releases](https://github.com/JRStriestocode/TagIT/releases) page.
2. Extract the contents of the zip file.
3. Copy `main.js`, `manifest.json`, and `styles.css` into a new folder named `TagIT` in your vault's `.obsidian/plugins` directory.
4. Open **Obsidian** and navigate to **Settings** > **Community plugins**.
5. Enable **TagIt** in the **Installed plugins** list.

## Usage

### Adding Tags to Folders

- **Right-Click Method**:

  - Right-click on a folder in the file explorer.
  - Select **Add/Edit Folder Tags**.
  - Enter tags (comma-separated) in the modal that appears.
  - Click **Save** to apply the tags to the folder.

- **Command Palette**:
  - Open the command palette with `Ctrl+P` (or `Cmd+P` on Mac).
  - Search for **Add/Edit tags for current folder**.
  - Enter tags in the modal and save.

### Tag Inheritance

Configure how tags are inherited in nested folders via **Settings** > **TagIt**:

- **None**: Only apply tags set directly on the folder.
- **Immediate**: Inherit tags from the immediate parent folder.
- **All**: Inherit tags from all parent folders, recursively.

### File Movement Handling

When moving files between folders with different tags, a modal appears with options:

- **Replace All**: Replace all existing tags with the new folder's tags.
- **Merge**: Keep existing tags and add the new folder's tags.
- **No Action**: Keep tags as they are.

### Bulk Tag Application

- Right-click on a folder.
- Select **Apply Folder Tags to Notes**.
- The folder's tags will be merged with existing tags on all notes within the folder.

### Converting Inline Tags to YAML

- Right-click on a note.
- Select **Convert Inline Tags to YAML**.
- Inline tags (`#tag`) within the note will be moved to the YAML front matter.

## Configuration

Access plugin settings via **Settings** > **TagIt**:

- **Tag Inheritance Mode**: Choose tag inheritance behavior.
- **Excluded Folders**: Specify folders to exclude from tag inheritance.
- **Show Folder Icons**: Toggle the display of icons next to tagged folders.
- **Auto-apply Tags**: Automatically apply folder tags to new files.
- **Debug Mode**: Enable detailed logging for troubleshooting.

## Compatibility

- **Obsidian Version**: Tested with Obsidian v0.15.0 and above.
- **Operating Systems**: Compatible with Windows, macOS, and Linux.
- **Themes**: Supports both light and dark themes.

## Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the Repository**: Click the **Fork** button at the top right of this page.
2. **Clone Your Fork**: `git clone https://github.com/JRStriestocode/TagIT.git`
3. **Create a Branch**: `git checkout -b feature/my-feature`
4. **Make Changes**: Implement your feature or bug fix.
5. **Commit Changes**: `git commit -am 'Add new feature'`
6. **Push to Branch**: `git push origin feature/my-feature`
7. **Open a Pull Request**: Submit your changes for review.

Please ensure your code adheres to the project's coding conventions and passes all tests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Obsidian Community](https://obsidian.md/community) for their support and inspiration.
- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api) for providing the tools to develop this plugin.
- Icons made by [Feather Icons](https://feathericons.com/) licensed under the MIT License.
