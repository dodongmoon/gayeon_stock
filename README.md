# 실시간 주식 손익 대시보드

삼성전자(005930) 1주, SOL AI반도체TOP2플러스 ETF(0167A0) 4주, TIGER 반도체TOP10커버드콜액티브(0177R0) 15주의 손익을 실시간으로 계산해 보여주는 웹앱입니다.

## 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속

## 배포 (Render 원클릭)

아래 링크로 바로 배포할 수 있습니다.

- [Render Deploy](https://render.com/deploy?repo=https://github.com/dodongmoon/gayeon_stock)

## 기본 매수 정보

- 삼성전자: 169,100원 x 1주
- SOL AI반도체TOP2플러스 ETF: 9,200원 x 4주
- TIGER 반도체TOP10커버드콜액티브: 11,000원 x 15주
- 시작 금액: 250,000원
- 매수일: 2026-03-31

값을 바꾸려면 [`server.js`](/Volumes/SanDiskSSD/mac_usb/cursor/가연주식/server.js) 상단 `HOLDINGS`, `STARTING_CASH`, `PURCHASE_DATE`를 수정하면 됩니다.

## 포함 기능

- 5초 주기 실시간 현재가 반영
- 종목별 평가손익/손익률
- 총 손익/총 손익률
- 삼성전자/ETF 각각 매수일 이후 종가 차트
- 매수일 이후 각 거래일 종가 기준 총 자산/총 손익 추이 차트
- 차트 데이터 1분 주기 자동 갱신 (새 거래일 감지 시 즉시 반영)
