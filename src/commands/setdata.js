const { ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("../openCloudAPI");
const { pushHistory } = require("../nlp/nlpHandler");
const { buildSetDataEmbed, buildInternalErrorEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Player Data",
  description: "Set or update a datastore entry by key",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
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

    const check = await validateCommand(interaction, {
      key, universeId, datastoreName, rawValue, scope, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    // Attempt to parse value as JSON; fall back to raw string
    let parsedValue = rawValue;
    try {
      parsedValue = JSON.parse(rawValue);
    } catch (_) {
      // keep as string
    }

    try {

      const result = await openCloud.SetDataStoreEntry(interaction.guildId, key, parsedValue, universeId, datastoreName, scope);

      if (result.success) {
        pushHistory(interaction.channelId, interaction.user.id, "setData", { key, universeId, datastoreName, value: rawValue, scope });
      }

      await interaction.editReply({ embeds: [buildSetDataEmbed(result, { key, universeId, datastoreName, rawValue, scope }, universeInfo)] });
    } catch (error) {
      log.error("Error in setdata command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] });
    }
  },
};
