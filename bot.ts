import { Telegraf, Markup } from 'telegraf';
import { GoogleGenAI } from '@google/genai';
import fsPromises from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { saveGeneratedSummary } from './server';

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

  const userStates: Record<number, { patientName?: string, files: any[], model: string }> = {};

  bot.start((ctx) => {
    ctx.reply('Welcome to Clinical Scribe Bot!\n\nYou can upload images or PDFs of case sheets and lab reports.\nThe AI will automatically detect the patient name and age if you don\'t provide them.\n\nOptionally, you can set a name with: /patient <Name>\n\nOnce you have uploaded the documents, type /generate to receive the summary.\nYou can choose your AI model with /model.');
  });

  bot.command('patient', (ctx) => {
    const name = ctx.message.text.replace('/patient', '').trim();
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) {
      userStates[chatId] = { files: [], model: 'gemini-3.5-flash' };
    }
    
    if (!name) {
      return ctx.reply('Please provide a name. Usage: /patient John Doe');
    }
    
    userStates[chatId].patientName = name;
    ctx.reply(`Patient name set to: ${name}. Now send me case sheets or lab reports (images/PDFs), and type /generate when done.`);
  });

  bot.command('model', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) {
      userStates[chatId] = { files: [], model: 'gemini-3.5-flash' };
    }

    try {
      const apiKey = process.env.NVIDIA_NIM_API_KEY;
      let nimModels: string[] = [];
      if (apiKey) {
        const openai = new OpenAI({
          apiKey,
          baseURL: 'https://integrate.api.nvidia.com/v1',
        });
        const response = await openai.models.list();
        nimModels = response.data.map(m => m.id);
      }
      
      const allModels = ['gemini-3.5-flash', 'gemini-2.5-pro', ...nimModels].slice(0, 98); // Telegram max is ~100 buttons
      
      const buttons = [];
      for (let i = 0; i < allModels.length; i += 2) {
        const row = [];
        // Ensure callback data is under 64 bytes
        const m1 = allModels[i];
        row.push(Markup.button.callback(m1.length > 30 ? m1.substring(0, 27) + '...' : m1, `model_${m1}`.substring(0, 64)));
        if (i + 1 < allModels.length) {
          const m2 = allModels[i + 1];
          row.push(Markup.button.callback(m2.length > 30 ? m2.substring(0, 27) + '...' : m2, `model_${m2}`.substring(0, 64)));
        }
        buttons.push(row);
      }
      
      ctx.reply('Choose an AI Model (Note: Vision models are recommended for images):', Markup.inlineKeyboard(buttons));
    } catch (e) {
      ctx.reply('Choose an AI Model:', Markup.inlineKeyboard([
        [Markup.button.callback('gemini-3.5-flash', 'model_gemini-3.5-flash')],
        [Markup.button.callback('gemini-2.5-pro', 'model_gemini-2.5-pro')]
      ]));
    }
  });

  bot.action(/^model_(.+)$/, (ctx) => {
    const model = ctx.match[1];
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) {
      userStates[chatId] = { files: [], model: 'gemini-3.5-flash' };
    }
    userStates[chatId].model = model;
    ctx.reply(`Model set to ${model}.`);
    ctx.answerCbQuery();
  });

  const processFile = async (ctx: any, fileId: string, mimeType: string) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) {
      userStates[chatId] = { files: [], model: 'gemini-3.5-flash' };
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
      const modelToUse = state.model || 'gemini-3.5-flash';
      let summaryText = '';

      if (modelToUse.startsWith('gemini')) {
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
          parts.push({ text: '\n--- EXAMPLES: PAST Discharge Summaries ---\n' });
          for (const file of pastSummaries) {
            parts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
          }
        }

        parts.push({ text: '\n--- INPUT DATA ---\n' });

        for (const file of state.files) {
          parts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
        }

        parts.push({ text: '\nNow, generate the final discharge summary. Format it nicely using Markdown.\n' });

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: { parts },
          config: {
            systemInstruction: "You are a professional medical scribe writing discharge summaries. Start your response exactly with:\nPATIENT_NAME: <name or Unknown> | AGE: <age or Unknown>\nThen provide the summary.",
            temperature: 0.2,
          },
        });
        summaryText = response.text || 'Failed to generate summary.';
      } else {
        // Use NVIDIA NIM
        const apiKey = process.env.NVIDIA_NIM_API_KEY;
        if (!apiKey) throw new Error('NVIDIA_NIM_API_KEY is not set.');
        const openai = new OpenAI({ apiKey, baseURL: 'https://integrate.api.nvidia.com/v1' });

        const content: any[] = [
          {
            type: 'text',
            text: `You are an expert medical AI assistant specialized in writing professional, medically accurate discharge summaries for pediatric patients.
Your task is to review the provided patient case sheets and lab reports, and generate a concise, professional discharge summary.
${state.patientName ? `\nThe patient's name is: ${state.patientName}\n` : ''}
If any "Past Discharge Summaries" are provided, you MUST adopt their exact style, tone, section headers, and formatting conventions so the new summary matches the hospital's existing clinical documentation standards.
If NO templates are provided, use the standard international pediatric discharge summary format. Ensure the tone is appropriate for pediatric cases (including age, weight, and developmental context when relevant).`
          }
        ];

        const addFilesToOpenAI = (files: any[], sectionName: string) => {
          if (files.length > 0) {
            content.push({ type: 'text', text: `\n--- ${sectionName} ---\n` });
            for (const file of files) {
              if (file.mimeType.startsWith('image/')) {
                 content.push({ type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.data}` } });
              } else {
                 content.push({ type: 'text', text: `[A document of type ${file.mimeType} was uploaded, but the current NIM model only supports text and images. Please upload images of your PDFs instead.]` });
              }
            }
          }
        };

        addFilesToOpenAI(pastSummaries, 'EXAMPLES: PAST DISCHARGE SUMMARIES');
        addFilesToOpenAI(state.files, 'PATIENT INPUT DATA');

        content.push({ type: 'text', text: '\nNow, generate the final discharge summary. Format it nicely using Markdown.\n' });

        const response = await openai.chat.completions.create({
          model: modelToUse,
          messages: [
            { role: 'system', content: 'You are a professional medical scribe writing discharge summaries. Start your response exactly with:\nPATIENT_NAME: <name or Unknown> | AGE: <age or Unknown>\nThen provide the summary.' },
            { role: 'user', content: content }
          ],
          temperature: 0.2,
        });

        summaryText = response.choices[0].message.content || 'Failed to generate summary.';
      }

      let extractedName = state.patientName || 'Unknown';
      let extractedAge = 'Unknown';
      let finalSummary = summaryText;
      
      const match = summaryText.match(/^PATIENT_NAME:\s*(.*?)\s*\|\s*AGE:\s*(.*?)\s*\n([\s\S]*)$/i);
      if (match) {
         extractedName = state.patientName || match[1].trim();
         extractedAge = match[2].trim();
         finalSummary = match[3].trim();
      }

      await saveGeneratedSummary({
        patientName: extractedName,
        age: extractedAge,
        content: finalSummary,
        source: 'telegram',
        date: new Date().toISOString()
      });

      // Clear files after generation to save memory
      userStates[chatId].files = [];
      userStates[chatId].patientName = undefined; // reset patient name for next run
      
      // Telegram message length limit is 4096 characters, chunk if necessary
      const maxLen = 4000;
      for (let i = 0; i < finalSummary.length; i += maxLen) {
        await ctx.reply(finalSummary.substring(i, i + maxLen));
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
