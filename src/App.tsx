import React, { useState, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import type { UploadedFile } from './types';
import { FileText, Loader2, ClipboardCheck, Sparkles, Settings, Building2, Stethoscope } from 'lucide-react';
import Markdown from 'react-markdown';

type Tab = 'generate' | 'templates' | 'saved';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('generate');

  const [caseSheets, setCaseSheets] = useState<UploadedFile[]>([]);
  const [labReports, setLabReports] = useState<UploadedFile[]>([]);
  const [pastSummaries, setPastSummaries] = useState<UploadedFile[]>([]);
  const [savedSummaries, setSavedSummaries] = useState<any[]>([]);
  
  const [models, setModels] = useState<string[]>(['gemini-3.5-flash', 'gemini-2.5-pro']);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash');
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  const [patientName, setPatientName] = useState<string>('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Load past summaries from backend on startup
    fetch('/api/templates')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPastSummaries(data);
        }
      })
      .catch(console.error);

    fetch('/api/saved-summaries')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSavedSummaries(data);
        }
      })
      .catch(console.error);

    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && Array.isArray(data.models)) {
          // Prepend Gemini models to the NIM models
          setModels(['gemini-3.5-flash', 'gemini-2.5-pro', ...data.models]);
        }
      })
      .catch(err => {
        console.error("Failed to load NIM models", err);
      })
      .finally(() => {
        setIsLoadingModels(false);
      });
  }, []);

  const handleUpdateTemplates = (newTemplates: UploadedFile[]) => {
    setPastSummaries(newTemplates);
    fetch('/api/templates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ templates: newTemplates })
    }).catch(console.error);
  };

  const handleGenerate = async () => {
    if (caseSheets.length === 0 && labReports.length === 0) {
      setError('Please upload at least one Case Sheet or Lab Report.');
      return;
    }

    setIsGenerating(true);
    setError('');
    setSummary('');

    try {
      const response = await fetch('/api/generate-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caseSheets,
          labReports,
          pastSummaries,
          model: selectedModel,
          patientName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate summary.');
      }

      setSummary(data.summary);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (summary) {
      navigator.clipboard.writeText(summary);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <header className="bg-white border-b border-slate-200 py-6 px-4 sm:px-8 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md">
              <ClipboardCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Clinical Scribe AI</h1>
              <p className="text-sm text-slate-500 font-medium">Medically Accurate Discharge Summaries</p>
            </div>
          </div>
          
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'generate' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Stethoscope className="w-4 h-4 mr-2" />
              Generate
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'templates' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Templates
            </button>
            <button
              onClick={() => {
                setActiveTab('saved');
                fetch('/api/saved-summaries').then(r => r.json()).then(d => setSavedSummaries(d)).catch(console.error);
              }}
              className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'saved' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4 mr-2" />
              Saved
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-8">
        
        {activeTab === 'generate' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* INPUT PANEL */}
            <section className="lg:col-span-5 space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h2 className="text-lg font-bold flex items-center text-slate-800">
                    <FileText className="w-5 h-5 mr-2 text-blue-600" />
                    Patient Documents
                  </h2>
                  {pastSummaries.length > 0 && (
                    <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-1 rounded-md">
                      {pastSummaries.length} Template{pastSummaries.length !== 1 ? 's' : ''} Active
                    </span>
                  )}
                </div>
                
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <label className="block text-sm font-semibold text-slate-800 mb-2 flex items-center">
                    <Settings className="w-4 h-4 mr-1.5 text-slate-500" />
                    AI Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={isLoadingModels}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {models.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-2">
                    Note: NVIDIA NIM Vision models are recommended for images. Text models may not support image inputs.
                  </p>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Patient Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="Enter patient name..."
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
                    {error}
                  </div>
                )}

                <FileUpload
                  label="1. Patient Case Sheets"
                  description="Upload scanned case sheets, admission notes, or progress charts (Images/PDFs)."
                  files={caseSheets}
                  onChange={setCaseSheets}
                />

                <div className="h-px bg-slate-100 my-4" />

                <FileUpload
                  label="2. Lab Reports"
                  description="Upload blood work, imaging reports, or other diagnostics."
                  files={labReports}
                  onChange={setLabReports}
                />

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || (caseSheets.length === 0 && labReports.length === 0)}
                  className="w-full mt-6 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Generating Summary...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 mr-2" />
                      Generate Discharge Summary
                    </>
                  )}
                </button>
              </div>
            </section>

            {/* OUTPUT PANEL */}
            <section className="lg:col-span-7">
              <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 h-full min-h-[600px] flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                  <h2 className="text-lg font-bold text-slate-800">Generated Summary</h2>
                  {summary && (
                    <button
                      onClick={copyToClipboard}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors flex items-center"
                    >
                      <ClipboardCheck className="w-4 h-4 mr-1.5" />
                      Copy to Clipboard
                    </button>
                  )}
                </div>

                <div className="flex-grow overflow-y-auto">
                  {summary ? (
                    <div className="prose prose-slate prose-sm sm:prose-base max-w-none">
                      <Markdown>{summary}</Markdown>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                        <FileText className="w-8 h-8 text-slate-300" />
                      </div>
                      <p className="text-sm">Upload documents and click generate to see the summary.</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : activeTab === 'templates' ? (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center">
                  <Building2 className="w-6 h-6 mr-2 text-blue-600" />
                  Hospital Style Templates
                </h2>
                <p className="text-slate-500 mt-2">
                  Upload examples of previous discharge summaries from your hospital. These will be stored securely on the server and automatically used as a style and formatting reference for all future generated summaries.
                </p>
              </div>

              <div className="h-px bg-slate-100 my-6" />

              <FileUpload
                label="Past Discharge Summaries"
                description="Upload examples of previous discharge summaries. The AI will match their tone, formatting, and section styles."
                files={pastSummaries}
                onChange={handleUpdateTemplates}
              />
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-xl font-bold text-slate-800 flex items-center">
              <FileText className="w-6 h-6 mr-2 text-blue-600" />
              Saved Summaries
            </h2>
            {savedSummaries.length === 0 ? (
              <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center text-slate-500">
                No saved summaries found.
              </div>
            ) : (
              savedSummaries.map((s, i) => (
                <div key={s.id || i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="font-bold text-lg text-slate-900">{s.patientName}</h3>
                      <p className="text-sm text-slate-500">Age: {s.age || 'Unknown'}</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {s.source}
                      </span>
                      <p className="text-xs text-slate-400 mt-1">{new Date(s.date).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="prose prose-sm max-w-none prose-slate">
                    <Markdown>{s.content}</Markdown>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </main>
    </div>
  );
}

