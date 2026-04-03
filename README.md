# PLAYNC Party Builder

AION2 공식 공개 API를 Netlify Function으로 프록시해서 캐릭터 검색과 파티 편성을 할 수 있는 정적 웹 프로젝트입니다. 로컬 저장과 서버 저장(공유 링크) 모드를 모두 지원합니다.

## 구조

- `public/`: 순수 HTML/CSS/JavaScript 프런트엔드
- `netlify/functions/plaync-character.js`: AION2 검색/랭킹 API 프록시
- `netlify/functions/party-board.js`: 서버 저장/공유 링크 보드 저장소
- `netlify.toml`: Netlify 배포 설정

## Netlify 환경 변수

선택:

- `PLAYNC_API_KEY`: PLAYNC Developers에서 발급받은 API Key

- `PLAYNC_AION2_BASE_URL`: 기본값 `https://aion2.plaync.com`

예시:

```text
PLAYNC_API_KEY=발급받은키
PLAYNC_AION2_BASE_URL=https://aion2.plaync.com
```

## 저장 방식

- 기본 URL 접속: `로컬 저장`, `서버 저장`, `서버 불러오기` 중 하나 선택
- 공유 링크 접속: `?board=XXXXXXXX` 형식의 8자리 보드 코드를 읽어서 서버 보드를 바로 불러옴
- 로컬 저장: 현재 브라우저 `localStorage` 에만 저장
- 서버 저장: Netlify Blobs 에 저장하고 공유 링크로 같은 편성을 열 수 있음

## 로컬 실행

Netlify Function까지 같이 확인하려면:

```bash
npx netlify dev
```

정적 파일만 확인하려면:

```bash
python3 -m http.server 8080 -d public
```

## 참고

- 프런트에는 API Key를 두지 않습니다.
- 현재 이 프로젝트는 공식 공개 캐릭터 검색 경로가 확인된 `AION2`만 지원합니다.
- 화면에는 `전투력`과 `아이템 레벨`을 표시하며, 검색 결과는 아이템 레벨 1000 이하를 제외합니다.
- 로컬 개발에서 Netlify Blobs 환경이 없으면 `party-board` 함수는 `.data/party-board-store.json` 파일을 임시 저장소로 사용합니다.
