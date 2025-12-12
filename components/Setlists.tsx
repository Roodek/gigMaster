import React, { useState, useMemo, useRef } from 'react';
import { Plus, ListMusic, Trash2, Play, MoveVertical, X, Check, Pencil, GripVertical, Search, Import, FileWarning, AlertTriangle, Copy, Save } from 'lucide-react';
import { Setlist, Sheet } from '../types';
import { storage } from '../services/storage';
import { processBatchImport } from '../utils/fileProcessor';

interface SetlistsProps {
  setlists: Setlist[];
  sheets: Sheet[];
  onRefresh: () => void;
  onPlay: (setlist: Setlist) => void;
}

interface DeleteModalState {
    isOpen: boolean;
    setlist: Setlist | null;
}

interface ConflictState {
    newSheets: Sheet[];
    duplicates: Sheet[];
    setlistName?: string;
}

interface ErrorModalState {
    isOpen: boolean;
    message: string;
}

const Setlists: React.FC<SetlistsProps> = ({ setlists, sheets, onRefresh, onPlay }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newSetName, setNewSetName] = useState('');
  const [selectedSheetIds, setSelectedSheetIds] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  
  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ isOpen: false, setlist: null });
  
  // Import Conflict Modal State
  const [conflictData, setConflictData] = useState<ConflictState | null>(null);
  
  // Error Modal State
  const [errorModal, setErrorModal] = useState<ErrorModalState>({ isOpen: false, message: '' });

  const importInputRef = useRef<HTMLInputElement>(null);

  // Search States
  const [listSearch, setListSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  
  const startCreate = () => {
    setEditingId(null);
    setNewSetName('');
    setSelectedSheetIds([]);
    setLibrarySearch('');
    setIsEditing(true);
  };

  const startEdit = (setlist: Setlist) => {
    setEditingId(setlist.id);
    setNewSetName(setlist.name);
    setSelectedSheetIds([...setlist.sheetIds]);
    setLibrarySearch('');
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!newSetName.trim()) return;
    
    const existingSetlist = editingId ? setlists.find(s => s.id === editingId) : null;
    
    const setlist: Setlist = {
      id: editingId || crypto.randomUUID(),
      name: newSetName,
      sheetIds: selectedSheetIds,
      dateCreated: existingSetlist ? existingSetlist.dateCreated : Date.now(),
    };
    
    await storage.saveSetlist(setlist);
    closeEditor();
    onRefresh();
  };

  const closeEditor = () => {
    setIsEditing(false);
    setEditingId(null);
    setNewSetName('');
    setSelectedSheetIds([]);
  };

  // Toggle selection: append to end if adding, remove if existing
  const toggleSelection = (id: string) => {
    setSelectedSheetIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  // DnD Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    // Required for Firefox
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newIds = [...selectedSheetIds];
    const [removed] = newIds.splice(draggedIndex, 1);
    newIds.splice(targetIndex, 0, removed);
    
    setSelectedSheetIds(newIds);
    setDraggedIndex(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, setlist: Setlist) => {
    e.stopPropagation();
    setDeleteModal({ isOpen: true, setlist: setlist });
  };

  const confirmDelete = async () => {
      if (deleteModal.setlist) {
          await storage.deleteSetlist(deleteModal.setlist.id);
          setDeleteModal({ isOpen: false, setlist: null });
          onRefresh();
      }
  };

  // Step 1: Initiate Import
  const handleImportSetlist = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const result = await processBatchImport(e.target.files);
        if (result.error) {
            setErrorModal({ isOpen: true, message: result.error });
            if (e.target) e.target.value = '';
            return;
        }

        if (result.sheets.length > 0) {
            // Check for duplicates in library by fetching fresh state
            const currentSheets = await storage.getAllSheets();
            
            const duplicates = result.sheets.filter(newSheet => 
                currentSheets.some(existing => existing.name.trim().toLowerCase() === newSheet.name.trim().toLowerCase())
            );

            if (duplicates.length > 0) {
                setConflictData({ newSheets: result.sheets, duplicates, setlistName: result.setlistName });
            } else {
                await finalizeSetlistImport(result.sheets, false, result.setlistName);
            }
        } else {
            alert("No valid files found for import.");
        }
    }
    if (e.target) e.target.value = '';
  };

  // Step 2: Finalize Import
  const finalizeSetlistImport = async (newSheets: Sheet[], overwrite: boolean, setlistName?: string) => {
        const currentSheets = await storage.getAllSheets();
        
        // Prepare sheets for saving, handling overwrites
        const sheetsToSave = newSheets.map(sheet => {
            const existing = currentSheets.find(s => s.name.trim().toLowerCase() === sheet.name.trim().toLowerCase());
            if (existing && overwrite) {
                // Reuse existing ID to overwrite content but keep metadata
                return {
                    ...sheet,
                    id: existing.id,
                    tags: existing.tags,
                    tagIcons: existing.tagIcons,
                    dateAdded: Date.now()
                };
            }
            return sheet;
        });

        // Save all sheets
        for (const sheet of sheetsToSave) {
            await storage.addSheet(sheet);
        }

        // Create Setlist
        // Sort sheets alphabetically for the setlist
        const sortedSheets = [...sheetsToSave].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        const sortedIds = sortedSheets.map(s => s.id);

        const name = setlistName || "Imported Setlist";
        
        const newSetlist: Setlist = {
            id: crypto.randomUUID(),
            name: name,
            sheetIds: sortedIds,
            dateCreated: Date.now()
        };
        
        await storage.saveSetlist(newSetlist);
        
        setConflictData(null);
        setTimeout(() => alert(`Imported ${sheetsToSave.length} sheets and created setlist "${name}".`), 100);
        onRefresh();
  };

  const filteredSetlists = useMemo(() => {
    const q = listSearch.toLowerCase();
    return setlists.filter(l => l.name.toLowerCase().includes(q));
  }, [setlists, listSearch]);

  const filteredLibrary = useMemo(() => {
    const q = librarySearch.toLowerCase();
    return sheets.filter(s => 
        s.name.toLowerCase().includes(q) || 
        (s.tags && s.tags.some(t => t.toLowerCase().includes(q)))
    );
  }, [sheets, librarySearch]);

  if (isEditing) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
           <h2 className="text-2xl font-bold text-white">{editingId ? 'Edit Setlist' : 'New Setlist'}</h2>
           <div className="flex gap-2">
             <button onClick={closeEditor} className="p-2 text-slate-400 hover:text-white"><X /></button>
             <button 
                onClick={handleSave} 
                disabled={!newSetName || selectedSheetIds.length === 0}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg"
             >
                <Check size={18} />
                <span>Save</span>
             </button>
           </div>
        </div>

        <input 
          type="text" 
          placeholder="Setlist Name (e.g., Wedding Gig)"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white mb-6 focus:ring-2 focus:ring-blue-500 outline-none"
          value={newSetName}
          onChange={e => setNewSetName(e.target.value)}
        />

        <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
            {/* Library Selection */}
            <div className="flex-1 overflow-hidden flex flex-col bg-slate-800/50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Library (Tap to add)</h3>
                
                {/* Library Filter */}
                <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                    <input 
                        type="text" 
                        placeholder="Filter library..." 
                        className="w-full bg-slate-900 border border-slate-700 rounded-md pl-9 pr-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                        value={librarySearch}
                        onChange={(e) => setLibrarySearch(e.target.value)}
                    />
                </div>

                <div className="overflow-y-auto space-y-2 flex-1">
                    {filteredLibrary.map(sheet => {
                        const isSelected = selectedSheetIds.includes(sheet.id);
                        return (
                            <div 
                                key={sheet.id}
                                onClick={() => !isSelected && toggleSelection(sheet.id)}
                                className={`flex items-center p-3 rounded-lg border transition-all ${isSelected ? 'opacity-50 cursor-not-allowed border-slate-700' : 'cursor-pointer bg-slate-800 border-transparent hover:bg-slate-700'}`}
                            >
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 text-xs font-bold shrink-0 ${isSelected ? 'bg-slate-600 text-slate-400' : 'bg-blue-600 text-white'}`}>
                                    {isSelected ? <Check size={12}/> : <Plus size={12} />}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-slate-200 truncate text-sm">{sheet.name}</div>
                                    {sheet.tags && sheet.tags.length > 0 && (
                                        <div className="flex gap-1 mt-1">
                                            {sheet.tags.slice(0,2).map(t => <span key={t} className="text-[10px] bg-slate-700 px-1 rounded text-slate-400">{t}</span>)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {filteredLibrary.length === 0 && (
                        <div className="text-center text-slate-500 text-sm py-4">No matching sheets</div>
                    )}
                </div>
            </div>

            {/* Selected Order with DnD */}
            <div className="flex-1 overflow-y-auto min-h-0 bg-slate-800/50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Selected Order (Drag to reorder)</h3>
                {selectedSheetIds.length === 0 ? (
                    <div className="text-slate-500 text-center py-8 italic">No sheets selected</div>
                ) : (
                    <div className="space-y-2">
                        {selectedSheetIds.map((id, index) => {
                            const sheet = sheets.find(s => s.id === id);
                            if (!sheet) return null;
                            const isDragging = draggedIndex === index;
                            return (
                                <div 
                                    key={`${id}-${index}`} 
                                    draggable="true"
                                    onDragStart={(e) => handleDragStart(e, index)}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDrop={(e) => handleDrop(e, index)}
                                    onDragEnd={() => setDraggedIndex(null)}
                                    className={`flex items-center bg-slate-800 p-2 rounded-lg border transition-all ${isDragging ? 'opacity-50 border-blue-500 bg-slate-700' : 'border-slate-700'}`}
                                >
                                    <div className="p-2 text-slate-500 cursor-grab active:cursor-grabbing">
                                        <GripVertical size={20} />
                                    </div>
                                    <span className="w-6 text-center text-slate-500 font-mono text-sm">{index + 1}</span>
                                    <span className="flex-1 truncate mx-2">{sheet.name}</span>
                                    
                                    <button 
                                        onClick={() => toggleSelection(id)}
                                        className="p-2 text-red-400 hover:bg-red-500/20 rounded ml-1"
                                        title="Remove"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 pb-24">
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 gap-4">
        <div>
           <h1 className="text-3xl font-bold text-white mb-1">Setlists</h1>
           <p className="text-slate-400 text-sm">Organize your repertoire</p>
        </div>
        <div className="flex gap-3 items-start">
            <div className="relative md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                    type="text" 
                    placeholder="Search setlists..." 
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                />
            </div>
            
            <div className="flex flex-col gap-2">
                <button 
                    onClick={() => importInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-lg shadow-lg active:scale-95 transition-all whitespace-nowrap"
                    title="Import a folder as a setlist (Batch Import + Auto Create Setlist)"
                >
                    <Import size={20} />
                    <span className="hidden sm:inline">Import Setlist</span>
                </button>
                
                <button 
                    onClick={startCreate}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg shadow-lg active:scale-95 transition-all whitespace-nowrap"
                >
                    <Plus size={20} />
                    <span className="hidden sm:inline">New Setlist</span>
                </button>
            </div>
            
            <input 
                type="file" 
                ref={importInputRef} 
                className="hidden" 
                // @ts-ignore
                webkitdirectory="" 
                directory="" 
                multiple 
                onChange={handleImportSetlist} 
            />
        </div>
      </div>

      {setlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-700 rounded-2xl bg-slate-800/30">
          <div className="bg-slate-800 p-4 rounded-full mb-4">
             <ListMusic size={32} className="text-slate-400" />
          </div>
          <p className="text-lg text-slate-300 font-medium">No setlists yet</p>
          <p className="text-slate-500 text-sm mt-1">Create one or import a folder</p>
        </div>
      ) : filteredSetlists.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
            <p>No setlists found matching "{listSearch}"</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSetlists.map((list) => (
            <div key={list.id} className="bg-slate-800 rounded-xl p-4 flex items-center justify-between group hover:bg-slate-750 transition-colors">
               <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={() => onPlay(list)}>
                  <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center text-slate-400">
                     <ListMusic size={24} />
                  </div>
                  <div>
                      <h3 className="text-lg font-medium text-white">{list.name}</h3>
                      <p className="text-sm text-slate-400">{list.sheetIds.length} pieces</p>
                  </div>
               </div>

               <div className="flex items-center gap-2">
                   <button 
                     onClick={() => onPlay(list)}
                     className="p-3 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors shadow-lg shadow-green-900/20"
                     title="Start Performance"
                   >
                       <Play size={20} fill="currentColor" />
                   </button>
                   <div className="w-px h-8 bg-slate-700 mx-2" />
                   <button 
                      onClick={() => startEdit(list)}
                      className="p-2 text-slate-400 hover:text-blue-400 transition-colors bg-slate-900/50 rounded-lg hover:bg-slate-900"
                      title="Edit Setlist"
                    >
                       <Pencil size={18} />
                   </button>
                   <button 
                      onClick={(e) => handleDeleteClick(e, list)}
                      className="p-2 text-slate-400 hover:text-red-400 transition-colors bg-slate-900/50 rounded-lg hover:bg-slate-900"
                      title="Delete Setlist"
                    >
                       <Trash2 size={18} />
                   </button>
               </div>
            </div>
          ))}
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
                          {conflictData.duplicates.length} of the sheets in this setlist match existing sheets in your library.
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
                          "Overwrite" will update existing sheets but keep metadata. "Keep Both" will create duplicates. Both options will include these sheets in the new setlist.
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
                          onClick={() => finalizeSetlistImport(conflictData.newSheets, false, conflictData.setlistName)}
                          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors"
                      >
                          <div className="flex items-center justify-center gap-2">
                             <Copy size={16} />
                             <span>Keep Both</span>
                          </div>
                      </button>
                      <button 
                          onClick={() => finalizeSetlistImport(conflictData.newSheets, true, conflictData.setlistName)}
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

      {/* Delete Modal */}
      {deleteModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setDeleteModal({ isOpen: false, setlist: null })}>
              <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                  <div className="flex flex-col items-center text-center mb-6">
                      <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center text-red-500 mb-4">
                          <Trash2 size={32} />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">Delete Setlist?</h3>
                      <p className="text-slate-400 text-sm">
                          Are you sure you want to delete <span className="font-bold text-white">"{deleteModal.setlist?.name}"</span>?
                          This action cannot be undone. Note: Sheets in the library will NOT be deleted.
                      </p>
                  </div>

                  <div className="flex gap-3">
                      <button 
                          onClick={() => setDeleteModal({ isOpen: false, setlist: null })}
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
    </div>
  );
};

export default Setlists;