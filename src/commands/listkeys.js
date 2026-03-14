const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { sendPaginatedList } = require("../utils/pagination");
const { formatKeyEntries, buildErrorEmbed } = require("../utils/formatters");

module.exports = {
  category: "Player Data",
  description: "List all entry keys in a datastore with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 2,
  expectedArgs: "<universeid> <datastore> [scope]",
  guildOnly: true,

  options: [
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
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[0]);
    const datastoreName = interaction?.options?.getString("datastore") || args[1];
    const scope = interaction?.options?.getString("scope") || args[2] || "global";

    if (!universeId || isNaN(universeId)) {
      await interaction.reply({ content: "Please provide a valid Universe ID.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!datastoreName || datastoreName.trim().length === 0) {
      await interaction.reply({ content: "Please provide a datastore name.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

      pushHistory(interaction.channelId, interaction.user.id, "listKeys", { universeId, datastoreName, scope });

      await sendPaginatedList({
        authorId: user.id,
        title: `Keys - ${datastoreName}`,
        iconUrl: universeInfo.icon ?? null,
        fetchPage: (pt) => openCloud.ListDataStoreKeys(universeId, datastoreName, scope, pt),
        formatEntries: (data, pageNum) => formatKeyEntries(data, pageNum, { universeId, scope }),
        sendInitial: (opts) => interaction.editReply(opts),
        editFn: (opts) => interaction.editReply(opts),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (error) {
      console.error("Error in listkeys command:", error);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] }).catch(() => {});
    }
  },
};
