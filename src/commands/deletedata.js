const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { buildDeleteDataEmbed, buildErrorEmbed } = require("../utils/formatters");

module.exports = {
  category: "Player Data",
  description: "Delete a datastore entry by key (irreversible)",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 3,
  expectedArgs: "<key> <universeid> <datastore> [scope]",
  guildOnly: true,

  options: [
    {
      name: "key",
      description: "The datastore entry key to delete",
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
    const scope = interaction?.options?.getString("scope") || args[3] || "global";

    if (!key || key.trim().length === 0) return "Please provide a valid entry key.";
    if (!universeId || isNaN(universeId)) return "Please provide a valid Universe ID.";
    if (!datastoreName || datastoreName.trim().length === 0) return "Please provide a datastore name.";

    await interaction.deferReply();

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

      // Snapshot current value before deleting so it can be shown in the result
      const snapshot = await openCloud.GetDataStoreEntry(key, universeId, datastoreName);
      const snapshotText = snapshot.success && snapshot.data !== null
        ? JSON.stringify(snapshot.data, null, 2).slice(0, 900)
        : "Could not retrieve value before deletion.";

      const result = await openCloud.DeleteDataStoreEntry(key, universeId, datastoreName, scope);

      if (result.success) {
        pushHistory(interaction.channelId, interaction.user.id, "deleteData", { key, universeId, datastoreName, scope });
      }

      await interaction.editReply({ embeds: [buildDeleteDataEmbed(result, { key, universeId, datastoreName, scope, snapshotText }, universeInfo)] });
    } catch (error) {
      console.error("Error in deletedata command:", error);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] });
    }
  },
};
