# 상세 문서

[README](../README.ko.md)에 없는 내용입니다. 직접 설치, 헬퍼, skill, Chrome 직접 등록, 동작 방식, 한계, 포크 관리 방식.

## 직접 설치

`ovis-with-browser setup`이 하는 일을 손으로 하면 이렇습니다.

```bash
herdr plugin install icingrain/ovis-with-browser -y        # 또는: git clone … && herdr plugin link .
```

플러그인은 자체 ID(`icingrain.ovis-with-browser`)와 포트 **7318**을 써서, 설치된 Ovis(`devswha.ovis`, 포트 7317)와 함께 돌아갑니다. 설정과 페어링을 그쪽과 분리하려면 `~/.config/herdr/plugins/config/icingrain.ovis-with-browser/env`에 아래 두 줄을 넣으세요(`herdr plugin config-dir icingrain.ovis-with-browser`가 폴더를 알려 줍니다).

```
PORT=7318
OVIS_STATE_DIR=~/.local/state/ovis-with-browser
```

그다음 `herdr plugin action invoke start --plugin icingrain.ovis-with-browser`로 시작합니다. 이후에는 herdr와 함께 시작됩니다. Ovis README의 설치 스크립트와 Mac·Windows 앱은 이 포크가 아니라 원본 Ovis를 설치합니다.

## setup 플래그

`ovis-with-browser setup`은 터미널에서는 질문하고, 플래그로 대신 답할 수 있습니다.

| 플래그 | 뜻 |
|---|---|
| `--skill` / `--no-skill` | 에이전트 skill 설치 여부 |
| `--tailnet existing\|separate\|skip` | 이미 쓰는 tailnet 주소(443), 별도 주소, 설정 안 함 |
| `--https-port <n>` | 별도 주소의 HTTPS 포트 (기본값: 8443, 8444, 8445, 10000 중 첫 빈 포트) |
| `--force` | 다른 서비스가 이미 쓰는 tailnet 주소를 바꿈 |
| `--port <n>` | 서버 포트 (기본 7318) |
| `--no-plugin` | 플러그인은 그대로 둠 (이미 연결한 경우 등) |
| `--ref <tag>` | 설치할 플러그인 버전 |
| `--yes` | 모든 질문에 안전한 답을 택함: skill은 설치하고 tailnet 주소는 건드리지 않음 |

모바일 기기는 Tailscale로 Ovis에 접속합니다. `--tailnet separate`는 `tailscale serve --https=8443 --bg http://127.0.0.1:7318`을 실행하고, `tailscale serve --https=8443 off`로 되돌립니다.

## 에이전트가 자기 Chrome을 직접 등록하게 하기

skill은 에이전트가 `scripts/ovis-browser.ts`(npm 패키지의 `ovis-browser` 명령)로 Chrome을 띄우게 합니다. 이 헬퍼는 별도 프로필로 Chrome을 띄우고, 에이전트가 실행 중인 pane(`$HERDR_PANE_ID`)에 등록합니다.

```bash
ovis-browser start --url https://example.com    # 이 pane의 Chrome을 띄우거나 재사용하고 등록
ovis-browser status
ovis-browser stop                                # 등록 해제 후 Chrome 종료
```

`OVIS_URL`(기본 `http://127.0.0.1:7318`)과, 서버가 요구하면 `OVIS_TOKEN`을 읽습니다. Ovis를 재시작한 뒤에는 `start`가 새 Chrome을 띄우지 않고 아직 실행 중인 Chrome을 다시 등록합니다.

skill을 직접 설치하려면:

```bash
bun scripts/install-browser-skill.ts          # 쓸 내용만 보여 주고 아무것도 쓰지 않음
bun scripts/install-browser-skill.ts --yes    # ovis-browser 설치
bun scripts/install-browser-skill.ts --remove --yes
```

