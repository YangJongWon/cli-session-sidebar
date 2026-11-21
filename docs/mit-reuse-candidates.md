# MIT 저장소 재사용 후보

확인일: 2026-11-21. 저장소의 라이선스 표기 또는 LICENSE를 확인했다. 아래 재사용 판단은 이번 확장 요구사항에 대한 검토 의견이며, 각 저장소를 포크하거나 코드를 가져오지는 않았다.

## 후보와 활용 범위

| 저장소 | 확인한 라이선스 | 이번 프로젝트에서 참고·활용할 부분 | 남는 작업 |
| --- | --- | --- | --- |
| [Photonico/terminal_sidebar](https://github.com/Photonico/terminal_sidebar) | MIT 소스. 동봉 Codicons는 별도 CC BY 4.0 표기 | 사이드바 터미널, 이름 있는 탭, 시작 명령과 셸 설정, VS Code 테마 대응 | 대화 이력 재개와 확장 호스트 종료 후 프로세스 보존은 추가 구현 필요. README는 리로드 후 새 셸을 만든다고 명시 |
| [Danesed/claude-tmux-sidebar](https://github.com/Danesed/claude-tmux-sidebar) | [MIT](https://github.com/Danesed/claude-tmux-sidebar/blob/main/LICENSE) | 에이전트 선택 UI, 사용자 정의 라벨·명령·인수, 재개 템플릿과 CLI별 이력 연결 방식 | tmux 기반이므로 Windows에서 별도 tmux 설치를 없애려는 요구에는 백엔드 변경 필요 |
| [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) | [MIT](https://github.com/xtermjs/xterm.js/blob/master/LICENSE) | 터미널 렌더링·ANSI 처리·입력·스크롤. 현재 초안도 사용 중 | 프로세스 실행과 세션 유지 기능은 별도 |
| [microsoft/node-pty](https://github.com/microsoft/node-pty) | [MIT](https://github.com/microsoft/node-pty/blob/main/LICENSE) | Windows ConPTY 기반 프로세스 실행·입출력·크기 변경. 현재 초안도 사용 중 | 독립 세션 관리자, 재연결, 네이티브 모듈 포함 VSIX 배포 검증 |
| [microsoft/vscode-extension-samples](https://github.com/microsoft/vscode-extension-samples) | [MIT](https://github.com/microsoft/vscode-extension-samples/blob/main/LICENSE) | [webview-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample)의 사이드바 구조, [webview-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-sample)의 편집기 탭·상태 복원 | 두 화면의 동일 세션 연결과 위치 전환은 제품 요구에 맞게 구현 |

## 단축 효과가 큰 조합

현재 초안은 이미 xterm.js와 node-pty를 사용한다. 따라서 터미널을 새로 만드는 시간을 줄이는 선택은 반영되어 있다.

추가로는 Terminal Sidebar에서 사이드바 터미널 UI·설정 구조를, AgentMux에서 사용자 정의 CLI·재개 설정 구조를 비교하는 것이 유용하다. 전체를 그대로 포크하면 각각의 프로세스 생명주기 또는 tmux 의존성을 다시 바꿔야 하므로, 현재 구조와 비교한 뒤 필요한 부분을 선택하는 편을 우선 검토한다.

기본 샘플이나 라이브러리 재사용만으로 다음 작업이 없어지지는 않는다.

- 이름별 작업 및 CLI 대화 ID 보존.
- 확장 호스트와 분리된 실행 프로세스 관리.
- Windows 네이티브 구성 요소를 포함하는 배포와 설치 검증.
- 사이드바 ↔ 편집기 교차 드래그 가능성 검증.
- iPhone Safari의 입력·재접속 검증.

## 재사용 시 기록

실제로 가져오는 코드의 저장소·커밋·파일 경로·저작권 및 라이선스를 기록하고 원문 고지를 유지한다. MIT 소스라는 이유로 이미지·아이콘·동봉 바이너리까지 같은 라이선스라고 가정하지 않는다. 이는 특히 Terminal Sidebar에 별도 표기된 Codicons를 포함할 때 확인할 사항이다.
