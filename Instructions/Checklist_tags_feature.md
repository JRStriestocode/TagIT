# Feature Request: Apply Tags to Markdown Checklists

## Overview

Add a feature in the [Plugin Name] plugin that allows users to apply tags to individual or multiple checklist items within a markdown note. This functionality will make organizing and categorizing checklist items more effective, providing an easy way to tag tasks based on content or urgency.

## Features

- **Highlight Checklist Items**: Allow users to highlight one or more checklist items within a note.
- **Right-Click Context Menu**: Provide an option called "Apply Tag" when users right-click the selected items.
- **Modal for Tagging**:
  - **Tag Input Field**: An input field to specify the desired tag.
  - **Urgency Field**: A dropdown list with urgency levels represented by emojis:
    - 🟢 (Low)
    - 🟡 (Moderate)
    - 🟠 (Important)
    - 🔴 (Critical)
    - ⚪️ (Default, no urgency)
  - **Buttons**:
    - **Apply Button**: Applies the tag and urgency level to the selected checklist items.
    - **Cancel Button**: Closes the modal without making any changes.
- **Tag and Urgency Assignment**: Append the specified hashtag to the end of each checklist item, followed by the chosen urgency emoji if applicable.
  - **Default Behavior**: The default selection is ⚪️ (no urgency), meaning no emoji will be added if this is selected.

## Detailed Description

### 1. Highlight Checklist Items

- **User Interaction**: The user can highlight one or multiple checklist items within a markdown note.
- **Multiple Selection**: Users can select multiple consecutive checklist items to apply tags in bulk.

### 2. Context Menu Option

- **Right-Click Access**: When the user right-clicks on a highlighted selection, they should see an "Apply Tag" option in the context menu.
- **Menu Availability**: This option is only visible when checklist items are selected.

### 3. Tagging Modal

- **Modal Design**:
  - The modal contains an input field for entering a tag.
  - The **Urgency Field** dropdown has five options, each represented by a distinct emoji to indicate urgency.
  - The **Apply Button** commits the changes, while the **Cancel Button** closes the modal.
- **Urgency Field Behavior**:
  - **Default Selection**: ⚪️ is the default, and when selected, no emoji is appended to the checklist item.
  - **Other Selections**: 🟢, 🟡, 🟠, 🔴 emojis are appended to each checklist item to indicate urgency.

### 4. Tag and Urgency Assignment

- **Appending Tags**:
  - The hashtag entered by the user is appended at the end of each checklist item.
  - If an urgency level other than ⚪️ is chosen, the respective emoji is appended after the tag.
- **Example**:
  - Checklist item before: `- [ ] Complete project documentation`
  - After applying tag and urgency: `- [ ] Complete project documentation #project 🔴`

## Technical Requirements

- **Context Menu Integration**:
  - Add an "Apply Tag" option to the right-click menu for checklist items.
- **Modal Implementation**:
  - Use Obsidian's modal elements to create a user-friendly tagging interface.
- **Tag and Emoji Assignment**:
  - Implement logic to append the entered hashtag and urgency emoji to each selected checklist item.
- **Error Handling**:
  - Handle scenarios where no tag is entered or if the input is invalid.

## User Interface Changes

- **Right-Click Context Menu**:
  - Add the "Apply Tag" option when checklist items are highlighted.
- **Modal Design**:
  - Include an input field for tags, an urgency dropdown, and Apply/Cancel buttons.

## Developer Notes

- **Code Structure**:
  - Separate the UI code for the modal from the logic for applying tags and urgency.
  - Reuse any existing tag management functions where possible.
- **Settings Integration**:
  - Optionally add a setting that allows users to customize the urgency emojis or add new urgency levels.

## Acceptance Criteria

- Users can highlight one or more checklist items and right-click to apply a tag.
- A modal appears with an input field for tags and an urgency dropdown.
- The specified tag and urgency emoji (if applicable) are appended to each selected checklist item.
- The modal can be dismissed with the Cancel button without making changes.

## Steps for Implementation

1. **Add Context Menu Option**:
   - Modify the plugin to add the "Apply Tag" option in the right-click menu for checklist items.
2. **Create Tagging Modal**:
   - Design and implement a modal that contains an input field, urgency dropdown, and buttons.
3. **Develop Tagging Logic**:
   - Write a function that appends the specified tag and urgency emoji to the selected checklist items.
4. **Testing**:
   - Conduct unit tests on the tagging functionality for both single and multiple checklist items.
   - Perform integration testing within Obsidian to ensure the context menu and modal work as expected.
5. **Documentation**:
   - Update README with instructions for the new feature.
6. **Release**:
   - Prepare the updated plugin for release, updating the version and changelog.

## Additional Considerations

- **User Education**:
  - Provide a tutorial or example in the documentation to demonstrate how to use the new feature effectively.
- **Community Feedback**:
  - Gather feedback from users to further refine the feature and add additional customization options if requested.

---

This feature will enhance task management by allowing users to quickly categorize and prioritize checklist items with tags and urgency levels. Let me know if there are any further adjustments needed!
