require("dotenv/config");
const { Client, IntentsBitField } = require("discord.js");
const parseAndReply = require("./parse-and-reply.js");
const chatWithGpt = require("./chat-with-gpt.js");

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

// 🔒 prevents multiple simultaneous OpenAI calls (VERY important for free tier)
let busy = false;

// 🧠 safe wrapper (prevents 429 spikes)
async function safeChat(fn) {
  while (busy) {
    await new Promise((r) => setTimeout(r, 300));
  }

  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

client.on("ready", () => {
  console.log("The bot is online!");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content.toLowerCase().startsWith("quiet")) return;

  const wasMentioned = message.mentions.has(client.user);

  const isReplyToBot = message.reference?.messageId
    ? await message.channel.messages
        .fetch(message.reference.messageId)
        .then((ref) => ref.author.id === client.user.id)
        .catch(() => false)
    : false;

  if (!wasMentioned && !isReplyToBot) return;

  // 🧹 clean input (remove mentions)
  const userInput = message.content
    .replace(/<@!?\\d+>/g, "")
    .replace(/<@&\\d+>/g, "")
    .trim();

  await message.channel.sendTyping();

  const sendTypingInterval = setInterval(() => {
    message.channel.sendTyping();
  }, 8000);

  try {
    // 🧠 MINIMAL CONTEXT (IMPORTANT FIX)
    let conversationLog = [
      {
        role: "system",
        content:
          "You are a helpful Ruby on Rails tutor. Be concise. Use Ruby examples when helpful.",
      },
    ];

    // 🪶 only last 6 messages (NOT 15 — reduces token usage massively)
    let prevMessages = await message.channel.messages.fetch({ limit: 6 });
    prevMessages = prevMessages.reverse();

    for (const msg of prevMessages) {
      // ignore unrelated bot messages
      if (msg.author.bot && msg.author.id !== client.user.id) continue;

      const cleaned = msg.content
        .replace(/<@!?\\d+>/g, "")
        .replace(/<@&\\d+>/g, "")
        .trim();

      if (!cleaned) continue;

      conversationLog.push({
        role: msg.author.id === client.user.id ? "assistant" : "user",
        content: cleaned,
      });
    }

    // add latest user message LAST
    conversationLog.push({
      role: "user",
      content: userInput,
    });

    // 🧯 rate-limit safe call
    const gptResponse = await safeChat(() =>
      chatWithGpt(conversationLog)
    );

    clearInterval(sendTypingInterval);

    if (!gptResponse) {
      await message.reply(
        "I'm having trouble reaching OpenAI. Try again in a moment."
      );
      return;
    }

    await parseAndReply(gptResponse, message);
  } catch (error) {
    clearInterval(sendTypingInterval);
    console.error("Bot error:", error);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);