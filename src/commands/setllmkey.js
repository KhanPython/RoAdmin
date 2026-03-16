const {
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

module.exports = {
  category: "Config",
  description: "Set the Anthropic API key used for natural language command processing",

  slash: "both",
  testOnly: false,

  permissions: ["ADMINISTRATOR"],
  guildOnly: true,

  options: [],

  callback: async ({ interaction }) => {
    const modal = new ModalBuilder()
      .setCustomId("setllmkey_modal")
      .setTitle("Enter LLM API Key");

    const apiKeyInput = new TextInputBuilder()
      .setCustomId("llmkey_input")
      .setLabel("Anthropic API Key")
      .setPlaceholder("sk-ant-...")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(256);

    modal.addComponents(new ActionRowBuilder().addComponents(apiKeyInput));

    await interaction.showModal(modal);
  },
};
