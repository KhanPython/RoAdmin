const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { buildSetDataEmbed, buildErrorEmbed } = require("../utils/formatters");

module.exports = {
  category: "Player Data",
  description: "Set or update a datastore entry by key",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 4,
  expectedArgs: "<key> <universeid> <datastore> <value>",
  guildOnly: true,

  options: [
    {
      name: "key",
      description: "The datastore entry key",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "datastore",
      description: "The datastore name",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "value",
      description: "The value to store (JSON or plain string)",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "scope",
      description: "The datastore scope (default: global)",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const key = interaction?.options?.getString("key") || args[0];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);
    const datastoreName = interaction?.options?.getString("datastore") || args[2];
    const rawValue = interaction?.options?.getString("value") || args[3];
    const scope = interaction?.options?.getString("scope") || args[4] || "global";

    if (!key || key.trim().length === 0) return "Please provide a valid entry key.";
    if (!universeId || isNaN(universeId)) return "Please provide a valid Universe ID.";
    if (!datastoreName || datastoreName.trim().length === 0) return "Please provide a datastore name.";
    if (!rawValue || rawValue.trim().length === 0) return "Please provide a value to store.";

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Attempt to parse value as JSON; fall back to raw string
    let parsedValue = rawValue;
    try {
      parsedValue = JSON.parse(rawValue);
    } catch (_) {
      // keep as string
    }

    try {
      if (!openCloud.hasApiKey(universeId)) {
        await interaction.editReply({ embeds: [apiCache.createMissingApiKeyEmbed(universeId)] });
        return;
      }

      const universeCheck = await universeUtils.verifyUniverseExists(openCloud, universeId);
      if (!universeCheck.success) {
        await interaction.editReply({ content: universeCheck.errorMessage });
        return;
      }
      const universeInfo = universeCheck.universeInfo;

      const result = await openCloud.SetDataStoreEntry(key, parsedValue, universeId, datastoreName, scope);

      if (result.success) {
        pushHistory(interaction.channelId, interaction.user.id, "setData", { key, universeId, datastoreName, value: rawValue, scope });
      }

      await interaction.editReply({ embeds: [buildSetDataEmbed(result, { key, universeId, datastoreName, rawValue, scope }, universeInfo)] });
    } catch (error) {
      console.error("Error in setdata command:", error);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] });
    }
  },
};
