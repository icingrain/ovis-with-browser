<p align="center">
  <img src="public/icons/icon-192.png" alt="Ovis" width="100">
</p>

<h1 align="center">Ovis with Browser</h1>

<p align="center">
  <strong>에이전트가 쓰는 브라우저를, 채팅과 터미널 옆 탭에서.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>한국어</strong>
</p>

[Ovis](https://github.com/devswha/ovis)를 포크한 프로젝트입니다. Ovis는 [herdr](https://github.com/herdrdev/herdr)의 브라우저·모바일 클라이언트이고, 기존 기능은 모두 그대로 있습니다. 이 포크가 더하는 것은 하나, **Browser** 탭입니다. 코딩 에이전트가 Chrome으로 작업하면 그 Chrome 탭을 Ovis에서 그대로 보고, 컴퓨터에서든 모바일 기기에서든 에이전트가 막혔을 때 직접 이어받을 수 있습니다.

설치, 에이전트, 채팅, 터미널, 푸시 알림, 원격 PC 같은 나머지는 [Ovis README](https://github.com/devswha/ovis#readme)와 [사용자 가이드](https://github.com/devswha/ovis/blob/main/docs/guide.md)를 보세요. 이 문서는 포크가 더한 부분만 다룹니다.

## 무엇을 하나

- **Browser 탭**: Chat, Terminal 옆에 생깁니다. 에이전트가 Chrome을 쓰는 pane에서, 그 Chrome이 pane에 등록되면 나타납니다.
- **에이전트가 쓰는 바로 그 탭**: Ovis가 Chrome 탭을 스트리밍(Chrome DevTools Protocol screencast)하고, 클릭과 키 입력을 되돌려 보냅니다. 탭 선택기로 열린 탭을 고릅니다.
- **원할 때만 제어권을 가져옵니다**: 처음에는 보기 전용입니다. 첫 클릭이나 키 입력이 제어권을 가져오고 그 입력은 페이지로 전달되지 않습니다. **Esc**, 해제 버튼, 60초간 입력 없음 중 하나로 제어권이 돌아갑니다. 스크롤은 제어권을 가져오지 않습니다.
- **모바일 기기용**: 터치 기기에서는 **Trackpad** 모드로 열립니다. 손가락 하나로 커서를 움직이고(hover 동작), 탭하면 클릭, 두 손가락 탭은 우클릭, 두 손가락 이동은 스크롤, 탭 후 드래그는 드래그입니다. 아래 막대에 우클릭, 키보드, 드래그 잠금 버튼이 있습니다. **Direct** 모드는 마우스처럼 포인터를 그대로 보냅니다.
- **메뉴와 대화상자**: Chrome의 기본 `<select>` 목록과 JavaScript `alert`, `confirm`, `prompt`는 화면 스트림에 잡히지 않아서, Ovis가 직접 그려 주고 답을 Chrome에 돌려 보냅니다.
- **백그라운드 탭**: Chrome은 숨겨진 탭을 그리지 않습니다. 그런 탭을 고르면 **Show this tab**(제어권을 가져오고 탭을 앞으로 가져옴)과 **Back**이 있는 카드가 나옵니다. 탭을 보기만 해서는 Chrome 창이 앞으로 올라오지 않습니다.

## 동작 방식

<p align="center">
  <img src="docs/media/browser-tab/flow.gif" alt="동작 도식: 에이전트의 Chrome이 herdr pane에 등록되고, Ovis가 화면을 프레임으로 모바일 기기에 보내고, 첫 탭이 제어권을 가져오고, 이동과 탭이 Ovis 서버를 거쳐 Chrome으로 돌아가며, Esc나 60초 유휴 시 제어권이 돌아간다." width="640">
</p>

1. **Chrome은 내 컴퓨터에서 실행됩니다.** 에이전트의 Chrome은 loopback에 디버깅 포트를 엽니다. Ovis가 직접 띄우지는 않고, 에이전트가 헬퍼로 띄우거나(아래 참고) 직접 띄웁니다.
2. **pane에 등록합니다.** Ovis 서버가 그 herdr pane의 Chrome 주소를 메모리에 두고 Browser 탭을 보여 줍니다. 서버는 Ovis의 것 그대로이고 모듈 하나만 더했습니다([server/browser-sessions.ts](server/browser-sessions.ts)). 별도 서버는 없습니다.
3. **프레임이 나갑니다.** 서버가 Chrome에 탭 하나의 screencast를 요청하고, 그 탭을 연 브라우저나 모바일 기기에 프레임을 보냅니다. 모바일 기기에는 더 작고 낮은 화질의 프레임을 보냅니다.
4. **입력이 돌아옵니다.** 클릭, 이동, 스크롤, 키 입력이 서버로 가서 Chrome에서 재현됩니다. 포인터 이동은 하나로 합쳐서, 요청이 처리되는 동안에는 가장 최근 것만 보냅니다.
5. **제어는 명시적입니다.** 처음에는 보기 전용이고, 첫 탭이나 키 입력이 제어권을 가져오며 그 입력은 페이지로 가지 않습니다. Esc, 해제 버튼, 60초 무입력이면 제어권이 돌아갑니다.

## 설치

같은 컴퓨터에 [herdr](https://github.com/herdrdev/herdr), [Bun](https://bun.sh), 데스크톱 Chrome이 필요합니다. macOS와 Linux에서 테스트했고 **Windows는 아직 테스트하지 않았습니다.**

```bash
git clone https://github.com/icingrain/ovis-with-browser.git
cd ovis-with-browser
herdr plugin link .
herdr plugin action invoke start --plugin icingrain.ovis-with-browser
```

Ovis가 이미 설치되어 있어도 함께 돌아갑니다. 이 포크는 자체 플러그인 ID(`icingrain.ovis-with-browser`)와 포트 **7318**을 씁니다. 설치된 Ovis와 설정, 페어링을 분리하려면 `~/.config/herdr/plugins/config/icingrain.ovis-with-browser/env`에 아래 두 줄을 넣으세요.

```
PORT=7318
OVIS_STATE_DIR=~/.local/state/ovis-with-browser
```

`http://127.0.0.1:7318`을 열거나, 모바일 기기에서는 Tailscale로 `tailscale serve --https=8443 --bg http://127.0.0.1:7318`을 실행한 뒤 그 주소로 엽니다. Ovis README의 설치 스크립트와 Mac·Windows 앱은 이 포크가 아니라 원본 Ovis를 설치합니다.

### 설치 명령 (setup)

`ovis-with-browser` npm 패키지가 헬퍼를 PATH에 넣고 나머지를 차례로 안내합니다. 에이전트 skill 설치, 그리고 모바일 기기용 tailnet 주소(이미 쓰는 주소, 별도 주소, 설정 안 함)입니다.

```bash
bun add -g ovis-with-browser
ovis-with-browser setup
```

터미널에서는 질문하고, 플래그로 대신 답할 수 있습니다(`--skill`, `--no-skill`, `--tailnet existing|separate|skip`, `--https-port`, `--force`). 다른 서비스가 쓰는 tailnet 주소는 `--force` 없이는 바꾸지 않습니다. [npm 패키지](https://www.npmjs.com/package/ovis-with-browser)이고, `bun scripts/build-npm-package.ts`로 `dist-npm/`에 직접 빌드할 수도 있습니다.

### 에이전트가 자기 Chrome을 직접 등록하게 하기 (권장)

skill을 한 번 설치합니다. 에이전트가 `scripts/ovis-browser.ts`로 Chrome을 띄우게 하는 skill이고, 이 헬퍼는 별도 프로필로 Chrome을 띄워 에이전트가 실행 중인 pane(`$HERDR_PANE_ID`)에 등록합니다.

```bash
bun scripts/install-browser-skill.ts          # 쓸 내용만 보여 주고 아무것도 쓰지 않음
bun scripts/install-browser-skill.ts --yes    # ovis-browser 설치
bun scripts/install-browser-skill.ts --remove --yes
```

`skills/ovis-browser/SKILL.md`를 두 곳에 씁니다. `~/.claude`(Claude Code는 자기 폴더만 읽습니다. `~/.claude`가 없으면 건너뜀)와 공용 `~/.agents/skills`(herdr 자체 skill이 있는 폴더이고 Codex와 오픈 [`skills`](https://github.com/vercel-labs/skills) CLI를 쓰는 다른 에이전트가 읽음)입니다. `--agent codex` 또는 `--agent opencode`로 해당 에이전트의 폴더도 추가할 수 있습니다. 설치기가 쓴 파일만 바꾸며, 설치 후에는 실행 중인 에이전트 세션을 다시 시작하세요. herdr 플러그인으로 쓴다면 같은 설치가 플러그인 action **Install the Browser tab skill**입니다. 자동으로 실행되지는 않습니다.

에이전트가 항상 skill을 스스로 고르지는 않습니다. 테스트에서 Claude Code는 골랐지만, 자체 브라우저 도구가 있는 Codex는 이름을 지정하기 전까지 그 도구를 썼습니다. 요청에 "ovis-browser로 열어"라고 쓰거나, 에이전트 지침(`AGENTS.md`, `CLAUDE.md`)에 한 줄 넣으세요. 예: *herdr pane에서는 내장 브라우저 도구 대신 ovis-browser skill로 브라우저를 연다.*

이후 브라우저가 필요한 pane의 에이전트는 `ovis-browser start`를 실행하고, 출력된 `cdp_url`을 조작하며, 사용자는 그 pane의 **Browser** 탭을 엽니다. 헬퍼는 `OVIS_URL`(기본 `http://127.0.0.1:7318`)과, 서버가 요구하면 `OVIS_TOKEN`을 읽습니다.

```bash
bun scripts/ovis-browser.ts start --url https://example.com   # 이 pane의 Chrome을 띄우거나 재사용하고 등록
bun scripts/ovis-browser.ts status
bun scripts/ovis-browser.ts stop                               # 등록 해제 후 Chrome 종료
```

### 또는 직접 등록하기

1. 루프백에 디버깅 포트를 열어 Chrome을 시작합니다.
   ```bash
   chrome --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/agent-chrome
   ```
2. pane에 등록합니다. pane 안에서는 ID가 `$HERDR_PANE_ID`이고, 밖에서는 `herdr pane list`가 보여 줍니다.
   ```bash
   curl -X POST 'http://127.0.0.1:7318/api/pane/browser/register' \
     -H 'content-type: application/json' \
     --data '{"pane_id":"w1:p1","cdp_url":"http://127.0.0.1:9222"}'
   ```
   `http://127.0.0.1:<port>` 주소만 받습니다. `DELETE /api/pane/browser?pane_id=w1:p1`로 해제합니다. 등록은 서버 메모리에 있어서 서버를 재시작하면 다시 해야 합니다. 토큰이나 페어링된 기기를 요구하는 서버는 이 호출에 `Authorization: Bearer <token>`이 필요합니다.
3. Ovis에서 pane을 열고 **Browser**를 고릅니다.

`bun scripts/browser-tab-demo.ts --pane-id=<pane id>`는 상호작용 테스트 페이지가 있는 Chrome을 열고 등록 명령을 출력합니다. 가장 빠르게 써 보는 방법입니다.

## 모바일 기기에서

터치 기기에서는 Browser 탭이 **Trackpad** 모드로 열립니다. 페이지 영역이 터치패드가 되고, 커서가 탭이 닿을 위치를 보여 줍니다. 옆의 **Direct** 모드는 마우스처럼 포인터를 그대로 보냅니다. 선택은 기기마다 기억됩니다. 페이지 아래 막대에는 **Right click**, **Keyboard**(키보드 열기), **Drag lock**이 있습니다.

<table>
  <tr>
    <td width="50%" valign="top"><b>1. 제어권 가져오기와 이동</b><br>한 번 탭하면 제어권을 가져옵니다. 이 첫 탭은 페이지로 가지 않습니다. 그다음 손가락 하나로 끌면 커서가 따라오고 hover도 동작합니다.</td>
    <td width="50%" valign="top"><b>2. 클릭과 우클릭</b><br>탭하면 커서 위치를 클릭합니다. 두 손가락 탭은 우클릭이고, Right click 버튼도 같습니다.</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/media/browser-tab/guide-1-control-and-move.gif" alt="모바일 화면: 탭으로 제어권을 켜고 손가락 하나로 커서를 움직인다" width="260"></td>
    <td align="center"><img src="docs/media/browser-tab/guide-2-click-and-right-click.gif" alt="모바일 화면: 탭으로 버튼을 클릭하고 두 손가락 탭으로 컨텍스트 메뉴를 연다" width="260"></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>3. 드래그</b><br>탭한 뒤 바로 다시 터치해서 움직이면 잡아서 끕니다. 길거나 정밀한 드래그는 Drag lock을 켜고 움직인 뒤 끄면 놓습니다.</td>
    <td width="50%" valign="top"><b>4. 메뉴와 스크롤</b><br>select 목록은 커서 위치에 열리고, alert·confirm·prompt는 대화상자로 나옵니다. 두 손가락을 위아래로 움직이면 스크롤되며 제어권을 가져오지 않습니다.</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/media/browser-tab/guide-3-drag.gif" alt="모바일 화면: 탭 후 터치와 이동으로 상자를 끌고, Drag lock 버튼이 강조된다" width="260"></td>
    <td align="center"><img src="docs/media/browser-tab/guide-4-menus-and-scroll.gif" alt="모바일 화면: select 메뉴가 커서 아래에 열리고, 두 손가락으로 페이지를 스크롤한다" width="260"></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>5. 놓기와 탭 전환</b><br>X 버튼(또는 Esc, 60초 무입력)이 제어권을 돌려줍니다. 탭 선택기는 아래에서 올라오는 시트로 열리고, 백그라운드 탭은 Show this tab 카드로 나옵니다.</td>
    <td width="50%" valign="top"></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/media/browser-tab/guide-5-release-and-tabs.gif" alt="모바일 화면: X 버튼이 제어권을 놓고 탭 선택기가 아래 시트로 열린다" width="260"></td>
    <td></td>
  </tr>
</table>

## 한계

- Chrome은 Ovis 서버와 같은 컴퓨터에서 헤드리스가 아닌 데스크톱 Chrome으로 실행해야 합니다. 원격 PC의 pane에는 Browser 탭이 없습니다.
- Windows는 아직 테스트하지 않았습니다. Browser 탭, 헬퍼, skill 설치기는 macOS에서만 실행해 봤고, `scripts/ovis-browser.ts`와 `scripts/install-browser-skill.ts`의 Windows 경로는 작성만 했을 뿐 검증하지 않았습니다.
- 날짜·색상·파일 선택기, 붙여넣기, IME 조합 입력은 전달되지 않습니다.
- 보이는 것은 스트림입니다. 페이지의 반응은 네트워크 왕복 시간과 Chrome의 캡처·인코딩 시간이 지난 뒤 화면에 닿습니다. 모바일 기기에는 따라가기 위해 더 작고 낮은 화질의 프레임을 보냅니다.
- 등록된 Chrome은 Ovis를 열 수 있는 누구나 완전히 조작할 수 있습니다. 따라서 보호는 Ovis의 접근 규칙(토큰, 페어링된 기기, Tailscale)에 달려 있습니다. 공유해도 되는 Chrome만 등록하세요.

## 포크 관리 방식

- `upstream-sync`는 `devswha/ovis`의 `main`을 그대로 따라가며 여기에는 커밋하지 않습니다.
- `main`은 `upstream-sync` 위에 Browser 탭을 얹은 것이고, upstream이 갱신될 때마다 rebase합니다.
- Browser 탭은 `server/browser-sessions.ts`, `src/components/BrowserView.*`, `src/lib/browser*.ts`, `scripts/browser-tab-*`에 있고, 나머지 diff는 얇은 연결 코드(`PaneView` 타입, pane lens, 헤더 버튼, 번역)입니다.

Ovis는 MIT 라이선스입니다. [LICENSE](LICENSE)를 보세요.
