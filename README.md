# Cek stok VPS OVH Singapore

Node.js 22+, tanpa dependency. Kode aplikasi hanya `index.js`.

Memantau Ubuntu 2026.04 di `ap-southeast-sgp`:

| Plan | Spesifikasi |
| --- | --- |
| `vps-2027-model2` | 4 core / 8 GB RAM |
| `vps-2027-model3` | 6 core / 12 GB RAM |

Telegram hanya dikirim jika `linuxStatus` persis `available`. Status Windows,
lokasi lain, status tidak dikenal, dan stok kosong tidak memicu notifikasi.
Pesan berisi spesifikasi, lokasi, OS, dan https://www.ovhcloud.com/en/vps/.

## Konfigurasi

1. Salin `.env.example` menjadi `.env`.
2. Buat bot lewat `@BotFather` di Telegram. Isi token pada `TELEGRAM_BOT_TOKEN`.
3. Kirim `/start` ke bot. Dapatkan chat ID dari `getUpdates` Telegram Bot API,
   lalu isi `TELEGRAM_CHAT_ID`. Untuk grup, tambahkan bot lalu kirim perintah ke bot di grup.
4. Atur `CHECK_INTERVAL_SECONDS`, default 60, rentang 10–86400 detik.
5. Jalankan `npm start` untuk monitoring, atau `npm run check` untuk sekali cek.

Jangan bagikan token, URL API yang memuat token, atau commit `.env`.
`npm run check` juga mengirim Telegram jika stok tersedia, bukan mode simulasi.

## Perilaku

- Cek langsung saat mulai; cek berikutnya setelah putaran selesai ditambah interval.
- Timeout tiap request 20 detik. Putaran tidak tumpang tindih.
- Satu notifikasi per plan selama stok masih tersedia.
- Setelah `out-of-stock`, notifikasi diaktifkan lagi untuk restock berikutnya.
- Pengiriman gagal dicoba lagi pada putaran berikutnya. Error satu plan tidak menghentikan plan lain.
- Deduplikasi hanya di memori. Restart proses bisa mengirim ulang stok yang masih tersedia.
- Jika Telegram menerima pesan tetapi respons terputus, pesan bisa terkirim ulang.
- Hentikan dengan Ctrl+C. Tidak membeli VPS otomatis.

## Perintah Telegram

Saat monitor mulai, menu `/status` didaftarkan otomatis untuk chat terkonfigurasi.
Jika menu belum muncul, buka ulang chat Telegram; perintah tetap bisa diketik manual.

Kirim `/status` (atau `/status@nama_bot` di grup) dari chat yang sesuai
`TELEGRAM_CHAT_ID`. Bot membalas bahwa proses aktif, sedang cek atau menunggu,
interval, waktu cek terakhir (UTC), dan hasil putaran terakhir.
Perintah ini tidak memicu request stok OVH baru.

Listener Telegram berjalan terpisah dari putaran stok menggunakan long polling.
Hanya jalankan satu proses monitor per token bot. Bot tidak boleh memiliki webhook
aktif karena `getUpdates` tidak bisa digunakan bersamaan dengan webhook.
Mode `npm run check` tidak menjalankan listener perintah.
Jika bot mati atau koneksi Telegram gagal, `/status` tidak dibalas.

## Pengujian

`npm test` memakai `node:test` dan mock API, tanpa jaringan atau kredensial.
`node --check index.js` memeriksa sintaks. VS Code: pilih task `Test`.

## Deployment Ubuntu dengan systemd

Pasang Node.js 22+ dan simpan project di `/opt/ovh-stock`. Buat user layanan
`ovh-stock` yang bisa membaca folder itu. Isi `.env`; batasi akses file dengan
`chmod 600 .env` dan pastikan pemiliknya `ovh-stock`. Tidak perlu `npm install`.

Buat `/etc/systemd/system/ovh-stock.service`:

```ini
[Unit]
Description=OVH Singapore VPS stock monitor
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=ovh-stock
WorkingDirectory=/opt/ovh-stock
ExecStart=/usr/bin/node --env-file=.env index.js
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Sesuaikan `ExecStart` dengan lokasi Node.js dari `command -v node`.
Aktifkan lewat `sudo systemctl daemon-reload` lalu
`sudo systemctl enable --now ovh-stock`.
Log: `journalctl -u ovh-stock -f`.

## Maintenance

Ubah spesifikasi/plan di `plans`, OS dan subsidiary di `getStock`, isi pesan
di `sendTelegram`. Setelah perubahan jalankan pengujian, lalu restart layanan.
Tidak ada database, framework, atau paket eksternal untuk diperbarui.