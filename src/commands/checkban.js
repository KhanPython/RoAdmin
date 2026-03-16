const { ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("./../openCloudAPI");
const { pushHistory } = require("../nlpHandler");
const { buildCheckBanEmbed, buildInternalErrorEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Moderation",
  description: "Check the ban status of a player by UserId",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: false,
  minArgs: 2,
  expectedArgs: "<userId> <universeId>",
  guildOnly: true,

  options: [
    {
      name: "userid",
      description: "The user ID to check",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
    {
      name: "universeid",
      description: "Universe ID (required)",
      required: true,
      type: ApplicationCommandOptionType.Number,
    },
  ],

  callback: async ({ user, args, interaction }) => {
    const userId = interaction?.options?.getNumber("userid") || parseInt(args[0]);
    const universeId = interaction?.options?.getNumber("universeid") || parseInt(args[1]);

    const check = await validateCommand(interaction, {
      userId, universeId, requireApiKey: true, requireUniverse: true,
    });
    if (!check.valid) return check.errorString;

    const universeInfo = check.universeInfo;

    try {

      const result = await openCloud.CheckBanStatus(interaction.guildId, userId, universeId);

      pushHistory(interaction.channelId, interaction.user.id, "checkBan", { userId, universeId });

      await interaction.editReply({ embeds: [buildCheckBanEmbed(result, { userId, universeId }, universeInfo)] });
    } catch (error) {
      log.error("Error in checkban command:", error.message);
      await interaction.editReply({ embeds: [buildInternalErrorEmbed()] });
    }
  },
};
