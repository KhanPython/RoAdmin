const { ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("../openCloudAPI");
const { pushHistory } = require("../nlp/nlpHandler");
const { sendPaginatedList } = require("../utils/pagination");
const { formatKeyEntries, buildInternalErrorEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Player Data",
  description: "List all entry keys in a datastore with pagination",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
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

    const check = await validateCommand(interaction, {
      universeId, datastoreName, scope, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    try {

      pushHistory(interaction.channelId, interaction.user.id, "listKeys", { universeId, datastoreName, scope });

      await sendPaginatedList({
        authorId: user.id,
        title: `Keys - ${datastoreName}`,
        iconUrl: universeInfo.icon ?? null,
        fetchPage: (pt) => openCloud.ListDataStoreKeys(interaction.guildId, universeId, datastoreName, scope, pt),
        formatEntries: (data, pageNum) => formatKeyEntries(data, pageNum, { universeId, scope, universeName: universeInfo.name }),
        sendInitial: (opts) => interaction.editReply(opts),
        editFn: (opts) => interaction.editReply(opts),
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (error) {
      log.error("Error in listkeys command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] }).catch(() => {});
    }
  },
};
