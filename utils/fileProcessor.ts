import { Sheet, SheetPage } from '../types';

interface ProcessResult {
  sheets: Sheet[];
  setlistName?: string;
  error?: string;
}

export const processBatchImport = async (fileList: FileList): Promise<ProcessResult> => {
  const files = Array.from(fileList).filter(f => !f.name.startsWith('.')); // Ignore hidden files
  
  if (files.length === 0) return { sheets: [] };

  // 1. Structure Verification
  // Expected: Root/File.pdf OR Root/Folder/Image.png
  // Invalid: Root/Folder/Nested/Image.png
  
  const rootFolderName = files[0].webkitRelativePath.split('/')[0];
  const groupedFiles = new Map<string, File[]>();
  const rootFiles: File[] = [];

  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    
    // Safety check for path depth
    // parts[0] = Root
    // parts[1] = File (if length 2) OR Folder (if length 3)
    // parts[2] = File (if length 3)
    
    if (parts.length > 3) {
      return { sheets: [], error: `Invalid structure in "${file.webkitRelativePath}". Nested folders are not allowed.` };
    }

    if (parts.length === 2) {
      // It's a file in the root
      rootFiles.push(file);
    } else if (parts.length === 3) {
      // It's a file in a subfolder (a piece)
      const folderName = parts[1];
      if (!groupedFiles.has(folderName)) {
        groupedFiles.set(folderName, []);
      }
      groupedFiles.get(folderName)!.push(file);
    }
  }

  const resultSheets: Sheet[] = [];

  // 2. Process Root Files (PDFs or Images acting as single page sheets)
  for (const file of rootFiles) {
     const name = file.name.replace(/\.[^/.]+$/, "");
     const page: SheetPage = {
         blob: file,
         fileType: file.type as any
     };
     
     // Construct Sheet
     resultSheets.push({
         id: crypto.randomUUID(),
         name: name,
         tags: [],
         dateAdded: Date.now(),
         pages: [page]
     });
  }

  // 3. Process Grouped Folders (Multi-page sheets)
  for (const [folderName, groupFiles] of groupedFiles.entries()) {
      // Sort files by name (e.g. page1, page2)
      // We use numeric sort for "page1", "page10" handling if possible, or simple localeCompare
      groupFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

      // Validate: Folders should primarily contain images. 
      // If a folder contains a PDF, current Viewer expects 1 PDF per sheet. 
      // We will allow it but warn or fail if mixed? 
      // User prompt implies: "pngFolder: page1.png, page2.png". 
      // We'll assume folder = multi-page image sheet.
      // If a PDF is found inside a folder, we treat it as a page, but Viewer might struggle if mixed.
      // For safety based on prompt, we assume standard usage.

      const pages: SheetPage[] = groupFiles.map(f => ({
          blob: f,
          fileType: f.type as any
      }));

      resultSheets.push({
          id: crypto.randomUUID(),
          name: folderName,
          tags: [],
          dateAdded: Date.now(),
          pages: pages
      });
  }

  return { sheets: resultSheets, setlistName: rootFolderName };
};