# Changelog

## [1.0.6] - 2024-03-XX

### Added

- New checklist urgency management feature
  - Visual modal for changing urgency levels
  - Command palette integration for quick urgency changes
  - Five predefined urgency levels with emoji indicators
  - Horizontal layout for urgency selection
- Enhanced checklist tagging interface
  - Improved visual feedback
  - Better keyboard support with Enter key
  - Consistent styling across modals

### Changed

- Improved modal UI consistency
- Enhanced user experience with visual urgency selection
- Updated documentation with new features
- Added command palette shortcuts for urgency levels

### Fixed

- Button styling consistency in modals
- Urgency indicator replacement logic
- Modal positioning and layout issues
- TypeScript type definitions

## [1.0.5] - 2024-11-12

### Added

- New checklist tagging feature
  - Right-click menu option for tagging checklist items
  - Urgency level indicators with emojis (🟢, 🟡, 🟠, 🔴, ⚪️)
  - Bulk tagging support for multiple checklist items
- Improved UI consistency across all modals
- Enhanced tag extraction logic

### Changed

- Standardized modal styling and layout
- Improved user feedback and error handling
- Updated documentation with new features

### Fixed

- Tag extraction from various YAML formats
- UI consistency issues in modals
- Empty line handling in tag conversion

## [1.0.4] - 2024-11-10

### Added

- New batch conversion feature with inheritance options
  - Convert tags to YAML for all notes within a folder and its subfolders
  - Option to convert tags only in the selected folder
  - Progress summary showing successful and failed conversions
- Added file count display in conversion dialog
- Added conversion result modal with detailed statistics

### Changed

- Improved batch conversion UI with clearer options
- Enhanced error handling during batch operations
- Updated documentation to reflect new features

### Fixed

- Improved handling of empty lines during tag conversion
- Better error reporting for failed conversions

## [1.0.3] - 2024-11-06

### Added

- Batch conversion warning modal
- Toggle for batch conversion warning
- Improved tag conflict resolution

### Changed

- Enhanced folder tag application logic
- Updated UI for better user experience

## [1.0.2] - 2024-11-04

### Added

- Tag inheritance modes
- Folder exclusion options
- Visual indicators for tagged folders

### Fixed

- Duplicate tag handling
- Tag synchronization issues

## [1.0.1] - 2024-11-04

### Added

- Basic folder tagging functionality
- Automatic tag application
- File movement handling

### Fixed

- Initial bug fixes and performance improvements

## [1.0.0] - 2024-11-04

### Added

- Initial release
- Core folder tagging functionality
- YAML front matter support
- Basic settings panel
