# Feature Request: Convert Tags to YAML with Inheritance Options

## Overview

Implement a feature in the TagIT plugin that allows users to convert tags to YAML front matter with inheritance options. This feature will prompt users with a dialog box when they select "Convert to YAML," offering flexibility to apply changes across all notes within the targeted folder or only within the selected folder.

## Features

- **Dialog Box Prompt**: Display a dialog box when "Convert to YAML" is selected, showing the number of files affected.
- **Inheritance Options**:
  - **Convert All**: Convert tags to YAML for all notes within the selected folder and its subfolders.
  - **Convert Folder Only**: Restrict the conversion to tags in the selected folder only, excluding any subfolders.
  - **Cancel**: Option to cancel the operation.

## Detailed Description

### 1. Dialog Box Prompt

- **Implementation**: When users right-click and select "Convert to YAML," the plugin displays a dialog box listing the number of affected files.
- **User Choices**:
  - **Yes, Convert All (number of files)**: Applies the conversion to all notes within the selected folder and its subfolders, converting all plain text tags to YAML front matter.
  - **Only Convert This Folder (number of files)**: Limits the conversion to files in the selected folder, excluding subfolders.
  - **Cancel**: Allows the user to exit without making changes.

### 2. Inheritance Options

- **Convert All Option**: If the user selects this option, tags across all notes within the selected folder and its subfolders are converted to YAML in each file.
- **Folder-Specific Option**: If the user opts to convert only the selected folder, the conversion will apply solely to that folder’s notes without affecting any subfolders.
- **Cancel Option**: Closes the dialog box with no changes applied.

## Technical Requirements

- **Dialog Box Design**:
  - Use Obsidian’s UI elements to create a clear, intuitive dialog box that displays options.
- **File Handling**:
  - Implement functions to handle the conversion across all files in the selected folder and subfolders or only within the specific folder.
  - Ensure compatibility with existing YAML structures and error handling for read-only files.
- **Performance Optimization**:
  - Ensure efficient file processing to prevent slowdowns in large vaults.

## User Interface Changes

- **Right-Click Context Menu**:
  - Build onto the existing "Convert to YAML" option within the folder’s right-click menu.
- **Dialog Box Display**:
  - Include the number of affected files in the dialog box for user clarity.

## Developer Notes

- **Code Structure**:
  - Separate dialog box code from file processing functions for better maintainability.
- **Settings Integration**:
  - Add an optional setting to allow users to disable the dialog box for a quicker experience.

## Acceptance Criteria

- When "Convert to YAML" is selected, a dialog box appears with options to convert all notes within the selected folder and subfolders or only notes within the selected folder.
- The number of affected files displays accurately in the dialog box.
- The conversion is executed according to the selected option.

## Steps for Implementation

1. **Create Dialog Box**:
   - Design a dialog box that displays file count and inheritance options.
2. **Inheritance Logic**:
   - Implement code to detect all files within the selected folder and its subfolders, or only files within the chosen folder.
3. **Conversion Execution**:
   - Write a function that processes each file, moving plain text tags to YAML.
4. **Testing**:
   - Test across various folder structures to ensure accuracy.
5. **Documentation**:
   - Update README with instructions for the new feature.
6. **Release**:
   - Prepare the updated plugin for release, updating the version and changelog.

## Additional Considerations

- **User Education**:
  - Explain in documentation how inheritance options work and how they can be used effectively.
- **Community Feedback**:
  - Gather user input to refine and improve this feature in future versions.
