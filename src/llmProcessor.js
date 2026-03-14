/**
 * LLM Command Processor
 * Uses the Anthropic API (claude-haiku) to parse natural language into
 * structured Roblox admin commands.
 */

const Anthropic = require("@anthropic-ai/sdk");
const llmCache = require("./utils/llmCache");

const FALLBACK = [{
  action: null,
  parameters: {},
  missing: [],
  confirmation_summary: "Failed to parse command. Please try again.",
}];

/**
 * Parse a natural language message into one or more structured commands.
 *
 * @param {string} text - The user's message (mention already stripped)
 * @param {{ id: number, name: string }[]} knownUniverses - Cached universe name→ID mappings
 * @param {{ action: string, parameters: object, timestamp: string }[]} history - Recent commands in this channel
 * @returns {Promise<{ action: string|null, parameters: object, missing: string[], confirmation_summary: string }[]>}
 */
async function processCommand(text, knownUniverses = [], history = []) {
  const universeContext =
    knownUniverses.length > 0
      ? `Known universes (resolve game names to IDs using this list):\n` +
        knownUniverses.map(u => `- "${u.name}" → ${u.id}`).join("\n")
      : "";

  const historyContext =
    history.length > 0
      ? `\nRecent commands executed in this channel (most recent last):\n` +
        history.map((h, i) => `${i + 1}. ${h.action} — ${JSON.stringify(h.parameters)}`).join("\n") +
        `\n\nUse this history to resolve references like "the previous user", "same universe", "undo that", "ban them again", etc. Carry forward parameters from recent commands when the user references them implicitly.`
      : "";

  const systemPrompt = `You are a command parser for a Roblox admin Discord bot. Parse the user's intent and return ONLY valid JSON — no prose, no markdown code fences, no explanation.

Available actions and their parameters:
- ban            → required: userId(number), reason(string), universeId(number)  |  optional: duration(string e.g. "7d","2m","1y"), excludeAlts(boolean, default false)
- unban          → required: userId(number), universeId(number)
- checkBan       → required: userId(number), universeId(number)
- listBans       → required: universeId(number)
- showData       → required: key(string), universeId(number), datastoreName(string)
- setData        → required: key(string), value(string), universeId(number), datastoreName(string)  |  optional: scope(string, default "global")
- deleteData     → required: key(string), universeId(number), datastoreName(string)  |  optional: scope(string, default "global")  |  NOTE: key is the specific entry key (e.g. a player's userId as string like "12345"), NOT the datastore name itself. Warn the user in confirmation_summary if the key looks like a generic name rather than a player ID.
- listKeys       → required: universeId(number), datastoreName(string)  |  optional: scope(string, default "global")
- listLeaderboard → required: leaderboardName(string), universeId(number)  |  optional: scope(string, default "global")
- removeFromBoard → required: userId(number), leaderboardName(string), universeId(number)  |  optional: key(string, defaults to userId as string)

${universeContext}
${historyContext}

BATCH COMMANDS: When the user wants to perform the same action on multiple targets (e.g. "ban 123 and 456", "ban users from this table: {123, 456, 789}", "unban all of these: 1, 2, 3"), return a JSON ARRAY of command objects — one per target. Each object must be fully self-contained with all parameters. Shared parameters (universeId, reason, etc.) should be copied into every object.

Output schema — return ONLY this JSON, nothing else:

For a SINGLE command:
[{
  "action": "<one of the action names above, or null if the message is not a recognizable admin command>",
  "parameters": { "<only parameters explicitly found or resolvable from the message>" },
  "missing": ["<names of required parameters absent from the message>"],
  "confirmation_summary": "<one concise sentence describing what will happen, or a brief reason if action is null>"
}]

For MULTIPLE commands (batch):
[
  { "action": "...", "parameters": { ... }, "missing": [...], "confirmation_summary": "..." },
  { "action": "...", "parameters": { ... }, "missing": [...], "confirmation_summary": "..." }
]

ALWAYS return an array, even for a single command.`;

  try {
    const client = new Anthropic.default({ apiKey: llmCache.getLlmKey() });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    });

    const raw = response.content[0]?.text?.trim() ?? "";

    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    const parsed = JSON.parse(cleaned);

    // Normalise: always return an array of command objects
    const commands = Array.isArray(parsed) ? parsed : [parsed];

    return commands.map(cmd => ({
      action: cmd.action ?? null,
      parameters: cmd.parameters ?? {},
      missing: Array.isArray(cmd.missing) ? cmd.missing : [],
      confirmation_summary: cmd.confirmation_summary ?? "",
    }));
  } catch (err) {
    console.error("[NLP] processCommand error:", err.message);
    return FALLBACK;
  }
}

module.exports = { processCommand };
