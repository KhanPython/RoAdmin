const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

module.exports = {
  category: "NLP",
  description: "Issue a command in plain English via AI",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  guildOnly: true,

  callback: async ({ interaction }) => {
    const modal = new ModalBuilder()
      .setCustomId("ask_modal")
      .setTitle("Natural Language Command");

    const commandInput = new TextInputBuilder()
      .setCustomId("ask_input")
      .setLabel("What would you like to do?")
      .setPlaceholder("e.g., ban user 12345 for cheating in MyGame")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(commandInput));
    await interaction.showModal(modal);
  },
};
