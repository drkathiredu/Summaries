export interface UploadedFile {
  id: string;
  name: string;
  data: string; // base64 encoded data
  mimeType: string;
  size: number;
}
