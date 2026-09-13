# JPML for Visual Studio Code

Language support for `.jp` files, the configuration format that borrows TOML's
sections and JSON's nesting.

```jp
[SERVER_ID]
config: {
  disabled_channels:,
  disabled_users: [9892, 82082, 8209]
}
```

## Features

- **Syntax highlighting** for sections, keys, strings and their escapes,
  numbers (including `0xff`, `1_000`, `inf`), keywords and comments. Invalid
  escapes such as `\q` are marked.
- **Live error checking.** Errors are underlined as you type, using the same
  parser as the [`jpml-lang`](https://www.npmjs.com/package/jpml-lang) package,
  so the editor and your program always agree about what is valid.
- **Outline, breadcrumbs and Go to Symbol** (`Ctrl+Shift+O`) for sections and
  keys, nested objects included.
- **Folding** for sections, multi-line objects and arrays, and comment blocks.
- **Format Document** in the canonical style that `jpml fmt` writes.
- **Preview as JSON**, from the editor title bar or the Command Palette.
- Comment toggling, bracket matching, auto-closing and indentation.

## Formatting and comments

The formatter rewrites the whole file from its parsed data, and comments are
not part of that data. To avoid silently deleting your notes, **Format Document
does nothing on a file that contains comments** and tells you why. If you
would rather format anyway, turn on `jpml.format.allowDroppingComments`.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `jpml.validate.enable` | `true` | Check files for errors as you type. |
| `jpml.duplicateKeys` | `"error"` | `"error"`, `"first"` or `"last"`: how repeated keys are treated. |
| `jpml.format.width` | `88` | Column budget for keeping an array on one line. |
| `jpml.format.sortKeys` | `false` | Sort keys alphabetically when formatting. |
| `jpml.format.allowDroppingComments` | `false` | Allow formatting files that contain comments. |

Indentation follows the editor's tab size for the file.

## Development

```bash
bun install
bun run build
bun run test          # outline unit tests + grammar snapshots
bun run typecheck
```

Open this folder in VS Code and press **F5** to launch a window with the
extension loaded and the `examples/` folder open. `examples/broken.jp` shows the
error checking.

After an intentional grammar change, review and accept the new snapshots with
`bun run test:grammar:update`.

### Cutting a release

```bash
# bump "version" in package.json and add a CHANGELOG.md entry
git commit -am "Release 1.1.2"
git tag v1.1.2
git push --follow-tags
```

Then publish a GitHub Release for that tag. The tag must match the version
exactly, or the build fails before anything is published. If one registry
fails, re-run just that job from the workflow run page; a registry refuses to
overwrite a version it already has.

To build a `.vsix` locally without publishing, run `bun run package`.

## Licence

MIT.
