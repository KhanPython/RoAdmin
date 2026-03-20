const { ApplicationCommandOptionType } = require("discord.js");
const { handleNlpInteraction } = require("../nlp/nlpHandler");
const log = require("../utils/logger");

module.exports = {
  category: "NLP",
  description: "Issue a command in plain English via AI",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  ephemeral: true,
  guildOnly: true,

  options: [
    {
      name: "prompt",
      description: "What would you like to do? (e.g., ban user 12345 for cheating in MyGame)",
      required: true,
      type: ApplicationCommandOptionType.String,
    },
  ],

  callback: async ({ interaction }) => {
    try {
      await handleNlpInteraction(interaction);
    } catch (err) {
      log.error("ask command error:", err.message);
      const reply = interaction.deferred || interaction.replied
        ? (opts) => interaction.editReply(opts)
        : (opts) => interaction.reply({ ...opts, ephemeral: true });
      await reply({ content: "Something went wrong processing your command. Please try again." }).catch(() => {});
    }
  },
};
