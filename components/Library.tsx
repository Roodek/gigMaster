
import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { Upload, FileText, Trash2, Plus, Music, Search, Tag, X, PenLine, Save, FolderUp, Layers, ChevronDown, Check, Library as LibraryIcon, AlertTriangle, Copy, FileWarning, RefreshCw } from 'lucide-react';
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
  
  const [allTags, setAllTags] = useState<TagDef[]>([]);
  const [editingSheet, setEditingSheet] = useState<Sheet | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagIcons, setEditTagIcons] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState('');
  
  const [selectedIconName, setSelectedIconName] = useState<string>('Tag');
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ isOpen: false, sheet: null, affectedSetlists: [] });
  const [conflictData, setConflictData] = useState<ConflictState | null>(null);
  const [errorModal, setErrorModal] = useState<ErrorModalState>({ isOpen: false, message: '' });

  const loadTags = useCallback(async () => {
    try {
        const tags = await storage.getAllTags();
        setAllTags(tags);
    } catch (e) {
        console.error("Failed to load tags", e);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const initiateImport = async (newSheets: Sheet[], successMessage?: string) => {
    if (newSheets.length === 0) return;
    const currentSheets = await storage.getAllSheets();
    const duplicates = newSheets.filter(newSheet => 
        currentSheets.some(existing => existing.name.trim().toLowerCase() === newSheet.name.trim().toLowerCase())
    );
    if (duplicates.length > 0) {
        setConflictData({ newSheets, duplicates, successMessage });
    } else {
        await finalizeImport(newSheets, false, successMessage);
    }
  };

  const finalizeImport = async (newSheets: Sheet[], overwrite: boolean, successMessage?: string) => {
      const currentSheets = await storage.getAllSheets();
      for (const sheet of newSheets) {
          const existing = currentSheets.find(s => s.name.trim().toLowerCase() === sheet.name.trim().toLowerCase());
          let sheetToSave = sheet;
          
          if (existing && overwrite) {
              sheetToSave = {
                  ...sheet,
                  id: existing.id, // Preserve ID to keep tags/annotations
                  tags: existing.tags,
                  tagIcons: existing.tagIcons,
                  dateAdded: Date.now()
              };
          }
          await storage.addSheet(sheetToSave);
      }
      setConflictData(null);
      if (successMessage) setTimeout(() => alert(successMessage), 100);
      onRefresh();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newSheets: Sheet[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        const file = e.target.files[i];
        const page: SheetPage = { blob: file, fileType: file.type as any };
        newSheets.push({
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ""),
          tags: [],
          dateAdded: Date.now(),
          pages: [page]
        });
      }
      await initiateImport(newSheets);
    }
    if (e.target) e.target.value = '';
  };

  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = (Array.from(e.target.files) as File[]).filter(f => !f.name.startsWith('.'));
      if (files.length === 0) return;
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      const pathParts = files[0].webkitRelativePath.split('/');
      const sheetName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "Imported Folder";
      const pages: SheetPage[] = files.map(f => ({ blob: f, fileType: f.type as any }));
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

  const handleDeleteClick = (e: React.MouseEvent, sheet: Sheet) => {
    e.stopPropagation();
    e.preventDefault();
    const affected = setlists
        .filter(list => list.sheetIds.includes(sheet.id))
        .map(list => list.name);
    setDeleteModal({ isOpen: true, sheet, affectedSetlists: affected });
  };

  const confirmDelete = async () => {
      if (deleteModal.sheet) {
          await storage.deleteSheet(deleteModal.sheet.id);
          setDeleteModal({ isOpen: false, sheet: null, affectedSetlists: [] });
          onRefresh();
      }
  };

  const openEditModal = (e: React.MouseEvent, sheet: Sheet) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingSheet(sheet);
    setEditName(sheet.name);
    setEditTags(sheet.tags || []);
    setEditTagIcons(sheet.tagIcons || {});
    setTagInput('');
    setSelectedIconName('Tag');
  };

  const closeEditModal = () => {
    setEditingSheet(null);
  };

  const handleAddTag = async () => {
    if (tagInput.trim()) {
      const tagName = tagInput.trim();
      if (!editTags.includes(tagName)) setEditTags([...editTags, tagName]);
      const iconName = selectedIconName || 'Tag';
      const newTagDef = { label: tagName, iconName };
      if (!allTags.some(t => t.label === tagName)) {
          setAllTags(prev => [...prev, newTagDef]);
          try {
            await storage.saveTag(newTagDef);
            await loadTags();
          } catch (err) {
            console.error("Failed to save tag", err);
            await loadTags();
          }
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setEditTags(editTags.filter(t => t !== tagToRemove));
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
    if (sheet?.tagIcons?.[tag]) return ICON_MAP[sheet.tagIcons[tag]] || Tag;
    if (editTagIcons[tag]) return ICON_MAP[editTagIcons[tag]] || Tag;
    const def = allTags.find(t => t.label === tag);
    return def ? ICON_MAP[def.iconName] || Tag : Tag;
  };

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
                <button onClick={() => batchInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-lg shadow-lg transition-all active:scale-95 whitespace-nowrap">
                    <LibraryIcon size={20} /> <span className="hidden sm:inline">Batch Import</span>
                </button>
                <div className="flex gap-2 w-full">
                    <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg shadow-lg transition-all active:scale-95 whitespace-nowrap">
                        <Upload size={20} /> <span className="hidden sm:inline">File</span>
                    </button>
                    <button onClick={() => folderInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg shadow-lg transition-all active:scale-95 border border-slate-600 whitespace-nowrap">
                        <FolderUp size={20} /> <span className="hidden sm:inline">Folder (Images)</span>
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
          <Upload size={32} className="text-slate-400 mb-4" />
          <p className="text-lg text-slate-300 font-medium">No sheets yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredSheets.map((sheet) => {
             const fileCount = sheet.pages.length;
             const isPdf = sheet.pages?.[0]?.fileType === 'application/pdf';
             return (
                <div key={sheet.id} onClick={() => onSelect(sheet.id)} className="group relative bg-slate-800 rounded-xl overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all cursor-pointer aspect-[3/4] flex flex-col">
                    <div className="flex-1 bg-slate-900 flex items-center justify-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent z-10" />
                        <div className="flex flex-col items-center gap-2">
                            {isPdf ? <FileText size={48} className="text-slate-600" /> : <Music size={48} className="text-slate-600" />}
                            <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">
                                {fileCount > 1 ? `${fileCount} ${isPdf ? 'Files' : 'Pages'}` : (isPdf ? 'PDF' : 'Image')}
                            </span>
                        </div>
                        <div className="absolute bottom-2 left-2 z-20 flex flex-wrap gap-1 max-w-[90%]">
                            {(sheet.tags || []).slice(0, 4).map(tag => {
                                const Icon = getTagIcon(tag, sheet);
                                return <span key={tag} className="text-[10px] bg-blue-500/20 text-blue-300 p-1 rounded-full border border-blue-500/30"><Icon size={12} /></span>;
                            })}
                        </div>
                    </div>
                    <div className="bg-slate-800 p-3 z-20 border-t border-slate-700/50">
                        <h3 className="text-white font-medium text-sm truncate">{sheet.name}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{new Date(sheet.dateAdded).toLocaleDateString()}</p>
                    </div>
                    <div className="absolute top-2 right-2 flex flex-col gap-2 z-30">
                        <button 
                            onClick={(e) => openEditModal(e, sheet)} 
                            className="p-3 bg-black/80 text-white rounded-full hover:bg-blue-600 active:scale-90 transition-all shadow-xl"
                        >
                            <PenLine size={16} />
                        </button>
                        <button 
                            onClick={(e) => handleDeleteClick(e, sheet)}
                            className="p-3 bg-black/80 text-white rounded-full hover:bg-red-500 active:scale-90 transition-all shadow-xl"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
             );
          })}
        </div>
      )}
      
      {/* Duplicate Conflict Resolution Modal */}
      {conflictData && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
                  <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                      <FileWarning size={32} className="text-amber-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-white text-center mb-2">Duplicate Sheets Found</h2>
                  <p className="text-slate-400 text-center text-sm mb-6 leading-relaxed">
                      The following entries already exist in your library. How would you like to proceed?
                  </p>
                  
                  <div className="max-h-48 overflow-y-auto mb-8 pr-2 space-y-2 no-scrollbar">
                      {conflictData.duplicates.map(d => (
                          <div key={d.id} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                              <FileText size={16} className="text-slate-500" />
                              <span className="text-sm font-medium text-white truncate flex-1">{d.name}</span>
                              <span className="text-[10px] font-black uppercase tracking-tighter text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">Conflict</span>
                          </div>
                      ))}
                  </div>

                  <div className="flex flex-col gap-3">
                      <button 
                        onClick={() => finalizeImport(conflictData.newSheets, true, conflictData.successMessage)} 
                        className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-500 transition-all font-bold shadow-lg shadow-blue-900/20"
                      >
                          <RefreshCw size={20} /> Overwrite Existing
                      </button>
                      <button 
                        onClick={() => finalizeImport(conflictData.newSheets, false, conflictData.successMessage)} 
                        className="w-full flex items-center justify-center gap-2 py-4 bg-slate-800 text-white rounded-2xl hover:bg-slate-700 transition-all font-bold"
                      >
                          <Copy size={20} /> Keep Both (Create Duplicates)
                      </button>
                      <button 
                        onClick={() => setConflictData(null)} 
                        className="w-full py-3 text-slate-500 hover:text-white transition-colors text-sm font-medium"
                      >
                          Cancel Import
                      </button>
                  </div>
              </div>
          </div>
      )}

      {deleteModal.isOpen && deleteModal.sheet && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setDeleteModal({ isOpen: false, sheet: null, affectedSetlists: [] })}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-8 text-center">
                <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-white mb-2">Delete "{deleteModal.sheet.name}"?</h2>
                <p className="text-slate-400 text-sm">This will permanently remove the sheet and its annotations from your device.</p>
            </div>
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex gap-3 rounded-b-2xl">
                <button onClick={() => setDeleteModal({ isOpen: false, sheet: null, affectedSetlists: [] })} className="flex-1 px-4 py-3 bg-slate-800 text-white rounded-lg font-medium">Cancel</button>
                <button onClick={confirmDelete} className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-500">Delete Forever</button>
            </div>
          </div>
        </div>
      )}

      {editingSheet && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={closeEditModal}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <h2 className="text-xl font-bold text-white">Edit Sheet Details</h2>
                <button onClick={closeEditModal} className="text-slate-400 hover:text-white"><X /></button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto no-scrollbar">
                <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Sheet Name</label>
                    <input type="text" className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" value={editName} onChange={e => setEditName(e.target.value)} />
                </div>
                <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Tags & Icons</label>
                    <div className="flex flex-wrap gap-2 mb-4">
                        {editTags.map(tag => (
                            <span key={tag} className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 text-blue-300 border border-blue-500/30 rounded-full text-sm">
                                {React.createElement(getTagIcon(tag), { size: 14 })}
                                {tag} <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-400 transition-colors p-0.5"><X size={14}/></button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input type="text" className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 text-white" placeholder="Type new tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTag()} />
                        <button onClick={handleAddTag} className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500"><Plus size={20} /></button>
                    </div>
                </div>
            </div>
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex gap-3 rounded-b-2xl">
                <button onClick={closeEditModal} className="flex-1 px-4 py-3 bg-slate-800 text-white rounded-lg font-medium">Cancel</button>
                <button onClick={saveEdits} className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Library;
