<div align="center">

# CLI Session Sidebar

**每个任务一个 CLI 会话，就在侧边栏。**

在侧边栏运行 CLI。<br>
每个任务保留自己的会话、输出和恢复命令。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![VS Code · Cursor 1.106+](https://img.shields.io/badge/VS%20Code%20%C2%B7%20Cursor-%E2%89%A51.106-007ACC?logo=visualstudiocode&logoColor=white)

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文**

</div>

扩展 ID 是 `yangjongwon.cli-session-sidebar`。它发布在 Open VSX 的 `yangjongwon` 命名空间下。

## 能做什么

- 点击即可启动 Claude Code、Codex、Cursor CLI、OpenCode、Antigravity、Devin。在 Windows 上，列表中还有 PowerShell、PowerShell 7、Git Bash 和命令提示符。在 Mac 上，这些位置显示 zsh 和 Homebrew。
- 在命令管理中可以修改内置命令的名称、运行程序、参数、恢复命令和图标。已知的内置命令有预设图标，其他命令根据名称生成文字和颜色。可以改成自定义文字、颜色或图片文件。重置会恢复最初提供的值。
- 同一个 CLI 可以建立多个名称不同的任务，并用标签切换。
- 关闭窗口后，正在运行的任务仍留在独立后端。再次打开时会重新连接到该进程。
- 恢复最近任务和按指定 ID 恢复都直接使用 CLI 命令。扩展不会附加跳过权限的选项。
- 任务列表可以按日期整日保留和恢复。可以搜索输出，也可以搜索任务。
- 界面语言可以是自动、韩语、日语、中文或英语。
- 终端里出现的文件路径可以点击，并在编辑器中打开。

## 首次运行和安装

如果找不到程序，终端上方会显示原因和官方安装命令。点击**安装**后，只有在确认之后才会执行该命令。也可以复制命令自行运行。

只有 Windows 提供安装命令。在其他系统上，请先查看官方安装方法，再输入程序路径。扩展不会代替登录。

Cursor CLI 的程序名是 `agent`。

## 要求

- VS Code 或 Cursor 1.106 及以上
- 安装命令和默认 shell 说明以 Windows 为准

## 开发

```bash
npm install
npm test
```

安装了 Edge 时，用 `PLAYWRIGHT_CHANNEL=msedge npm run check:ui` 做界面检查。扩展开发主机通过启动配置 **Run CLI Session Sidebar** 打开。

## 范围

侧边栏之间的移动使用 VS Code 拖拽。侧边栏和编辑器标签之间用 ⋯ 菜单切换。再次显示已保存的输出、重新连接仍在运行的进程，以及用恢复命令继续对话，是三项不同的操作。

## 许可证

[MIT](LICENSE)
