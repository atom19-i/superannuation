import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import {
  ApiError,
  parseTransactions,
  validateTransactions,
  filterTransactions,
  calculateReturns
} from './engine.js';

const MAX_BODY_BYTES = 100 * 1024 * 1024;
const UI_FILE_URL = new URL('../public/index.html', import.meta.url);
const uiHtmlPromise = readFile(UI_FILE_URL, 'utf8');

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

function writeHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8'
  });
  res.end(html);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(new ApiError(413, `Payload exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8') || '{}';
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'Invalid JSON payload'));
      }
    });

    req.on('error', (err) => reject(new ApiError(400, err.message)));
  });
}

function getPath(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.pathname;
}

function createMetrics() {
  return {
    lastLatencyMs: 0,
    requestCount: 0,
    startedAtMs: Date.now()
  };
}

function performancePayload(metrics) {
  const memoryMb = process.memoryUsage().rss / (1024 * 1024);
  const threadPoolSize = Number(process.env.UV_THREADPOOL_SIZE || 4);

  return {
    time: `${metrics.lastLatencyMs.toFixed(3)} ms`,
    memory: `${memoryMb.toFixed(2)} MB`,
    threads: threadPoolSize,
    requests: metrics.requestCount,
    uptimeSeconds: Math.floor((Date.now() - metrics.startedAtMs) / 1000),
    cpuCount: os.availableParallelism()
  };
}

export function createServer() {
  const metrics = createMetrics();

  return http.createServer(async (req, res) => {
    const started = process.hrtime.bigint();

    try {
      const path = getPath(req);

      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        const html = await uiHtmlPromise;
        writeHtml(res, 200, html);
        return;
      }

      if (req.method === 'GET' && path === '/health') {
        writeJson(res, 200, { status: 'ok' });
        return;
      }

      if (req.method === 'GET' && path === '/blackrock/challenge/v1/performance') {
        writeJson(res, 200, performancePayload(metrics));
        return;
      }

      if (req.method !== 'POST') {
        throw new ApiError(405, `Method ${req.method} is not allowed`);
      }

      const payload = await readJsonBody(req);

      if (path === '/blackrock/challenge/v1/transactions:parse') {
        writeJson(res, 200, parseTransactions(payload));
        return;
      }

      if (path === '/blackrock/challenge/v1/transactions:validator') {
        writeJson(res, 200, validateTransactions(payload));
        return;
      }

      if (path === '/blackrock/challenge/v1/transactions:filter') {
        writeJson(res, 200, filterTransactions(payload));
        return;
      }

      if (path === '/blackrock/challenge/v1/returns:nps') {
        writeJson(res, 200, calculateReturns(payload, 'nps'));
        return;
      }

      if (path === '/blackrock/challenge/v1/returns:index') {
        writeJson(res, 200, calculateReturns(payload, 'index'));
        return;
      }

      throw new ApiError(404, 'Route not found');
    } catch (error) {
      if (error instanceof ApiError) {
        writeJson(res, error.status, {
          error: error.message,
          details: error.details ?? undefined
        });
      } else {
        writeJson(res, 500, {
          error: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      metrics.lastLatencyMs = elapsedMs;
      metrics.requestCount += 1;
    }
  });
}
