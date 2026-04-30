import React, { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Users } from 'lucide-react';

interface PresenceProps {
  boardId: string;
  socket: Socket | null;
  onlineCount: number;
}

export const Presence: React.FC<PresenceProps> = ({ onlineCount }) => {
  return (
    <div className="bg-white px-3 py-1.5 border border-slate-200 rounded-full flex items-center space-x-2 text-[10px] font-bold text-slate-500 shadow-sm uppercase tracking-widest">
      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-sm shadow-emerald-200" />
      <span>{onlineCount > 0 ? `${onlineCount + 1} Active` : 'Connected'} • Syncing Live</span>
    </div>
  );
};
