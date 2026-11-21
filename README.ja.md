<div align="center">

# CLI Session Sidebar

**作業ごとの CLI セッションを、サイドバーに。**

サイドバーで CLI を起動し、<br>
作業ごとにセッション、出力、再開コマンドを保持します。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![VS Code · Cursor 1.106+](https://img.shields.io/badge/VS%20Code%20%C2%B7%20Cursor-%E2%89%A51.106-007ACC?logo=visualstudiocode&logoColor=white)

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md)

</div>

拡張機能 ID は `local.cli-session-sidebar` です。発行者フィールドは `local` です。保存済みの作業と設定がすでにこの ID を使うため、Marketplace アカウントを作るまでは変更しません。公開登録するときは [Marketplace 発行者](https://marketplace.visualstudio.com/manage) を作り、`package.json` の `publisher` をそのアカウントに合わせます。発行者を変えると拡張機能 ID が変わり、既存の保存フォルダは引き継がれません。

## できること

- Claude Code、Codex、Cursor CLI、OpenCode、Antigravity、Devin を押すとすぐ開始します。Windows では PowerShell、PowerShell 7、Git Bash、コマンド プロンプトも並びます。Mac ではその位置に zsh と Homebrew が出ます。
- コマンド管理で、組み込みコマンドの名前、実行プログラム、引数、再開コマンド、アイコンを変更できます。既知の組み込みコマンドには決められたアイコンがあり、それ以外は名前から文字と色を作ります。文字、色、画像ファイルに変更できます。リセットは最初の値に戻します。
- 同じ CLI で名前の違う作業を複数置き、タブで切り替えます。
- ウィンドウを閉じても、実行中の作業は別のバックエンドに残ります。再度開くとそのプロセスへ再接続します。
- 最近の作業の再開と、指定 ID の再開は CLI コマンドをそのまま使います。拡張機能は権限を省略するオプションを付けません。
- 作業一覧は日付ごとに保存し、復元できます。出力の検索と作業の検索があります。
- 画面の言語は自動、韓国語、日本語、中国語、英語です。
- ターミナルに出たファイルパスは、押すとエディターで開きます。

## 初回起動とインストール

プログラムが見つからないとき、理由と公式のインストールコマンドをターミナルの上に表示します。**インストール** を押すと、確認したあとだけそのコマンドを実行します。コマンドをコピーして自分で実行することもできます。

インストールコマンドを出すのは Windows だけです。ほかの OS では公式の手順を確認し、実行プログラムのパスを入力します。拡張機能はログインを代行しません。

Cursor CLI の実行名は `agent` です。

## 要件

- VS Code または Cursor 1.106 以上
- インストールコマンドと既定シェルの案内は Windows に合わせています

## 開発

```bash
npm install
npm test
```

画面の確認は、Edge があるとき `PLAYWRIGHT_CHANNEL=msedge npm run check:ui` で実行します。拡張機能の開発ホストは、起動構成 **Run CLI Session Sidebar** で開きます。

## 範囲

サイドバー同士の移動は VS Code のドラッグを使います。サイドバーとエディタータブの切り替えは ⋯ メニューで行います。保存した出力を再表示すること、実行中だったプロセスへ再接続すること、再開コマンドで会話を続けることは、それぞれ別の動作です。

## ライセンス

[MIT](LICENSE)
