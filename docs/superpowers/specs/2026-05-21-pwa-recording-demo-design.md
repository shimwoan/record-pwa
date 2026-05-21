# PWA 녹음 안정성 테스트 데모앱 설계

**날짜:** 2026-05-21  
**목적:** iPhone PWA에서 장시간 녹음이 얼마나 버티는지 기술 검증

---

## 1. 목표

- Wake Lock + MediaRecorder + IndexedDB chunk 저장 조합으로 iOS PWA 녹음 안정성 측정
- 화면 자동 꺼짐 방지 (Wake Lock), 백그라운드 진입 감지, 끊김 시 비프음 경고
- 테스트 아무 음성 녹음 (실제 회의 음성 아님)

---

## 2. 기술 스택

- **프레임워크:** Vite + React
- **PWA:** vite-plugin-pwa (manifest + Service Worker 자동 생성)
- **저장:** IndexedDB (외부 라이브러리 없이 native API 직접 사용)
- **오디오:** MediaRecorder API + Web Audio API (비프음)
- **외부 라이브러리:** 없음

---

## 3. 컴포넌트 구조

```
App
├── RecordingControls   — 녹음 시작/중지 버튼, 경과 시간
├── StatusDashboard     — Wake Lock 상태, chunk 수, 누적 용량, visibility 상태
└── EventLog            — 타임스탬프 + 이벤트 실시간 로그
```

---

## 4. 데이터 흐름

```
마이크 → MediaRecorder(5초 interval)
              → ondataavailable
                    → IndexedDB 저장 {id, timestamp, blob, size}
                    → EventLog 추가
                    → StatusDashboard 업데이트

녹음 중지 → 전체 chunk 합산 → webm 파일 다운로드
```

---

## 5. 핵심 기능

### 5-1. MediaRecorder + chunk 저장
- `mediaRecorder.start(5000)` — 5초마다 `ondataavailable` 발생
- 각 chunk를 IndexedDB에 저장: `{ id, timestamp, blob, size }`
- 녹음 중지 시 전체 chunk를 `Blob` 합산 → webm 다운로드

### 5-2. Wake Lock
- 녹음 시작 시 자동 `navigator.wakeLock.request('screen')`
- `visibilitychange`로 복귀 감지 → Wake Lock 재요청 (iOS에서 해제되는 경우 대응)
- 미지원 환경: StatusDashboard에 "Wake Lock 미지원" 표시, 녹음은 계속

### 5-3. EventLog 항목
- `[HH:MM:SS] 녹음 시작`
- `[HH:MM:SS] chunk #N 저장 (XXkB)`
- `[HH:MM:SS] 화면 백그라운드 진입` / `복귀`
- `[HH:MM:SS] Wake Lock 해제됨` / `재획득`
- `[HH:MM:SS] 녹음 중지 — 총 N개 chunk, XX.XMB`

---

## 6. 비프음 (iOS 완전 대응)

### iOS AudioContext 제약 우회
- 녹음 시작 버튼 탭 시점에 `AudioContext` 생성
- 즉시 **무음(gain=0) 0.001초** 재생 → iOS가 컨텍스트를 "사용자 허용"으로 등록
- 이후 탭 없이도 비프음 자동 재생 가능

### 비프음 사양
- 주파수: **880Hz + 1760Hz 동시 합성** (날카롭고 크게)
- 파형: `square` (sine보다 크고 거슬림 — 경고음에 적합)
- 길이: 0.5초
- 볼륨: GainNode 0.8

### 비프음 발생 조건
- `MediaRecorder.onerror` 발생
- `visibilitychange` → hidden (백그라운드 진입)
- Wake Lock `release` 이벤트

---

## 7. 에러 처리

| 상황 | 처리 |
|---|---|
| 마이크 권한 거부 | 안내 메시지 표시, 녹음 불가 |
| MediaRecorder 미지원 | "이 브라우저는 지원되지 않습니다" 표시 |
| Wake Lock 미지원 | StatusDashboard에 "미지원" 표시, 녹음 계속 |
| IndexedDB 저장 실패 | EventLog 빨간 텍스트 + 비프음 |
| 녹음 끊김 | EventLog 기록 + 비프음 |

---

## 8. PWA 설정

- `manifest.json`: 앱 이름, 아이콘, `display: standalone`
- Service Worker: vite-plugin-pwa 자동 생성 (오프라인 캐시)
- iPhone Safari: "홈 화면에 추가" 후 실행

---

## 9. 테스트 시나리오

1. **기본:** 화면 켜둔 채 1시간 녹음 → Wake Lock 유지 여부 확인
2. **백그라운드:** 홈버튼 누름 → 몇 초 후 끊기는지 EventLog로 확인
3. **화면 잠금:** 전원버튼 → 즉시 끊기는지 확인
4. **복귀:** 백그라운드 후 복귀 → Wake Lock 재획득 여부 확인
5. **비프음:** 각 끊김 상황에서 비프음 울리는지 확인
