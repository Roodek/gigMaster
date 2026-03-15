
import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AppView, Sheet, Setlist, ViewerState } from './types';
import { storage } from './services/storage';
import { Music, ListMusic, Settings, HelpCircle, X, FileText, FolderUp, PenTool, Zap, Keyboard, MousePointerClick, Library as LibraryIcon, Layers, AlertTriangle } from 'lucide-react';
import Library from './components/Library';
import Setlists from './components/Setlists';
import Viewer from './components/Viewer';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.LIBRARY);
  // Track previous view to return to after closing viewer
  const [previousView, setPreviousView] = useState<AppView>(AppView.LIBRARY);
  
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [viewerState, setViewerState] = useState<ViewerState | null>(null);
  const [navigationDirection, setNavigationDirection] = useState<'forward' | 'backward'>('forward');
  const [showHelp, setShowHelp] = useState(false);

  const loadData = useCallback(async () => {
    try {
      await storage.init();
      const loadedSheets = await storage.getAllSheets();
      const loadedSetlists = await storage.getAllSetlists();
      setSheets(loadedSheets.sort((a, b) => b.dateAdded - a.dateAdded));
      setSetlists(loadedSetlists.sort((a, b) => b.dateCreated - a.dateCreated));
    } catch (error) {
      console.error("Failed to load data", error);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Navigation Logic
  const openViewer = (sheetId: string) => {
    setPreviousView(AppView.LIBRARY);
    setNavigationDirection('forward');
    setViewerState({
      activeSetlistId: null,
      queue: [sheetId],
      currentIndex: 0
    });
    setView(AppView.VIEWER);
  };

  const playSetlist = (setlist: Setlist) => {
    if (setlist.sheetIds.length === 0) return;
    setPreviousView(AppView.SETLISTS);
    setNavigationDirection('forward');
    setViewerState({
      activeSetlistId: setlist.id,
      queue: setlist.sheetIds,
      currentIndex: 0
    });
    setView(AppView.VIEWER);
  };

  const handleNext = () => {
    if (!viewerState) return;
    if (viewerState.currentIndex < viewerState.queue.length - 1) {
      setNavigationDirection('forward');
      setViewerState({ ...viewerState, currentIndex: viewerState.currentIndex + 1 });
    }
  };

  const handlePrev = () => {
    if (!viewerState) return;
    if (viewerState.currentIndex > 0) {
      setNavigationDirection('backward');
      setViewerState({ ...viewerState, currentIndex: viewerState.currentIndex - 1 });
    }
  };

  const handleJumpTo = (index: number) => {
    if (!viewerState) return;
    if (index >= 0 && index < viewerState.queue.length) {
        setNavigationDirection('forward'); // Jumping usually implies starting from beginning
        setViewerState({ ...viewerState, currentIndex: index });
    }
  };

  const closeViewer = () => {
    setViewerState(null);
    setView(previousView);
  };

  // Get current sheet title for viewer
  const getCurrentSheetTitle = () => {
    if (!viewerState) return '';
    const currentId = viewerState.queue[viewerState.currentIndex];
    const sheet = sheets.find(s => s.id === currentId);
    return sheet ? sheet.name : 'Unknown';
  };

  if (view === AppView.VIEWER && viewerState) {
    const currentSheetId = viewerState.queue[viewerState.currentIndex];
    
    // Prepare queue data for the Viewer's dropdown
    const queueData = viewerState.queue.map(id => {
        const s = sheets.find(sheet => sheet.id === id);
        return { id, name: s ? s.name : 'Unknown Sheet' };
    });

    return (
      <Viewer 
        key={currentSheetId} // CRITICAL: Reset internal state when changing pieces
        sheetId={currentSheetId}
        title={getCurrentSheetTitle()}
        onClose={closeViewer}
        onNext={handleNext}
        onPrev={handlePrev}
        hasNext={viewerState.currentIndex < viewerState.queue.length - 1}
        hasPrev={viewerState.currentIndex > 0}
        queue={queueData}
        currentQueueIndex={viewerState.currentIndex}
        onJumpTo={handleJumpTo}
        initialDirection={navigationDirection}
      />
    );
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Sidebar Navigation */}
      <nav className="w-20 md:w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between z-10">
        <div>
          <div className="p-6 flex items-center gap-3">
             <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-purple-500 rounded-lg flex items-center justify-center shrink-0">
               <Music size={18} className="text-white" />
             </div>
             <span className="font-bold text-xl hidden md:block tracking-tight">GigMaster</span>
          </div>
          
          <div className="mt-6 px-3 space-y-2">
            <button 
              onClick={() => setView(AppView.LIBRARY)}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all ${view === AppView.LIBRARY ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}
            >
              <LibraryIcon size={22} />
              <span className="font-medium hidden md:block">Library</span>
            </button>
            <button 
              onClick={() => setView(AppView.SETLISTS)}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all ${view === AppView.SETLISTS ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}
            >
              <ListMusic size={22} />
              <span className="font-medium hidden md:block">Setlists</span>
            </button>
          </div>
        </div>

        <div className="p-6 border-t border-slate-800 flex flex-col gap-4">
           <button 
             onClick={() => setShowHelp(true)} 
             className="flex items-center gap-4 text-slate-400 hover:text-white transition-colors group w-full"
             title="App Instructions"
           >
             <HelpCircle size={22} className="group-hover:text-blue-400 transition-colors" />
             <span className="text-sm font-medium hidden md:block group-hover:text-blue-100">Help & Guide</span>
           </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto no-scrollbar relative bg-gradient-to-br from-slate-900 to-slate-800">
        {view === AppView.LIBRARY && (
          <Library 
            sheets={sheets}
            setlists={setlists}
            onImport={() => {}} // Handled inside component
            onRefresh={loadData}
            onSelect={openViewer}
          />
        )}
        {view === AppView.SETLISTS && (
          <Setlists 
            setlists={setlists}
            sheets={sheets}
            onRefresh={loadData}
            onPlay={playSetlist}
          />
        )}
      </main>

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setShowHelp(false)}>
           <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                 <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-900/50">
                      <HelpCircle size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">User Guide</h2>
                        <p className="text-sm text-slate-400">How to use GigMaster</p>
                    </div>
                 </div>
                 <button onClick={() => setShowHelp(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                    <X size={24} />
                 </button>
              </div>
              
              <div className="overflow-y-auto p-6 space-y-8 text-slate-300">
                 
                 {/* Section: Importing */}
                 <section>
                    <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                        <FileText className="text-blue-400" size={20} />
                        Importing & File Structures
                    </h3>
                    <div className="space-y-4 pl-2 border-l-2 border-slate-800">
                        <div>
                            <h4 className="text-sm font-bold text-slate-200 mb-1">Supported Formats</h4>
                            <p className="text-sm text-slate-400">PDF, PNG, and JPEG.</p>
                        </div>
                        
                        <div>
                            <h4 className="text-sm font-bold text-slate-200 mb-1">Batch Import Structure</h4>
                            <p className="text-sm text-slate-400 mb-2">When importing a folder for setlists or batch libraries, use this structure:</p>
                            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-slate-300">
                                MySetlist/ <span className="text-slate-500">// Root Folder</span><br/>
                                ├── Song_A.pdf <span className="text-green-400">// Single Sheet</span><br/>
                                ├── Song_B.jpg <span className="text-green-400">// Single Sheet</span><br/>
                                └── Song_C/ <span className="text-blue-400">// Multi-file Sheet</span><br/>
                                &nbsp;&nbsp;&nbsp;&nbsp;├── page1.png<br/>
                                &nbsp;&nbsp;&nbsp;&nbsp;└── page2.png
                            </div>
                            <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                                <AlertTriangle size={12} /> Nested folders deeper than this are not supported.
                            </p>
                        </div>

                        <div>
                            <h4 className="text-sm font-bold text-slate-200 mb-1">Duplicate Handling</h4>
                            <p className="text-sm text-slate-400">If a sheet with the same name already exists:</p>
                            <ul className="list-disc list-inside text-sm text-slate-400 mt-1">
                                <li><span className="text-yellow-400 font-bold">Overwrite:</span> Updates the file content but preserves your tags, annotations, and setlists.</li>
                                <li><span className="text-blue-400 font-bold">Keep Both:</span> Creates a duplicate copy with the same name.</li>
                            </ul>
                        </div>
                    </div>
                 </section>

                 {/* Section: Viewer & Navigation */}
                 <section>
                    <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                        <MousePointerClick className="text-purple-400" size={20} />
                        Viewer & Navigation
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <h4 className="font-bold text-white text-sm mb-1 flex items-center gap-2">
                                <Keyboard size={14} /> Bluetooth Pedals
                            </h4>
                            <p className="text-xs text-slate-400">
                                Connect your bluetooth page turner. Compatible with standard <span className="text-white">Arrow Keys, Spacebar, and Enter</span>.
                            </p>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <h4 className="font-bold text-white text-sm mb-1 flex items-center gap-2">
                                <MousePointerClick size={14} /> Touch Controls
                            </h4>
                            <p className="text-xs text-slate-400">
                                Tap the <span className="text-white">Left 20%</span> of the screen to go back, <span className="text-white">Right 20%</span> to go forward. Tap <span className="text-white">Center</span> to show/hide controls.
                            </p>
                        </div>
                    </div>
                 </section>

                 {/* Section: Annotations */}
                 <section>
                    <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                        <PenTool className="text-pink-400" size={20} />
                        Annotations
                    </h3>
                    <p className="text-sm mb-2">
                        Enter annotation mode by tapping the <span className="inline-flex items-center justify-center bg-blue-600 text-white w-5 h-5 rounded-full mx-1"><PenTool size={10} /></span> icon in the viewer.
                    </p>
                    <ul className="list-disc list-inside text-sm text-slate-400 space-y-1 ml-1">
                        <li>Draw with various colors and line widths.</li>
                        <li>Use the eraser to remove strokes.</li>
                        <li>Annotations are automatically saved for each sheet.</li>
                    </ul>
                 </section>

                 {/* Section: Setlists */}
                 <section>
                    <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                        <ListMusic className="text-green-400" size={20} />
                        Setlists
                    </h3>
                    <p className="text-sm">
                        Create setlists to organize your repertoire for performance. You can drag and drop to reorder pieces.
                        When playing a setlist, turning the page at the end of a piece will automatically load the next one in the queue.
                    </p>
                 </section>

              </div>
              
              <div className="p-4 bg-slate-950 border-t border-slate-800 text-center">
                  <p className="text-xs text-slate-500">GigMaster works completely offline. Your library is stored in your browser.</p>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
