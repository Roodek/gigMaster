import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, PenTool, Eraser, Undo, X, Settings2, Trash2, ChevronDown, Sliders, List, FileText, GripHorizontal, Palette } from 'lucide-react';
import { Stroke, Point, Sheet } from '../types';
import { storage } from '../services/storage';
import { PAGE_TURN_KEYS, COLORS } from '../constants';
import * as pdfjsLib from 'pdfjs-dist';

// Handle ESM default export structure if present (fixes common issue with cdn imports of pdfjs)
const pdfjs: any = (pdfjsLib as any).default || pdfjsLib;

interface ViewerProps {
  sheetId: string;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  title: string;
  queue?: { id: string; name: string }[];
  currentQueueIndex?: number;
  onJumpTo?: (index: number) => void;
  initialDirection?: 'forward' | 'backward';
}

// Helper: Squared distance between two points
const dist2 = (p1: Point, p2: Point) => (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;

// Helper: Minimum squared distance from point P to segment AB
const distToSegmentSquared = (p: Point, a: Point, b: Point) => {
  const l2 = dist2(a, b);
  if (l2 === 0) return dist2(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
};

// Helper: Convert Hex to RGBA
const hexToRgba = (hex: string, alpha: number) => {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const Viewer: React.FC<ViewerProps> = ({ 
    sheetId, onClose, onNext, onPrev, hasNext, hasPrev, title,
    queue, currentQueueIndex, onJumpTo, initialDirection = 'forward'
}) => {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  
  // Navigation State
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [subPageIndex, setSubPageIndex] = useState(0);
  
  // Current File Metadata
  const [numSubPages, setNumSubPages] = useState(0);
  const [fileType, setFileType] = useState<string>('');

  // UI States
  const [showPageNav, setShowPageNav] = useState(false);
  const [targetPage, setTargetPage] = useState(1);
  const [showQueueMenu, setShowQueueMenu] = useState(false);

  // Content Loading State
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null); // PDFDocumentProxy
  const [loading, setLoading] = useState(true);
  
  const loadDirection = useRef<'forward' | 'backward'>('forward');
  
  // Worker State
  const [workerReady, setWorkerReady] = useState(false);
  
  // Annotation State
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [allStrokes, setAllStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [lineWidth, setLineWidth] = useState(3);
  const [opacity, setOpacity] = useState(1);
  const [showPenSettings, setShowPenSettings] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  // Floating Toolbar State
  const [toolbarPos, setToolbarPos] = useState({ x: 20, y: 100 });
  
  // Refs
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const pageNavRef = useRef<HTMLDivElement>(null);
  const queueMenuRef = useRef<HTMLDivElement>(null);
  
  // Toolbar Drag Refs
  const isDraggingToolbar = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialPos = useRef({ x: 0, y: 0 });
  
  // 0. Initialize Worker safely
  useEffect(() => {
    if (pdfjs.GlobalWorkerOptions.workerSrc) {
        setWorkerReady(true);
        return;
    }
    // Set worker directly to CDN to avoid blob/fetch issues
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    setWorkerReady(true);
  }, []);

  // 1. Load Sheet Data & Annotations
  useEffect(() => {
    let active = true;
    const loadSheet = async () => {
      setLoading(true);
      setPdfDoc(null);
      
      try {
        const loadedSheet = await storage.getSheet(sheetId);
        if (loadedSheet && active) {
            setSheet(loadedSheet);
            
            if (initialDirection === 'backward') {
                setActiveFileIndex(loadedSheet.pages.length - 1);
                loadDirection.current = 'backward';
            } else {
                setActiveFileIndex(0);
                setSubPageIndex(0);
                loadDirection.current = 'forward';
            }

            const storedAnnotations = await storage.getAnnotation(sheetId);
            setAllStrokes(storedAnnotations ? storedAnnotations.strokes : []);
        }
      } catch (err) {
        console.error("Error loading sheet:", err);
        if (active) setLoading(false);
      }
    };
    loadSheet();
    return () => { active = false; };
  }, [sheetId, initialDirection]);

  // 2. Load Content for Current File (Image or PDF)
  useEffect(() => {
    if (!sheet || !sheet.pages || sheet.pages.length === 0) return;
    
    if (activeFileIndex >= sheet.pages.length) {
        setActiveFileIndex(0);
        return;
    }

    const currentPageData = sheet.pages[activeFileIndex];
    const type = currentPageData.fileType;
    setFileType(type);
    
    let active = true;
    setLoading(true);
    setBlobUrl(null);
    setPdfDoc(null);

    const loadContent = async () => {
        if (type === 'application/pdf') {
             if (!workerReady) return; 
             try {
                const arrayBuffer = await currentPageData.blob.arrayBuffer();
                if (!active) return;
                
                const loadingTask = pdfjs.getDocument({
                    data: new Uint8Array(arrayBuffer),
                    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                    cMapPacked: true,
                });

                const doc = await loadingTask.promise;
                if (active) {
                    setPdfDoc(doc);
                    setNumSubPages(doc.numPages);
                    if (loadDirection.current === 'backward') {
                        setSubPageIndex(doc.numPages - 1);
                    } else {
                        setSubPageIndex(0);
                    }
                    setLoading(false);
                }
             } catch (e) {
                 console.error("PDF Load Error", e);
                 if (active) setLoading(false);
             }
        } else {
            const url = URL.createObjectURL(currentPageData.blob);
            if (active) {
                setBlobUrl(url);
                setNumSubPages(1);
                setSubPageIndex(0);
                setLoading(false);
            }
        }
    };

    loadContent();

    return () => {
        active = false;
        if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [sheet, activeFileIndex, workerReady]);

  // 3. Render PDF Page
  useEffect(() => {
    if (fileType !== 'application/pdf' || !pdfDoc || !pdfCanvasRef.current) return;
    let renderTask: any = null;
    const renderPage = async () => {
        try {
            const pageNumber = subPageIndex + 1;
            const page = await pdfDoc.getPage(pageNumber);
            const container = containerRef.current;
            if (!container) return;
            const { clientWidth, clientHeight } = container;
            const unscaledViewport = page.getViewport({ scale: 1 });
            const scaleX = clientWidth / unscaledViewport.width;
            const scaleY = clientHeight / unscaledViewport.height;
            const scale = Math.min(scaleX, scaleY) * 0.98;
            const viewport = page.getViewport({ scale });
            const canvas = pdfCanvasRef.current;
            if (canvas) {
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                const renderContext = {
                    canvasContext: canvas.getContext('2d')!,
                    viewport: viewport,
                };
                renderTask = page.render(renderContext);
                await renderTask.promise;
            }
        } catch (error: any) {
            if (error.name !== 'RenderingCancelledException') {
                console.error("PDF Render Error", error);
            }
        }
    };
    renderPage();
    return () => { if (renderTask) renderTask.cancel(); };
  }, [pdfDoc, subPageIndex, fileType, dimensions]);

  // Sync dimensions
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({ width: clientWidth, height: clientHeight });
      }
    };
    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [loading, blobUrl]);

  // Save Annotations
  useEffect(() => {
    if (!loading && sheet) {
      const timeout = setTimeout(() => {
        storage.saveAnnotation(sheet.id, allStrokes);
      }, 500); 
      return () => clearTimeout(timeout);
    }
  }, [allStrokes, sheet, loading]);

  // Click outside to close navs
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pageNavRef.current && !pageNavRef.current.contains(event.target as Node)) {
        setShowPageNav(false);
      }
      if (queueMenuRef.current && !queueMenuRef.current.contains(event.target as Node)) {
        setShowQueueMenu(false);
      }
      // Note: Pen Settings and Color Picker are now part of the floating toolbar structure,
      // handling click outside for them is done slightly differently or they can stay open until toggled.
      // For simplicity in the floating model, we'll let them toggle.
    };
    if (showPageNav || showQueueMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPageNav, showQueueMenu]);

  // Navigation Handlers
  const handlePageNext = () => {
    if (subPageIndex < numSubPages - 1) {
        setSubPageIndex(prev => prev + 1);
    } else {
        if (sheet && activeFileIndex < sheet.pages.length - 1) {
            loadDirection.current = 'forward';
            setActiveFileIndex(prev => prev + 1);
        } else if (hasNext) {
            onNext();
        }
    }
  };

  const handlePagePrev = () => {
    if (subPageIndex > 0) {
        setSubPageIndex(prev => prev - 1);
    } else {
        if (activeFileIndex > 0) {
            loadDirection.current = 'backward';
            setActiveFileIndex(prev => prev - 1);
        } else if (hasPrev) {
            onPrev();
        }
    }
  };

  const handleJumpToPage = (e: React.FormEvent) => {
      e.preventDefault();
      const p = Math.max(1, Math.min(numSubPages, targetPage));
      setSubPageIndex(p - 1);
      setShowPageNav(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (PAGE_TURN_KEYS.NEXT.includes(e.key)) {
        e.preventDefault();
        handlePageNext();
      } else if (PAGE_TURN_KEYS.PREV.includes(e.key)) {
        e.preventDefault();
        handlePagePrev();
      } else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePageNext, handlePagePrev, onClose]);

  // --- Drawing Logic ---
  
  const getPoint = (e: React.MouseEvent | React.TouchEvent): Point | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else if ('changedTouches' in e && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else if ('clientX' in e) {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    } else {
        return null;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const isStrokeOnCurrentPage = (stroke: Stroke) => {
      let strokeFileIndex = stroke.fileIndex;
      let strokePageIndex = stroke.pageIndex;
      if (strokeFileIndex === undefined) {
          const isSinglePdf = sheet?.pages.length === 1 && sheet.pages[0].fileType === 'application/pdf';
          if (isSinglePdf) {
              strokeFileIndex = 0;
          } else {
              strokeFileIndex = stroke.pageIndex;
              strokePageIndex = 0;
          }
      }
      return strokeFileIndex === activeFileIndex && strokePageIndex === subPageIndex;
  };

  const eraseAt = (point: Point) => {
    const threshold = 200;
    setAllStrokes(prev => prev.filter(stroke => {
      if (!isStrokeOnCurrentPage(stroke)) return true;
      for (let i = 0; i < stroke.points.length - 1; i++) {
        if (distToSegmentSquared(point, stroke.points[i], stroke.points[i + 1]) < threshold) {
          return false;
        }
      }
      return true;
    }));
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingMode) return;
    const point = getPoint(e);
    if (!point) return;

    if (tool === 'eraser') {
      eraseAt(point);
    } else {
      setCurrentStroke({
        points: [point],
        color: hexToRgba(color, opacity),
        width: lineWidth,
        pageIndex: subPageIndex,
        fileIndex: activeFileIndex
      });
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingMode) return;
    if (!currentStroke && tool !== 'eraser') return;
    if (tool === 'eraser' && !('touches' in e) && e.buttons !== 1) return;

    e.preventDefault(); 
    const point = getPoint(e);
    if (!point) return;

    if (tool === 'eraser') {
      eraseAt(point);
    } else if (currentStroke) {
      setCurrentStroke(prev => prev ? { ...prev, points: [...prev.points, point] } : null);
    }
  };

  const handlePointerUp = () => {
    if (currentStroke) {
      setAllStrokes(prev => [...prev, currentStroke]);
      setCurrentStroke(null);
    }
  };

  const handleUndo = () => {
    const currentStrokes = allStrokes.filter(s => isStrokeOnCurrentPage(s));
    const otherStrokes = allStrokes.filter(s => !isStrokeOnCurrentPage(s));
    if (currentStrokes.length > 0) {
        setAllStrokes([...otherStrokes, ...currentStrokes.slice(0, -1)]);
    }
  };

  const handleClear = () => {
    if (confirm('Clear annotations on this page?')) {
        setAllStrokes(prev => prev.filter(s => !isStrokeOnCurrentPage(s)));
    }
  };

  // --- Toolbar Drag Logic ---

  const onToolbarPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    isDraggingToolbar.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    initialPos.current = { ...toolbarPos };
  };

  const onToolbarPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingToolbar.current) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    // Basic bounds
    const newX = initialPos.current.x + dx;
    const newY = initialPos.current.y + dy;
    setToolbarPos({ x: newX, y: newY });
  };

  const onToolbarPointerUp = (e: React.PointerEvent) => {
    isDraggingToolbar.current = false;
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture(e.pointerId);
  };

  const getSvgPath = (points: Point[]) => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  const visibleStrokes = allStrokes.filter(s => isStrokeOnCurrentPage(s));
  const popoverSideClass = toolbarPos.x > (window.innerWidth / 2) ? 'right-full mr-2' : 'left-full ml-2';

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col h-screen w-screen">
      {/* Top Bar */}
      <div className={`absolute top-0 left-0 right-0 z-20 flex justify-between items-center p-4 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${(isDrawingMode || showPageNav || showPenSettings || showQueueMenu) ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
        <div className="flex items-center gap-4">
            <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white">
                <X size={20} />
            </button>
            <div className="flex flex-col">
                <div className="flex items-center gap-2">
                    <h2 className="text-white font-medium truncate max-w-[200px] sm:max-w-md shadow-sm">{title}</h2>
                    {sheet && sheet.pages.length > 1 && (
                        <div className="flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded text-[10px] text-slate-300">
                             <FileText size={10} />
                             <span>File {activeFileIndex + 1}/{sheet.pages.length}</span>
                        </div>
                    )}
                    
                    {queue && queue.length > 1 && (
                        <div className="relative" ref={queueMenuRef}>
                            <button
                                onClick={() => {
                                    setShowQueueMenu(!showQueueMenu);
                                    setShowPageNav(false);
                                    setShowPenSettings(false);
                                }}
                                className={`p-1.5 rounded-full transition-colors ${showQueueMenu ? 'bg-white/20 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
                                title="Setlist Queue"
                            >
                                <List size={18} />
                            </button>
                            {showQueueMenu && (
                                <div className="absolute top-full left-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-72 max-h-[60vh] overflow-y-auto z-50 flex flex-col py-1">
                                    {queue.map((item, idx) => (
                                        <button
                                            key={`${item.id}-${idx}`}
                                            onClick={() => {
                                                onJumpTo?.(idx);
                                                setShowQueueMenu(false);
                                            }}
                                            className={`text-left px-4 py-3 text-sm border-b border-slate-700/50 last:border-0 hover:bg-slate-700 transition-colors ${idx === currentQueueIndex ? 'bg-blue-600/20 text-blue-300 font-medium border-l-2 border-l-blue-500' : 'text-slate-300'}`}
                                        >
                                            <div className="flex gap-3">
                                                <span className="opacity-50 w-5 text-right font-mono">{idx + 1}.</span>
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {numSubPages > 1 && (
                    <div className="relative" ref={pageNavRef}>
                        <button 
                            onClick={() => {
                                setShowPageNav(!showPageNav);
                                setTargetPage(subPageIndex + 1);
                                setShowPenSettings(false); 
                                setShowQueueMenu(false);
                            }}
                            className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-white/5 px-2 py-1 rounded transition-colors mt-0.5"
                        >
                            <span>Page {subPageIndex + 1} / {numSubPages}</span>
                            <ChevronDown size={12} className={`transition-transform ${showPageNav ? 'rotate-180' : ''}`} />
                        </button>

                        {showPageNav && (
                            <div className="absolute top-full left-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-2xl w-64 z-50">
                                <form onSubmit={handleJumpToPage} className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs text-slate-400 font-bold uppercase">Go to page</span>
                                        <span className="text-xs text-slate-500">{targetPage} / {numSubPages}</span>
                                    </div>
                                    
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max={numSubPages} 
                                        value={targetPage}
                                        onChange={(e) => setTargetPage(parseInt(e.target.value))}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />

                                    <div className="flex gap-2">
                                        <input 
                                            type="number" 
                                            min="1" 
                                            max={numSubPages}
                                            value={targetPage}
                                            onChange={(e) => setTargetPage(parseInt(e.target.value))}
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-center focus:ring-1 focus:ring-blue-500 outline-none"
                                        />
                                        <button 
                                            type="submit"
                                            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm font-medium"
                                        >
                                            Go
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-800/90 backdrop-blur rounded-full px-3 py-1.5 border border-white/10">
             <button 
                onClick={() => setIsDrawingMode(!isDrawingMode)} 
                className={`p-2 rounded-full transition-colors ${isDrawingMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title={isDrawingMode ? "Done Drawing" : "Annotate"}
             >
                <PenTool size={18} />
             </button>
        </div>
      </div>

      {/* Floating Vertical Annotation Toolbar */}
      {isDrawingMode && (
         <div 
            style={{ transform: `translate(${toolbarPos.x}px, ${toolbarPos.y}px)` }} 
            className="fixed z-50 top-0 left-0 flex flex-col items-center gap-2 p-2 bg-slate-800/90 backdrop-blur rounded-full border border-white/10 shadow-2xl touch-none"
         >
             {/* Handle */}
             <div 
                className="flex items-center justify-center p-2 text-slate-400 cursor-grab active:cursor-grabbing hover:text-white"
                onPointerDown={onToolbarPointerDown}
                onPointerMove={onToolbarPointerMove}
                onPointerUp={onToolbarPointerUp}
             >
                <GripHorizontal size={20} />
             </div>

             <div className="w-8 h-px bg-white/10 my-1" />

             {/* Tools */}
             <button 
                onClick={() => setTool('pen')}
                className={`p-3 rounded-full transition-colors ${tool === 'pen' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
             >
                <PenTool size={18} />
             </button>
             <button 
                onClick={() => setTool('eraser')}
                className={`p-3 rounded-full transition-colors ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
             >
                <Eraser size={18} />
             </button>

             {/* Color Picker Toggle */}
             {tool === 'pen' && (
                 <div className="relative">
                    <button 
                        onClick={() => {
                            setShowColorPicker(!showColorPicker);
                            setShowPenSettings(false);
                        }}
                        className="p-3 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        style={{ color: showColorPicker ? 'white' : color }}
                    >
                        <Palette size={18} />
                    </button>
                    {showColorPicker && (
                        <div className={`absolute top-0 ${popoverSideClass} bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-2xl flex flex-col gap-2`}>
                            {COLORS.map(c => (
                                <button 
                                key={c}
                                onClick={() => {
                                    setColor(c);
                                    setShowColorPicker(false);
                                }}
                                className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                                style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    )}
                 </div>
             )}

             {/* Settings Toggle */}
             {tool === 'pen' && (
                <div className="relative">
                    <button 
                        onClick={() => {
                            setShowPenSettings(!showPenSettings);
                            setShowColorPicker(false);
                        }}
                        className={`p-3 rounded-full transition-colors ${showPenSettings ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                    >
                        <Sliders size={18} />
                    </button>
                    {showPenSettings && (
                        <div className={`absolute top-0 ${popoverSideClass} bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-2xl w-56`}>
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Pen Options</h4>
                            <div className="bg-slate-900 rounded-lg p-3 mb-4 border border-slate-700/50 flex items-center justify-center overflow-hidden">
                                <svg width="160" height="40" className="block">
                                    <path d="M 20 20 Q 80 5, 140 20" stroke={hexToRgba(color, opacity)} strokeWidth={lineWidth} fill="none" strokeLinecap="round" />
                                </svg>
                            </div>
                            <div className="mb-4">
                                <div className="flex justify-between mb-1"><span className="text-xs text-slate-400">Width</span><span className="text-xs text-slate-300">{lineWidth}px</span></div>
                                <input type="range" min="1" max="20" step="1" value={lineWidth} onChange={(e) => setLineWidth(parseInt(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                            </div>
                            <div>
                                <div className="flex justify-between mb-1"><span className="text-xs text-slate-400">Opacity</span><span className="text-xs text-slate-300">{Math.round(opacity * 100)}%</span></div>
                                <input type="range" min="0.1" max="1.0" step="0.1" value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                            </div>
                        </div>
                    )}
                </div>
             )}

             <div className="w-8 h-px bg-white/10 my-1" />

             <button onClick={handleUndo} className="p-3 text-slate-400 hover:text-white hover:bg-white/10 rounded-full" title="Undo">
                <Undo size={18} />
             </button>
             
             <button onClick={handleClear} className="p-3 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-full" title="Clear Page">
                <Trash2 size={18} />
             </button>
             
             <button onClick={() => setIsDrawingMode(false)} className="p-3 text-slate-400 hover:text-white hover:bg-white/10 rounded-full" title="Close">
                 <X size={18} />
             </button>
         </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 relative flex items-center justify-center bg-zinc-900 overflow-hidden">
        {(loading || (!workerReady && fileType === 'application/pdf')) ? (
          <div className="animate-spin text-white"><Settings2 size={40} /></div>
        ) : (fileType === 'application/pdf' ? pdfDoc : blobUrl) ? (
            <div 
                ref={containerRef}
                className={`relative w-full h-full flex items-center justify-center select-none ${isDrawingMode ? 'cursor-crosshair' : ''}`}
                style={{ touchAction: 'none' }} // Critical for preventing scroll on mobile while drawing
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
            >
                {fileType === 'application/pdf' ? (
                     <canvas 
                        ref={pdfCanvasRef} 
                        className="shadow-2xl pointer-events-none"
                        style={{ maxWidth: '100%', maxHeight: '100%' }}
                     />
                ) : (
                    <img 
                        src={blobUrl || ''} 
                        alt={`Page ${subPageIndex + 1}`} 
                        className="max-w-full max-h-full object-contain pointer-events-none select-none shadow-2xl"
                    />
                )}

                {/* SVG Overlay for Annotations */}
                <svg 
                    ref={svgRef}
                    className="absolute inset-0 w-full h-full pointer-events-none" 
                    viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                    preserveAspectRatio="none"
                >
                    {visibleStrokes.map((stroke, i) => (
                        <path 
                            key={i}
                            d={getSvgPath(stroke.points)}
                            stroke={stroke.color}
                            strokeWidth={stroke.width}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    ))}
                    {currentStroke && (
                        <path 
                            d={getSvgPath(currentStroke.points)}
                            stroke={currentStroke.color}
                            strokeWidth={currentStroke.width}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    )}
                </svg>
            </div>
        ) : (
          <div className="text-white/50">Error loading file</div>
        )}

        {/* Navigation Hit Zones */}
        {!isDrawingMode && !showPageNav && !showPenSettings && !showColorPicker && (
          <>
            <div className="absolute inset-y-0 left-0 w-[20%] z-10 cursor-pointer" onClick={handlePagePrev} />
            <div className="absolute inset-y-0 right-0 w-[20%] z-10 cursor-pointer" onClick={handlePageNext} />
          </>
        )}
      </div>

      {/* Bottom Control Hint */}
      {!isDrawingMode && !showPageNav && !showPenSettings && !showQueueMenu && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-8 z-20 pointer-events-none opacity-0 hover:opacity-100 transition-opacity">
           <button 
             className={`p-4 bg-black/50 rounded-full backdrop-blur pointer-events-auto hover:bg-black/80 transition-all ${(!hasPrev && activeFileIndex === 0 && subPageIndex === 0) ? 'opacity-30 cursor-not-allowed' : ''}`}
             onClick={handlePagePrev}
             disabled={!hasPrev && activeFileIndex === 0 && subPageIndex === 0}
           >
             <ChevronLeft size={32} />
           </button>
           <button 
             className={`p-4 bg-black/50 rounded-full backdrop-blur pointer-events-auto hover:bg-black/80 transition-all ${(!hasNext && activeFileIndex === (sheet?.pages.length || 1) - 1 && subPageIndex === numSubPages - 1) ? 'opacity-30 cursor-not-allowed' : ''}`}
             onClick={handlePageNext}
             disabled={!hasNext && activeFileIndex === (sheet?.pages.length || 1) - 1 && subPageIndex === numSubPages - 1}
           >
             <ChevronRight size={32} />
           </button>
        </div>
      )}
    </div>
  );
};

export default Viewer;