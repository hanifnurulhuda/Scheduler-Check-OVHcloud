- [x] Requirements: Node.js 22+, tanpa dependency, monitor dua plan OVH Singapore untuk Ubuntu.
- [x] Scaffold: package.json, index.js, .env.example.
- [x] Scheduler: interval configurable, Telegram hanya saat linuxStatus available.
- [x] Extensions: tidak diperlukan.
- [x] Validasi: node --test (13 tes lulus) dan node --check index.js.
- [x] Telegram /status: kesehatan proses tanpa cek stok baru; hanya chat terkonfigurasi.
- [x] Menu /status: setMyCommands otomatis saat monitor mulai, scope chat terkonfigurasi.
- [x] Task: pengujian melalui VS Code.
- [x] Launch: tidak dijalankan sebelum kredensial Telegram diisi pengguna.
- [x] Dokumentasi: README dengan konfigurasi dan deployment systemd.

Pertahankan satu file aplikasi, native fetch, dan node:test. Jangan tambah framework, dashboard, database, atau dependency tanpa kebutuhan nyata. Jangan log token Telegram. Status tak dikenal tidak boleh memicu notifikasi.