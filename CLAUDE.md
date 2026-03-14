# CLAUDE.md — RoAdmin Developer Guide

This file provides context for AI assistants working on the RoAdmin codebase.

---

# Agent Instructions

You're working inside the **WAT framework** (Workflows, Agents, Tools). This architecture separates concerns so that probabilistic AI handles reasoning while deterministic code handles execution. That separation is what makes this system reliable.

## The WAT Architecture

**Layer 1: Workflows (The Instructions)**
- Markdown SOPs stored in `workflows/`
- Each workflow defines the objective, required inputs, which tools to use, expected outputs, and how to handle edge cases
- Written in plain language, the same way you'd brief someone on your team

**Layer 2: Agents (The Decision-Maker)**
- This is your role. You're responsible for intelligent coordination.
- Read the relevant workflow, run tools in the correct sequence, handle failures gracefully, and ask clarifying questions when needed
- You connect intent to execution without trying to do everything yourself
- Example: If you need to pull data from a website, don't attempt it directly. Read `workflows/scrape_website.md`, figure out the required inputs, then execute `tools/scrape_single_site.py`

**Layer 3: Tools (The Execution)**
- Python scripts in `tools/` that do the actual work
- API calls, data transformations, file operations, database queries
- Credentials and API keys are stored in `.env`
- These scripts are consistent, testable, and fast

**Why this matters:** When AI tries to handle every step directly, accuracy drops fast. If each step is 90% accurate, you're down to 59% success after just five steps. By offloading execution to deterministic scripts, you stay focused on orchestration and decision-making where you excel.

## How to Operate

**1. Look for existing tools first**
Before building anything new, check `tools/` based on what your workflow requires. Only create new scripts when nothing exists for that task.

**2. Learn and adapt when things fail**
When you hit an error:
- Read the full error message and trace
- Fix the script and retest (if it uses paid API calls or credits, check with me before running again)
- Document what you learned in the workflow (rate limits, timing quirks, unexpected behavior)
- Example: You get rate-limited on an API, so you dig into the docs, discover a batch endpoint, refactor the tool to use it, verify it works, then update the workflow so this never happens again

**3. Keep workflows current**
Workflows should evolve as you learn. When you find better methods, discover constraints, or encounter recurring issues, update the workflow. That said, don't create or overwrite workflows without asking unless I explicitly tell you to. These are your instructions and need to be preserved and refined, not tossed after one use.

## The Self-Improvement Loop

Every failure is a chance to make the system stronger:
1. Identify what broke
2. Fix the tool
3. Verify the fix works
4. Update the workflow with the new approach
5. Move on with a more robust system

This loop is how the framework improves over time.

## File Structure

**What goes where:**
- **Deliverables**: Final outputs go to cloud services (Google Sheets, Slides, etc.) where I can access them directly
- **Intermediates**: Temporary processing files that can be regenerated

**Directory layout:**
```
.tmp/           # Temporary files (scraped data, intermediate exports). Regenerated as needed.
tools/          # Python scripts for deterministic execution
workflows/      # Markdown SOPs defining what to do and how
.env            # API keys and environment variables (NEVER store secrets anywhere else)
credentials.json, token.json  # Google OAuth (gitignored)
```

**Core principle:** Local files are just for processing. Anything I need to see or use lives in cloud services. Everything in `.tmp/` is disposable.

## Bottom Line

You sit between what I want (workflows) and what actually gets done (tools). Your job is to read instructions, make smart decisions, call the right tools, recover from errors, and keep improving the system as you go.

Stay pragmatic. Stay reliable. Keep learning.

---

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
