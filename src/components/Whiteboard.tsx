import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { io, Socket } from 'socket.io-client';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, limit, getDocs } from 'firebase/firestore';
import { db, auth, googleProvider } from '../lib/firebase';
import { onAuthStateChanged, signInAnonymously, signInWithPopup, signOut } from 'firebase/auth';
import { Toolbar } from './Toolbar';
import { Presence } from './Presence';
import { Button } from './ui/Button';
import { Share2, Download, Trash2, Save, Undo, Redo, LogIn, LogOut, Search, Lock, Globe, Copy, Check, FileImage, FileDown } from 'lucide-react';
import { nanoid } from 'nanoid';
import { cn } from '../lib/utils';
import { jsPDF } from 'jspdf';

interface WhiteboardProps {
  boardId: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ boardId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvas = useRef<fabric.Canvas | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [tool, setTool] = useState<'select' | 'pen' | 'eraser' | 'rect' | 'circle' | 'text' | 'sticky'>('select');
  const [color, setColor] = useState('#000000');
  const [user, setUser] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [boardIdInput, setBoardIdInput] = useState('');
  const [boardData, setBoardData] = useState<any>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRemoteChange = useRef(false);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const isHistoryUpdate = useRef(false);

  const isOwner = user?.uid === boardData?.ownerId || boardData?.ownerId === 'guest';
  const modeParam = new URLSearchParams(window.location.search).get('mode');
  const canEdit = isOwner || modeParam === 'edit' || (boardData?.publicPermission === 'edit' && modeParam !== 'view');

