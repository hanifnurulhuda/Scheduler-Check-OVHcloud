import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStocks, getStock, plans, sendTelegram, pollCommands, registerCommands } from './index.js';

function mockApi(status = 'out-of-stock', telegramOk = true) {
  const messages = [];
  const fetchFn = async (url, options) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
      messages.push(JSON.parse(options.body));
      return { ok: telegramOk, status: telegramOk ? 200 : 500, json: async () => ({ ok: telegramOk }) };
    }
    assert.equal(url.searchParams.get('os'), 'Ubuntu 2026.04');
    return { ok: true, json: async () => ({ datacenters: [
      { code: 'eu-west-rbx', linuxStatus: 'available' },
      { code: 'ap-southeast-sgp', linuxStatus: status, windowsStatus: 'available' },
    ] }) };
  };
  return { fetchFn, messages };
}

const quiet = () => {};

test('Menu /status didaftarkan hanya untuk chat terkonfigurasi', async () => {
  await registerCommands('token', '123', async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/bottoken/setMyCommands');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.scope, { type: 'chat', chat_id: '123' });
    assert.equal(body.commands[0].command, 'status');
    return { ok: true, json: async () => ({ ok: true }) };
  });
});

test('Pendaftaran menu gagal ditolak', async () => {
  for (const response of [
    { ok: false, status: 400 },
    { ok: true, json: async () => ({ ok: false }) },
  ]) {
    await assert.rejects(registerCommands('token', '123', async () => response));
  }
});

test('/status membaca kesehatan tanpa request OVH dan mengabaikan chat lain', async () => {
  const messages = [];
  const health = { interval: 60, checking: true, lastCheck: null, lastSuccess: null };
  const fetchFn = async (url, options) => {
    assert.ok(String(url).startsWith('https://api.telegram.org/'));
    if (String(url).includes('/getUpdates')) {
      assert.equal(url.searchParams.get('offset'), '10');
      return { ok: true, json: async () => ({ ok: true, result: [
        { update_id: 10, message: { chat: { id: 999 }, text: '/status' } },
        { update_id: 11, message: { chat: { id: 123 }, text: '/status@my_bot' } },
        { update_id: 12, message: { chat: { id: 123 }, text: '/other' } },
      ] }) };
    }
    messages.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  assert.equal(await pollCommands('token', '123', health, 10, fetchFn), 13);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Bot aktif/);
  assert.match(messages[0].text, /sedang cek stok/);
  health.checking = false;
  health.lastCheck = '2026-10-08T00:00:00.000Z';
  health.lastSuccess = false;
  await pollCommands('token', '123', health, 10, fetchFn);
  assert.match(messages[1].text, /menunggu putaran berikutnya/);
  assert.match(messages[1].text, /2026-10-08T00:00:00.000Z/);
  assert.match(messages[1].text, /ada error/);
});

test('/status menolak respons Telegram gagal atau tidak valid', async () => {
  for (const response of [
    { ok: false, status: 409 },
    { ok: true, json: async () => ({ ok: false }) },
  ]) {
    await assert.rejects(pollCommands('token', '123', {}, 0, async () => response));
  }
});

for (const status of ['out-of-stock', 'unknown', '']) {
  test(`Tidak kirim Telegram saat linuxStatus ${JSON.stringify(status)}`, async () => {
    const api = mockApi(status);
    await checkStocks('token', '123', api.fetchFn, quiet);
    assert.equal(api.messages.length, 0);
  });
}

test('Kirim kedua plan tersedia setiap putaran dan berhenti saat stok kosong', async () => {
  const available = mockApi('available');
  await checkStocks('token', '123', available.fetchFn, quiet);
  await checkStocks('token', '123', available.fetchFn, quiet);
  assert.equal(available.messages.length, 4);
  assert.equal(available.messages[0].chat_id, '123');
  assert.match(available.messages[0].text, /4 core \/ 8 GB RAM/);
  assert.match(available.messages[1].text, /6 core \/ 12 GB RAM/);
  assert.ok(available.messages[0].text.includes('https://www.ovhcloud.com/en/vps/'));
  assert.match(available.messages[0].text, /Jumlah stok: tidak tersedia dari API OVH/);
  const empty = mockApi();
  await checkStocks('token', '123', empty.fetchFn, quiet);
  assert.equal(empty.messages.length, 0);
  await checkStocks('token', '123', available.fetchFn, quiet);
  assert.equal(available.messages.length, 6);
});

test('Telegram gagal: coba lagi pada pengecekan berikutnya', async () => {
  assert.equal(await checkStocks('token', '123', mockApi('available', false).fetchFn, quiet), false);
  const api = mockApi('available');
  await checkStocks('token', '123', api.fetchFn, quiet);
  assert.equal(api.messages.length, 2);
});

test('Respons OVH tidak valid ditolak', async () => {
  for (const data of [{}, { datacenters: [] }, { datacenters: [{ code: 'ap-southeast-sgp' }] }]) {
    await assert.rejects(getStock(plans[0], async () => ({ ok: true, json: async () => data })));
  }
  await assert.rejects(getStock(plans[0], async () => ({ ok: false, status: 503 })), /OVH HTTP 503/);
});

test('Status tak dikenal tetap tanpa notif setelah stok tersedia', async () => {
  await checkStocks('token', '123', mockApi('available').fetchFn, quiet);
  const unknown = mockApi('unknown');
  await checkStocks('token', '123', unknown.fetchFn, quiet);
  assert.equal(unknown.messages.length, 0);
});

test('Error tidak membocorkan token; kedua plan tetap diperiksa', async () => {
  const logs = [];
  let calls = 0;
  await checkStocks('secret-token', '123', async () => {
    calls++;
    throw new Error('Error https://api.telegram.org/botsecret-token/sendMessage');
  }, message => logs.push(message));
  assert.equal(calls, 2);
  assert.ok(logs.every(message => !message.includes('secret-token')));
});

test('Telegram ok=false tetap dianggap gagal meskipun HTTP 200', async () => {
  await assert.rejects(sendTelegram(plans[0], 'token', '123', async () => ({
    ok: true, json: async () => ({ ok: false }),
  })), /Telegram menolak/);
});