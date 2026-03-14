# CLAUDE.md — RoAdmin Developer Guide

This file provides context for AI assistants working on the RoAdmin codebase.

## Project Overview

**RoAdmin** is a Discord bot that exposes Roblox Open Cloud API operations as Discord slash commands. It lets Discord server administrators manage Roblox experiences (ban/unban players, inspect datastores, manage leaderboards) without needing a custom Roblox admin panel or external database.

- **Language:** JavaScript (Node.js 16+)
- **License:** MIT
- **Author:** KhanPython

---

## Repository Structure

```
RoAdmin/
├── src/
│   ├── index.js              # Bot entry point — initializes discord.js client and WOKCommands
│   ├── openCloudAPI.js       # Core Roblox Open Cloud API wrapper (ban, datastore, messaging)
│   ├── robloxUserInfo.js     # Fetches Roblox user info via public API (username, avatar)
│   ├── robloxMessageAPI.js   # Roblox Messaging Service integration
│   ├── commands/             # Discord slash command handlers (one file per command)
│   │   ├── ban.js
│   │   ├── unban.js
│   │   ├── setapikey.js
│   │   ├── showData.js
│   │   ├── listleaderboard.js
│   │   └── removeFromBoard.js
│   └── utils/
│       ├── apiCache.js       # In-memory API key store keyed by universeId
│       └── universeUtils.js  # Universe ID validation helpers
├── .github/workflows/
│   └── deploy.yml            # CI/CD: SSH deploy to GCP VM on push to master
├── assets/
│   └── Logo.png
├── package.json
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 16+ |
| Discord framework | discord.js v14 |
| Command handler | wokcommands v1.5 |
| Roblox SDK | rbxcloud v1.2 |
| HTTP client | axios v1.4 |
| Environment | dotenv v16 |
| Deployment | GitHub Actions → PM2 on GCP VM |

---

## Development Setup

```bash
# Install all dependencies
npm install

# Create a .env file (not committed — see .gitignore)
echo "DISCORD_TOKEN=your-token-here" > .env

# Start the bot
npm start      # runs: node .
```

No test framework is configured (`npm test` is a stub). There are no test files in the repository.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Discord bot token |

Per-universe Roblox API keys are **not stored in .env**. They are set at runtime via the `/setapikey` Discord slash command and held in the in-memory cache (`src/utils/apiCache.js`). Keys are cleared when the bot restarts.

---

## Key Conventions

### Command Files (`src/commands/`)

Every command is a WOKCommands module exporting a plain object:

```js
module.exports = {
  category: "Moderation",           // Displayed in help
  description: "Short description",
  slash: "both",                    // Support both slash and prefix
  permissions: ["ADMINISTRATOR"],   // Gate all commands to server admins
  options: [                        // Discord slash command parameters
    {
      name: "userid",
      description: "...",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
  ],
  callback: async ({ interaction, channel }) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // ... do work ...
    await interaction.editReply({ embeds: [embed] });
  },
};
```

Key points:
- Always `deferReply` with `MessageFlags.Ephemeral` before async API calls to avoid interaction timeouts.
- Always `editReply` (not `reply`) after deferring.
- Validate inputs before making external API calls.
- Show user-friendly embed responses; never expose raw stack traces.

### API Wrapper (`src/openCloudAPI.js`)

All exported functions return a standardized response object:

```js
{ success: boolean, status: number, data: any }
```

Callers must check `result.success` before using `result.data`. HTTP errors are caught and returned as `{ success: false, status: <code>, data: errorMessage }` — they are never thrown.

### In-Memory API Key Cache (`src/utils/apiCache.js`)

```js
// Store
apiCache.set(universeId, apiKey);

// Retrieve
const key = apiCache.get(universeId);
```

Keys are only available for the life of the current process. The `/setapikey` command must be re-run after bot restarts.

### Embed Truncation

Discord embeds have strict character limits. When displaying datastore values or user data that may be large:
- Truncate field values to ≤ 1024 characters.
- Split metadata and payload into **separate embeds** if needed.
- Field names ≤ 256 chars, embed title ≤ 256 chars, total embed ≤ 6000 chars.

---

## Commands Reference

| Command | Category | Key Parameters |
|---------|----------|---------------|
| `/ban` | Moderation | `userid`, `reason`, `universeid`, `duration` (opt), `excludealts` (opt) |
| `/unban` | Moderation | `userid`, `universeid` |
| `/setapikey` | Config | `universeid`, `apikey` |
| `/showData` | Player Data | `key`, `universeid`, `datastorename` |
| `/listleaderboard` | Debugging | `leaderboardname`, `universeid`, `scope` (opt) |
| `/removeFromBoard` | Moderation | `userid`, `leaderboardname`, `universeid`, `key` (opt) |

---

## Deployment

**Production** is deployed automatically on every push to `master` via `.github/workflows/deploy.yml`:

1. SSH into the GCP VM.
2. `git stash && git pull origin master`
3. Overwrite `.env` with `DISCORD_TOKEN` from GitHub Secrets.
4. `npm install --production`
5. `pm2 restart RoAdmin || pm2 start . --name RoAdmin && pm2 save`

Required GitHub Secrets: `REMOTE_HOST`, `REMOTE_USER`, `SSH_PRIVATE_KEY`, `DISCORD_TOKEN`.

**Do not push directly to `master`** unless deploying to production.

---

## Roblox Open Cloud API Notes

- Base URL: `https://apis.roblox.com/cloud/v2/`
- Authentication header: `x-api-key: <key>`
- DataStore endpoints require `universeId` and a scoped API key with DataStore read/write permissions.
- User Restriction endpoints (ban/unban) require a key with `user-restrictions:write` permission.
- Ordered DataStores use a separate endpoint family from standard DataStores.

---

## What to Avoid

- Do not persist API keys to disk or logs — they live only in memory.
- Do not skip `deferReply` before async operations; Discord invalidates interactions after 3 seconds.
- Do not use `reply` after `deferReply`; use `editReply` instead.
- Do not add a database dependency — the design intentionally uses Roblox DataStores as the sole persistence layer.
- Do not push to `master` when working on a feature; use a feature branch.
- Do not expose raw error objects in Discord messages — format them into readable embed fields.
