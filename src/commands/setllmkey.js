const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
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

    const apiKeyInput = new LabelBuilder()
      .setLabel("Anthropic API Key")
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("llmkey_input")
          .setPlaceholder("sk-ant-...")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(256),
      );

    modal.addLabelComponents(apiKeyInput);

    await interaction.showModal(modal);
  },
};
