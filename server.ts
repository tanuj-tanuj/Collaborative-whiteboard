import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  const PORT = 3000;

  // Simple store for current cursors (non-persistent)
  const cursors: Record<string, any> = {};

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-board', (boardId) => {
      socket.join(boardId);
      console.log(`User ${socket.id} joined board ${boardId}`);
    });

    socket.on('canvas-update', (data) => {
      // data: { boardId, delta } or full state? 
      // For simplicity in this demo, it broadcasts the update to others
      socket.to(data.boardId).emit('canvas-update-remote', data.update);
    });

    socket.on('cursor-move', (data) => {
      socket.to(data.boardId).emit('cursor-move-remote', {
        userId: socket.id,
        ...data
      });
    });

    socket.on('disconnect', () => {
      io.emit('user-disconnected', socket.id);
      console.log('User disconnected:', socket.id);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
