# CLI Session Sidebar

사이드바에서 CLI를 실행하고, 작업마다 세션을 유지하고 다시 이어갑니다.

Run a CLI from the sidebar. Each task keeps its own session, output, and resume command.

확장 ID는 `local.cli-session-sidebar`입니다. 게시자 필드는 `local`입니다. 이미 이 ID로 저장된 작업과 설정이 이 폴더를 쓰므로, 마켓 계정을 만들기 전에는 바꾸지 않습니다. 공개 등록할 때는 [Marketplace 게시자](https://marketplace.visualstudio.com/manage)를 만든 뒤 `package.json`의 `publisher`를 그 계정과 같게 바꿉니다. 게시자를 바꾸면 확장 ID가 바뀌고, 기존 저장 폴더는 따라오지 않습니다.

## 할 수 있는 일

- Claude Code, Codex, Cursor CLI, OpenCode, Antigravity, Devin을 눌러 바로 시작합니다. Windows에서는 PowerShell, PowerShell 7, Git Bash, 명령 프롬프트가 함께 나옵니다. Mac에서는 zsh와 Homebrew가 그 자리에 나옵니다.
- 커맨드 관리에서 기본 커맨드의 이름, 실행 프로그램, 인수, 재개 명령, 아이콘을 고칠 수 있습니다. 아이콘은 기본 커맨드마다 정해져 있고, 그 밖에는 이름에서 글자와 색을 만듭니다. 글자, 색, 이미지 파일로 바꿀 수 있습니다. 리셋은 처음 제공된 값으로 되돌립니다.
- 같은 CLI로 이름 다른 작업을 여러 개 두고, 탭에서 전환합니다.
- 창을 닫아도 실행 중인 작업은 별도 백엔드에 남습니다. 다시 열면 그 프로세스에 다시 연결합니다.
- 최근 작업 재개와 지정 ID 재개는 CLI 명령을 그대로 사용합니다. 확장이 권한 생략 옵션을 붙이지 않습니다.
- 작업 목록은 날짜별로 보존하고 복원합니다. 출력 검색과 작업 검색이 있습니다.
- 화면 언어는 자동, 한국어, 일본어, 중국어, 영어입니다.
- 터미널에 나온 파일 경로는 눌러 에디터에서 엽니다.

## 처음 실행과 설치

프로그램을 찾지 못하면 터미널 위에 이유와 공식 설치 명령을 보여 줍니다. **설치**를 누르면 그 명령을 확인한 뒤에만 실행합니다. 명령을 복사해 직접 실행할 수도 있습니다.

Windows에서만 설치 명령을 제공합니다. 다른 운영체제에서는 공식 설치 방법을 확인한 뒤 실행 프로그램 경로를 입력합니다. 확장은 로그인을 대신하지 않습니다.

Cursor CLI의 실행 이름은 `agent`입니다.

## 요구 사항

- VS Code 또는 Cursor 1.106 이상
- 설치 명령과 기본 셸 안내는 Windows 기준입니다

## 개발

```bash
npm install
npm test
```

화면 검사는 Edge가 있을 때 `PLAYWRIGHT_CHANNEL=msedge npm run check:ui`로 실행합니다. 확장 개발 호스트는 실행 구성 **Run CLI Session Sidebar**로 엽니다.

## 범위

사이드바끼리의 이동은 VS Code 드래그를 사용합니다. 사이드바와 편집기 탭 사이는 ⋯ 메뉴로 전환합니다. 출력 기록을 다시 보여주는 것과, 실행 중이던 프로세스에 다시 연결하는 것, 재개 명령으로 대화를 잇는 것은 서로 다른 동작입니다.

## 라이선스

[MIT](LICENSE)
