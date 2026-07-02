import React, { useCallback, useRef } from 'react';
import { Upload, X, File, Image as ImageIcon, FileText } from 'lucide-react';
import type { UploadedFile } from '../types';

interface FileUploadProps {
  label: string;
  description: string;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  accept?: string;
  multiple?: boolean;
}

export function FileUpload({ label, description, files, onChange, accept = "image/*,application/pdf", multiple = true }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      processFiles(newFiles);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      processFiles(newFiles);
    }
  };

  const processFiles = async (newFiles: File[]) => {
    const processedFiles: UploadedFile[] = [];

    for (const file of newFiles) {
      try {
        const base64 = await toBase64(file);
        // Remove the data URL prefix to get raw base64
        const rawBase64 = base64.split(',')[1];
        
        processedFiles.push({
          id: Math.random().toString(36).substring(7),
          name: file.name,
          data: rawBase64,
          mimeType: file.type,
          size: file.size,
        });
      } catch (error) {
        console.error("Error processing file", file.name, error);
      }
    }

    onChange([...files, ...processedFiles]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const removeFile = (idToRemove: string) => {
    onChange(files.filter(f => f.id !== idToRemove));
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) return <FileText className="w-5 h-5 text-red-500" />;
    if (mimeType.includes('image')) return <ImageIcon className="w-5 h-5 text-blue-500" />;
    return <File className="w-5 h-5 text-gray-500" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
        <p className="text-xs text-slate-500">{description}</p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-colors"
      >
        <Upload className="w-8 h-8 text-slate-400 mb-2" />
        <p className="text-sm text-slate-600 font-medium">Click to upload or drag and drop</p>
        <p className="text-xs text-slate-400 mt-1">Images or PDF (max 10MB per file recommended)</p>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept={accept}
        multiple={multiple}
      />

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map(file => (
            <li key={file.id} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200">
              <div className="flex items-center space-x-3 overflow-hidden">
                {getFileIcon(file.mimeType)}
                <div className="truncate">
                  <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatSize(file.size)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(file.id);
                }}
                className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
