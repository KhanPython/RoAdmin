/**
 * LLM Command Processor
 * Uses the Anthropic API (claude-haiku) to parse natural language into
 * structured Roblox admin commands.
 */

const Anthropic = require("@anthropic-ai/sdk");
const llmCache = require("./utils/llmCache");

const FALLBACK = {
  action: null,
  parameters: {},
  missing: [],
  confirmation_summary: "Failed to parse command. Please try again.",
};

/**
 * Parse a natural language message into a structured command.
 *
 * @param {string} text - The user's message (mention already stripped)
 * @param {{ id: number, name: string }[]} knownUniverses - Cached universe name→ID mappings
 * @returns {Promise<{ action: string|null, parameters: object, missing: string[], confirmation_summary: string }>}
 */
async function processCommand(text, knownUniverses = []) {
  const universeContext =
    knownUniverses.length > 0
      ? `Known universes (resolve game names to IDs using this list):\n` +
        knownUniverses.map(u => `- "${u.name}" → ${u.id}`).join("\n")
      : "";

  const systemPrompt = `You are a command parser for a Roblox admin Discord bot. Parse the user's intent and return ONLY valid JSON — no prose, no markdown code fences, no explanation.

Available actions and their parameters:
- ban            → required: userId(number), reason(string), universeId(number)  |  optional: duration(string e.g. "7d","2m","1y"), excludeAlts(boolean, default false)
- unban          → required: userId(number), universeId(number)
- showData       → required: key(string), universeId(number), datastoreName(string)
- listLeaderboard → required: leaderboardName(string), universeId(number)  |  optional: scope(string, default "global")
- removeFromBoard → required: userId(number), leaderboardName(string), universeId(number)  |  optional: key(string, defaults to userId as string)

${universeContext}

Output schema — return ONLY this JSON object, nothing else:
{
  "action": "<one of the action names above, or null if the message is not a recognizable admin command>",
  "parameters": { "<only parameters explicitly found or resolvable from the message>" },
  "missing": ["<names of required parameters absent from the message>"],
  "confirmation_summary": "<one concise sentence describing what will happen, or a brief reason if action is null>"
}`;

  try {
    const client = new Anthropic.default({ apiKey: llmCache.getLlmKey() });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    });

    const raw = response.content[0]?.text?.trim() ?? "";

    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    const parsed = JSON.parse(cleaned);

    // Normalise to expected shape
    return {
      action: parsed.action ?? null,
      parameters: parsed.parameters ?? {},
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
      confirmation_summary: parsed.confirmation_summary ?? "",
    };
  } catch (err) {
    console.error("[NLP] processCommand error:", err.message);
    return FALLBACK;
  }
}

module.exports = { processCommand };
