const { ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("../openCloudAPI");
const { pushHistory } = require("../nlpHandler");
const { sendPaginatedList } = require("../utils/pagination");
const { formatBanEntries, buildInternalErrorEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Moderation",
  description: "List all active bans in a universe with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
  minArgs: 1,
  expectedArgs: "<universeId>",
  guildOnly: true,

  options: [
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[0]);

    const check = await validateCommand(interaction, {
      universeId, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    try {

      pushHistory(interaction.channelId, interaction.user.id, "listBans", { universeId });

      await sendPaginatedList({
        authorId: user.id,
        title: `Active Bans - ${universeInfo.name}`,
        iconUrl: universeInfo.icon ?? null,
        fetchPage: (pt) => openCloud.ListBans(interaction.guildId, universeId, pt),
        formatEntries: (data, pageNum) => formatBanEntries(data, pageNum, { universeName: universeInfo.name }),
        sendInitial: (opts) => interaction.editReply(opts),
        editFn: (opts) => interaction.editReply(opts),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (error) {
      log.error("Error in listbans command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] }).catch(() => {});
    }
  },
};
