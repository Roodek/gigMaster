import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { Upload, FileText, Trash2, Plus, Music, Search, Tag, X, PenLine, Save, FolderUp, Layers, ChevronDown, Check, Library as LibraryIcon, AlertTriangle, Copy, FileWarning } from 'lucide-react';
import { Sheet, SheetPage, TagDef, Setlist } from '../types';
import { storage } from '../services/storage';
import { ICON_MAP } from '../constants';
import { processBatchImport } from '../utils/fileProcessor';

interface LibraryProps {
  sheets: Sheet[];
  setlists: Setlist[];
  onImport: () => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
}

interface DeleteModalState {
    isOpen: boolean;
    sheet: Sheet | null;
    affectedSetlists: string[];
}

interface ConflictState {
    newSheets: Sheet[];
    duplicates: Sheet[];
    successMessage?: string;
}

interface ErrorModalState {
    isOpen: boolean;
    message: string;
}

const Library: React.FC<LibraryProps> = ({ sheets, setlists, onRefresh, onSelect }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Global Tags State
  const [allTags, setAllTags] = useState<TagDef[]>([]);
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);

  // Edit Modal State
  const [editingSheet, setEditingSheet] = useState<Sheet | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagIcons, setEditTagIcons] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState('');
  
  // Custom Tag Icon Picker
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [selectedIconName, setSelectedIconName] = useState<string>('Tag');

  // Delete Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ isOpen: false, sheet: null, affectedSetlists: [] });

  // Import Conflict Modal State
  const [conflictData, setConflictData] = useState<ConflictState | null>(null);

  // Error Modal State
  const [errorModal, setErrorModal] = useState<ErrorModalState>({ isOpen: false, message: '' });

  const loadTags = useCallback(async () => {
    try {
        const tags = await storage.getAllTags();
        setAllTags(tags);
    } catch (e) {
        console.error("Failed to load tags", e);
    }
  }, []);

  // Load global tags on mount
  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Step 1: Initiate Import and Check for Duplicates
  const initiateImport = async (newSheets: Sheet[], successMessage?: string) => {
    if (newSheets.length === 0) return;

    // Fetch latest sheets from DB
    const currentSheets = await storage.getAllSheets();

    // Check for duplicates
    const duplicates = newSheets.filter(newSheet => 
        currentSheets.some(existing => existing.name.trim().toLowerCase() === newSheet.name.trim().toLowerCase())
    );

    if (duplicates.length > 0) {
        // Trigger Modal
        setConflictData({ newSheets, duplicates, successMessage });
    } else {
        // No conflicts, proceed directly
        await finalizeImport(newSheets, false, successMessage);
    }
  };

  // Step 2: Finalize Import (Executed after conflict resolution or if no conflicts)
  const finalizeImport = async (newSheets: Sheet[], overwrite: boolean, successMessage?: string) => {
      const currentSheets = await storage.getAllSheets();
      let count = 0;
      
      for (const sheet of newSheets) {
          const existing = currentSheets.find(s => s.name.trim().toLowerCase() === sheet.name.trim().toLowerCase());
          
          let sheetToSave = sheet;

          if (existing && overwrite) {
              // Overwrite: Use existing ID, preserve tags/icons
              sheetToSave = {
                  ...sheet,
                  id: existing.id,
                  tags: existing.tags,
                  tagIcons: existing.tagIcons,
                  dateAdded: Date.now()
              };
          }

          await storage.addSheet(sheetToSave);
          count++;
      }

      setConflictData(null); // Close modal if open
      
      if (successMessage) {
          // Small timeout to allow modal to close visually first
          setTimeout(() => alert(successMessage), 100);
      }
      onRefresh();
  };

  // Handle individual files
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newSheets: Sheet[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        const file = e.target.files[i];
        const page: SheetPage = {
          blob: file,
          fileType: file.type as any
        };
        
        const newSheet: Sheet = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ""),
          tags: [],
          dateAdded: Date.now(),
          pages: [page]
        };
        newSheets.push(newSheet);
      }
      
      await initiateImport(newSheets);
    }
    // Reset input
    if (e.target) e.target.value = '';
  };

  // Handle Single Folder Import
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(f => !f.name.startsWith('.'));
      if (files.length === 0) return;

      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      const pathParts = files[0].webkitRelativePath.split('/');
      const sheetName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "Imported Folder";

      const pages: SheetPage[] = files.map(f => ({
          blob: f,
          fileType: f.type as any
      }));

      const newSheet: Sheet = {
          id: crypto.randomUUID(),
          name: sheetName,
          tags: [],
          dateAdded: Date.now(),
          pages: pages
      };
      
      await initiateImport([newSheet]);
    }
    if (e.target) e.target.value = '';
  };

  // Handle Batch Import
  const handleBatchImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const result = await processBatchImport(e.target.files);
        if (result.error) {
            setErrorModal({ isOpen: true, message: result.error });
            if (e.target) e.target.value = '';
            return;
        }
        if (result.sheets.length > 0) {
            await initiateImport(result.sheets, `Successfully imported ${result.sheets.length} entries.`);
        } else {
            alert("No valid files found in selection.");
        }
    }
    if (e.target) e.target.value = '';
  };

  // Initial Delete Click - Opens Modal
  const handleDeleteClick = (e: React.MouseEvent, sheet: Sheet) => {
    e.stopPropagation();
    const affected = setlists
        .filter(list => list.sheetIds.includes(sheet.id))
        .map(list => list.name);

    setDeleteModal({
        isOpen: true,
        sheet: sheet,
        affectedSetlists: affected
    });
  };

  // Confirm Delete Action
  const confirmDelete = async () => {
      if (deleteModal.sheet) {
          await storage.deleteSheet(deleteModal.sheet.id);
          setDeleteModal({ isOpen: false, sheet: null, affectedSetlists: [] });
          onRefresh();
      }
  };

  const openEditModal = (e: React.MouseEvent, sheet: Sheet) => {
    e.stopPropagation();
    setEditingSheet(sheet);
    setEditName(sheet.name);
    setEditTags(sheet.tags || []);
    setEditTagIcons(sheet.tagIcons || {});
    setTagInput('');
    setSelectedIconName('Tag');
    setShowIconPicker(false);
    setTagToDelete(null);
  };

  const closeEditModal = () => {
    setEditingSheet(null);
    setTagToDelete(null);
  };

  const handleAddTag = async () => {
    if (tagInput.trim()) {
      const tagName = tagInput.trim();
      addTag(tagName);
      const iconName = selectedIconName || 'Tag';
      const newTagDef = { label: tagName, iconName };
      const tagExists = allTags.some(t => t.label === tagName);
      if (!tagExists) {
          const optimisticTags = [...allTags, newTagDef];
          setAllTags(optimisticTags);
          try {
            await storage.saveTag(newTagDef);
            await loadTags();
          } catch (err) {
            console.error("Failed to save tag", err);
            await loadTags();
          }
      }
      setTagInput('');
      setSelectedIconName('Tag');
    }
  };

  const addTag = (tag: string) => {
    if (!editTags.includes(tag)) {
        setEditTags([...editTags, tag]);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setEditTags(editTags.filter(t => t !== tagToRemove));
  };

  const confirmDeleteTag = async (label: string) => {
      const newTags = allTags.filter(t => t.label !== label);
      setAllTags(newTags);
      setTagToDelete(null);
      try {
        await storage.deleteTag(label);
        const latestTags = await storage.getAllTags();
        setAllTags(latestTags);
      } catch (err) {
        console.error("Failed to delete tag", err);
        loadTags();
      }
  };

  const saveEdits = async () => {
    if (editingSheet && editName.trim()) {
      const updatedSheet: Sheet = {
        ...editingSheet,
        name: editName.trim(),
        tags: editTags,
        tagIcons: editTagIcons
      };
      await storage.updateSheetMetadata(updatedSheet);
      closeEditModal();
      onRefresh();
    }
  };

  const filteredSheets = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return sheets.filter(s => 
      s.name.toLowerCase().includes(q) || 
      (s.tags && s.tags.some(t => t.toLowerCase().includes(q)))
    );
  }, [sheets, searchQuery]);

  const getTagIcon = (tag: string, sheet?: Sheet) => {
    if (sheet?.tagIcons?.[tag]) {
        return ICON_MAP[sheet.tagIcons[tag]] || Tag;
    }
    if (editTagIcons[tag]) {
        return ICON_MAP[editTagIcons[tag]] || Tag;
    }
    const def = allTags.find(t => t.label === tag);
    if (def) return ICON_MAP[def.iconName] || Tag;
    return Tag;
  };

  const CurrentInputIcon = ICON_MAP[selectedIconName] || Tag;

  return (
    <div className="p-6 pb-24 relative">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between mb-8 gap-4">
        <div className="mt-1">
           <h1 className="text-3xl font-bold text-white mb-1">Library</h1>
           <p className="text-slate-400 text-sm">All your imported sheet music</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-3 items-start w-full xl:w-auto">
            <div className="relative flex-1 w-full md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                    type="text" 
                    placeholder="Search by name or tags..." 
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            
            <div className="flex flex-col gap-2 w-full md:w-auto">
                <button 
                    onClick={() => batchInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-lg shadow-lg transition-all active:scale-95 whitespace-nowrap"
                    title="Import multiple sheets (folders or files) at once with verification"
                >
                    <LibraryIcon size={20} />
                    <span className="hidden sm:inline">Batch Import</span>
                </button>

                <div className="flex gap-2 w-full">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg shadow-lg shadow-blue-900/20 transition-all active:scale-95 whitespace-nowrap"
                    >
                        <Upload size={20} />
                        <span className="hidden sm:inline">File</span>
                    </button>

                    <button 
                        onClick={() => folderInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg shadow-lg transition-all active:scale-95 border border-slate-600 whitespace-nowrap"
                        title="Import a folder containing pages as ONE sheet"
                    >
                        <FolderUp size={20} />
                        <span className="hidden sm:inline">Folder (Images)</span>
                    </button>
                </div>
            </div>
        </div>
        
        <input type="file" ref={fileInputRef} className="hidden" accept="image/png, image/jpeg, application/pdf" multiple onChange={handleFileChange} />
        <input type="file" ref={folderInputRef} className="hidden" 
            // @ts-ignore
            webkitdirectory="" directory="" multiple onChange={handleFolderChange} 
        />
        <input type="file" ref={batchInputRef} className="hidden"
            // @ts-ignore
            webkitdirectory="" directory="" multiple onChange={handleBatchImport} 
        />
      </div>

      {sheets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-700 rounded-2xl bg-slate-800/30">
          <div className="bg-slate-800 p-4 rounded-full mb-4">
             <Upload size={32} className="text-slate-400" />
          </div>
          <p className="text-lg text-slate-300 font-medium">No sheets yet</p>
          <p className="text-slate-500 text-sm mt-1">Import PDF, PNG or JPG files to start</p>
        </div>
      ) : filteredSheets.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
              <p>No results found for "{searchQuery}"</p>
          </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredSheets.map((sheet) => {
             const fileCount = sheet.pages.length;
             const firstPage = sheet.pages?.[0];
             const isPdf = firstPage?.fileType === 'application/pdf';
             return (
                <div 
                key={sheet.id}
                onClick={() => onSelect(sheet.id)}
                className="group relative bg-slate-800 rounded-xl overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all cursor-pointer aspect-[3/4] flex flex-col"
                >
                <div className="flex-1 bg-slate-900 flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent z-10" />
                    
                    <div className="flex flex-col items-center gap-2">
                        {isPdf ? (
                            <FileText size={48} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                        ) : (
                            <Music size={48} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                        )}
                        <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">
                            {fileCount > 1 ? `${fileCount} ${isPdf ? 'Files' : 'Pages'}` : (isPdf ? 'PDF' : 'Image')}
                        </span>
                    </div>

                    {fileCount > 1 && (
                        <div className="absolute top-2 left-2 z-20 bg-black/60 text-white px-2 py-0.5 rounded text-xs flex items-center gap-1">
                            <Layers size={12} /> {fileCount}
                        </div>
                    )}
                    
                    <div className="absolute bottom-2 left-2 z-20 flex flex-wrap gap-1 max-w-[90%]">
                        {(sheet.tags || []).slice(0, 4).map(tag => {
                            const Icon = getTagIcon(tag, sheet);
                            return (
                                <span key={tag} className="text-[10px] bg-blue-500/20 text-blue-300 p-1 rounded-full border border-blue-500/30" title={tag}>
                                    <Icon size={12} />
                                </span>
                            );
                        })}
                    </div>
                </div>
                <div className="bg-slate-800 p-3 z-20 border-t border-slate-700/50">
                    <h3 className="text-white font-medium text-sm truncate" title={sheet.name}>{sheet.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{new Date(sheet.dateAdded).toLocaleDateString()}</p>
                </div>
                <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    <button onClick={(e) => openEditModal(e, sheet)} className="p-2 bg-black/60 text-white rounded-full hover:bg-blue-600 backdrop-blur" title="Edit Details"><PenLine size={14} /></button>
                    <button onClick={(e) => handleDeleteClick(e, sheet)} className="p-2 bg-black/60 text-white rounded-full hover:bg-red-500 backdrop-blur" title="Delete"><Trash2 size={14} /></button>
                </div>
                </div>
             );
          })}
        </div>
      )}

      {/* Error Modal for Import Structure */}
      {errorModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setErrorModal({ isOpen: false, message: '' })}>
            <div className="bg-slate-800 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center text-red-500 mb-4">
                        <FileWarning size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Import Error</h3>
                    <p className="text-red-300 text-sm mb-4 bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                        {errorModal.message}
                    </p>
                    
                    <div className="text-left w-full bg-slate-900/50 p-4 rounded-xl border border-slate-700 space-y-3">
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Supported Folder Structures</p>
                        
                        <div className="flex gap-3">
                            <div className="flex-1 space-y-1">
                                <span className="text-xs text-blue-400 font-bold">1. Mixed Files</span>
                                <div className="text-xs text-slate-500 font-mono bg-slate-950 p-2 rounded border border-slate-800 leading-relaxed">
                                    Root/<br/>
                                    ├── SongA.pdf<br/>
                                    ├── SongB.jpg
                                </div>
                            </div>
                            <div className="flex-1 space-y-1">
                                <span className="text-xs text-blue-400 font-bold">2. Image Folders</span>
                                <div className="text-xs text-slate-500 font-mono bg-slate-950 p-2 rounded border border-slate-800 leading-relaxed">
                                    Root/<br/>
                                    ├── SongC/<br/>
                                    │   ├── 1.png<br/>
                                    │   └── 2.png
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <button 
                    onClick={() => setErrorModal({ isOpen: false, message: '' })}
                    className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
                >
                    Close
                </button>
            </div>
        </div>
      )}

      {/* Duplicate Conflict Modal */}
      {conflictData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => {}}>
              <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                  <div className="flex flex-col items-center text-center mb-6">
                      <div className="w-16 h-16 bg-yellow-900/30 rounded-full flex items-center justify-center text-yellow-500 mb-4">
                          <FileWarning size={32} />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">Duplicates Detected</h3>
                      <p className="text-slate-400 text-sm mb-4">
                          {conflictData.duplicates.length} of the sheets you are importing have the same names as existing sheets in your library.
                      </p>
                      
                      <div className="bg-slate-900/50 rounded-lg p-3 w-full max-h-48 overflow-y-auto mb-4 border border-slate-700 text-left">
                           <ul className="text-sm text-slate-300 space-y-1">
                               {conflictData.duplicates.map((s, i) => (
                                   <li key={i} className="flex items-center gap-2">
                                       <AlertTriangle size={12} className="text-yellow-500" />
                                       <span className="truncate">{s.name}</span>
                                   </li>
                               ))}
                           </ul>
                      </div>
                      
                      <p className="text-slate-500 text-xs">
                          "Overwrite" will update the content of existing sheets but keep their tags and setlist assignments. "Keep Both" will create duplicates.
                      </p>
                  </div>

                  <div className="flex gap-3">
                      <button 
                          onClick={() => setConflictData(null)}
                          className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={() => finalizeImport(conflictData.newSheets, false, conflictData.successMessage)}
                          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors"
                      >
                          <div className="flex items-center justify-center gap-2">
                             <Copy size={16} />
                             <span>Keep Both</span>
                          </div>
                      </button>
                      <button 
                          onClick={() => finalizeImport(conflictData.newSheets, true, conflictData.successMessage)}
                          className="flex-1 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-medium transition-colors"
                      >
                          <div className="flex items-center justify-center gap-2">
                              <Save size={16} />
                              <span>Overwrite</span>
                          </div>
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setDeleteModal({ isOpen: false, sheet: null, affectedSetlists: [] })}>
              <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                  <div className="flex flex-col items-center text-center mb-6">
                      <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center text-red-500 mb-4">
                          <Trash2 size={32} />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">Delete Sheet?</h3>
                      <p className="text-slate-400 text-sm">
                          Are you sure you want to delete <span className="font-bold text-white">"{deleteModal.sheet?.name}"</span>?
                          This action cannot be undone.
                      </p>
                  </div>

                  {deleteModal.affectedSetlists.length > 0 && (
                      <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 mb-6">
                          <div className="flex items-center gap-2 text-orange-400 font-bold text-sm mb-1">
                              <AlertTriangle size={14} />
                              <span>Warning</span>
                          </div>
                          <p className="text-orange-300/80 text-xs mb-2">
                              This sheet is currently used in the following setlists and will be removed from them:
                          </p>
                          <ul className="text-xs text-orange-200 list-disc list-inside">
                              {deleteModal.affectedSetlists.map(name => (
                                  <li key={name}>{name}</li>
                              ))}
                          </ul>
                      </div>
                  )}

                  <div className="flex gap-3">
                      <button 
                          onClick={() => setDeleteModal({ isOpen: false, sheet: null, affectedSetlists: [] })}
                          className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={confirmDelete}
                          className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-red-900/20"
                      >
                          Delete
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Edit Modal (Existing) */}
      {editingSheet && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={closeEditModal}>
              <div className="bg-slate-800 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                      <h3 className="font-bold text-white">Edit Details</h3>
                      <button onClick={closeEditModal} className="text-slate-400 hover:text-white"><X size={20}/></button>
                  </div>
                  <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Name</label>
                          <input 
                            type="text" 
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                          />
                      </div>
                      
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Selected Tags</label>
                          <div className="flex flex-wrap gap-2 mb-4 min-h-[32px]">
                              {editTags.map(tag => {
                                  const Icon = getTagIcon(tag);
                                  return (
                                    <span key={tag} className="flex items-center gap-1 bg-blue-600/20 text-blue-300 px-2 py-1 rounded-full text-sm border border-blue-600/30">
                                        <Icon size={12} />
                                        {tag}
                                        <button onClick={() => handleRemoveTag(tag)} className="hover:text-white ml-1"><X size={12}/></button>
                                    </span>
                                  );
                              })}
                              {editTags.length === 0 && <span className="text-slate-500 text-sm italic">No tags selected</span>}
                          </div>

                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Quick Add</label>
                          <div className="grid grid-cols-3 gap-2 mb-4">
                              {allTags.map(tagDef => {
                                  const isSelected = editTags.includes(tagDef.label);
                                  const Icon = ICON_MAP[tagDef.iconName] || Tag;
                                  
                                  return (
                                    <div key={tagDef.label} className="relative group min-h-[58px]">
                                        <button
                                            onClick={() => isSelected ? handleRemoveTag(tagDef.label) : addTag(tagDef.label)}
                                            className={`w-full h-full flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${isSelected ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                                        >
                                            <Icon size={20} className="mb-1" />
                                            <span className="text-[10px] truncate w-full text-center">{tagDef.label}</span>
                                        </button>
                                        
                                        {!tagToDelete && (
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setTagToDelete(tagDef.label);
                                                }}
                                                className="absolute -top-1 -right-1 bg-slate-950 text-slate-500 rounded-full p-0.5 border border-slate-700 hover:text-red-500 hover:border-red-500 transition-colors z-10"
                                                title="Delete from Quick Add"
                                            >
                                                <X size={10} />
                                            </button>
                                        )}

                                        {tagToDelete === tagDef.label && (
                                            <div 
                                                className="absolute inset-0 bg-slate-950/90 border border-red-500 rounded-lg flex items-center justify-around z-20 animate-in fade-in zoom-in duration-150 backdrop-blur-sm"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <button 
                                                    onClick={() => setTagToDelete(null)}
                                                    className="p-1 rounded-full bg-slate-800 text-slate-400 hover:text-white transition-colors"
                                                >
                                                    <X size={16} />
                                                </button>
                                                <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Del?</span>
                                                <button 
                                                    onClick={() => confirmDeleteTag(tagDef.label)}
                                                    className="p-1 rounded-full bg-red-600 text-white hover:bg-red-500 transition-colors shadow-lg shadow-red-900/50"
                                                >
                                                    <Check size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                  )
                              })}
                          </div>

                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Create Custom Tag</label>
                          <div className="flex gap-2 items-center">
                            {/* Icon Picker Trigger */}
                            <div className="relative">
                                <button 
                                    onClick={() => setShowIconPicker(!showIconPicker)}
                                    className="w-10 h-10 flex items-center justify-center bg-slate-900 border border-slate-700 rounded-lg hover:border-blue-500 transition-colors text-slate-300"
                                    title="Choose icon"
                                >
                                    <CurrentInputIcon size={18} />
                                </button>
                                
                                {showIconPicker && (
                                    <div className="absolute bottom-full left-0 mb-2 p-3 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 w-64">
                                        <div className="grid grid-cols-6 gap-2">
                                            {Object.keys(ICON_MAP).map(iconName => {
                                                const Icon = ICON_MAP[iconName];
                                                const isSelected = selectedIconName === iconName;
                                                return (
                                                    <button 
                                                        key={iconName}
                                                        onClick={() => {
                                                            setSelectedIconName(iconName);
                                                            setShowIconPicker(false);
                                                        }}
                                                        className={`p-2 rounded hover:bg-slate-700 flex items-center justify-center ${isSelected ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                                                    >
                                                        <Icon size={16} />
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <input 
                                type="text" 
                                placeholder="Tag name..."
                                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none text-sm h-10"
                                value={tagInput}
                                onChange={e => setTagInput(e.target.value)}
                            />
                            
                            <button 
                                onClick={handleAddTag}
                                disabled={!tagInput.trim()}
                                className="h-10 px-4 bg-slate-700 hover:bg-blue-600 text-white rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Add Tag"
                            >
                                <Plus size={18} />
                            </button>
                          </div>
                      </div>
                  </div>
                  <div className="p-4 border-t border-slate-700 flex justify-end gap-3 bg-slate-900/50">
                      <button onClick={closeEditModal} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
                      <button onClick={saveEdits} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500">
                          <Save size={16} /> Save
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Library;