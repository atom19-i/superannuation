# Superannuation API

Backend service for micro-savings and retirement projections from expenses.

## Stack
- Node.js 22+
- Native `http` server (no external runtime dependencies)
- Native test runner (`node --test`)

## Run locally
```bash
npm start
```

Server starts on `http://0.0.0.0:5477` (or `PORT` env var).

Open UI in browser:
`http://localhost:5477/`

## Run tests
```bash
npm test
```

## Docker
Build:
```bash
docker build -t blk-hacking-ind-iti-dargar .
```

Run:
```bash
docker run -d -p 5477:5477 blk-hacking-ind-iti-dargar
```

Compose:
```bash
docker compose up --build
```

## Endpoints
- `POST /blackrock/challenge/v1/transactions:parse`
- `POST /blackrock/challenge/v1/transactions:validator`
- `POST /blackrock/challenge/v1/transactions:filter`
- `POST /blackrock/challenge/v1/returns:nps`
- `POST /blackrock/challenge/v1/returns:index`
- `GET /blackrock/challenge/v1/performance`
- `GET /health`
- `GET /` (API console UI)

## Core rules implemented
1. `remanent = ceil_to_100(amount) - amount`
2. `q` periods: override remanent with fixed amount
3. `q` conflicts: latest `start`, tie -> first in input order
4. `p` periods: additive extras; all matches are summed
5. `k` periods: independent inclusive aggregation windows
6. Rule order: base -> `q` -> `p` -> `k`
7. Returns:
- NPS annual rate `7.11%`
- Index annual rate `14.49%`
- Horizon years: `60-age` if `age < 60`, else `5`
8. NPS tax benefit:
- Deduction = `min(invested, 10% annual income, 200000)`
- Tax benefit = `Tax(income) - Tax(income - deduction)`
9. Inflation-adjusted real value:
- `real = nominal / (1 + inflation)^t`

## Input assumptions
- Timestamp format is strict: `YYYY-MM-DD HH:mm:ss`
- Timezone is interpreted as `Asia/Kolkata` for all temporal logic
- `wage` is monthly salary in INR
- Money is computed internally in paise (integer) and serialized with 2 decimals
- Inclusive period boundaries (`start` and `end` both included)

## Example request
```bash
curl -X POST http://localhost:5477/blackrock/challenge/v1/returns:nps \
  -H 'content-type: application/json' \
  -d '{
    "age": 29,
    "wage": 50000,
    "inflation": 5.5,
    "transactions": [
      {"timestamp":"2023-10-12 20:15:00", "amount":250, "ceiling":300, "remanent":50},
      {"timestamp":"2023-02-28 15:49:00", "amount":375, "ceiling":400, "remanent":25},
      {"timestamp":"2023-07-01 21:59:00", "amount":620, "ceiling":700, "remanent":80},
      {"timestamp":"2023-12-17 08:09:00", "amount":480, "ceiling":500, "remanent":20}
    ],
    "q": [{"fixed":0, "start":"2023-07-01 00:00:00", "end":"2023-07-31 23:59:59"}],
    "p": [{"extra":25, "start":"2023-10-01 08:00:00", "end":"2023-12-31 19:59:59"}],
    "k": [
      {"start":"2023-03-01 00:00:00", "end":"2023-11-30 23:59:59"},
      {"start":"2023-01-01 00:00:00", "end":"2023-12-31 23:59:59"}
    ]
  }'
```

## Test files
Tests are in `/test` and include comments with:
- test type
- validation target
- execution command
