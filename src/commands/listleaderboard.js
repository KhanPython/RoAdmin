const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const openCloud = require("../openCloudAPI");
const apiCache = require("../utils/apiCache");
const universeUtils = require("../utils/universeUtils");
const { pushHistory } = require("../nlpHandler");
const { sendPaginatedList } = require("../utils/pagination");
const { formatLeaderboardEntries, buildErrorEmbed } = require("../utils/formatters");

const ENTRIES_PER_PAGE = 10;

module.exports = {
  category: "Debugging",
  description: "List all entries in an ordered datastore with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 2,
  expectedArgs: "<leaderboardName> <universeId> [scope]",
  guildOnly: true,

  options: [
    {
      name: "leaderboard",
      description: "The leaderboard/ordered datastore name",
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
      name: "scope",
      description: "The datastore scope (default: global)",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const leaderboardName = interaction?.options?.getString("leaderboard") || args[0];
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);
    const scopeId = interaction?.options?.getString("scope") || args[2] || "global";

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (!universeId || isNaN(universeId)) {
        await interaction.editReply({ content: "Please provide a valid Universe ID." });
        return;
      }

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

      pushHistory(interaction.channelId, interaction.user.id, "listLeaderboard", { leaderboardName, scopeId, universeId });

      await sendPaginatedList({
        authorId: user.id,
        title: `Leaderboard - ${leaderboardName}`,
        iconUrl: universeInfo.icon ?? null,
        fetchPage: (pt) => openCloud.ListOrderedDataStoreEntries(leaderboardName, scopeId, pt, universeId),
        formatEntries: (data, pageNum) => formatLeaderboardEntries(data, pageNum, { universeId, scope: scopeId, universeName: universeInfo.name, entriesPerPage: ENTRIES_PER_PAGE }),
        sendInitial: (opts) => interaction.editReply(opts),
        editFn: (opts) => interaction.editReply(opts),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (error) {
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] }).catch(() => {});
    }
  },
};
