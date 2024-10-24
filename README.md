# TagIT - Obsidian Plugin

TagIT is an Obsidian plugin that enhances the tagging system by associating YAML tags with folders.

## Features

- Add tags to folders
- Automatically apply folder tags to new files
- Edit and remove tags from folders
- Remove tags from individual files
- Create new folders with tags

## Installation

1. Open Obsidian Settings
2. Go to Third-party plugin
3. Make sure Safe mode is off
4. Click Browse community plugins
5. Search for "TagIT"
6. Click Install
7. Once installed, close the community plugins window and activate the plugin

## Usage

- Right-click on a folder to add/edit tags or remove all tags
- Right-click on a file to remove its tags
- Use the command palette to create a new folder with tags

## Development

If you want to contribute to the development of TagIT:

1. Clone this repo.
2. `npm i` or `yarn` to install dependencies
3. `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/tagit/`.

## Support

If you encounter any issues or have feature requests, please file them in the [Issues](https://github.com/JRStriestocode/TagIT/issues) section of the GitHub repository.

## License

[MIT](LICENSE)
