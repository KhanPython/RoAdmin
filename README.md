

<div align="center">
    <img alt="platform" src="https://camo.githubusercontent.com/27d9a984b7c15ec14322b53f221c964e8218459b0209e7f8f6fb3d68c5d80351/68747470733a2f2f696d672e736869656c64732e696f2f7374617469632f76313f7374796c653d666f722d7468652d6261646765266d6573736167653d526f626c6f7826636f6c6f723d303030303030266c6f676f3d526f626c6f78266c6f676f436f6c6f723d464646464646266c6162656c3d">
    <h1>RoAdmin</h1>
    <img src="./assets/Logo.png" width="300" height="300" alt="blueprint illustration">
    <p>
        <img alt="language" src="https://img.shields.io/github/languages/top/KhanPython/Volt-beta" >
        <img alt="code size" src="https://img.shields.io/github/languages/code-size/KhanPython/Volt-beta">
        <img alt="issues" src="https://img.shields.io/github/issues/KhanPython/Volt-beta" >
        <img alt="issues" src="https://img.shields.io/github/last-commit/KhanPython/Volt-Beta" >
        <img alt="license" src="https://img.shields.io/github/license/KhanPython/VOLT-Beta" >
    </p>
</div>

### A Discord bot for managing Roblox experiences via Roblox Open Cloud APIs - with both slash commands and natural language input powered by Claude (Anthropic).

---

## Features

- **Moderation** - Ban and unban players, check ban status, list active bans
- **DataStore Management** - Read, write, list keys, and delete standard datastore entries
- **Leaderboards** - View and remove entries from ordered datastores
- **Natural Language Interface** - Use `/ask` with plain English commands; Claude Haiku 4.5 parses intent and presents a confirmation before executing
- **Multi-universe Support** - Manage multiple Roblox experiences from one bot instance, each with its own API key
- **Privacy** - Sensitive player data in bot responses is automatically redacted after 2 minutes; `/forgetme` lets admins wipe stored data
- **Security** - All commands require Administrator permission; NLP commands include a confirmation step, prompt-injection defence, LLM rate limiting (5 req/60s per user), and batch write protection

---

## Setup

### 1. Environment Variables

<!-- AUTO-GENERATED: from CLAUDE.md environment variables table -->
| Variable | Required | Description |
| -------- | -------- | ----------- |
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `ENCRYPTION_KEY` | No | 64-char hex string (32 bytes) for AES-256-GCM encryption of persisted API keys. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Without this, keys are held in memory only and cleared on restart. |
| `NODE_ENV` | No | Set to `"production"` on the GCP VM. Controls default log level. |
| `LOG_LEVEL` | No | `"debug"`, `"info"`, `"warn"`, or `"error"`. Defaults to `"info"` in production, `"debug"` otherwise. |
| `RATE_LIMIT_MAX` | No | Max Roblox API requests per universe per window (default: 50). |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window in ms (default: 60000). |
<!-- END AUTO-GENERATED -->

Minimal `.env` to get started:

```
DISCORD_TOKEN=your-discord-bot-token
```

### 2. Installation & Running

```bash
npm install
npm start
```

### 3. First-time Configuration (inside Discord)

All other secrets are set at runtime via slash commands. When `ENCRYPTION_KEY` is configured, keys are encrypted and persisted to `data/keystore.enc` — they survive bot restarts. Without `ENCRYPTION_KEY`, keys are held in memory only and must be re-entered after each restart.

**Register a Roblox universe:**
```
/setapikey universeid:<universeId>
```
A secure modal will appear prompting you to paste your API key. Run this once per experience you want to manage. The key must have the appropriate Open Cloud permissions (DataStore read/write, User Restrictions write).

**Register an Anthropic API key (required for NLP):**
```
/setllmkey
```
A secure modal will appear prompting you to paste your Anthropic API key. The bot validates the key by making a test call before storing it.

---

## Slash Commands

All commands require **Administrator** permission and are ephemeral or guild-only.

### Config

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/setapikey` | `universeid` | Register a Roblox Open Cloud API key for a universe. API key is entered via a secure modal. |
| `/setllmkey` | - | Register the Anthropic API key for NLP processing. Key is entered via a secure modal. |

### NLP

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/ask` | `prompt` | Issue a command in plain English via AI. Claude Haiku 4.5 parses your intent and shows a confirmation before executing. |

