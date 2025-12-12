import { Music2, Mic, Guitar, Piano, Clock, Zap, BookOpen, Star, Heart, Cloud, Briefcase, GraduationCap, Tag, Smile, Flame, Sun, Moon, Anchor, Coffee, Feather, Headphones, Key, MapPin } from 'lucide-react';

export const DB_NAME = 'GigMasterDB';
export const DB_VERSION = 4; // Incremented to ensure tags store is correctly initialized
export const STORES = {
  SHEETS: 'sheets',
  SETLISTS: 'setlists',
  ANNOTATIONS: 'annotations',
  TAGS: 'tags',
};

// Key codes for page turners
export const PAGE_TURN_KEYS = {
  NEXT: ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'],
  PREV: ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'],
};

export const COLORS = [
  '#ef4444', // Red
  '#f59e0b', // Amber
  '#22c55e', // Green
  '#3b82f6', // Blue
  '#000000', // Black
  '#ffffff', // White
];

// Available icons for custom tags
export const ICON_MAP: Record<string, any> = {
  Tag, Music2, Mic, Guitar, Piano, Clock, Zap, BookOpen, Star, Heart, Cloud, Briefcase, GraduationCap, 
  Smile, Flame, Sun, Moon, Anchor, Coffee, Feather, Headphones, Key, MapPin
};

// Initial data for the tags store
export const INITIAL_TAGS = [
  { label: 'Classical', iconName: 'BookOpen' },
  { label: 'Jazz', iconName: 'Music2' },
  { label: 'Pop', iconName: 'Star' },
  { label: 'Rock', iconName: 'Zap' },
  { label: 'Gig', iconName: 'Briefcase' },
  { label: 'Favorites', iconName: 'Heart' },
];