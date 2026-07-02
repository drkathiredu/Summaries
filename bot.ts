import { Telegraf } from 'telegraf';
import { GoogleGenAI } from '@google/genai';
import fsPromises from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

async function getTemplates() {
  try {
    const data = await fsPromises.readFile(TEMPLATES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    return [];
  }
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN is not set, telegram bot will not start.');
    return;
  }

  const bot = new Telegraf(token);

  const userStates: Record<number, { patientName?: string, files: any[] }> = {};

  bot.start((ctx) => {
    ctx.reply('Welcome to Clinical Scribe Bot!\n\nPlease set the patient name using:\n/patient <Name>\n\nThen upload images or PDFs of case sheets and lab reports. Once done, type /generate to receive the summary.');
  });

  bot.command('patient', (ctx) => {
    const name = ctx.message.text.replace('/patient', '').trim();
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) {
      userStates[chatId] = { files: [] };
    }
    
    if (!name) {
      return ctx.reply('Please provide a name. Usage: /patient John Doe');
    }
    
    userStates[chatId].patientName = name;
    ctx.reply(`Patient name set to: ${name}. Now send me case sheets or lab reports (images/PDFs), and type /generate when done.`);
  });

  const processFile = async (ctx: any, fileId: string, mimeType: string) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) {
      userStates[chatId] = { files: [] };
    }

    try {
      ctx.reply('Downloading file...');
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await fetch(fileLink.href);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');

      userStates[chatId].files.push({
        data: base64,
        mimeType,
      });

      ctx.reply(`File received. Total files: ${userStates[chatId].files.length}. Type /generate when ready.`);
    } catch (e: any) {
      console.error(e);
      ctx.reply('Failed to download file.');
    }
  };

  bot.on('photo', async (ctx) => {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await processFile(ctx, photo.file_id, 'image/jpeg');
  });

  bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    await processFile(ctx, doc.file_id, doc.mime_type || 'application/octet-stream');
  });

  bot.command('generate', async (ctx) => {
    const chatId = ctx.chat.id;
    const state = userStates[chatId];

    if (!state || state.files.length === 0) {
      return ctx.reply('Please upload at least one image or document first.');
    }

    ctx.reply('Generating pediatric discharge summary... This may take a minute.');

    try {
      const pastSummaries = await getTemplates();
      const parts: any[] = [];

      parts.push({
        text: `You are an expert medical AI assistant specialized in writing professional, medically accurate discharge summaries for pediatric patients.

Your task is to review the provided patient case sheets and lab reports, and generate a concise, professional discharge summary.
${state.patientName ? `\nThe patient's name is: ${state.patientName}\n` : ''}

If any "Past Discharge Summaries" are provided, you MUST adopt their exact style, tone, section headers, and formatting conventions so the new summary matches the hospital's existing clinical documentation standards.
If NO templates are provided, use the standard international pediatric discharge summary format. Ensure the tone is appropriate for pediatric cases (including age, weight, and developmental context when relevant).
`,
      });

      if (pastSummaries.length > 0) {
        parts.push({ text: '\n--- EXAMPLES: PAST DISCHARGE SUMMARIES (FOR STYLE/TONE) ---\n' });
        for (const file of pastSummaries) {
          parts.push({
            inlineData: {
              data: file.data,
              mimeType: file.mimeType,
            },
          });
        }
      }

      parts.push({ text: '\n--- INPUT DATA ---\n' });

      for (const file of state.files) {
        parts.push({
          inlineData: {
            data: file.data,
            mimeType: file.mimeType,
          },
        });
      }

      parts.push({ text: '\nNow, based on the input data, please generate the final discharge summary. Format it nicely using Markdown.\n' });

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: { parts },
        config: {
          systemInstruction: "You are a professional medical scribe writing discharge summaries.",
          temperature: 0.2,
        },
      });

      const summary = response.text || 'Failed to generate summary.';
      
      // Clear files after generation to save memory
      userStates[chatId].files = [];
      
      // Telegram message length limit is 4096 characters, chunk if necessary
      const maxLen = 4000;
      for (let i = 0; i < summary.length; i += maxLen) {
        await ctx.reply(summary.substring(i, i + maxLen));
      }

    } catch (error: any) {
      console.error(error);
      ctx.reply(`Error generating summary: ${error.message}`);
    }
  });

  bot.launch().catch(err => {
    console.error('Failed to launch telegram bot', err);
  });
  
  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
