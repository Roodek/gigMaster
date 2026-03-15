
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, ListMusic, Trash2, Play, X, Check, Pencil, GripVertical, Search, Import, AlertTriangle, FileWarning, RefreshCw, Copy, FileText } from 'lucide-react';
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

const Setlists: React.FC<SetlistsProps> = ({ setlists, sheets, onRefresh, onPlay }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newSetName, setNewSetName] = useState('');
  const [selectedSheetIds, setSelectedSheetIds] = useState<string[]>([]);
  
  // DRAG STATE
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const startPointerY = useRef(0);
  const itemHeights = useRef<number[]>([]);
  const containerRect = useRef<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ isOpen: false, setlist: null });
  const [conflictData, setConflictData] = useState<ConflictState | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [listSearch, setListSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  
  const startCreate = () => {
    setEditingId(null);
    setNewSetName('');
    setSelectedSheetIds([]);
    setIsEditing(true);
  };

  const startEdit = (setlist: Setlist) => {
    setEditingId(setlist.id);
    setNewSetName(setlist.name);
    setSelectedSheetIds([...setlist.sheetIds]);
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
    setIsEditing(false);
    onRefresh();
  };

  const toggleSelection = (id: string) => {
    setSelectedSheetIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  // --- REORDERING LOGIC ---

  const handlePointerDown = (e: React.PointerEvent, index: number) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    
    if (containerRef.current) {
        containerRect.current = containerRef.current.getBoundingClientRect();
        const children = Array.from(containerRef.current.children);
        // Fix: Cast child to HTMLElement to avoid 'unknown' type error in getBoundingClientRect call
        itemHeights.current = children.map(child => (child as HTMLElement).getBoundingClientRect().height + 8); 
    }
    
    startPointerY.current = e.clientY;
    setDraggedIndex(index);
    setHoverIndex(index);
    setDragOffset(0);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggedIndex === null || !containerRect.current) return;
    
    const currentY = e.clientY;
    const deltaY = currentY - startPointerY.current;
    setDragOffset(deltaY);

    const relativeY = currentY - containerRect.current.top + (containerRef.current?.scrollTop || 0);
    
    let currentTotalHeight = 0;
    let newHoverIndex = 0;
    
    for (let i = 0; i < itemHeights.current.length; i++) {
        const h = itemHeights.current[i];
        if (relativeY > currentTotalHeight + h / 2) {
            newHoverIndex = i;
        }
        currentTotalHeight += h;
    }
    
    const clampedIndex = Math.max(0, Math.min(newHoverIndex, selectedSheetIds.length - 1));
    if (clampedIndex !== hoverIndex) {
        setHoverIndex(clampedIndex);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggedIndex !== null && hoverIndex !== null && draggedIndex !== hoverIndex) {
        const newIds = [...selectedSheetIds];
        const [removed] = newIds.splice(draggedIndex, 1);
        newIds.splice(hoverIndex, 0, removed);
        setSelectedSheetIds(newIds);
    }
    
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
    }
    setDraggedIndex(null);
    setHoverIndex(null);
    setDragOffset(0);
  };

  const getItemStyle = (index: number) => {
    if (draggedIndex === null || hoverIndex === null) return {};

    if (index === draggedIndex) {
        return {
            transform: `translateY(${dragOffset}px) scale(1.03)`,
            zIndex: 50,
            boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.8)',
            borderColor: '#3b82f6', 
            backgroundColor: '#1e293b', 
            transition: 'none',
        };
    }

    let shift = 0;
    const height = itemHeights.current[draggedIndex] || 64;

    if (draggedIndex < hoverIndex) {
        if (index > draggedIndex && index <= hoverIndex) shift = -height;
    } else if (draggedIndex > hoverIndex) {
        if (index < draggedIndex && index >= hoverIndex) shift = height;
    }

    return {
        transform: `translateY(${shift}px)`,
        transition: 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
    };
  };

  const handleDeleteClick = (e: React.MouseEvent, setlist: Setlist) => {
    e.stopPropagation();
    setDeleteModal({ isOpen: true, setlist });
  };

  const confirmDelete = async () => {
      if (deleteModal.setlist) {
          await storage.deleteSetlist(deleteModal.setlist.id);
          setDeleteModal({ isOpen: false, setlist: null });
          onRefresh();
      }
  };

  const handleImportSetlist = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const result = await processBatchImport(e.target.files);
        if (result.sheets.length > 0) {
            const currentSheets = await storage.getAllSheets();
            const duplicates = result.sheets.filter(newSheet => 
                currentSheets.some(existing => existing.name.trim().toLowerCase() === newSheet.name.trim().toLowerCase())
            );

            if (duplicates.length > 0) {
                setConflictData({ 
                    newSheets: result.sheets, 
                    duplicates, 
                    setlistName: result.setlistName 
                });
            } else {
                await finalizeSetlistImport(result.sheets, false, result.setlistName);
            }
        } else if (result.error) {
            alert(result.error);
        }
    }
    if (e.target) e.target.value = '';
  };

  const finalizeSetlistImport = async (newSheets: Sheet[], overwrite: boolean, setlistName?: string) => {
      const currentSheets = await storage.getAllSheets();
      const finalSheetIds: string[] = [];

      for (const sheet of newSheets) {
          const existing = currentSheets.find(s => s.name.trim().toLowerCase() === sheet.name.trim().toLowerCase());
          let sheetToSave = sheet;
          
          if (existing && overwrite) {
              sheetToSave = {
                  ...sheet,
                  id: existing.id, 
                  tags: existing.tags,
                  tagIcons: existing.tagIcons,
                  dateAdded: Date.now()
              };
          }
          await storage.addSheet(sheetToSave);
          finalSheetIds.push(sheetToSave.id);
      }

      finalSheetIds.sort((a, b) => {
          const sA = newSheets.find(s => s.id === a || (overwrite && s.name === currentSheets.find(ex => ex.id === a)?.name));
          const sB = newSheets.find(s => s.id === b || (overwrite && s.name === currentSheets.find(ex => ex.id === b)?.name));
          return (sA?.name || '').localeCompare(sB?.name || '', undefined, { numeric: true });
      });

      const newSetlist: Setlist = {
          id: crypto.randomUUID(),
          name: setlistName || "Imported Setlist",
          sheetIds: finalSheetIds,
          dateCreated: Date.now()
      };
      
      await storage.saveSetlist(newSetlist);
      setConflictData(null);
      onRefresh();
  };

  const filteredSetlists = useMemo(() => {
    const q = listSearch.toLowerCase();
    return setlists.filter(l => l.name.toLowerCase().includes(q));
  }, [setlists, listSearch]);

  const filteredLibrary = useMemo(() => {
    const q = librarySearch.toLowerCase();
    return sheets.filter(s => s.name.toLowerCase().includes(q) || (s.tags && s.tags.some(t => t.toLowerCase().includes(q))));
  }, [sheets, librarySearch]);

  if (isEditing) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
           <h2 className="text-2xl font-bold text-white tracking-tight">{editingId ? 'Edit Setlist' : 'New Setlist'}</h2>
           <div className="flex gap-2">
             <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-slate-400 hover:text-white transition-colors font-medium">Cancel</button>
             <button onClick={handleSave} disabled={!newSetName || selectedSheetIds.length === 0} className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-xl hover:bg-green-500 disabled:opacity-50 transition-all shadow-lg shadow-green-900/20 active:scale-95">
                <Check size={18} /> <span className="font-bold">Save Setlist</span>
             </button>
           </div>
        </div>
        
        <div className="relative mb-6">
            <input 
                type="text" 
                placeholder="Ex: Tonight's Performance, Jazz Set, etc." 
                className="w-full bg-slate-800 border-2 border-slate-700 rounded-xl p-4 text-xl text-white focus:border-blue-500 outline-none transition-colors" 
                value={newSetName} 
                onChange={e => setNewSetName(e.target.value)} 
            />
        </div>

        <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
            <div className="flex-1 overflow-hidden flex flex-col bg-slate-800/40 rounded-2xl p-4 border border-slate-700/50">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4">Add Library Pieces</h3>
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input type="text" placeholder="Search library..." className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-blue-500" value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} />
                </div>
                <div className="overflow-y-auto space-y-2 flex-1 no-scrollbar">
                    {filteredLibrary.map(sheet => {
                        const isSelected = selectedSheetIds.includes(sheet.id);
                        return (
                            <button 
                                key={sheet.id} 
                                onClick={() => !isSelected && toggleSelection(sheet.id)} 
                                className={`w-full flex items-center p-3 rounded-xl border-2 transition-all text-left ${isSelected ? 'opacity-40 border-slate-700 bg-transparent grayscale' : 'cursor-pointer bg-slate-800 border-transparent hover:bg-slate-700 hover:border-blue-500/30'}`}
                            >
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center mr-3 shrink-0 transition-colors ${isSelected ? 'bg-slate-700' : 'bg-blue-600'}`}>
                                    {isSelected ? <Check size={14}/> : <Plus size={14} />}
                                </div>
                                <span className="text-slate-200 text-sm font-medium truncate">{sheet.name}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex-[1.5] overflow-y-auto min-h-0 bg-slate-800/40 rounded-2xl p-4 no-scrollbar border border-slate-700/50">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4">Performance Order</h3>
                {selectedSheetIds.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-500 italic text-sm">
                        <ListMusic size={32} className="mb-2 opacity-20" />
                        Select pieces from the library to build your set
                    </div>
                ) : (
                    <div ref={containerRef} className="space-y-2 select-none relative pb-10">
                        {selectedSheetIds.map((id, index) => {
                            const sheet = sheets.find(s => s.id === id);
                            if (!sheet) return null;
                            const isBeingDragged = draggedIndex === index;
                            return (
                                <div 
                                    key={`${id}-${index}`} 
                                    style={getItemStyle(index)}
                                    className="flex items-center bg-slate-800 p-2 rounded-xl border border-slate-700 relative group"
                                >
                                    <div 
                                        className="p-3 text-slate-500 cursor-grab active:cursor-grabbing touch-none transition-colors hover:text-white"
                                        onPointerDown={(e) => handlePointerDown(e, index)}
                                        onPointerMove={handlePointerMove}
                                        onPointerUp={handlePointerUp}
                                    >
                                        <GripVertical size={20} />
                                    </div>
                                    <div className={`flex items-center flex-1 min-w-0 ${isBeingDragged ? 'pointer-events-none' : ''}`}>
                                        <div className="w-6 h-6 flex items-center justify-center text-[10px] font-black text-slate-600 bg-slate-900 rounded-md shrink-0">
                                            {index + 1}
                                        </div>
                                        <span className="flex-1 truncate mx-3 text-sm font-semibold text-white">{sheet.name}</span>
                                    </div>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); toggleSelection(id); }} 
                                        className={`p-3 text-slate-500 hover:text-red-500 transition-all ${isBeingDragged ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover:opacity-100'}`}
                                    >
                                        <Trash2 size={18} />
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
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 gap-6">
        <div>
            <h1 className="text-4xl font-black text-white mb-2">Setlists</h1>
            <p className="text-slate-400 text-sm">Performance ready repertoire lists</p>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
            <div className="relative group">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
                <input type="text" placeholder="Search sets..." className="bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:border-blue-500 outline-none transition-all w-full md:w-48 lg:w-64" value={listSearch} onChange={(e) => setListSearch(e.target.value)} />
            </div>
            
            <button onClick={() => importInputRef.current?.click()} className="flex items-center gap-2 bg-indigo-600/10 text-indigo-400 border border-indigo-600/20 px-4 py-2 rounded-xl hover:bg-indigo-600 hover:text-white transition-all shadow-lg active:scale-95">
                <Import size={16} />
                <span className="font-bold text-xs">Import Set</span>
            </button>
            
            <button onClick={startCreate} className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/20 active:scale-95">
                <Plus size={18} />
                <span className="font-bold text-xs">Create New</span>
            </button>
            
            <input type="file" ref={importInputRef} className="hidden" 
                // @ts-ignore
                webkitdirectory="" directory="" multiple onChange={handleImportSetlist} 
            />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
          {filteredSetlists.map(list => (
            <div key={list.id} className="bg-slate-800/80 rounded-2xl p-4 sm:p-5 flex items-center justify-between hover:bg-slate-800 hover:shadow-2xl transition-all border border-slate-700/50 group">
               <div className="flex items-center gap-4 sm:gap-5 cursor-pointer flex-1 min-w-0" onClick={() => onPlay(list)}>
                  <div className="p-3 bg-slate-900 rounded-2xl text-slate-500 group-hover:text-blue-400 transition-colors shrink-0"><ListMusic size={24} /></div>
                  <div className="min-w-0">
                      <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors truncate">{list.name}</h3>
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">{list.sheetIds.length} pieces</span>
                          <span className="w-1 h-1 rounded-full bg-slate-700 hidden xs:block" />
                          <span className="text-[10px] text-slate-500 whitespace-nowrap">{new Date(list.dateCreated).toLocaleDateString()}</span>
                      </div>
                  </div>
               </div>
               <div className="flex items-center gap-2 ml-4 shrink-0">
                   <button onClick={() => onPlay(list)} className="p-2 px-3 bg-green-600 text-white rounded-xl hover:bg-green-500 transition-all shadow-lg shadow-green-900/20 active:scale-90 flex items-center gap-1.5 group/play">
                       <Play size={16} fill="currentColor" />
                       <span className="font-black text-[9px] uppercase tracking-widest hidden sm:block">Start Gig</span>
                   </button>
                   <div className="w-px h-6 bg-slate-700 mx-1 hidden md:block" />
                   <button onClick={() => startEdit(list)} className="p-2 text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 rounded-xl transition-all"><Pencil size={16} /></button>
                   <button onClick={(e) => handleDeleteClick(e, list)} className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"><Trash2 size={16} /></button>
               </div>
            </div>
          ))}

          {filteredSetlists.length === 0 && (
              <div className="py-24 text-center">
                  <p className="text-slate-500 font-medium">No setlists found matching "{listSearch}"</p>
              </div>
          )}
      </div>

      {/* Duplicate Conflict Resolution Modal */}
      {conflictData && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
                  <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                      <FileWarning size={32} className="text-amber-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-white text-center mb-2">Duplicate Sheets in Setlist</h2>
                  <p className="text-slate-400 text-center text-sm mb-6 leading-relaxed">
                      The following sheets in your imported setlist already exist in your library.
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
                        onClick={() => finalizeSetlistImport(conflictData.newSheets, true, conflictData.setlistName)} 
                        className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-500 transition-all font-bold shadow-lg shadow-blue-900/20"
                      >
                          <RefreshCw size={20} /> Overwrite Library Content
                      </button>
                      <button 
                        onClick={() => finalizeSetlistImport(conflictData.newSheets, false, conflictData.setlistName)} 
                        className="w-full flex items-center justify-center gap-2 py-4 bg-slate-800 text-white rounded-2xl hover:bg-slate-700 transition-all font-bold"
                      >
                          <Copy size={20} /> Keep Both (New Copies)
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

      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setDeleteModal({ isOpen: false, setlist: null })}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle size={32} className="text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-white text-center mb-2">Delete Setlist?</h2>
            <p className="text-slate-400 text-center text-sm mb-8 px-4 leading-relaxed">This will remove the "{deleteModal.setlist?.name}" playlist. Your library files and annotations are safe.</p>
            <div className="flex gap-3">
                <button onClick={() => setDeleteModal({ isOpen: false, setlist: null })} className="flex-1 py-3.5 bg-slate-800 text-white rounded-2xl hover:bg-slate-700 transition-all font-bold">Cancel</button>
                <button onClick={confirmDelete} className="flex-1 py-3.5 bg-red-600 text-white rounded-2xl hover:bg-red-500 transition-all font-bold shadow-lg shadow-red-900/20">Delete List</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Setlists;
