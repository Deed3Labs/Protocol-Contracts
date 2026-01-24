interface EthereumProvider {
  isMetaMask?: boolean;
  request?: (args: { method: string; params?: any[] | Record<string, any> }) => Promise<any>;
  // Add more properties as needed
}

// File System Access API types
interface FileSystemFileHandle {
  kind: 'file';
  name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<File>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | Blob | ArrayBuffer | DataView): Promise<void>;
  close(): Promise<void>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

interface OpenFilePickerOptions {
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
  multiple?: boolean;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
    showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  }
}

export {}; 