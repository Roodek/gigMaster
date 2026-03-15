
export interface Point {
  x: number;
  y: number;
}

export type AnnotationType = 'path' | 'text' | 'rect' | 'circle';

export interface Stroke {
  id?: string;
  type?: AnnotationType;
  points: Point[];
  color: string;
  width: number;
  text?: string;
  fontFamily?: string;
  pageIndex: number; // For PDF: page number (0-based). For Images: 0.
  fileIndex?: number; // Index of the file in sheet.pages. Defaults to 0 if undefined.
}

export interface SheetPage {
  blob: Blob;
  fileType: 'image/png' | 'image/jpeg' | 'application/pdf';
}

export interface TagDef {
  label: string;
  iconName: string;
}

export interface Sheet {
  id: string;
  name: string;
  tags: string[]; 
  tagIcons?: Record<string, string>; // Map tag label to icon name (e.g. 'MyTag': 'Guitar')
  dateAdded: number;
  pages: SheetPage[]; // Replaced single blob with array of pages
  previewUrl?: string; // For images
}

export interface AnnotationLayer {
  sheetId: string;
  strokes: Stroke[];
}

export interface Setlist {
  id: string;
  name: string;
  sheetIds: string[]; // Ordered list of sheet IDs
  dateCreated: number;
}

export enum AppView {
  LIBRARY = 'LIBRARY',
  SETLISTS = 'SETLISTS',
  VIEWER = 'VIEWER',
}

export interface ViewerState {
  activeSetlistId: string | null; // null if viewing single file from library
  queue: string[]; // Sheet IDs in order
  currentIndex: number;
}
