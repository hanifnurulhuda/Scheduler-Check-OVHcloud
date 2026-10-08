import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const plans = [
  { code: 'vps-2027-model2', label: '4 core / 8 GB RAM' },
  { code: 'vps-2027-model3', label: '6 core / 12 GB RAM' },
];

export async function getStock(plan, fetchFn = fetch) {
  const url = new URL('https://www.ovhcloud.com/ca/engine/api/v1/vps/order/rule/datacenter/');
  url.search = new URLSearchParams({
    ovhSubsidiary: 'WE', os: 'Ubuntu 2026.04', planCode: plan.code,
  });
  const response = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`OVH HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.datacenters)) throw new Error('Respons OVH: datacenters tidak valid');
  const singapore = data.datacenters.find(dc => dc.code === 'ap-southeast-sgp');
  if (typeof singapore?.linuxStatus !== 'string') {
    throw new Error('Respons OVH: Singapore atau linuxStatus tidak ditemukan');
  }
  return singapore.linuxStatus;
}

export async function sendTelegram(plan, token, chatId, fetchFn = fetch) {
  await sendMessage(`Stok VPS OVH tersedia!\n${plan.label}\nPlan: ${plan.code}\nLokasi: Singapore (ap-southeast-sgp)\nOS: Ubuntu 2026.04\nhttps://www.ovhcloud.com/en/vps/`, token, chatId, fetchFn);
}

async function sendMessage(text, token, chatId, fetchFn = fetch) {
  const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  const data = await response.json();
  if (data.ok !== true) throw new Error('Telegram menolak pengiriman pesan');
}

export async function registerCommands(token, chatId, fetchFn = fetch) {
  const response = await fetchFn(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      scope: { type: 'chat', chat_id: chatId },
      commands: [{ command: 'status', description: 'Cek bot aktif tanpa cek stok baru' }],
    }),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  const data = await response.json();
  if (data.ok !== true) throw new Error('Telegram menolak pendaftaran menu');
}

export async function pollCommands(token, chatId, health, offset = 0, fetchFn = fetch) {
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.search = new URLSearchParams({ offset: String(offset), timeout: '25', allowed_updates: '["message"]' });
  const response = await fetchFn(url, { signal: AbortSignal.timeout(35_000) });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  const data = await response.json();
  if (data.ok !== true || !Array.isArray(data.result)) throw new Error('Respons getUpdates tidak valid');
  for (const update of data.result) {
    const message = update.message;
    if (String(message?.chat?.id) === chatId && /^\/status(?:@[\w]+)?(?:\s|$)/i.test(message?.text ?? '')) {
      const text = [
        'Bot aktif.',
        `Monitoring: ${health.checking ? 'sedang cek stok' : 'menunggu putaran berikutnya'}.`,
        `Interval: ${health.interval} detik setelah putaran selesai.`,
        `Cek terakhir selesai: ${health.lastCheck ?? 'belum ada'}.`,
        `Hasil terakhir: ${health.lastSuccess === null ? 'belum ada' : health.lastSuccess ? 'berhasil' : 'ada error; cek log'}.`,
      ].join('\n');
      await sendMessage(text, token, chatId, fetchFn);
    }
    offset = update.update_id + 1;
  }
  return offset;
}

async function listenCommands(token, chatId, health) {
  let offset = 0;
  let menuRegistered = false;
  while (true) {
    if (!menuRegistered) {
      try {
        await registerCommands(token, chatId);
        menuRegistered = true;
        console.log('Telegram: menu /status terdaftar.');
      } catch {
        console.error('Telegram: pendaftaran menu gagal; coba lagi setelah polling.');
      }
    }
    try {
      offset = await pollCommands(token, chatId, health, offset);
    } catch {
      console.error('Telegram /status: polling gagal; coba lagi 5 detik. Pastikan tidak ada webhook atau proses bot lain.');
      await sleep(5000);
    }
  }
}

export async function checkStocks(notified, token, chatId, fetchFn = fetch, log = console.log) {
  let failed = false;
  for (const plan of plans) {
    try {
      const status = await getStock(plan, fetchFn);
      log(`${new Date().toISOString()} ${plan.code}: ${status}`);
      if (status === 'out-of-stock') {
        notified.delete(plan.code);
      } else if (status === 'available' && !notified.has(plan.code)) {
        await sendTelegram(plan, token, chatId, fetchFn);
        notified.add(plan.code);
        log(`${plan.code}: notifikasi terkirim`);
      }
    } catch (error) {
      failed = true;
      // Pesan error fetch bisa memuat URL Telegram beserta token.
      const message = error instanceof TypeError ? 'Request gagal' : String(error.message);
      log(`${plan.code}: ${token ? message.replaceAll(token, '[redacted]') : message}`);
    }
  }
  return !failed;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const interval = Number(process.env.CHECK_INTERVAL_SECONDS ?? 60);
  if (!token || !chatId) throw new Error('Isi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di .env');
  if (!Number.isSafeInteger(interval) || interval < 10 || interval > 86400) {
    throw new Error('CHECK_INTERVAL_SECONDS harus bilangan bulat 10–86400');
  }
  const notified = new Set();
  const once = process.argv.includes('--once');
  const health = { interval, checking: false, lastCheck: null, lastSuccess: null };
  if (!once) void listenCommands(token, chatId, health);
  do {
    health.checking = true;
    const success = await checkStocks(notified, token, chatId);
    health.checking = false;
    health.lastCheck = new Date().toISOString();
    health.lastSuccess = success;
    if (once) {
      process.exitCode = success ? 0 : 1;
      return;
    }
    await sleep(interval * 1000);
  } while (true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}