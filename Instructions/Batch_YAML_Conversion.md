# Feature Request: Batch Convert Plain Text Tags to YAML Front Matter

## Overview

Implement a new feature in the TagIt plugin that allows users to batch convert plain text tags to YAML front matter in multiple note files simultaneously. This functionality will enhance user efficiency by streamlining the tag management process for large numbers of notes.

## Features

- **Multi-File Selection**: Allow users to select multiple note files within the Obsidian file explorer.
- **Context Menu Access**: Enable a right-click context menu option labeled "Convert to YAML" when one or more files are selected.
- **Top 3 Lines Scanning**: The conversion process scans only the top three lines of each file for plain text tags.
- **Silent Conversion with Warning**: Apply the conversion without confirmation prompts, displaying a warning pop-up upon completion to summarize the actions taken.

## Detailed Description

### 1. Multi-File Selection

- **Implementation**: Utilize Obsidian's native multi-selection capabilities in the file explorer.
- **User Interaction**: Users can select multiple files using Shift (for range selection) or Ctrl/Cmd (for individual selection) clicks.

### 2. Context Menu Option

- **Right-Click Access**: When one or more files are selected, right-clicking brings up a context menu with the option "Convert to YAML."
- **Menu Availability**: Ensure that this option is only visible when the selection includes markdown note files.

### 3. Conversion Process

- **Scanning Top 3 Lines**:
  - The script scans only the first three lines of each selected file.
  - This limitation focuses on the typical location of inline tags and improves performance.
- **Tag Detection**:
  - Identify inline tags formatted as `#tag`, `#tag/subtag`, or `#tag1 #tag2`.
  - Support for multiple tags on a single line and across the three lines.
- **YAML Front Matter Insertion**:
  - If the file lacks YAML front matter, insert a new YAML block at the top.
  - Add a `tags` field containing all detected tags.
  - Maintain proper YAML formatting to ensure compatibility.
- **Cleanup**:
  - Remove the original inline tags from the top three lines after they have been moved to YAML.
  - Leave the rest of the file content untouched.

### 4. Silent Conversion with Warning

- **No Confirmation Prompts**:
  - The conversion proceeds without asking the user for confirmation for each file.
  - This design choice streamlines the process, especially when dealing with many files.
- **Warning Pop-Up**:
  - After the conversion completes, display a summary pop-up.
  - The pop-up includes:
    - The number of files processed.
    - The number of files successfully converted.
    - Any errors encountered (e.g., files already containing YAML tags, read-only files).
  - Include a disclaimer about the irreversibility of the action unless the user manually reverts changes.

## Technical Requirements

- **File Handling**:
  - Ensure the script handles file encoding correctly (e.g., UTF-8).
  - Implement proper error handling for files that cannot be read or written.
- **Performance Optimization**:
  - Process files asynchronously if possible to avoid freezing the UI.
  - Limit resource usage to prevent degradation of Obsidian's performance.
- **Compatibility**:
  - The feature should be compatible with Obsidian v0.15.0 and above.
  - Ensure it works across Windows, macOS, and Linux platforms.
- **Testing**:
  - Test with various file sizes and content to ensure robustness.
  - Verify that existing YAML front matter in files remains unaltered unless tags are added.

## User Interface Changes

- **Context Menu Addition**:
  - Add "Convert to YAML" in the right-click context menu for file selections.
  - Use a separator to group it logically with other TagIt plugin options.
- **Warning Pop-Up Design**:
  - Match the aesthetic of Obsidian's native notifications.
  - Provide clear messaging and an option to "Do not show this again" (stored in plugin settings).

## Developer Notes

- **Code Structure**:
  - Modularize the code to separate UI elements from file processing logic.
  - Reuse existing functions from the "Convert Inline Tags to YAML" feature where possible.
- **Settings Integration**:
  - Consider adding a toggle in the plugin settings to enable/disable the warning pop-up.
  - Optionally, allow users to set the number of lines to scan (default to 3).
- **Logging**:
  - If Debug Mode is enabled, log detailed information about the conversion process.
  - Include information about any files that were skipped or encountered errors.

## Acceptance Criteria

- Users can select multiple note files and batch convert inline tags to YAML front matter.
- The conversion affects only the top three lines of each file.
- No confirmation dialogs appear during the process, except for the final warning pop-up.
- The feature does not interfere with other functionalities of the TagIt plugin or Obsidian.
- The implementation follows best coding practices and is maintainable.

## Steps for Implementation

1. **Enhance File Selection**:
   - Verify that multi-file selection is supported in the file explorer.
2. **Add Context Menu Option**:
   - Modify the plugin to add "Convert to YAML" in the right-click menu for file selections.
3. **Develop Conversion Logic**:
   - Write a function that processes each file:
     - Reads the top three lines.
     - Detects and extracts inline tags.
     - Inserts or updates the YAML front matter with these tags.
     - Removes the original inline tags from the top three lines.
   - Handle edge cases, such as existing YAML front matter or no tags found.
4. **Implement Silent Processing**:
   - Ensure the function runs without user prompts during processing.
5. **Create Warning Pop-Up**:
   - After processing, display a summary pop-up with relevant information.
6. **Testing**:
   - Conduct unit tests on the conversion function with various file contents.
   - Perform integration testing within Obsidian.
   - Test across different operating systems.
7. **Update Documentation**:
   - Add instructions for the new feature in the README and any in-app help sections.
   - Provide examples or screenshots if beneficial.
8. **Release**:
   - Prepare the plugin for release, ensuring all new code is documented and reviewed.
   - Update the version number and changelog accordingly.

## Potential Challenges

- **File Encoding Issues**:
  - Ensure the script handles different text encodings to avoid data corruption.
- **Large File Handling**:
  - While only the top three lines are read, ensure the file I/O operations are efficient.
- **User Error Mitigation**:
  - Users might accidentally select non-note files; implement checks to process only valid markdown files.

## Additional Considerations

- **User Education**:
  - Inform users about the irreversible nature of the batch conversion unless they have version control or backups.
- **Future Expansion**:
  - Consider allowing users to customize the number of lines scanned or patterns detected (advanced settings).
- **Community Feedback**:
  - After implementation, gather user feedback to refine the feature in subsequent updates.

---

By implementing this feature, the TagIt plugin will offer enhanced tag management capabilities, saving users time and effort when organizing their notes. The detailed description and technical requirements provided should equip the developer with all necessary information to add this functionality effectively.