  const saveToHistory = useCallback(() => {
    const canvas = fabricCanvas.current;
    if (!canvas || isRemoteChange.current || isHistoryUpdate.current || !canEdit) return;
    const currentState = JSON.stringify(canvas.toJSON());
    
    // Only push if different from last state
    if (undoStack.current.length > 0 && undoStack.current[undoStack.current.length - 1] === currentState) return;
    
    undoStack.current.push(currentState);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, [canEdit]);

  const undo = useCallback(async () => {
    if (undoStack.current.length <= 1 || !fabricCanvas.current || !canEdit) return;
    
    isHistoryUpdate.current = true;
    const currentState = undoStack.current.pop()!;
    redoStack.current.push(currentState);
    
    const previousState = undoStack.current[undoStack.current.length - 1];
    await fabricCanvas.current.loadFromJSON(previousState);
    fabricCanvas.current.renderAll();
    
    socketRef.current?.emit('canvas-update', { boardId, update: previousState });
    isHistoryUpdate.current = false;
  }, [boardId, canEdit]);

  const redo = useCallback(async () => {
    if (redoStack.current.length === 0 || !fabricCanvas.current || !canEdit) return;
    
    isHistoryUpdate.current = true;
    const state = redoStack.current.pop()!;
    undoStack.current.push(state);
    
    await fabricCanvas.current.loadFromJSON(state);
    fabricCanvas.current.renderAll();
    
    socketRef.current?.emit('canvas-update', { boardId, update: state });
    isHistoryUpdate.current = false;
  }, [boardId, canEdit]);

  const deleteSelected = useCallback(() => {
    const canvas = fabricCanvas.current;
    if (!canvas || !canEdit) return;
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length > 0) {
      canvas.remove(...activeObjects);
      canvas.discardActiveObject();
      canvas.renderAll();
      saveToHistory();
      socketRef.current?.emit('canvas-update', { boardId, update: JSON.stringify(canvas.toJSON()) });
    }
  }, [canEdit, boardId, saveToHistory]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  // Initialize Canvas Once
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight - 56,
      backgroundColor: '#f8fafc',
    });
    fabricCanvas.current = canvas;

    const socket = io();
    socketRef.current = socket;
    socket.emit('join-board', boardId);

    // Initial Load from Firebase
    const loadBoard = async () => {
      const path = `boards/${boardId}`;
      try {
        const boardDoc = await getDoc(doc(db, 'boards', boardId));
        if (boardDoc.exists()) {
          const data = boardDoc.data();
          setBoardData(data);
          if (data.canvasState) {
            isRemoteChange.current = true;
            await canvas.loadFromJSON(data.canvasState);
            canvas.renderAll();
            isRemoteChange.current = false;
          }
        } else {
          const initialData = {
            name: 'Untitled Board',
            ownerId: auth.currentUser?.uid || 'guest',
            canvasState: JSON.stringify(canvas.toJSON()),
            publicPermission: 'edit',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(doc(db, 'boards', boardId), initialData);
          setBoardData(initialData);
        }
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, path);
      }
    };
    loadBoard();

    // Socket Events
    socket.on('canvas-update-remote', async (json) => {
      isRemoteChange.current = true;
      await canvas.loadFromJSON(json);
      canvas.renderAll();
      isRemoteChange.current = false;
    });

    const handleResize = () => {
      canvas.setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 56,
      });
      canvas.renderAll();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.disconnect();
      canvas.dispose();
    };
  }, [boardId]);

  // Sync Permissions and Tools to existing Canvas
  useEffect(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    canvas.on('object:added', (e) => {
      const obj = e.target;
      if (obj) {
        obj.set({
          perPixelTargetFind: true,
          padding: 5,
        });
      }
    });

    const handleCanvasChange = () => {
      if (isRemoteChange.current || isHistoryUpdate.current || !canEdit) return;
      
      const json = JSON.stringify(canvas.toJSON());
      saveToHistory();
      socketRef.current?.emit('canvas-update', { boardId, update: json });
    };

    const handleObjectMoving = () => {
      if (isRemoteChange.current || !canEdit) return;
      // We emit full state for simplicity, though granular is better for scaling
      // Throttling could be added here if needed
      socketRef.current?.emit('canvas-update', { boardId, update: JSON.stringify(canvas.toJSON()) });
    };

    canvas.off('object:added', handleCanvasChange);
    canvas.off('object:modified', handleCanvasChange);
    canvas.off('object:removed', handleCanvasChange);
    canvas.off('path:created', handleCanvasChange);
    canvas.off('object:moving', handleObjectMoving);
    canvas.off('object:scaling', handleObjectMoving);
    canvas.off('object:rotating', handleObjectMoving);
    
    canvas.on('object:added', handleCanvasChange);
    canvas.on('object:modified', handleCanvasChange);
    canvas.on('object:removed', handleCanvasChange);
    canvas.on('path:created', handleCanvasChange);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:scaling', handleObjectMoving);
    canvas.on('object:rotating', handleObjectMoving);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!canEdit) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObj = canvas.getActiveObject();
        if (activeObj && activeObj.type === 'i-text' && (activeObj as fabric.IText).isEditing) {
          return;
        }
        deleteSelected();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const saveInterval = setInterval(async () => {
      const path = `boards/${boardId}`;
      if (fabricCanvas.current && canEdit) {
        setIsSaving(true);
        const state = JSON.stringify(fabricCanvas.current.toJSON());
        try {
          await updateDoc(doc(db, 'boards', boardId), {
            canvasState: state,
            updatedAt: serverTimestamp(),
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, path);
        }
        setIsSaving(false);
      }
    }, 30000);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(saveInterval);
      canvas.off('object:added', handleCanvasChange);
      canvas.off('object:modified', handleCanvasChange);
      canvas.off('object:removed', handleCanvasChange);
      canvas.off('path:created', handleCanvasChange);
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('object:scaling', handleObjectMoving);
      canvas.off('object:rotating', handleObjectMoving);
    };
  }, [canEdit, boardId, saveToHistory, undo, redo, deleteSelected]);

  const updatePublicPermission = async (perm: string) => {
    const path = `boards/${boardId}`;
    if (!isOwner) return;
    try {
      await updateDoc(doc(db, 'boards', boardId), {
        publicPermission: perm,
        updatedAt: serverTimestamp(),
      });
      setBoardData((prev: any) => ({ ...prev, publicPermission: perm }));
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  };

  const copyLink = (perm?: string) => {
    const url = new URL(window.location.href);
    if (perm) url.searchParams.set('mode', perm);
    else url.searchParams.delete('mode');
    
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Sign in error', error);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const joinBoard = () => {
    if (boardIdInput.trim()) {
      window.location.href = `?board=${boardIdInput.trim()}`;
    }
  };

  // Tool logic
  useEffect(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    canvas.selection = canEdit && tool === 'select';
    canvas.discardActiveObject();
    canvas.defaultCursor = tool === 'eraser' ? 'crosshair' : 'default';
    canvas.hoverCursor = tool === 'eraser' ? 'crosshair' : 'move';
    
    // Ensure all objects are interactive if in eraser/select mode
    canvas.forEachObject(obj => {
      obj.selectable = canEdit && (tool === 'select' || tool === 'eraser');
      obj.evented = true;
    });

    canvas.renderAll();

    if (!canEdit) {
      canvas.isDrawingMode = false;
      return;
    }

    canvas.isDrawingMode = tool === 'pen';
    if (canvas.isDrawingMode) {
      if (!canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      }
      canvas.freeDrawingBrush.color = color;
      canvas.freeDrawingBrush.width = 4;
    }

    const onMouseDown = (opt: fabric.TPointerEventInfo) => {
      if (!canEdit) return;
      
      const pointer = canvas.getScenePoint(opt.e);

      // Eraser logic
      if (tool === 'eraser') {
        const target = opt.target;
        if (target) {
          canvas.remove(target);
          canvas.renderAll();
          saveToHistory();
          socketRef.current?.emit('canvas-update', { boardId, update: JSON.stringify(canvas.toJSON()) });
        }
        return;
      }

      if (tool === 'select' || tool === 'pen') return;

      let obj;

      if (tool === 'rect') {
        obj = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          fill: 'rgba(255, 255, 255, 0.01)',
          stroke: color,
          strokeWidth: 3,
          width: 100,
          height: 100,
          id: nanoid(),
        } as any);
      } else if (tool === 'circle') {
        obj = new fabric.Circle({
          left: pointer.x,
          top: pointer.y,
          fill: 'rgba(255, 255, 255, 0.01)',
          stroke: color,
          strokeWidth: 3,
          radius: 50,
          id: nanoid(),
        } as any);
      } else if (tool === 'text') {
        const text = new fabric.IText('Type here...', {
          left: pointer.x,
          top: pointer.y,
          fontFamily: 'Inter',
          fill: color,
          fontSize: 24,
          id: nanoid(),
        } as any);
        text.on('editing:entered', () => {
          text.hiddenTextarea?.focus();
        });
        obj = text;
      } else if (tool === 'sticky') {
        const text = new fabric.IText('Double click to edit', {
          fontSize: 14,
          originX: 'center',
          originY: 'center',
          left: 75,
          top: 75,
          width: 120,
          textAlign: 'center',
          fontFamily: 'Inter',
          editable: true,
          fill: '#475569',
        });
        
        obj = new fabric.Group([
          new fabric.Rect({
            width: 150,
            height: 150,
            fill: '#fef3c7',
            stroke: '#fcd34d',
            strokeWidth: 1,
            rx: 8,
            ry: 8,
            shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.1)', blur: 5, offsetX: 2, offsetY: 2 })
          }),
          text
        ], {
          left: pointer.x,
          top: pointer.y,
          id: nanoid(),
          subTargetCheck: true,
        } as any);

        // Sub-object editing logic
        obj.on('mousedblclick', () => {
          if (!canEdit) return;
          canvas.setActiveObject(text);
          text.enterEditing();
          text.selectAll();
          canvas.renderAll();
        });
      }

      if (obj) {
        // Handle IText specific UX (Enter to exit editing)
        const iText = obj instanceof fabric.IText ? obj : (obj instanceof fabric.Group ? (obj as fabric.Group).getObjects().find(o => o instanceof fabric.IText) : null) as fabric.IText;
        if (iText) {
          (iText as any).on('keydown', (e: any) => {
            if (e.keyCode === 13 && !e.shiftKey) { // Enter key
              iText.exitEditing();
              canvas.discardActiveObject();
              canvas.renderAll();
            }
          });
        }
        canvas.add(obj);
        canvas.setActiveObject(obj);
      }
    };

    canvas.on('mouse:down', onMouseDown);
    return () => {
      canvas.off('mouse:down', onMouseDown);
    };
  }, [tool, color, canEdit]);

  const exportAsImage = () => {
    if (!fabricCanvas.current) return;
    const dataURL = fabricCanvas.current.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 2,
    } as any);
    const link = document.createElement('a');
    link.download = `whiteboard-${boardId}.png`;
    link.href = dataURL;
    link.click();
  };

  const exportAsPDF = () => {
    if (!fabricCanvas.current) return;
    const canvas = fabricCanvas.current;
    
    // Get original size
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    
    // Create high-res image
    const dataURL = canvas.toDataURL({
      format: 'png',
      multiplier: 2
    } as any);
    
    const pdf = new jsPDF({
      orientation: originalWidth! > originalHeight! ? 'landscape' : 'portrait',
      unit: 'px',
      format: [originalWidth!, originalHeight!]
    });
    
    pdf.addImage(dataURL, 'PNG', 0, 0, originalWidth!, originalHeight!);
    pdf.save(`whiteboard-${boardId}.pdf`);
  };

  const clearCanvas = () => {
    if (!canEdit || !fabricCanvas.current) return;
    
    const canvas = fabricCanvas.current;
    const activeObjects = canvas.getActiveObjects();

    if (activeObjects.length > 0) {
      canvas.remove(...activeObjects);
      canvas.discardActiveObject();
      canvas.renderAll();
      saveToHistory();
      socketRef.current?.emit('canvas-update', { boardId, update: JSON.stringify(canvas.toJSON()) });
    } else {
      if (confirm('Clear entire board?')) {
        canvas.clear();
        canvas.backgroundColor = '#f8fafc';
        canvas.renderAll();
        
        saveToHistory();
        const json = JSON.stringify(canvas.toJSON());
        socketRef.current?.emit('canvas-update', { boardId, update: json });
      }
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20">
        <div className="flex items-center space-x-4">
          <div className="bg-blue-600 p-1.5 rounded-lg flex items-center justify-center cursor-pointer" onClick={() => window.location.href = '/'}>
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-none">Whiteboard App</span>
            <h1 className="text-sm font-semibold text-slate-900 truncate">Collaborative Session / {boardId}</h1>
          </div>
          <div className="flex items-center bg-slate-50 rounded-full border border-slate-200 px-3 py-1 ml-2">
            <input 
              type="text" 
              placeholder="Join ID..." 
              value={boardIdInput}
              onChange={(e) => setBoardIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinBoard()}
              className="bg-transparent border-none text-xs w-20 focus:ring-0 px-1 py-0 font-medium"
            />
            <button onClick={joinBoard} className="text-slate-400 hover:text-blue-600 transition-colors">
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
          {isSaving && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse ml-2" />}
        </div>

        <div className="flex items-center space-x-3">
          {canEdit && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={undo} className="px-2 h-8 rounded-lg" title="Undo (Ctrl+Z)">
                <Undo className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={redo} className="px-2 h-8 rounded-lg" title="Redo (Ctrl+Shift+Z)">
                <Redo className="w-4 h-4" />
              </Button>
              <div className="h-6 w-[1px] bg-slate-200 mx-1" />
            </div>
          )}
          
          <div className="flex items-center space-x-2">
            {user && !user.isAnonymous ? (
              <div className="flex items-center gap-2">
                 <div className="flex flex-col items-end mr-1">
                   <span className="text-[10px] font-bold text-slate-900 leading-none truncate max-w-[80px]">{user.displayName}</span>
                   <button onClick={handleSignOut} className="text-[9px] text-slate-400 hover:text-red-500 font-bold uppercase">Sign Out</button>
                 </div>
                 {user.photoURL ? (
                    <img src={user.photoURL} alt="Avatar" className="w-8 h-8 rounded-full border border-slate-200 shadow-sm" referrerPolicy="no-referrer" />
                 ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">{user.email?.charAt(0).toUpperCase()}</div>
                 )}
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={handleGoogleSignIn} className="h-8 text-[10px] font-bold gap-2 rounded-full border-slate-200">
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </Button>
            )}
          </div>
          
          <div className="h-6 w-[1px] bg-slate-200" />
          <div className="flex items-center space-x-2">
            <div className="flex bg-slate-100 p-1 rounded-full border border-slate-200">
              <button 
                onClick={exportAsImage}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white rounded-full transition-all"
                title="Export as PNG"
              >
                <FileImage className="w-3 h-3" />
                PNG
              </button>
              <button 
                onClick={exportAsPDF}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-white rounded-full transition-all"
                title="Export as PDF"
              >
                <FileDown className="w-3 h-3" />
                PDF
              </button>
            </div>
            <Button variant="default" size="sm" onClick={() => setIsShareModalOpen(true)} className="h-8 text-[10px] font-bold rounded-full shadow-polish">Share</Button>
          </div>
        </div>
      </header>

      <div className="flex-1 relative bg-slate-50/50">
        {!canEdit && (
          <div className="absolute top-4 right-1/2 translate-x-1/2 z-30 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 shadow-sm">
            <Lock className="w-3 h-3" />
            View Only Mode
          </div>
        )}
        <Toolbar activeTool={tool} setTool={setTool} color={color} setColor={setColor} disabled={!canEdit} />
        <canvas ref={canvasRef} />
        
        <div className="absolute bottom-6 right-6 flex items-center gap-3">
          <Presence boardId={boardId} socket={socketRef.current} />
          {canEdit && (
            <Button variant="outline" size="sm" onClick={clearCanvas} className="text-red-500 border-red-100 hover:bg-red-50 px-2 py-1 h-8 rounded-full shadow-sm bg-white">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Share Modal */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-polish border border-slate-100 relative slide-in-from-bottom-4 animate-in duration-300">
            <button 
              onClick={() => setIsShareModalOpen(false)}
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                <Globe className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Share Board</h2>
                <p className="text-sm text-slate-500">Invite others to collaborate</p>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">Link Permissions</label>
                <div className="flex flex-col gap-2">
                  <button 
                    disabled={!isOwner}
                    onClick={() => updatePublicPermission('view')}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                      boardData?.publicPermission === 'view' ? "border-blue-500 bg-blue-50/50" : "border-slate-100 hover:border-slate-200"
                    )}
                  >
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Anyone with link can view</h4>
                      <p className="text-xs text-slate-500">Recipients can only see the board</p>
                    </div>
                    {boardData?.publicPermission === 'view' && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                  </button>
                  <button 
                    disabled={!isOwner}
                    onClick={() => updatePublicPermission('edit')}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                      boardData?.publicPermission === 'edit' ? "border-blue-500 bg-blue-50/50" : "border-slate-100 hover:border-slate-200"
                    )}
                  >
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Anyone with link can edit</h4>
                      <p className="text-xs text-slate-500">Perfect for team brainstorming</p>
                    </div>
                    {boardData?.publicPermission === 'edit' && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                  </button>
                </div>
                {!isOwner && (
                  <p className="text-[10px] text-amber-600 font-bold mt-2 flex items-center gap-1.5 px-1 uppercase tracking-tight">
                    <Lock className="w-3 h-3" /> Only board owners can change permissions
                  </p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">Direct Links</label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-100 px-4 py-2.5 rounded-xl text-xs font-mono text-slate-500 truncate">
                      {window.location.origin + window.location.search + "&mode=view"}
                    </div>
                    <Button variant="outline" size="sm" className="h-10 rounded-xl" onClick={() => copyLink('view')}>
                      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-100 px-4 py-2.5 rounded-xl text-xs font-mono text-slate-500 truncate">
                      {window.location.origin + window.location.search + "&mode=edit"}
                    </div>
                    <Button variant="outline" size="sm" className="h-10 rounded-xl" onClick={() => copyLink('edit')}>
                        {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