`skills/ovis-browser/SKILL.md`를 두 곳에 씁니다. `~/.claude`(Claude Code는 자기 폴더만 읽습니다. 없으면 건너뜀)와 공용 `~/.agents/skills`(herdr 자체 skill이 있는 폴더이고 Codex와 오픈 [`skills`](https://github.com/vercel-labs/skills) CLI를 쓰는 다른 에이전트가 읽음)입니다. `--agent codex` 또는 `--agent opencode`로 해당 에이전트의 폴더도 추가합니다. 설치기가 쓴 파일만 바꾸며, 설치 후에는 실행 중인 에이전트 세션을 다시 시작하세요. herdr 플러그인 action으로는 **Install the Browser tab skill**입니다.

에이전트가 항상 skill을 스스로 고르지는 않습니다. 테스트에서 Claude Code는 골랐지만, 자체 브라우저 도구가 있는 Codex는 이름을 지정하기 전까지 그 도구를 썼습니다. 요청에 "ovis-browser로 열어"라고 쓰거나, 에이전트 지침(`AGENTS.md`, `CLAUDE.md`)에 한 줄 넣으세요: *herdr pane에서는 내장 브라우저 도구 대신 ovis-browser skill로 브라우저를 연다.*

## Chrome 직접 등록하기

1. 루프백에 디버깅 포트를 열어 Chrome을 시작합니다.
   ```bash
   chrome --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/agent-chrome
   ```
2. pane에 등록합니다(pane 안에서는 `$HERDR_PANE_ID`, 밖에서는 `herdr pane list`).
   ```bash
   curl -X POST 'http://127.0.0.1:7318/api/pane/browser/register' \
     -H 'content-type: application/json' \
     --data '{"pane_id":"w1:p1","cdp_url":"http://127.0.0.1:9222"}'
   ```
   `http://127.0.0.1:<port>` 주소만 받습니다. `DELETE /api/pane/browser?pane_id=w1:p1`로 해제합니다. 등록은 서버 메모리에 있어서 재시작하면 다시 해야 합니다. 토큰이나 페어링된 기기를 요구하는 서버는 이 호출에 `Authorization: Bearer <token>`이 필요합니다.
3. Ovis에서 pane을 열고 **Browser**를 고릅니다.

`bun scripts/browser-tab-demo.ts --pane-id=<pane id>`는 상호작용 테스트 페이지가 있는 Chrome을 열고 등록 명령을 출력합니다.

## 동작 방식

1. **Chrome은 내 컴퓨터에서 실행됩니다.** 에이전트의 Chrome은 루프백에 디버깅 포트를 엽니다. Ovis가 직접 띄우지 않고, 에이전트가 헬퍼로 띄우거나 직접 띄웁니다.
2. **pane에 등록합니다.** Ovis 서버가 그 herdr pane의 Chrome 주소를 메모리에 두고 Browser 탭을 보여 줍니다. 서버는 Ovis의 것 그대로이고 모듈 하나만 더했습니다([server/browser-sessions.ts](../server/browser-sessions.ts)). 별도 서버는 없습니다.
3. **프레임이 나갑니다.** 서버가 Chrome에 탭 하나의 screencast를 요청하고, 그 탭을 연 브라우저나 모바일 기기에 프레임을 보냅니다. 모바일 기기에는 더 작고 낮은 화질의 프레임을 보냅니다.
4. **입력이 돌아옵니다.** 클릭, 이동, 스크롤, 키 입력이 서버로 가서 Chrome에서 재현됩니다. 포인터 이동은 하나로 합쳐서, 요청이 처리되는 동안에는 가장 최근 것만 보냅니다.
5. **제어는 명시적입니다.** 처음에는 보기 전용이고, 첫 탭이나 키 입력이 제어권을 가져오며 그 입력은 페이지로 가지 않습니다. Esc, 해제 버튼, 60초 무입력이면 돌아갑니다.

## 한계

- Chrome은 Ovis 서버와 같은 컴퓨터에서 헤드리스가 아닌 데스크톱 Chrome으로 실행해야 합니다. 원격 PC의 pane에는 Browser 탭이 없습니다.
- Windows는 아직 테스트하지 않았습니다. Browser 탭, 헬퍼, skill 설치기는 macOS에서만 실행해 봤습니다.
- 날짜·색상·파일 선택기, 붙여넣기, IME 조합 입력은 전달되지 않습니다.
- 보이는 것은 스트림입니다. 페이지의 반응은 네트워크 왕복 시간과 Chrome의 캡처·인코딩 시간이 지난 뒤 화면에 닿습니다.
- 등록된 Chrome은 Ovis를 열 수 있는 누구나 완전히 조작할 수 있습니다. 보호는 Ovis의 접근 규칙(토큰, 페어링된 기기, Tailscale)에 달려 있으니, 공유해도 되는 Chrome만 등록하세요.

## 포크 관리 방식

- `upstream-sync`는 `devswha/ovis`의 `main`을 그대로 따라가며 여기에는 커밋하지 않습니다.
- `main`은 `upstream-sync` 위에 Browser 탭을 얹은 것이고, upstream이 갱신될 때마다 rebase합니다.
- Browser 탭은 `server/browser-sessions.ts`, `src/components/BrowserView.*`, `src/lib/browser*.ts`, `scripts/browser-tab-*`에 있고, 나머지 diff는 얇은 연결 코드(`PaneView` 타입, pane lens, 헤더 버튼, 번역)입니다.
- npm 패키지(`bun scripts/build-npm-package.ts`로 `dist-npm/`에 빌드)는 자체 버전을 갖고, `package.json`의 `ovisWithBrowser.ovisTested`가 테스트한 Ovis 버전입니다.
