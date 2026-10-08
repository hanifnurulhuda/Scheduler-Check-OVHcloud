# OVH Singapore VPS Stock Monitor

Node.js 22+, no dependencies. All application code is in `index.js`.

Monitors Ubuntu 2026.04 availability in `ap-southeast-sgp`:

| Plan | Specifications |
| --- | --- |
| `vps-2027-model2` | 4 core / 8 GB RAM |
| `vps-2027-model3` | 6 core / 12 GB RAM |

Telegram notifications are sent only when `linuxStatus` is exactly `available`.
Windows availability, other locations, unknown statuses, and out-of-stock results
do not trigger notifications. Messages include specifications, location, OS,
and https://www.ovhcloud.com/en/vps/.

## Configuration

1. Copy `.env.example` to `.env`.
2. Create a bot through `@BotFather` on Telegram. Set `TELEGRAM_BOT_TOKEN` to its token.
3. Send `/start` to the bot. Obtain your chat ID using the Telegram Bot API's
    `getUpdates` method, then set `TELEGRAM_CHAT_ID`. For groups, add the bot and
    send it a command in the group.
4. Set `CHECK_INTERVAL_SECONDS`: default 60, allowed range 10–86400 seconds.
5. Run `npm start` for continuous monitoring, or `npm run check` for a single check.

Do not share the token, API URLs containing the token, or commit `.env`.
`npm run check` also sends Telegram notifications when stock is available; it is not a dry run.

## Behavior

- Checks immediately on startup; subsequent checks run after each round finishes plus the configured interval.
- Stock and message requests time out after 20 seconds. Stock-check rounds do not overlap.
- Sends a notification for each available plan on every check round, even if stock remains available.
- An `out-of-stock` or unknown result sends no notification. Checks continue normally.
- The OVH API exposes availability, not stock quantities. Messages state that the quantity is unavailable; `daysBeforeDelivery` is not a stock count.
- Failed notifications are retried in the next round. A failure for one plan does not stop checks for the other.
- If Telegram accepts a message but its response is lost, the message may be sent again.
- Stop with Ctrl+C. The monitor does not purchase VPS instances automatically.

## Telegram Commands

On startup, the monitor automatically registers the `/status` menu for the configured chat.
If the menu is not visible, reopen the Telegram chat. You can also type the command manually.

Send `/status` (or `/status@bot_username` in a group) from the chat matching
`TELEGRAM_CHAT_ID`. The bot reports that the process is active, whether it is
checking or waiting, the interval, the last completed check time (UTC), and
the last round's result. This command does not trigger a new OVH stock request.

The Telegram listener runs independently of stock-check rounds using long polling.
Run only one monitor process per bot token. The bot must not have an active webhook,
because `getUpdates` cannot be used while a webhook is active.
`npm run check` does not start the command listener.
If the bot is stopped or its Telegram connection fails, `/status` receives no reply.

## Testing

`npm test` uses `node:test` and mocked APIs, with no network access or credentials required.
`node --check index.js` checks syntax. In VS Code, select the `Test` task.

## Ubuntu Deployment with systemd

Install Node.js 22+ and place the project in `/opt/ovh-stock`. Create an
`ovh-stock` service user with read access to that directory. Configure `.env`,
restrict file access with `chmod 600 .env`, and ensure it is owned by `ovh-stock`.
No `npm install` is needed.

Create `/etc/systemd/system/ovh-stock.service`:

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

Adjust `ExecStart` to match the Node.js path returned by `command -v node`.
Enable the service with `sudo systemctl daemon-reload`, followed by
`sudo systemctl enable --now ovh-stock`.
View logs with `journalctl -u ovh-stock -f`.

## Maintenance

Update specifications and plan codes in `plans`, the OS and subsidiary in
`getStock`, and notification text in `sendTelegram`. After changes, run the tests
and restart the service. There is no database, framework, or external package to update.