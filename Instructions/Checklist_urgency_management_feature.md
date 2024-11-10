# Feature Request: Change Urgency for Checklist Items

## Overview

Add a feature to the [Plugin Name] plugin that allows users to add, amend, or remove urgency levels for individual checklist items through a secondary right-click menu. This feature will enable users to quickly adjust the priority of checklist items by selecting a predefined urgency level or removing it altogether.

## Features

- **Right-Click Context Menu for Urgency**:
  - Add a new right-click option labeled "Change Urgency" for checklist items.
  - Provide a secondary context menu with urgency level options:
    - 🟢 (Low)
    - 🟡 (Moderate)
    - 🟠 (Important)
    - 🔴 (Critical)
    - ⚪️ (Default, no urgency)
- **Dynamic Application of Urgency**:
  - If no urgency is applied, the selected urgency level will be added to the checklist item.
  - If an urgency is already applied, the urgency level will be replaced with the newly selected one.
  - If "⚪️ (Default, no urgency)" is selected, any existing urgency will be removed from the checklist item.

## Detailed Description

### 1. Right-Click Context Menu for Urgency

- **User Interaction**:
  - The user can right-click on any checklist item to access the "Change Urgency" option.
  - Selecting this option opens a secondary context menu with the five urgency levels.

### 2. Urgency Level Options

- **Urgency Options Available**:
  - 🟢 (Low)
  - 🟡 (Moderate)
  - 🟠 (Important)
  - 🔴 (Critical)
  - ⚪️ (Default, no urgency)
- **Behavior Based on Current State**:
  - **No Existing Urgency**: The selected urgency level is added to the checklist item.
  - **Existing Urgency**: The urgency level is updated to the newly selected value.
  - **Remove Urgency**: Selecting ⚪️ removes any existing urgency emoji from the checklist item.

### 3. Example Workflow

- **Add Urgency**:
  - Checklist item before: `- [ ] Complete project documentation`
  - After selecting 🟠 (Important): `- [ ] Complete project documentation 🟠`
- **Amend Urgency**:
  - Checklist item before: `- [ ] Complete project documentation 🟡`
  - After selecting 🔴 (Critical): `- [ ] Complete project documentation 🔴`
- **Remove Urgency**:
  - Checklist item before: `- [ ] Complete project documentation 🟠`
  - After selecting ⚪️ (Default, no urgency): `- [ ] Complete project documentation`

## Technical Requirements

- **Context Menu Integration**:
  - Add a "Change Urgency" option to the right-click menu for checklist items.
  - Include a secondary context menu for urgency levels.
- **Urgency Management Logic**:
  - Implement logic to add, update, or remove urgency emojis based on the user's selection.
- **Error Handling**:
  - Handle scenarios where checklist items are formatted incorrectly or are read-only.

## User Interface Changes

- **Right-Click Context Menu**:
  - Add the "Change Urgency" option for checklist items.
- **Secondary Context Menu**:
  - Provide urgency level options in a submenu for easier navigation.

## Developer Notes

- **Code Structure**:
  - Separate the UI code for context menus from the logic for adding, updating, or removing urgency emojis.
  - Reuse any existing urgency handling functions where possible.
- **Settings Integration**:
  - Optionally add a setting that allows users to customize urgency emojis or add new urgency levels.

## Acceptance Criteria

- Users can right-click on a checklist item to access a "Change Urgency" option.
- A secondary context menu appears with urgency level options.
- The selected urgency level is added, updated, or removed accordingly from the checklist item.
- The changes are applied dynamically without requiring additional confirmation dialogs.

## Steps for Implementation

1. **Add Context Menu Option**:
   - Modify the plugin to add the "Change Urgency" option in the right-click menu for checklist items.
2. **Create Secondary Context Menu**:
   - Design and implement a secondary context menu for urgency level selection.
3. **Develop Urgency Management Logic**:
   - Write functions to add, update, or remove the urgency emoji based on user selection.
4. **Testing**:
   - Conduct unit tests on the urgency management functionality for both single and multiple checklist items.
   - Perform integration testing within Obsidian to ensure the context menus work as expected.
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

This feature will improve task prioritization by allowing users to easily change urgency levels on checklist items, helping them manage their to-do lists more effectively. Let me know if any further adjustments are needed!
