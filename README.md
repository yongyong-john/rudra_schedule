# PLAYNC Party Builder

AION2 공식 공개 검색/랭킹 API를 Netlify Function으로 프록시해서 캐릭터 검색과 파티 편성을 할 수 있는 정적 웹 프로젝트입니다.

## 구조

- `public/`: 순수 HTML/CSS/JavaScript 프런트엔드
- `netlify/functions/plaync-character.js`: AION2 검색/랭킹 API 프록시
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
- 현재 이 프로젝트는 공식 공개 캐릭터 검색/랭킹 경로가 확인된 `AION2`만 지원합니다.
- 공개 랭킹 API에는 전투력 필드가 직접 노출되지 않아, 화면에는 확인 가능한 `랭킹 점수`를 표시합니다.
