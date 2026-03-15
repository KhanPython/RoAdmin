

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
- **Natural Language Interface** - @mention the bot with plain English commands; Claude parses intent and presents a confirmation before executing
- **Multi-universe Support** - Manage multiple Roblox experiences from one bot instance, each with its own API key
- **Security** - All commands require Administrator permission; NLP commands include a confirmation step, prompt-injection defence, and batch write protection

---

## Setup

### 1. Environment Variable

The only secret stored in `.env` (or as a GitHub Actions secret) is your Discord bot token:

```
DISCORD_TOKEN=your-discord-bot-token
```

### 2. Installation & Running

```bash
npm install
npm start
```

### 3. First-time Configuration (inside Discord)

All other secrets are set at runtime via slash commands and held in memory. They must be re-entered after each bot restart.

**Register a Roblox universe:**
```
/setapikey universeid:<universeId> apikey:<your-roblox-open-cloud-key>
```
Run this once per experience you want to manage. The API key must have the appropriate Open Cloud permissions (DataStore read/write, User Restrictions write).

**Register an Anthropic API key (required for NLP):**
```
/setllmkey apikey:<your-anthropic-api-key>
```
The bot validates the key by making a test call before storing it.

---

## Slash Commands

All commands require **Administrator** permission and are ephemeral or guild-only.

### Config

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/setapikey` | `universeid`, `apikey` | Register a Roblox Open Cloud API key for a universe |
| `/setllmkey` | `apikey` | Register the Anthropic API key for NLP processing |

### Moderation

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/ban` | `userid`, `reason`, `universeid`, `duration`\*, `excludealts`\* | Ban a player. Duration format: `7d`, `2h`, `1m`, `1y`. Omit for permanent. |
| `/unban` | `userid`, `universeid` | Remove a player's ban |

### Player Data

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/showData` | `key`, `universeid`, `datastore` | Read a single standard datastore entry by key |
| `/setdata` | `key`, `universeid`, `datastore`, `value`, `scope`\* | Set or update a datastore entry (upsert). Value can be JSON or a plain string. |
| `/deletedata` | `key`, `universeid`, `datastore`, `scope`\* | Delete a datastore entry. Requires button confirmation; attaches a snapshot of the deleted value as a file. |

### Leaderboards

| Command | Parameters | Description |
|---------|-----------|-------------|
| `/listleaderboard` | `leaderboard`, `universeid`, `scope`\* | List top entries from an ordered datastore (paginated) |
| `/removeFromBoard` | `userid`, `leaderboard`, `universeid`, `key`\* | Remove a player's entry from an ordered datastore |

\* Optional parameter

---

## Natural Language Interface

@mention the bot with a plain-English request. Claude will parse the intent, display a confirmation embed, and execute only after you click **Confirm**.

> Only messages from **Administrators** are processed. A 3-second cooldown applies per user.

### How to use

```
@RoAdmin ban player 12345 for exploiting in universe 98765
```

The bot replies with a confirmation embed showing the parsed parameters. Click **Confirm** to execute or **Cancel** to abort.

### NLP Examples

#### Moderation

```
@RoAdmin ban user 12345678 for speed hacking, permanent, in universe 111222333
@RoAdmin ban player 87654321 for 7 days for chat abuse in universe 111222333
@RoAdmin ban 11223344 and 55667788 for exploiting in universe 111222333
@RoAdmin unban player 12345678 in universe 111222333
@RoAdmin check if player 12345678 is banned in universe 111222333
@RoAdmin list all active bans in universe 111222333
```

#### DataStore - Reading

```
@RoAdmin show data for key 12345678 in datastore PlayerCoins universe 111222333
@RoAdmin get entry 87654321 from PlayerStats datastore in universe 111222333
```

#### DataStore - Writing

```
@RoAdmin set PlayerCoins for key 12345678 to 500 in universe 111222333
@RoAdmin update PlayerStats for player 87654321 to {"coins":100,"level":5} in universe 111222333
```

> `setData` creates entries that don't exist yet (upsert behaviour). The value can be JSON or a plain string.

#### DataStore - Field Updates (updateData)

Update specific fields inside a JSON entry without touching anything else:

```
@RoAdmin set Gold on key 12345678 in PlayerStats datastore universe 111222333 to 400
@RoAdmin set Gold to 400 then set Money to 100 on key 12345678 in PlayerStats universe 111222333
```

Multiple field changes on the **same entry** are automatically merged into a single API call (one fetch + one write), regardless of how many fields you change. The result embed shows a compact before→after table:

```
Changes
Gold    250 → 400
Money   50  → 100
```

You can also chain `updateData` with other actions in the same request:

```
@RoAdmin set Gold on that entry to 400, then show me the data
```

> Use `updateData` (natural language field changes) when you want to change specific properties. Use `setData` only when you want to replace the entire entry value. `setData` cannot be batched.

#### DataStore - Keys

```
@RoAdmin list all keys in PlayerCoins datastore in universe 111222333
@RoAdmin list keys in PlayerStats in universe 111222333
```

> **Deletion is not available via NLP.** Use the `/deletedata` slash command instead - it requires a confirmation button click and attaches a snapshot of the deleted value. `setData` cannot be batched via NLP - it must be run one at a time. Multiple `updateData` field changes on the same entry are automatically merged into one API call.

#### Leaderboards (Ordered DataStores)

```
@RoAdmin show the top entries on the WinsLeaderboard in universe 111222333
@RoAdmin list global leaderboard KillsBoard in universe 111222333
@RoAdmin remove player 12345678 from WinsLeaderboard in universe 111222333
```

#### Batch Commands

```
@RoAdmin ban players 111, 222, and 333 for hacking in universe 111222333
@RoAdmin unban 444 and 555 from universe 111222333
```

> Batches are capped at **10 commands** per request. Read-only actions (`showData`, `listKeys`, `checkBan`, etc.) and field-level updates (`updateData`) can be batched freely. Full-replacement writes (`setData`) cannot be batched.

---

## Deployment

Production deploys automatically on every push to `master` via `.github/workflows/deploy.yml`:

1. SSH into the GCP VM
2. `git pull origin master`
3. Overwrite `.env` with `DISCORD_TOKEN` from GitHub Secrets
4. `npm install --production`
5. `pm2 restart RoAdmin`

Required GitHub Secrets: `REMOTE_HOST`, `REMOTE_USER`, `SSH_PRIVATE_KEY`, `DISCORD_TOKEN`.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 16+ |
| Discord framework | discord.js v14 |
| Command handler | WOKCommands v1.5 |
| NLP / intent parsing | Anthropic Claude (claude-sonnet) |
| Roblox SDK | rbxcloud v1.2 |
| HTTP client | axios v1.4 |
| Environment | dotenv v16 |
| Deployment | GitHub Actions → PM2 on GCP VM |

Per-universe API keys and the Anthropic key are held **in memory only** and are never written to disk or logs.