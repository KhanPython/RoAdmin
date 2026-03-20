require('dotenv').config();

// Polyfill for undici compatibility
const { ReadableStream } = require("node:stream/web");
globalThis.ReadableStream = ReadableStream;

const discord = require("discord.js");
const wokcommands = require("wokcommands");
const path = require("path");

const apiCache = require("./utils/apiCache");
const llmCache = require("./utils/llmCache");
const log = require("./utils/logger");

// Load persisted API keys and universe names from encrypted keystore
const { llmKeys } = apiCache.loadFromDisk(() => llmCache.getAllLlmKeys());
for (const [guildId, key] of Object.entries(llmKeys)) {
  llmCache.hydrateLlmKey(guildId, key);
}

const discordToken = process.env.DISCORD_TOKEN;

log.info(`Starting RoAdmin (NODE_ENV=${process.env.NODE_ENV || "development"}) ...`);

if (!discordToken) {
    log.error("Discord Token is undefined! Check your .env file or GitHub Secrets.");
    process.exit(1);
}

const client = new discord.Client({
  intents: [
    discord.IntentsBitField.Flags.Guilds,
    discord.IntentsBitField.Flags.GuildMessages,
  ],
  allowedMentions: { parse: ["users"] },
});

client.once("clientReady", async () => {
  try {
    new wokcommands(client, {
      commandsDir: path.join(__dirname, "commands"),
      // featuresDir: path.join(__dirname, "features"),
      mongoUri: "",
      botOwners: [],
    });

    log.info("Bot is ready to use!");
  } catch (error) {
    log.error("Startup error:", error.message);
  }
});

// Modal submit handlers
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId === "setllmkey_modal") {
    const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
    const Anthropic = require("@anthropic-ai/sdk");
    const keystore = require("./utils/keystore");
    const { buildErrorEmbed, buildStatusEmbed } = require("./utils/formatters");

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "❌ Administrator permission is required.", flags: MessageFlags.Ephemeral });
      return;
    }

    const apiKey = interaction.fields.getTextInputValue("llmkey_input").trim();

    if (!apiKey || apiKey.trim().length === 0) {
      await interaction.reply({
        content: "❌ Please provide a non-empty API key.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const anthropic = new Anthropic.default({ apiKey });
      await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      });
    } catch (err) {
      llmCache.setLlmKey(interaction.guildId, null);
      const safeReason =
        err.status === 401 ? "The API key was rejected by Anthropic (invalid or revoked)." :
        err.status === 429 ? "Anthropic rate limit reached. Please wait a moment and try again." :
        err.status >= 500 ? "Anthropic's servers are temporarily unavailable. Try again later." :
        "The API key could not be validated. Please check the key and try again.";
      await interaction.editReply({
        embeds: [
          buildStatusEmbed("Invalid API Key", safeReason),
        ],
      });
      return;
    }

    const persisted = llmCache.setLlmKey(interaction.guildId, apiKey);
    const diskFailed = keystore.isEnabled() && !persisted;

    await interaction.editReply({
      embeds: [
        buildStatusEmbed(
          diskFailed ? "⚠️ Credential Storage Error" : "✅ LLM API Key Configured",
          (diskFailed
            ? "Anthropic API key is active but could not be written to secure storage. It will not persist across restarts.\n\n"
            : keystore.isEnabled()
              ? "Anthropic API key securely stored.\n\n"
              : "Anthropic API key active for this session.\n\n") +
          "Use `/ask` to issue commands in plain English.\n" +
          "Example: `ban user 12345 for cheating in MyGame`",
          diskFailed ? 0xff9900 : 0x00ff00,
        ).addFields({
          name: "Storage",
          value: diskFailed
            ? "Contact the bot administrator to resolve the storage issue."
            : keystore.isEnabled()
              ? "Encrypted at rest · Persists across restarts"
              : "Session-only · Will not persist across restarts",
        }),
      ],
    });
    return;
  }

  if (!interaction.customId.startsWith("setapikey_modal_")) return;

  const openCloud = require("./openCloudAPI");
  const keystore = require("./utils/keystore");
  const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "❌ Administrator permission is required.", flags: MessageFlags.Ephemeral });
    return;
  }

  const universeId = Number(interaction.customId.replace("setapikey_modal_", ""));

  if (!Number.isFinite(universeId) || universeId <= 0 || !Number.isInteger(universeId)) {
    await interaction.reply({ content: "❌ Invalid universe ID.", flags: MessageFlags.Ephemeral });
    return;
  }

  const apiKey = interaction.fields.getTextInputValue("apikey_input").trim();

  if (!apiKey || apiKey.trim().length === 0) {
    await interaction.reply({
      content: "❌ Invalid API key. Please provide a non-empty key.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Validate the API key against Roblox API before storing
    try {
      const axios = require("axios");
      const testUrl = `https://apis.roblox.com/cloud/v2/universes/${universeId}/data-stores/dummy/scopes/global/entries/test`;
      await axios.get(testUrl, {
        headers: { "x-api-key": apiKey },
        validateStatus: (status) => status === 200 || status === 404,
      });
    } catch (apiKeyError) {
      const status = apiKeyError.response?.status;
      if (status === 401) throw new Error("API key is invalid or revoked. Check the key and try again.");
      if (status === 403) throw new Error("API key is valid but lacks the required permissions for this universe. Enable DataStore read access in the Open Cloud settings.");
      throw new Error("Could not validate the API key. Check the universe ID and try again.");
    }

    // Key validated - now persist it
    const persisted = openCloud.setApiKey(interaction.guildId, universeId, apiKey);

    let universeInfo;
    try {
      universeInfo = await openCloud.GetUniverseName(universeId);
      openCloud.setUniverseName(universeId, universeInfo.name);
    } catch (verifyError) {
      log.warn("Universe verification failed:", verifyError.message);
      universeInfo = { name: `Universe ${universeId}`, icon: null };
    }

    const diskFailed = keystore.isEnabled() && !persisted;

    const embed = new EmbedBuilder()
      .setTitle(diskFailed ? "⚠️ Credential Storage Error" : "API Key Configured")
      .setColor(diskFailed ? 0xFF9900 : 0x00FF00)
      .setDescription(
        diskFailed
          ? `Credential for universe \`${universeId}\` is active but could not be written to secure storage. It will not persist across restarts.`
          : keystore.isEnabled()
            ? `Credential for universe \`${universeId}\` has been securely stored.`
            : `Credential for universe \`${universeId}\` is active for this session only.`
      )
      .addFields(
        { name: "Universe ID:", value: `\`${universeId.toString()}\`` },
        { name: "Experience:", value: universeInfo.name || "Unknown" }
      )
      .setFooter({
        text: diskFailed
          ? "Contact the bot administrator to resolve the storage issue."
          : keystore.isEnabled()
            ? "Encrypted at rest · Persists across restarts"
            : "Session-only · Will not persist across restarts",
      })
      .setTimestamp();

    if (universeInfo.icon) {
      embed.setThumbnail(universeInfo.icon);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    log.error("setapikey modal error:", error.message);
    await interaction.editReply({ content: "❌ Something went wrong while configuring the API key. Please try again." });
  }
});

client.login(discordToken).catch((err) => {
  log.error("Failed to login to Discord:", err.message);
  process.exit(1);
});
