# PLAYNC Party Builder

PLAYNC Developers API를 Netlify Function으로 프록시해서 캐릭터 검색과 파티 편성을 할 수 있는 정적 웹 프로젝트입니다.

## 구조

- `public/`: 순수 HTML/CSS/JavaScript 프런트엔드
- `netlify/functions/plaync-character.js`: PLAYNC API 프록시
- `netlify.toml`: Netlify 배포 설정

## Netlify 환경 변수

필수:

- `PLAYNC_API_KEY`: PLAYNC Developers에서 발급받은 API Key

선택:

- `PLAYNC_API_BASE_URL`: 기본값 `https://dev-api.plaync.com`
- `PLAYNC_SEARCH_PATHS`: 검색 엔드포인트 후보를 쉼표로 지정
- `PLAYNC_DETAIL_PATHS`: 상세/전투력 보강 엔드포인트 후보를 쉼표로 지정

예시:

```text
PLAYNC_API_KEY=발급받은키
PLAYNC_SEARCH_PATHS=/characters/search,/character/search,/search/characters
PLAYNC_DETAIL_PATHS=/characters/basic,/characters/info,/characters/power
```

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
- 현재 PLAYNC 공식 문서에서 일부 게임의 캐릭터 API 스펙이 직접 노출되지 않아, 함수는 여러 공식 후보 엔드포인트를 순차 시도하도록 만들었습니다.
- 실제 게임별 정확한 경로를 이미 알고 있다면 `PLAYNC_SEARCH_PATHS`, `PLAYNC_DETAIL_PATHS`로 바로 고정하는 것이 가장 안정적입니다.
