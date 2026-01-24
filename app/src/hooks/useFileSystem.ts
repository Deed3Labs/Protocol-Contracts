import { useCallback, useState, useEffect } from 'react';

interface FileSystemOptions {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

/**
 * Hook for File System Access API
 * Allows exporting and importing files
 */
export function useFileSystem() {
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported('showSaveFilePicker' in window && 'showOpenFilePicker' in window);
  }, []);

  /**
   * Save file using File System Access API
   */
  const saveFile = useCallback(async (
    content: string | Blob,
    options: FileSystemOptions = {}
  ): Promise<boolean> => {
    if (!isSupported) {
      // Fallback: download file
      return downloadFile(content, options.suggestedName || 'file.txt');
    }

    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: options.suggestedName || 'file.txt',
        types: options.types || [{
          description: 'Text files',
          accept: { 'text/plain': ['.txt'] },
        }],
      });

      const writable = await fileHandle.createWritable();
      const blob = typeof content === 'string' 
        ? new Blob([content], { type: 'text/plain' })
        : content;
      await writable.write(blob);
      await writable.close();

      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled
        return false;
      }
      console.error('[FileSystem] Save failed:', error);
      // Fallback to download
      return downloadFile(content, options.suggestedName || 'file.txt');
    }
  }, [isSupported]);

  /**
   * Open file using File System Access API
   */
  const openFile = useCallback(async (
    options: FileSystemOptions = {}
  ): Promise<File | null> => {
    if (!isSupported) {
      // Fallback: use file input
      return openFileFallback();
    }

    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: options.types || [{
          description: 'Text files',
          accept: { 'text/plain': ['.txt'] },
        }],
      });

      const file = await fileHandle.getFile();
      return file;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled
        return null;
      }
      console.error('[FileSystem] Open failed:', error);
      // Fallback to file input
      return openFileFallback();
    }
  }, [isSupported]);

  /**
   * Export portfolio data as JSON
   */
  const exportPortfolio = useCallback(async (data: any): Promise<boolean> => {
    const json = JSON.stringify(data, null, 2);
    return saveFile(json, {
      suggestedName: `portfolio-${new Date().toISOString().split('T')[0]}.json`,
      types: [{
        description: 'JSON files',
        accept: { 'application/json': ['.json'] },
      }],
    });
  }, [saveFile]);

  /**
   * Export portfolio data as CSV
   */
  const exportPortfolioCSV = useCallback(async (data: any[]): Promise<boolean> => {
    if (!data || data.length === 0) {
      return false;
    }

    // Convert array of objects to CSV
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(header => {
        const value = row[header];
        // Escape commas and quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(','))
    ].join('\n');

    return saveFile(csv, {
      suggestedName: `portfolio-${new Date().toISOString().split('T')[0]}.csv`,
      types: [{
        description: 'CSV files',
        accept: { 'text/csv': ['.csv'] },
      }],
    });
  }, [saveFile]);

  /**
   * Import portfolio data from JSON file
   */
  const importPortfolio = useCallback(async (): Promise<any | null> => {
    const file = await openFile({
      types: [{
        description: 'JSON files',
        accept: { 'application/json': ['.json'] },
      }],
    });

    if (!file) {
      return null;
    }

    try {
      const text = await file.text();
      return JSON.parse(text);
    } catch (error) {
      console.error('[FileSystem] Failed to parse JSON:', error);
      return null;
    }
  }, [openFile]);

  return {
    isSupported,
    saveFile,
    openFile,
    exportPortfolio,
    exportPortfolioCSV,
    importPortfolio,
  };
}

/**
 * Fallback: Download file
 */
function downloadFile(content: string | Blob, filename: string): boolean {
  try {
    const blob = typeof content === 'string' 
      ? new Blob([content], { type: 'text/plain' })
      : content;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('[FileSystem] Download failed:', error);
    return false;
  }
}

/**
 * Fallback: Open file using file input
 */
function openFileFallback(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json,.csv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0] || null;
      resolve(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
