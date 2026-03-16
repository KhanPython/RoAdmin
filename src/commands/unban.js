const { ApplicationCommandOptionType } = require("discord.js");
const openCloud = require("./../openCloudAPI");
const { pushHistory } = require("../nlpHandler");
const { buildUnbanEmbed, buildErrorEmbed } = require("../utils/formatters");
const { validateCommand } = require("../utils/commandValidator");
const log = require("../utils/logger");

module.exports = {
  category: "Moderation",
  description: "Unbans a player from the experience by UserId",

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
      description: "The user identification",
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

      const response = await openCloud.UnbanUser(userId, universeId);

      if (response.success) {
        pushHistory(interaction.channelId, interaction.user.id, "unban", { userId, universeId });
      }

      await interaction.editReply({ embeds: [buildUnbanEmbed(response, { userId, universeId }, universeInfo)] });
    } catch (error) {
      log.error("Error in unban command:", error.message);
      await interaction.editReply({ embeds: [buildErrorEmbed(error.message)] });
    }
  },
};
