/*
Test type: Integration/API tests
Validation to be executed: Endpoint behavior for parse, validator, temporal filtering, and return calculations with q/p/k rules
Command with necessary arguments for execution: npm test
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/app.js';

function sampleTransactions() {
  return [
    { timestamp: '2023-10-12 20:15:00', amount: 250 },
    { timestamp: '2023-02-28 15:49:00', amount: 375 },
    { timestamp: '2023-07-01 21:59:00', amount: 620 },
    { timestamp: '2023-12-17 08:09:00', amount: 480 }
  ];
}

function samplePeriods() {
  return {
    q: [{ fixed: 0, start: '2023-07-01 00:00:00', end: '2023-07-31 23:59:59' }],
    p: [{ extra: 25, start: '2023-10-01 08:00:00', end: '2023-12-31 19:59:59' }],
    k: [
      { start: '2023-03-01 00:00:00', end: '2023-11-30 23:59:59' },
      { start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }
    ]
  };
}

const server = createServer();

let baseUrl = '';

test.before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  server.close();
  await once(server, 'close');
});

test('GET / serves UI page', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Superannuation API Console/);
});

test('POST /transactions:parse computes rounding totals', async () => {
  const res = await fetch(`${baseUrl}/blackrock/challenge/v1/transactions:parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expenses: sampleTransactions() })
  });

  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.transactionsTotalAmount, 1725);
  assert.equal(body.transactionsTotalCeiling, 1900);
  assert.equal(body.transactionsTotalRemanent, 175);
  assert.equal(body.transactions.length, 4);
});

test('POST /transactions:validator reports duplicates', async () => {
  const res = await fetch(`${baseUrl}/blackrock/challenge/v1/transactions:validator`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wage: 50000,
      transactions: [
        {
          timestamp: '2023-01-01 00:00:00',
          amount: 250,
          ceiling: 300,
          remanent: 50
        },
        {
          timestamp: '2023-01-01 00:00:00',
          amount: 150,
          ceiling: 200,
          remanent: 50
        }
      ]
    })
  });

  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.valid.length, 1);
  assert.equal(body.duplicates.length, 1);
  assert.equal(body.invalid[0].code, 'DUPLICATE_TIMESTAMP');
});

test('POST /transactions:filter applies q->p->k rules with inclusive bounds', async () => {
  const parseRes = await fetch(`${baseUrl}/blackrock/challenge/v1/transactions:parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expenses: sampleTransactions() })
  });
  const parseBody = await parseRes.json();

  const periods = samplePeriods();

  const res = await fetch(`${baseUrl}/blackrock/challenge/v1/transactions:filter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      transactions: parseBody.transactions,
      ...periods
    })
  });

  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.invalid.length, 0);
  assert.equal(body.savingsByDates.length, 2);
  assert.equal(body.savingsByDates[0].amount, 75);
  assert.equal(body.savingsByDates[1].amount, 145);

  const julTx = body.valid.find((tx) => tx.timestamp === '2023-07-01 21:59:00');
  assert.equal(julTx.remanentFinal, 0);

  const octTx = body.valid.find((tx) => tx.timestamp === '2023-10-12 20:15:00');
  assert.equal(octTx.remanentFinal, 75);
});

test('POST /returns:nps calculates projected and real values', async () => {
  const parseRes = await fetch(`${baseUrl}/blackrock/challenge/v1/transactions:parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expenses: sampleTransactions() })
  });
  const parseBody = await parseRes.json();

  const periods = samplePeriods();

  const res = await fetch(`${baseUrl}/blackrock/challenge/v1/returns:nps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      age: 29,
      wage: 50000,
      inflation: 5.5,
      transactions: parseBody.transactions,
      ...periods
    })
  });

  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.savingsByDates.length, 2);
  assert.equal(body.savingsByDates[1].amount, 145);
  assert.ok(body.savingsByDates[1].profits > 1000);
  assert.equal(body.savingsByDates[1].taxBenefit, 0);
  assert.ok(body.savingsByDates[1].realValue > 200);
});

test('strict timestamp validation rejects malformed timestamps', async () => {
  const res = await fetch(`${baseUrl}/blackrock/challenge/v1/transactions:parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expenses: [{ timestamp: '2023-10-12 20:15', amount: 250 }]
    })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /YYYY-MM-DD HH:mm:ss/);
});
