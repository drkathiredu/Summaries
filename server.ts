import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { startTelegramBot } from './bot';

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
const SAVED_SUMMARIES_FILE = path.join(DATA_DIR, 'saved_summaries.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function getSavedSummaries() {
  try {
    const data = await fsPromises.readFile(SAVED_SUMMARIES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function saveGeneratedSummary(summary: { patientName: string; age?: string; content: string; source: 'web' | 'telegram'; date: string }) {
  const summaries = await getSavedSummaries();
  summaries.unshift({
    id: Date.now().toString(),
    ...summary
  });
  await fsPromises.writeFile(SAVED_SUMMARIES_FILE, JSON.stringify(summaries), 'utf-8');
}

async function getTemplates() {
  try {
    const data = await fsPromises.readFile(TEMPLATES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function saveTemplates(templates: any[]) {
  await fsPromises.writeFile(TEMPLATES_FILE, JSON.stringify(templates), 'utf-8');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 encoded files
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.get('/api/templates', async (req, res) => {
    try {
      const templates = await getTemplates();
      res.json(templates);
    } catch (error: any) {
      console.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  app.get('/api/saved-summaries', async (req, res) => {
    try {
      const summaries = await getSavedSummaries();
      res.json(summaries);
    } catch (error: any) {
      console.error('Error fetching saved summaries:', error);
      res.status(500).json({ error: 'Failed to fetch saved summaries' });
    }
  });

  app.post('/api/templates', async (req, res) => {
    try {
      const templates = req.body.templates || [];
      await saveTemplates(templates);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error saving templates:', error);
      res.status(500).json({ error: 'Failed to save templates' });
    }
  });

  app.get('/api/models', async (req, res) => {
    try {
      const apiKey = process.env.NVIDIA_NIM_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'NVIDIA_NIM_API_KEY environment variable is not set.' });
      }
      const openai = new OpenAI({
        apiKey,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      });
      const response = await openai.models.list();
      res.json({ models: response.data.map(m => m.id) });
    } catch (error: any) {
      console.error('Error fetching models:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch models' });
    }
  });

  app.post('/api/generate-summary', async (req, res) => {
    try {
      const { caseSheets = [], labReports = [], pastSummaries = [], model = 'gemini-3.5-flash', patientName = '' } = req.body;

      if (caseSheets.length === 0 && labReports.length === 0) {
        return res.status(400).json({ error: 'Please provide at least one case sheet or lab report.' });
      }

      if (model.startsWith('gemini')) {
        const parts: any[] = [];

        parts.push({
          text: `You are an expert medical AI assistant specialized in writing professional, medically accurate discharge summaries for pediatric patients.

Your task is to review the provided patient case sheets and lab reports, and generate a concise, professional discharge summary.
${patientName ? `\nThe patient's name is: ${patientName}\n` : ''}

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

        if (caseSheets.length > 0) {
          parts.push({ text: '\nPATIENT CASE SHEETS:\n' });
          for (const file of caseSheets) {
            parts.push({
              inlineData: {
                data: file.data,
                mimeType: file.mimeType,
              },
            });
          }
        }

        if (labReports.length > 0) {
          parts.push({ text: '\nLAB REPORTS:\n' });
          for (const file of labReports) {
            parts.push({
              inlineData: {
                data: file.data,
                mimeType: file.mimeType,
              },
            });
          }
        }

        parts.push({ text: '\nNow, based on the input data, please generate the final discharge summary. Format it nicely using Markdown.\n' });

        const response = await ai.models.generateContent({
          model: model,
          contents: { parts },
          config: {
            systemInstruction: "You are a professional medical scribe writing discharge summaries. Start your response exactly with:\nPATIENT_NAME: <name or Unknown> | AGE: <age or Unknown>\nThen provide the summary.",
            temperature: 0.2, // Low temperature for factual accuracy
          },
        });

        const text = response.text || '';
        
        let extractedName = patientName || 'Unknown';
        let extractedAge = 'Unknown';
        let finalSummary = text;
        
        const match = text.match(/^PATIENT_NAME:\s*(.*?)\s*\|\s*AGE:\s*(.*?)\s*\n([\s\S]*)$/i);
        if (match) {
           extractedName = patientName || match[1].trim();
           extractedAge = match[2].trim();
           finalSummary = match[3].trim();
        }

        await saveGeneratedSummary({
          patientName: extractedName,
          age: extractedAge,
          content: finalSummary,
          source: 'web',
          date: new Date().toISOString()
        });

        res.json({ summary: finalSummary });
      } else {
        // Use NVIDIA NIM
        const apiKey = process.env.NVIDIA_NIM_API_KEY;
        if (!apiKey) {
          throw new Error('NVIDIA_NIM_API_KEY is not set.');
        }
        const openai = new OpenAI({
          apiKey,
          baseURL: 'https://integrate.api.nvidia.com/v1',
        });

        const content: any[] = [
          {
            type: 'text',
            text: `You are an expert medical AI assistant specialized in writing professional, medically accurate discharge summaries for pediatric patients.

Your task is to review the provided patient case sheets and lab reports, and generate a concise, professional discharge summary.
${patientName ? `\nThe patient's name is: ${patientName}\n` : ''}

If any "Past Discharge Summaries" are provided, you MUST adopt their exact style, tone, section headers, and formatting conventions so the new summary matches the hospital's existing clinical documentation standards.
If NO templates are provided, use the standard international pediatric discharge summary format. Ensure the tone is appropriate for pediatric cases (including age, weight, and developmental context when relevant).

NOTE: If the vision model complains about unsupported file types, assume it's an OCR failure or unsupported format, and try to extract whatever text you can or inform the user.`
          }
        ];

        const addFilesToOpenAI = (files: any[], sectionName: string) => {
          if (files.length > 0) {
            content.push({ type: 'text', text: `\n--- ${sectionName} ---\n` });
            for (const file of files) {
              if (file.mimeType.startsWith('image/')) {
                 content.push({
                   type: 'image_url',
                   image_url: { url: `data:${file.mimeType};base64,${file.data}` }
                 });
              } else {
                 content.push({ type: 'text', text: `[A document of type ${file.mimeType} was uploaded, but the current NIM model only supports text and images. Please upload images of your PDFs instead.]` });
              }
            }
          }
        };

        addFilesToOpenAI(pastSummaries, 'EXAMPLES: PAST DISCHARGE SUMMARIES (FOR STYLE/TONE)');
        addFilesToOpenAI(caseSheets, 'PATIENT CASE SHEETS');
        addFilesToOpenAI(labReports, 'LAB REPORTS');

        content.push({ type: 'text', text: '\nNow, based on the input data, please generate the final discharge summary. Format it nicely using Markdown.\n' });

        let text = '';
        try {
          const response = await openai.chat.completions.create({
            model: model,
            messages: [
              {
                role: 'system',
                content: 'You are a professional medical scribe writing discharge summaries. Start your response exactly with:\nPATIENT_NAME: <name or Unknown> | AGE: <age or Unknown>\nThen provide the summary.'
              },
              {
                role: 'user',
                content: content
              }
            ],
            temperature: 0.2,
          });
          text = response.choices[0].message.content || '';
        } catch (error: any) {
          if (error.message && (error.message.includes('multimodal') || error.message.includes('variant') || error.status === 400 || error.status === 500)) {
            let ocrText = '';
            if (pastSummaries.length > 0) {
               const pastParts = [{text: 'Extract all text from these past discharge summaries precisely:'}];
               pastSummaries.forEach((f: any) => pastParts.push({ inlineData: { data: f.data, mimeType: f.mimeType } }));
               const resp = await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: { parts: pastParts }});
               ocrText += `\n--- EXAMPLES: PAST DISCHARGE SUMMARIES ---\n${resp.text}\n`;
            }

            if (caseSheets.length > 0 || labReports.length > 0) {
               const fileParts = [{text: 'Extract all text from these patient case sheets and lab reports precisely:'}];
               caseSheets.forEach((f: any) => fileParts.push({ inlineData: { data: f.data, mimeType: f.mimeType } }));
               labReports.forEach((f: any) => fileParts.push({ inlineData: { data: f.data, mimeType: f.mimeType } }));
               const resp = await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: { parts: fileParts }});
               ocrText += `\n--- PATIENT INPUT DATA ---\n${resp.text}\n`;
            }

            const fallbackContent = [
              {
                type: 'text',
                text: `You are an expert medical AI assistant specialized in writing professional, medically accurate discharge summaries for pediatric patients.
Your task is to review the provided patient case sheets and lab reports, and generate a concise, professional discharge summary.
${patientName ? `\nThe patient's name is: ${patientName}\n` : ''}
If any "Past Discharge Summaries" are provided, you MUST adopt their exact style, tone, section headers, and formatting conventions so the new summary matches the hospital's existing clinical documentation standards.
If NO templates are provided, use the standard international pediatric discharge summary format. Ensure the tone is appropriate for pediatric cases (including age, weight, and developmental context when relevant).

Here is the extracted text from the uploaded documents:
${ocrText}

Now, generate the final discharge summary. Format it nicely using Markdown.`
              }
            ];

            const response = await openai.chat.completions.create({
              model: model,
              messages: [
                {
                  role: 'system',
                  content: 'You are a professional medical scribe writing discharge summaries. Start your response exactly with:\nPATIENT_NAME: <name or Unknown> | AGE: <age or Unknown>\nThen provide the summary.'
                },
                {
                  role: 'user',
                  content: fallbackContent
                }
              ],
              temperature: 0.2,
            });
            text = response.choices[0].message.content || '';
          } else {
            throw error;
          }
        }
        
        let extractedName = patientName || 'Unknown';
        let extractedAge = 'Unknown';
        let finalSummary = text;
        
        const match = text.match(/^PATIENT_NAME:\s*(.*?)\s*\|\s*AGE:\s*(.*?)\s*\n([\s\S]*)$/i);
        if (match) {
           extractedName = patientName || match[1].trim();
           extractedAge = match[2].trim();
           finalSummary = match[3].trim();
        }

        await saveGeneratedSummary({
          patientName: extractedName,
          age: extractedAge,
          content: finalSummary,
          source: 'web',
          date: new Date().toISOString()
        });

        res.json({ summary: finalSummary });
      }
    } catch (error: any) {
      console.error('Error generating summary:', error);
      res.status(500).json({ error: error.message || 'An error occurred while generating the summary.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startTelegramBot();
  });
}

startServer();
