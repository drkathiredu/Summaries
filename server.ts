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

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
            systemInstruction: "You are a professional medical scribe writing discharge summaries.",
            temperature: 0.2, // Low temperature for factual accuracy
          },
        });

        res.json({ summary: response.text });
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

        const response = await openai.chat.completions.create({
          model: model,
          messages: [
            {
              role: 'user',
              content: content
            }
          ],
          temperature: 0.2,
        });

        res.json({ summary: response.choices[0].message.content });
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
