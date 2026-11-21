# CLI Session Sidebar

[한국어](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | **English**

Run a CLI from the sidebar. Each task keeps its own session, output, and resume command.

The extension id is `local.cli-session-sidebar`. The publisher field is `local`. Saved tasks and settings already use this id, so leave it unchanged until you create a Marketplace account. To publish, create a [Marketplace publisher](https://marketplace.visualstudio.com/manage) and set `publisher` in `package.json` to that account. Changing the publisher changes the extension id, and the existing storage folder does not follow.

## What it does

- Start Claude Code, Codex, Cursor CLI, OpenCode, Antigravity, or Devin with one click. On Windows, PowerShell, PowerShell 7, Git Bash, and Command Prompt appear in that list. On Mac, zsh and Homebrew take that place.
- In command management, edit a built-in command's name, program, arguments, resume commands, and icon. Known built-ins have a preset icon. Other commands take letters and a color from the name. You can change the letters, color, or image file. Reset restores the original values.
- Keep several named tasks for the same CLI and switch them with tabs.
- A running task stays in a separate backend after the window closes. Opening the window again reconnects to that process.
- Resume recent work and resume a specific id use the CLI command as written. The extension does not add a permission-skipping option.
- The task list can preserve and restore a whole day. You can search output and search tasks.
- The interface language is automatic, Korean, Japanese, Chinese, or English.
- File paths shown in the terminal open in the editor when clicked.

## First run and install

If the program is missing, the reason and the official install command appear above the terminal. **Install** runs that command only after you confirm. You can also copy the command and run it yourself.

Install commands are offered only on Windows. On other systems, check the official install method and enter the program path. The extension does not sign in for you.

The Cursor CLI program name is `agent`.

## Requirements

- VS Code or Cursor 1.106 or newer
- Install commands and the default shell notes follow Windows

## Development

```bash
npm install
npm test
```

UI checks run with `PLAYWRIGHT_CHANNEL=msedge npm run check:ui` when Edge is installed. The extension development host opens from the **Run CLI Session Sidebar** launch configuration.

## Scope

Moving between sidebars uses VS Code drag. Switching between the sidebar and an editor tab uses the ⋯ menu. Showing saved output again, reconnecting to a process that was still running, and continuing a conversation with a resume command are different actions.

## License

[MIT](LICENSE)
