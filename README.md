# PWA 녹음 안정성 테스트 앱

iPhone PWA에서 장시간 녹음 안정성을 측정하는 데모앱.

## 실행 방법

### 개발 서버 (로컬)
```
npm install
npm run dev
```
http://localhost:5173 에서 확인

### iPhone 테스트
같은 Wi-Fi에서:
```
npm run dev -- --host
```
출력된 `Network: http://192.168.x.x:5173` 주소를 iPhone Safari에서 열기

**PWA 설치:** Safari 공유버튼(□↑) → "홈 화면에 추가" → 홈에서 실행

## 테스트 시나리오

| 시나리오 | 기대 결과 |
|---|---|
| 화면 켜둔 채 10분+ 녹음 | chunk 계속 저장, Wake Lock 활성 |
| 홈버튼 누름 | 비프음 + "백그라운드 진입" 로그 |
| 앱 복귀 | "화면 복귀" + Wake Lock 재획득 |
| 전원버튼 잠금 | 비프음 + Wake Lock 해제 로그 |
| 녹음 중지 | webm 파일 자동 다운로드 |

## 주의사항
- 녹음 중 화면을 끄거나 다른 앱으로 전환하지 마세요
- iOS Safari에서는 홈버튼/전원버튼으로 앱이 중단될 수 있습니다
- 데이터는 IndexedDB에 5초 단위로 저장됩니다
