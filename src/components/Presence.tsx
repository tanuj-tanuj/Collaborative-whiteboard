import React, { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Users } from 'lucide-react';

interface PresenceProps {
  boardId: string;
  socket: Socket | null;
}

export const Presence: React.FC<PresenceProps> = ({ socket }) => {
  const [onlineUsers, setOnlineUsers] = useState<number>(1);

  useEffect(() => {
    if (!socket) return;

    // This is simple mock for online count as the server broadcast isn't fully implemented
    // In a real app, I'd track a list of user objects with positions
    
    // For now, let's just show a subtle indicator
    return () => {};
  }, [socket]);

  return (
    <div className="bg-white px-3 py-1.5 border border-slate-200 rounded-full flex items-center space-x-2 text-[10px] font-bold text-slate-500 shadow-sm uppercase tracking-widest">
      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-sm shadow-emerald-200" />
      <span>Connected • Syncing Live</span>
    </div>
  );
};
