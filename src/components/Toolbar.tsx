import React from 'react';
import { MousePointer2, Pencil, Eraser, Square, Circle as CircleIcon, Type, StickyNote } from 'lucide-react';
import { cn } from '../lib/utils';

interface ToolbarProps {
  activeTool: string;
  setTool: (tool: any) => void;
  color: string;
  setColor: (color: string) => void;
  disabled?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({ activeTool, setTool, color, setColor, disabled }) => {
  const tools = [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'pen', icon: Pencil, label: 'Pen' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
    { id: 'rect', icon: Square, label: 'Rectangle' },
    { id: 'circle', icon: CircleIcon, label: 'Circle' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'sticky', icon: StickyNote, label: 'Sticky Note' },
  ];

  const colors = [
    '#000000', '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'
  ];

  if (disabled) return null;

  return (
    <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-20">
      <div className="w-14 bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/50 flex flex-col items-center py-4 space-y-2">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={cn(
              "p-2.5 rounded-xl transition-all group relative",
              activeTool === t.id ? "bg-blue-50 text-blue-600 shadow-sm" : "text-slate-400 hover:bg-slate-50"
            )}
            title={t.label}
          >
            <t.icon className="w-6 h-6" />
            <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap font-bold uppercase tracking-wider">
              {t.label}
            </div>
          </button>
        ))}
        
        <div className="w-8 h-[1px] bg-slate-100 my-2" />
        
        <div className="flex flex-col gap-2 items-center">
          <div className="grid grid-cols-2 gap-1.5 p-1">
            {colors.slice(0, 4).map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn(
                  "w-4 h-4 rounded-full border border-slate-100 transition-transform hover:scale-125",
                  color === c ? "ring-2 ring-blue-500 ring-offset-1" : ""
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="relative w-6 h-6 rounded-full border border-slate-200 overflow-hidden shadow-sm">
            <input 
              type="color" 
              value={color} 
              onChange={(e) => setColor(e.target.value)}
              className="absolute -inset-2 w-12 h-12 cursor-pointer border-none p-0 bg-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
