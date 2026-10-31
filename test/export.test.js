const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'expenses-')), 'expenses.json');
fs.copyFileSync(path.join(__dirname, '..', 'data', 'expenses.json'), tmp);
process.env.EXPENSES_FILE = tmp;

const app = require('../src/app');
const server = app.listen(0);
after(() => server.close());

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { port: server.address().port, path: urlPath, method },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('GET /expenses/export.csv returns header + 18 rows for September', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-09-01&to=2026-09-30');
  assert.strictEqual(res.status, 200);
  const lines = res.body.trim().split('\n');
  assert.strictEqual(lines[0], 'date,category,amount,note');
  assert.strictEqual(lines.length, 19); // 1 header + 18 data rows
});

test('GET /expenses/export.csv quotes notes containing commas', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-08-01&to=2026-10-31');
  assert.strictEqual(res.status, 200);
  const lines = res.body.trim().split('\n');
  for (const line of lines.slice(1)) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2}),([^,]+),(\d+),(.*)$/s);
    if (!match) {
      // Line has a quoted field — verify it starts with a quote after the last comma-separated amount
      assert.ok(line.includes('"'), `Expected quoted field in: ${line}`);
    }
  }
});

test('GET /expenses/export.csv returns 400 for missing or invalid params', async () => {
  const cases = [
    '/expenses/export.csv',
    '/expenses/export.csv?from=2026-09-01',
    '/expenses/export.csv?to=2026-09-30',
    '/expenses/export.csv?from=bad&to=2026-09-30',
    '/expenses/export.csv?from=2026-09-30&to=2026-09-01',
  ];
  for (const urlPath of cases) {
    const res = await request('GET', urlPath);
    assert.strictEqual(res.status, 400, urlPath);
    const body = JSON.parse(res.body);
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
  }
});

test('GET /expenses/export.csv sets Content-Disposition header', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-09-01&to=2026-09-30');
  assert.strictEqual(
    res.headers['content-disposition'],
    'attachment; filename="expenses-2026-09-01-2026-09-30.csv"'
  );
  assert.strictEqual(res.headers['content-type'], 'text/csv; charset=utf-8');
});
