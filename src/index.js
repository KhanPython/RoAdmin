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
    const axios = require("axios");

    // Probe each scope independently. We expect either 200/404 (== authorized,
    // resource may not exist) or 401/403. Any 401 means the key itself is bad.
    // 403 on a specific endpoint just means that scope is missing.
    const probe = async (url) => {
      try {
        const r = await axios.get(url, {
          headers: { "x-api-key": apiKey },
          validateStatus: () => true,
          timeout: 8000,
        });
        return r.status;
      } catch (err) {
        return err.response?.status ?? 0; // 0 = network error
      }
    };

    const [datastoreStatus, banStatus] = await Promise.all([
      probe(`https://apis.roblox.com/cloud/v2/universes/${universeId}/data-stores/dummy/scopes/global/entries/test`),
      probe(`https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/1`),
    ]);

    // Any 401 anywhere = the key itself is invalid/revoked.
    if (datastoreStatus === 401 || banStatus === 401) {
      throw new Error("API key is invalid or revoked. Check the key and try again.");
    }
    if (datastoreStatus === 0 && banStatus === 0) {
      throw new Error("Could not reach Roblox to validate the API key. Try again.");
    }

    // 200/404 = authorized (resource may not exist). 403 = scope missing.
    const isAuthorized = (s) => s === 200 || s === 404;
    const scopes = {
      datastore: isAuthorized(datastoreStatus),
      banManagement: isAuthorized(banStatus),
    };

    if (!scopes.datastore && !scopes.banManagement) {
      throw new Error(
        "API key is valid but has no Roblox Open Cloud scopes for this universe. " +
        "Enable DataStore and/or User Restrictions permissions and bind the key to this universe."
      );
    }

    // Key validated - persist
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

    // Render scope summary (✅ available · ❌ missing).
    const scopeLines = [
      `${scopes.datastore ? "✅" : "❌"} **DataStore** (read/write) — \`/showData\`, \`/setdata\`, \`/listkeys\`, \`/listleaderboard\``,
      `${scopes.banManagement ? "✅" : "❌"} **User Restrictions** — \`/ban\`, \`/unban\`, \`/checkban\`, \`/listbans\``,
    ];
    const missingScopes = !scopes.datastore || !scopes.banManagement;

    const embed = new EmbedBuilder()
      .setTitle(diskFailed ? "⚠️ Credential Storage Error" : "API Key Configured")
      .setColor(diskFailed ? 0xFF9900 : missingScopes ? 0xFFC107 : 0x00FF00)
      .setDescription(
        diskFailed
          ? `Credential for universe \`${universeId}\` is active but could not be written to secure storage. It will not persist across restarts.`
          : keystore.isEnabled()
            ? `Credential for universe \`${universeId}\` has been securely stored.`
            : `Credential for universe \`${universeId}\` is active for this session only.`
      )
      .addFields(
        { name: "Universe ID", value: `\`${universeId.toString()}\``, inline: true },
        { name: "Experience", value: universeInfo.name || "Unknown", inline: true },
        { name: "Detected Scopes", value: scopeLines.join("\n"), inline: false },
      );

    if (missingScopes) {
      embed.addFields({
        name: "Missing scopes",
        value:
          "Some commands won't work until you re-issue this key with the missing scopes enabled and bound to this universe at " +
          "<https://create.roblox.com/dashboard/credentials>.",
        inline: false,
      });
    }

    embed.setFooter({
      text: diskFailed
        ? "Contact the bot administrator to resolve the storage issue."
        : keystore.isEnabled()
          ? "Encrypted at rest · Persists across restarts"
          : "Session-only · Will not persist across restarts",
    }).setTimestamp();

    if (universeInfo.icon) {
      embed.setThumbnail(universeInfo.icon);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    log.error("setapikey modal error:", error.message);
    await interaction.editReply({
      content: `❌ ${error.message || "Something went wrong while configuring the API key. Please try again."}`,
    });
  }
});

client.login(discordToken).catch((err) => {
  log.error("Failed to login to Discord:", err.message);
  process.exit(1);
});
