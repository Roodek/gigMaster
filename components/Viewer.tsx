
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { PenTool, Eraser, X, Loader2, List, ChevronRight, ChevronLeft, Hash, ArrowRight, ChevronDown, BookOpen, RotateCcw, Type, Square, Circle, Search, Check, ChevronUp, Type as TypeIcon } from 'lucide-react';
import { Stroke, Point, Sheet, AnnotationType } from '../types';
import { storage } from '../services/storage';
import { COLORS, PAGE_TURN_KEYS } from '../constants';
import * as pdfjsLib from 'pdfjs-dist';

// Handle ESM default export wrapping from CDNs
const pdfjs: any = (pdfjsLib as any).default || pdfjsLib;

// Configure worker immediately
if (pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const FONTS = [
    { label: 'Standard Sans', value: 'sans-serif' },
    { label: 'Classic Serif', value: 'serif' },
    { label: 'Typewriter Mono', value: 'monospace' },
    { label: 'Handwritten', value: 'cursive' },
    { label: 'Decorative', value: 'fantasy' },
    { label: 'System Native', value: 'system-ui' }
];

const PRESET_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

interface ViewerProps {
  sheetId: string;
  title: string;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  queue: { id: string; name: string }[];
  currentQueueIndex: number;
  onJumpTo: (index: number) => void;
  initialDirection: 'forward' | 'backward';
}

const Viewer: React.FC<ViewerProps> = ({
  sheetId,
  title,
  onClose,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  queue,
  currentQueueIndex,
  onJumpTo,
  initialDirection
}) => {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [subPageIndex, setSubPageIndex] = useState(0);
  const [numSubPages, setNumSubPages] = useState(0);
  const [loading, setLoading] = useState(true);
  
  // Annotation State
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [currentTool, setCurrentTool] = useState<AnnotationType | 'eraser'>('path');
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [selectedWidth, setSelectedWidth] = useState(4);
  const [selectedFontSize, setSelectedFontSize] = useState(24);
  const [selectedFont, setSelectedFont] = useState(FONTS[0].value);
  const [allStrokes, setAllStrokes] = useState<Stroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<Stroke | null>(null);
  
  // Popover States
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [fontSearchQuery, setFontSearchQuery] = useState('');

  // Inline Text Input State
  const [textInput, setTextInput] = useState<{ x: number, y: number, w: number, h: number, value: string } | null>(null);

  // UI State
  const [showControls, setShowControls] = useState(true);
  const [showQueue, setShowQueue] = useState(false);
  const [showJumpDropdown, setShowJumpDropdown] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1400 });
  const [displayScale, setDisplayScale] = useState(1);

  // Stability Refs
  const pdfDocCache = useRef<Map<number, any>>(new Map());
  const canvasCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const renderTasks = useRef<Map<string, any>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const inlineTextRef = useRef<HTMLTextAreaElement>(null);
  const fontSearchInputRef = useRef<HTMLInputElement>(null);

  const currentViewRef = useRef<{ sheetId: string; fileIndex: number; pageIndex: number }>({
    sheetId,
    fileIndex: 0,
    pageIndex: initialDirection === 'backward' ? -1 : 0
  });

  const currentFile = sheet?.pages?.[activeFileIndex];
  const isPdf = currentFile?.fileType === 'application/pdf';
  const totalDisplayPages = isPdf ? numSubPages : (sheet?.pages?.length || 0);
  const currentDisplayPage = isPdf ? (Math.max(0, subPageIndex) + 1) : (activeFileIndex + 1);

  const updateDisplayScale = useCallback(() => {
    const element = isPdf ? pdfCanvasRef.current : imageRef.current;
    if (element && dimensions.width > 0) {
      const rect = element.getBoundingClientRect();
      setDisplayScale(rect.width / dimensions.width);
    }
  }, [isPdf, dimensions.width]);

  useLayoutEffect(() => {
    window.addEventListener('resize', updateDisplayScale);
    return () => window.removeEventListener('resize', updateDisplayScale);
  }, [updateDisplayScale]);

  useLayoutEffect(() => {
    setLoading(true);
    setSheet(null);
    setNumSubPages(0);
    setActiveFileIndex(0);
    setSubPageIndex(initialDirection === 'backward' ? -1 : 0);
    
    pdfDocCache.current.clear();
    canvasCache.current.clear();
    renderTasks.current.forEach(task => { try { task.cancel(); } catch(e) {} });
    renderTasks.current.clear();
    
    const ctx = pdfCanvasRef.current?.getContext('2d');
    if (ctx && pdfCanvasRef.current) {
        ctx.clearRect(0, 0, pdfCanvasRef.current.width, pdfCanvasRef.current.height);
    }

    currentViewRef.current = {
      sheetId,
      fileIndex: 0,
      pageIndex: initialDirection === 'backward' ? -1 : 0
    };
  }, [sheetId, initialDirection]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const loaded = await storage.getSheet(sheetId);
        if (!active || sheetId !== currentViewRef.current.sheetId) return;

        if (loaded) {
          const targetFileIdx = initialDirection === 'backward' ? Math.max(0, loaded.pages.length - 1) : 0;
          currentViewRef.current.fileIndex = targetFileIdx;
          setActiveFileIndex(targetFileIdx);
          setSheet(loaded);
          
          const annotations = await storage.getAnnotation(sheetId);
          if (active && sheetId === currentViewRef.current.sheetId) {
            setAllStrokes(annotations?.strokes || []);
          }
        } else {
           onClose();
        }
      } catch (err) {
        console.error("Load error", err);
      }
    };
    load();
    return () => { active = false; };
  }, [sheetId, initialDirection, onClose]);

  const getPdfDoc = useCallback(async (fileIdx: number) => {
    if (!sheet || !sheet.pages || !sheet.pages[fileIdx]) return null;
    if (pdfDocCache.current.has(fileIdx)) return pdfDocCache.current.get(fileIdx);
    if (sheet.pages[fileIdx].fileType !== 'application/pdf') return null;

    try {
        const arrayBuffer = await sheet.pages[fileIdx].blob.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        if (sheetId === currentViewRef.current.sheetId) {
            pdfDocCache.current.set(fileIdx, doc);
            return doc;
        }
        return null;
    } catch (e) {
        return null;
    }
  }, [sheet, sheetId]);

  const renderPage = useCallback(async (fIdx: number, pIdx: number, isPriority = false) => {
    const key = `${sheetId}-${fIdx}-${pIdx}`;
    
    if (canvasCache.current.has(key)) {
        if (isPriority) {
            const cachedCanvas = canvasCache.current.get(key);
            const mainCanvas = pdfCanvasRef.current;
            if (mainCanvas && cachedCanvas) {
                mainCanvas.width = cachedCanvas.width;
                mainCanvas.height = cachedCanvas.height;
                setDimensions({ width: cachedCanvas.width, height: cachedCanvas.height });
                mainCanvas.getContext('2d')?.drawImage(cachedCanvas, 0, 0);
                setTimeout(updateDisplayScale, 0);
            }
            setLoading(false);
        }
        return;
    }

    const doc = await getPdfDoc(fIdx);
    if (!doc || sheetId !== currentViewRef.current.sheetId || fIdx !== currentViewRef.current.fileIndex) return;

    try {
        const page = await doc.getPage(pIdx + 1);
        const viewport = page.getViewport({ scale: 2 });
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = viewport.width;
        offscreenCanvas.height = viewport.height;
        
        const task = page.render({
            canvasContext: offscreenCanvas.getContext('2d')!,
            viewport
        });

        renderTasks.current.set(key, task);
        await task.promise;
        
        if (sheetId === currentViewRef.current.sheetId && fIdx === currentViewRef.current.fileIndex) {
            canvasCache.current.set(key, offscreenCanvas);
            if (isPriority && pIdx === currentViewRef.current.pageIndex) {
                const mainCanvas = pdfCanvasRef.current;
                if (mainCanvas) {
                    mainCanvas.width = offscreenCanvas.width;
                    mainCanvas.height = offscreenCanvas.height;
                    setDimensions({ width: offscreenCanvas.width, height: offscreenCanvas.height });
                    mainCanvas.getContext('2d')?.drawImage(offscreenCanvas, 0, 0);
                    setTimeout(updateDisplayScale, 0);
                }
                setLoading(false);
            }
        }
    } catch (e) {
        if (isPriority) setLoading(false);
    }
  }, [sheetId, getPdfDoc, updateDisplayScale]);

  useEffect(() => {
    if (!sheet) return;
    const currentFile = sheet.pages[activeFileIndex];
    if (!currentFile) return;

    if (currentFile.fileType === 'application/pdf') {
        getPdfDoc(activeFileIndex).then(doc => {
            if (!doc || sheetId !== currentViewRef.current.sheetId) return;
            setNumSubPages(doc.numPages);
            if (subPageIndex === -1) {
                const last = doc.numPages - 1;
                currentViewRef.current.pageIndex = last;
                setSubPageIndex(last);
            } else {
                renderPage(activeFileIndex, subPageIndex, true);
            }
        });
    } else {
        setNumSubPages(1);
        setSubPageIndex(0);
        currentViewRef.current.pageIndex = 0;
        setLoading(false);
    }
  }, [sheet, activeFileIndex, subPageIndex, sheetId, getPdfDoc, renderPage]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isAnnotating) return;
    if (textInput) {
        handleFinishText();
        return;
    }
    
    if (showFontPicker || showSizePicker) {
        setShowFontPicker(false);
        setShowSizePicker(false);
        return;
    }

    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (currentTool === 'eraser') {
      const newStrokes = allStrokes.filter(s => {
        if (s.fileIndex !== activeFileIndex || s.pageIndex !== subPageIndex) return true;
        return !s.points.some(p => Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2)) < 0.012);
      });
      setAllStrokes(newStrokes);
      storage.saveAnnotation(sheetId, newStrokes);
      return;
    }

    const newStroke: Stroke = {
      id: crypto.randomUUID(),
      type: currentTool as AnnotationType,
      points: [{ x, y }],
      color: selectedColor,
      width: currentTool === 'text' ? selectedFontSize : selectedWidth,
      fontFamily: selectedFont,
      fileIndex: activeFileIndex,
      pageIndex: subPageIndex
    };
    setActiveStroke(newStroke);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isAnnotating || !activeStroke) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (activeStroke.type === 'path') {
        setActiveStroke(prev => prev ? { ...prev, points: [...prev.points, { x, y }] } : null);
    } else {
        setActiveStroke(prev => prev ? { ...prev, points: [prev.points[0], { x, y }] } : null);
    }
  };

  const handlePointerUp = () => {
    if (!activeStroke) return;

    if (activeStroke.type === 'text') {
        const p0 = activeStroke.points[0];
        const p1 = activeStroke.points[activeStroke.points.length - 1];
        
        const x = Math.min(p0.x, p1.x);
        const y = Math.min(p0.y, p1.y);
        const w = Math.max(0.02, Math.abs(p1.x - p0.x));
        const h = Math.max(0.015, Math.abs(p1.y - p0.y));

        updateDisplayScale();
        setTextInput({ x, y, w, h, value: '' });
        setActiveStroke(null);
    } else {
        const updated = [...allStrokes, activeStroke];
        setAllStrokes(updated);
        storage.saveAnnotation(sheetId, updated);
        setActiveStroke(null);
    }
  };

  const handleFinishText = () => {
    if (textInput && textInput.value.trim()) {
        const newTextAnnotation: Stroke = {
            id: crypto.randomUUID(),
            type: 'text',
            points: [
                { x: textInput.x, y: textInput.y },
                { x: textInput.x + textInput.w, y: textInput.y + textInput.h }
            ],
            color: selectedColor,
            width: selectedFontSize,
            fontFamily: selectedFont,
            text: textInput.value,
            fileIndex: activeFileIndex,
            pageIndex: subPageIndex
        };
        const updated = [...allStrokes, newTextAnnotation];
        setAllStrokes(updated);
        storage.saveAnnotation(sheetId, updated);
    }
    setTextInput(null);
  };

  const turnPage = useCallback((dir: 1 | -1) => {
    if (isPdf && dir === 1 && subPageIndex < numSubPages - 1) {
        setSubPageIndex(prev => prev + 1);
        currentViewRef.current.pageIndex++;
    } else if (isPdf && dir === -1 && subPageIndex > 0) {
        setSubPageIndex(prev => prev - 1);
        currentViewRef.current.pageIndex--;
    } else if (dir === 1 && sheet && activeFileIndex < sheet.pages.length - 1) {
        setActiveFileIndex(prev => prev + 1);
        setSubPageIndex(0);
        currentViewRef.current.fileIndex++;
        currentViewRef.current.pageIndex = 0;
    } else if (dir === -1 && activeFileIndex > 0) {
        setActiveFileIndex(prev => prev - 1);
        setSubPageIndex(-1);
        currentViewRef.current.fileIndex--;
        currentViewRef.current.pageIndex = -1;
    } else if (dir === 1 && hasNext) {
        onNext();
    } else if (dir === -1 && hasPrev) {
        onPrev();
    }
  }, [isPdf, subPageIndex, numSubPages, sheet, activeFileIndex, hasNext, hasPrev, onNext, onPrev]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (textInput) {
          if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleFinishText();
          }
          if (e.key === 'Escape') {
              setTextInput(null);
          }
          return;
      }
      if (PAGE_TURN_KEYS.NEXT.includes(e.key)) turnPage(1);
      else if (PAGE_TURN_KEYS.PREV.includes(e.key)) turnPage(-1);
      else if (e.key === 'Escape') {
          if (showJumpDropdown) setShowJumpDropdown(false);
          else if (showQueue) setShowQueue(false);
          else if (showFontPicker || showSizePicker) {
              setShowFontPicker(false);
              setShowSizePicker(false);
          }
          else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [turnPage, onClose, showJumpDropdown, showQueue, textInput, showFontPicker, showSizePicker]);

  const handleContainerClick = (e: React.MouseEvent) => {
    if (isAnnotating || showJumpDropdown || showQueue || textInput || showFontPicker || showSizePicker) {
        if (showJumpDropdown) setShowJumpDropdown(false);
        if (showQueue) setShowQueue(false);
        if (showFontPicker) setShowFontPicker(false);
        if (showSizePicker) setShowSizePicker(false);
        return;
    }
    const x = e.clientX / window.innerWidth;
    if (x < 0.2) turnPage(-1);
    else if (x > 0.8) turnPage(1);
    else setShowControls(!showControls);
  };

  const filteredFonts = FONTS.filter(f => 
    f.label.toLowerCase().includes(fontSearchQuery.toLowerCase())
  );

  const renderAnnotation = (anno: Stroke, key: string | number, isGhost = false) => {
      const { type = 'path', points, color, width, text, fontFamily } = anno;
      if (points.length === 0) return null;

      const p0 = points[0];
      const p1 = points[points.length - 1];

      const x0 = p0.x * dimensions.width;
      const y0 = p0.y * dimensions.height;
      const x1 = p1.x * dimensions.width;
      const y1 = p1.y * dimensions.height;

      const strokeProps = {
          key,
          stroke: color,
          strokeWidth: width,
          fill: 'none',
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          className: isGhost ? 'opacity-50' : ''
      };

      if (isGhost && type === 'text') {
        return (
            <rect 
                key={key}
                x={Math.min(x0, x1)}
                y={Math.min(y0, y1)}
                width={Math.max(2, Math.abs(x1 - x0))}
                height={Math.max(2, Math.abs(y1 - y0))}
                stroke={color}
                strokeWidth={1.5}
                fill={`${color}22`}
                strokeDasharray="4,4"
                className="opacity-60"
            />
        );
      }

      switch (type) {
          case 'path':
              return (
                  <path 
                    {...strokeProps}
                    d={points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x * dimensions.width} ${p.y * dimensions.height}`).join(' ')}
                  />
              );
          case 'rect':
              return (
                  <rect 
                    {...strokeProps}
                    x={Math.min(x0, x1)}
                    y={Math.min(y0, y1)}
                    width={Math.abs(x1 - x0)}
                    height={Math.abs(y1 - y0)}
                  />
              );
          case 'circle':
              const rx = Math.abs(x1 - x0) / 2;
              const ry = Math.abs(y1 - y0) / 2;
              return (
                  <ellipse 
                    {...strokeProps}
                    cx={Math.min(x0, x1) + rx}
                    cy={Math.min(y0, y1) + ry}
                    rx={rx}
                    ry={ry}
                  />
              );
          case 'text':
              const fs = width; // For text, width is the font size
              return (
                  <text 
                    key={key}
                    x={Math.min(x0, x1)}
                    y={Math.min(y0, y1) + (fs * 0.8)}
                    fill={color}
                    fontSize={fs}
                    fontFamily={fontFamily || 'sans-serif'}
                    fontWeight="bold"
                    className={isGhost ? 'opacity-30' : ''}
                  >
                      {text}
                  </text>
              );
          default:
              return null;
      }
  };

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col z-50 overflow-hidden touch-none select-none">
      {/* HUD Top */}
      <div className={`absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-50 flex items-center justify-between transition-opacity duration-200 ${showControls || isAnnotating ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center gap-3">
             <button onClick={onClose} className="p-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-all"><X size={20} /></button>
             <div className="text-white relative">
                <h2 className="font-bold text-lg truncate max-w-[150px] sm:max-w-md">{title}</h2>
                <button 
                  onClick={(e) => { e.stopPropagation(); if (!loading) setShowJumpDropdown(!showJumpDropdown); }}
                  className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-colors ${loading ? 'text-slate-600 cursor-wait' : 'text-slate-400 hover:text-blue-400'}`}
                >
                    {loading ? <span>Syncing...</span> : <span className="bg-white/5 px-2 py-1 rounded flex items-center gap-1.5">{currentDisplayPage} / {totalDisplayPages} <ChevronDown size={10}/></span>}
                </button>
             </div>
        </div>
        <div className="flex items-center gap-2">
             <button onClick={() => { setIsAnnotating(!isAnnotating); if (!isAnnotating && currentTool === 'eraser') setCurrentTool('path'); }} className={`p-3 rounded-xl transition-all ${isAnnotating && currentTool !== 'eraser' ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/10 text-white'}`}><PenTool size={20} /></button>
             <button onClick={() => { setCurrentTool('eraser'); setIsAnnotating(true); }} className={`p-3 rounded-xl transition-all ${isAnnotating && currentTool === 'eraser' ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/10 text-white'}`}><Eraser size={20} /></button>
             <button onClick={(e) => { e.stopPropagation(); setShowQueue(!showQueue); }} className={`p-3 rounded-xl transition-colors ${showQueue ? 'bg-blue-600 text-white' : 'bg-white/10 text-white'}`}><List size={20} /></button>
        </div>
      </div>

      <div ref={containerRef} className={`flex-1 relative flex items-center justify-center bg-zinc-950 ${isAnnotating ? 'cursor-crosshair' : 'cursor-default'}`} onClick={handleContainerClick} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
        {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-40">
                <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
                <p className="text-slate-500 text-xs font-black uppercase tracking-widest">Loading...</p>
            </div>
        )}
        <canvas ref={pdfCanvasRef} className={`max-w-full max-h-full object-contain shadow-2xl transition-opacity duration-300 pointer-events-none ${isPdf ? 'block' : 'hidden'}`} style={{ opacity: loading ? 0 : 1 }} />
        {!loading && sheet && currentFile && !isPdf && (
            <img ref={imageRef} src={URL.createObjectURL(currentFile.blob)} className="max-w-full max-h-full object-contain shadow-2xl pointer-events-none" alt="Sheet Page" onLoad={() => { setTimeout(updateDisplayScale, 100); }} />
        )}
        {!loading && sheet && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} preserveAspectRatio="none">
                {allStrokes.filter(s => s.fileIndex === activeFileIndex && s.pageIndex === subPageIndex).map((stroke, i) => renderAnnotation(stroke, i))}
                {activeStroke && renderAnnotation(activeStroke, 'active', true)}
            </svg>
        )}
        {textInput && (
            <div className="absolute z-50 flex items-center pointer-events-auto" style={{ left: `${textInput.x * 100}%`, top: `${textInput.y * 100}%`, width: `${textInput.w * 100}%`, height: `${textInput.h * 100}%` }}>
                <textarea 
                    ref={inlineTextRef}
                    value={textInput.value}
                    onChange={e => setTextInput({ ...textInput, value: e.target.value })}
                    onBlur={handleFinishText}
                    autoFocus
                    className="w-full h-full bg-slate-900/90 border-2 border-blue-500 rounded px-2 py-1 text-white font-bold outline-none shadow-2xl resize-none overflow-hidden"
                    style={{ color: selectedColor, fontSize: `${selectedFontSize * displayScale}px`, fontFamily: selectedFont, lineHeight: '1.2' }}
                />
            </div>
        )}
      </div>

      {/* Floating Toolbar */}
      {isAnnotating && (
          <div className="absolute bottom-[max(4rem,calc(env(safe-area-inset-bottom)+1.5rem))] left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-2xl border border-white/10 p-4 rounded-[3rem] shadow-[0_25px_60px_rgba(0,0,0,0.6)] flex items-center gap-4 z-[60] animate-in slide-in-from-bottom-8 duration-300 max-w-[98vw]">
              
              <div className="flex items-center bg-black/40 rounded-full p-1.5 shrink-0">
                  <button onClick={() => { setCurrentTool('path'); setShowSizePicker(false); setShowFontPicker(false); }} className={`p-2.5 rounded-full transition-all ${currentTool === 'path' ? 'bg-blue-600 text-white shadow-lg scale-110' : 'text-slate-500 hover:text-slate-300'}`}><PenTool size={18} /></button>
                  <button onClick={() => { setCurrentTool('text'); setShowSizePicker(false); setShowFontPicker(false); }} className={`p-2.5 rounded-full transition-all ${currentTool === 'text' ? 'bg-blue-600 text-white shadow-lg scale-110' : 'text-slate-500 hover:text-slate-300'}`}><Type size={18} /></button>
                  <button onClick={() => { setCurrentTool('rect'); setShowSizePicker(false); setShowFontPicker(false); }} className={`p-2.5 rounded-full transition-all ${currentTool === 'rect' ? 'bg-blue-600 text-white shadow-lg scale-110' : 'text-slate-500 hover:text-slate-300'}`}><Square size={18} /></button>
                  <button onClick={() => { setCurrentTool('circle'); setShowSizePicker(false); setShowFontPicker(false); }} className={`p-2.5 rounded-full transition-all ${currentTool === 'circle' ? 'bg-blue-600 text-white shadow-lg scale-110' : 'text-slate-500 hover:text-slate-300'}`}><Circle size={18} /></button>
              </div>

              <div className="w-px h-8 bg-white/10 shrink-0" />
              
              <div className="flex items-center gap-2 shrink-0">
                  {COLORS.map(c => (
                      <button key={c} onClick={() => { setSelectedColor(c); if (currentTool === 'eraser') setCurrentTool('path'); }} className={`w-7 h-7 rounded-full border-2 transition-all ${selectedColor === c && currentTool !== 'eraser' ? 'scale-110 border-white shadow-xl' : 'border-transparent opacity-60'}`} style={{ backgroundColor: c }} />
                  ))}
              </div>

              <div className="w-px h-8 bg-white/10 shrink-0" />

              {currentTool !== 'text' ? (
                <div className="flex items-center gap-2 shrink-0 px-1">
                    {[2, 4, 8].map(w => (
                        <button key={w} onClick={() => { setSelectedWidth(w); if (currentTool === 'eraser') setCurrentTool('path'); }} className={`flex items-center justify-center transition-all ${selectedWidth === w && currentTool !== 'eraser' ? 'text-blue-400 scale-125' : 'text-slate-500'}`}>
                            <div className="rounded-full bg-current" style={{ width: Math.max(5, w + 3), height: Math.max(5, w + 3) }} />
                        </button>
                    ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 shrink-0">
                    {/* Font Size Selector */}
                    <div className="relative overflow-visible">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowSizePicker(!showSizePicker); setShowFontPicker(false); }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-full border transition-all ${showSizePicker ? 'bg-blue-600 text-white border-blue-500 shadow-lg' : 'bg-black/40 text-slate-400 border-white/10'}`}
                        >
                            <span className="text-[11px] font-black">{selectedFontSize}px</span>
                            {showSizePicker ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {showSizePicker && (
                            <div className="absolute bottom-[calc(100%+1.5rem)] left-0 w-32 bg-slate-900/98 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9)] overflow-hidden z-[100]" onClick={e => e.stopPropagation()}>
                                <div className="p-2 border-b border-white/5 flex items-center">
                                    <input 
                                        type="number" 
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-2 text-xs text-white text-center outline-none focus:ring-1 focus:ring-blue-500"
                                        value={selectedFontSize}
                                        onChange={e => setSelectedFontSize(Math.max(1, parseInt(e.target.value) || 0))}
                                        placeholder="Size"
                                    />
                                </div>
                                <div className="max-h-48 overflow-y-auto py-2 no-scrollbar">
                                    {PRESET_FONT_SIZES.map(sz => (
                                        <button 
                                            key={sz}
                                            onClick={() => { setSelectedFontSize(sz); setShowSizePicker(false); }}
                                            className={`w-full flex items-center justify-center py-2.5 hover:bg-white/10 transition-colors ${selectedFontSize === sz ? 'text-blue-400' : 'text-slate-300'}`}
                                        >
                                            <span className="text-xs font-bold">{sz}px</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Font Family Selector */}
                    <div className="relative overflow-visible">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowFontPicker(!showFontPicker); setShowSizePicker(false); }}
                            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full border transition-all ${showFontPicker ? 'bg-blue-600 text-white border-blue-500 shadow-lg' : 'bg-black/40 text-slate-400 border-white/10'}`}
                        >
                            <span className="text-[10px] font-black uppercase tracking-wider truncate max-w-[70px]" style={{ fontFamily: selectedFont }}>
                                {FONTS.find(f => f.value === selectedFont)?.label || 'Font'}
                            </span>
                            {showFontPicker ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {showFontPicker && (
                            <div className="absolute bottom-[calc(100%+1.5rem)] left-0 w-64 bg-slate-900/98 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9)] overflow-hidden z-[100]" onClick={e => e.stopPropagation()}>
                                <div className="p-3 border-b border-white/5 relative">
                                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                    <input 
                                        ref={fontSearchInputRef}
                                        type="text" 
                                        placeholder="Search fonts..."
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500"
                                        value={fontSearchQuery}
                                        onChange={e => setFontSearchQuery(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-60 overflow-y-auto py-2 no-scrollbar">
                                    {filteredFonts.map(f => (
                                        <button 
                                            key={f.value}
                                            onClick={() => { setSelectedFont(f.value); setShowFontPicker(false); setFontSearchQuery(''); }}
                                            className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/10 transition-colors text-left ${selectedFont === f.value ? 'text-blue-400' : 'text-slate-300'}`}
                                        >
                                            <span className="text-sm font-medium" style={{ fontFamily: f.value }}>{f.label}</span>
                                            {selectedFont === f.value && <Check size={16} />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
              )}

              <div className="w-px h-8 bg-white/10 shrink-0" />
              
              <button onClick={() => { const updated = allStrokes.filter(s => s.fileIndex !== activeFileIndex || s.pageIndex !== subPageIndex); setAllStrokes(updated); storage.saveAnnotation(sheetId, updated); }} className="p-2.5 text-slate-500 hover:text-red-400 transition-colors shrink-0" title="Clear Page"><RotateCcw size={20} /></button>
              
              <button onClick={() => { setIsAnnotating(false); setShowFontPicker(false); setShowSizePicker(false); }} className="bg-white/10 hover:bg-blue-600 text-white px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.1em] transition-all shrink-0">Done</button>
          </div>
      )}

      {showQueue && queue && (
          <div className="absolute top-20 right-4 z-[100] w-64 bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="p-4 border-b border-white/5 flex items-center justify-between"><h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Queue</h3><button onClick={() => setShowQueue(false)} className="text-slate-500 hover:text-white"><X size={16}/></button></div>
              <div className="overflow-y-auto no-scrollbar py-2 max-h-[60vh]">
                  {queue.map((item, idx) => (
                      <button key={idx} onClick={() => { onJumpTo(idx); setShowQueue(false); }} className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left ${idx === currentQueueIndex ? 'bg-blue-600/20 text-blue-400 border-l-4 border-blue-500' : 'text-slate-300'}`}><span className="text-[10px] font-mono text-slate-500 w-4">{idx + 1}</span><span className="text-sm font-medium truncate flex-1">{item.name}</span></button>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};

export default Viewer;
