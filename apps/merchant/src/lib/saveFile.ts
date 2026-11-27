import { currentPlatform } from '@/reader/platform';

/**
 * Save a file the app made (a spreadsheet of sales): the browser's download, or, in the installed
 * app, where a download goes nowhere, the system's share sheet (Save to Files, AirDrop, Mail).
 * Returns false if the person closed the share sheet without choosing.
 */
export async function saveFile(name: string, text: string, type: string): Promise<boolean> {
  const blob = new Blob([text], { type });
  if (currentPlatform() !== 'web') {
    const file = new File([blob], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return true;
      } catch {
        return false;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