### Moderation

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/ban` | `userid`, `reason`, `universeid`, `duration`\*, `excludealts`\* | Ban a player. Duration format: `7d` (days), `2h` (hours), `1m` (months), `1y` (years). Omit for permanent. `excludealts`: when `true`, alt accounts are excluded from the ban; when `false` (default), alts are also banned. |
| `/unban` | `userid`, `universeid` | Remove a player's ban |
| `/checkban` | `userid`, `universeid` | Check the ban status of a player |
| `/listbans` | `universeid` | List all active bans in a universe (paginated) |

### Player Data

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/showData` | `key`, `universeid`, `datastore` | Read a datastore entry by key. Full data is always attached as a `.txt` file. |
| `/setdata` | `key`, `universeid`, `datastore`, `value`, `scope`\* | Set or update a datastore entry (upsert). Value can be JSON or a plain string. |
| `/deletedata` | `key`, `universeid`, `datastore`, `scope`\* | Delete a datastore entry. Requires button confirmation; attaches a snapshot of the deleted value as a file. |
| `/listkeys` | `universeid`, `datastore`, `scope`\* | List all entry keys in a datastore (paginated) |

### Leaderboards

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/listleaderboard` | `leaderboard`, `universeid`, `scope`\* | List top entries from an ordered datastore (paginated) |
| `/removeFromBoard` | `userid`, `leaderboard`, `universeid`, `key`\* | Remove a player's entry from an ordered datastore |

### Privacy

| Command | Parameters | Description |
| --- | --- | --- |
| `/forgetme` | `scope`\* (`"personal"` or `"server"`) | Delete data the bot holds. Both scopes require a confirmation button click. **Personal** (default): clears your NLP command history. **Server**: wipes all API keys, LLM key, data processing consent, and command history for the entire guild. |

### Info

| Command | Parameters | Description |
| --- | --- | --- |
| `/about` | - | Show bot version, uptime, storage mode, NLP consent status, and data practices |

\* Optional parameter

---

## Natural Language Interface

Use the `/ask` slash command with a plain-English prompt. Claude Haiku 4.5 parses your intent, displays a confirmation embed, and executes only after you click **Confirm**.

> Only **Administrators** can use `/ask`. A rate limit of 5 requests per 60 seconds applies per user. The bot also checks for relevant command keywords before forwarding to the LLM.

### How to use

```
/ask prompt:ban player 12345 for exploiting in universe 98765
```

The bot replies with a confirmation embed showing the parsed parameters. Click **Confirm** to execute or **Cancel** to delete the message. Read-only commands (`showData`, `checkBan`, `listBans`, `listKeys`, `listLeaderboard`) skip the confirmation step and execute immediately.

### NLP Examples

#### Moderation

```
/ask prompt:ban user 12345678 for speed hacking, permanent, in universe 111222333
/ask prompt:ban player 87654321 for 7 days for chat abuse in universe 111222333
/ask prompt:ban 11223344 and 55667788 for exploiting in universe 111222333
/ask prompt:unban player 12345678 in universe 111222333
/ask prompt:check if player 12345678 is banned in universe 111222333
/ask prompt:list all active bans in universe 111222333
```

#### DataStore - Reading

```
/ask prompt:show data for key 12345678 in datastore PlayerCoins universe 111222333
/ask prompt:get entry 87654321 from PlayerStats datastore in universe 111222333
```

#### DataStore - Writing

```
/ask prompt:set PlayerCoins for key 12345678 to 500 in universe 111222333
/ask prompt:update PlayerStats for player 87654321 to {"coins":100,"level":5} in universe 111222333
```

> `setData` creates entries that don't exist yet (upsert behaviour). The value can be JSON or a plain string.

#### DataStore - Field Updates (updateData)

Update specific fields inside a JSON entry without touching anything else:

```
/ask prompt:set Gold on key 12345678 in PlayerStats datastore universe 111222333 to 400
/ask prompt:set Gold to 400 then set Money to 100 on key 12345678 in PlayerStats universe 111222333
```

Multiple field changes on the **same entry** are automatically merged into a single API call (one fetch + one write), regardless of how many fields you change. The result embed shows a compact before→after table:

```
Changes
Gold    250 → 400
Money   50  → 100
```

You can also chain `updateData` with other actions in the same request:

```
/ask prompt:set Gold on that entry to 400, then show me the data
```

> Use `updateData` (natural language field changes) when you want to change specific properties. Use `setData` only when you want to replace the entire entry value. `setData` cannot be batched.

#### DataStore - Keys

```
/ask prompt:list all keys in PlayerCoins datastore in universe 111222333
/ask prompt:list keys in PlayerStats in universe 111222333
```

> **Deletion is not available via NLP.** Use the `/deletedata` slash command instead - it requires a confirmation button click and attaches a snapshot of the deleted value. `setData` cannot be batched via NLP - it must be run one at a time. Multiple `updateData` field changes on the same entry are automatically merged into one API call.

#### Leaderboards (Ordered DataStores)

```
/ask prompt:show the top entries on the WinsLeaderboard in universe 111222333
/ask prompt:list global leaderboard KillsBoard in universe 111222333
/ask prompt:remove player 12345678 from WinsLeaderboard in universe 111222333
```

#### Batch Commands

```
/ask prompt:ban players 111, 222, and 333 for hacking in universe 111222333
/ask prompt:unban 444 and 555 from universe 111222333
```

> Batches are capped at **10 commands** per request. Read-only actions (`showData`, `listKeys`, `checkBan`, etc.) and field-level updates (`updateData`) can be batched freely. Full-replacement writes (`setData`) cannot be batched.

---

## Deployment

Production deploys automatically on every push to `master` via `.github/workflows/deploy.yml`:

1. SSH into the GCP VM
2. `git fetch --all && git reset --hard origin/master && git clean -fd`
3. Overwrite `.env` with `DISCORD_TOKEN`, `ENCRYPTION_KEY`, and `NODE_ENV=production` from GitHub Secrets
4. `npm install --omit=dev`
5. Kill the PM2 daemon (`pm2 kill`), then start fresh via `pm2 start ecosystem.config.js`
6. `pm2 save` to persist the process list across VM reboots

Required GitHub Secrets: `REMOTE_HOST`, `REMOTE_USER`, `SSH_PRIVATE_KEY`, `DISCORD_TOKEN`, `ENCRYPTION_KEY`.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 16+ |
| Discord framework | discord.js v14 |
| Command handler | WOKCommands v1.5 |
| NLP / intent parsing | Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via `@anthropic-ai/sdk` |
| HTTP client | axios |
| Environment | dotenv |
| Deployment | GitHub Actions → PM2 on GCP VM |

Per-universe API keys and the Anthropic key are never logged. When `ENCRYPTION_KEY` is set, they are encrypted with AES-256-GCM and persisted to `data/keystore.enc` so they survive restarts. Without `ENCRYPTION_KEY`, they are held in memory only and cleared on restart.

---

## Security

RoAdmin follows a defense-in-depth approach — multiple overlapping layers so that no single failure compromises the system.

### Access Control

- Every command requires **Discord Administrator** permission, enforced both in command metadata and modal handlers.
- All data is **guild-scoped** — API keys, LLM keys, consent, and command history set in one server are inaccessible from another.
- NLP commands require explicit **data processing consent** (button click) from a server admin before the guild can use `/ask`.

### Encryption at Rest

- Persisted keys use **AES-256-GCM** (authenticated encryption).
- The encryption key is derived via **HKDF-SHA256** from the `ENCRYPTION_KEY` env var, using a per-deployment random salt stored in `data/keystore.salt`.
- Keystore writes are **atomic** (write → temp file → rename) to prevent corruption.
- File permissions are set to **owner-only** (`0o600`) on both the keystore and salt files.

### API Key Handling

- Keys are entered exclusively via **Discord modals** — they never appear in message history or channel text.
- Keys are **validated against the Roblox API** before being stored (401 = invalid, 403 = insufficient permissions).
- Keys are never echoed back, logged, or included in embeds.

### Input Validation

- `userId` and `universeId` must be positive integers; `scope` and `leaderboardName` are restricted to `[a-zA-Z0-9_-]`.
- Duration strings are validated against `\d+[dmyh]` and capped at 10 years.
- All string fields are capped at 1,000 characters; ban reasons at 500.
- NLP-parsed parameters are **type-coerced and re-validated** after LLM output — the bot never trusts the model's types directly.

### Prompt Injection Defence

- The LLM system prompt enforces a strict **action whitelist**. Any unrecognized action is rejected and logged as a possible injection attempt.
- Game names and command history injected into the prompt are **sanitized** (control characters, newlines, and `<>` stripped, values truncated).
- Data passed to the LLM for field-level patches is wrapped in explicit `<untrusted_data>` / `<instruction>` XML blocks, and XML-like tags within the data are stripped beforehand.
- `universeId` values returned by the LLM are **cross-checked** against the guild's configured universe list — hallucinated IDs are rejected.
- `deleteData` is **never available via NLP**; it can only be run through the `/deletedata` slash command with a confirmation button.

### Rate Limiting

- **Roblox API:** Sliding-window limiter — 50 requests per 60 seconds per universe (configurable via env vars). Checked before every API call.
- **LLM:** 5 requests per 60 seconds per user, preventing `/ask` spam and runaway API costs.

### Batch Protections

- Batch NLP commands are capped at **10 per request**.
- `setData` (full entry replacement) **cannot be batched** — only one per request.
- `updateData` verifies that **only the requested fields changed** before writing; unintended mutations are rejected.
- All mutating batches require an explicit **Confirm** button click.

### Data Privacy

- `/forgetme personal` clears a user's NLP command history; `/forgetme server` wipes all keys, consent, and history for the guild (requires confirmation).
- Command history is kept **in memory only** (max 20 entries per user/channel pair, max 10,000 keys total) and is never persisted to disk.

### Logging

- All output goes through a structured logger gated by `LOG_LEVEL`. In production, `debug` is suppressed entirely — no response bodies, request URLs, or credentials are written.
- Raw error objects are never surfaced in Discord; users see formatted embed messages only.