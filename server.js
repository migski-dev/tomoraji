const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/broadcast', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'broadcaster.html'));
});

app.get('/listen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'listener.html'));
});

// Active broadcasters
const activeBroadcasters = new Map();

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // When a broadcaster starts streaming
  socket.on('start-broadcasting', (broadcasterName) => {
    activeBroadcasters.set(socket.id, {
      id: socket.id,
      name: broadcasterName || `Broadcaster-${socket.id.substring(0, 5)}`
    });
    
    // Inform all clients about the new broadcaster
    io.emit('update-broadcasters', Array.from(activeBroadcasters.values()));
    console.log(`${broadcasterName} started broadcasting`);
  });
  
  // Handle audio chunks from broadcasters
  socket.on('audio-chunk', (data) => {
    // Broadcast the audio chunk to all listeners of this broadcaster
    socket.broadcast.to(`listeners:${socket.id}`).emit('audio-chunk', data);
  });
  
  // When a listener wants to tune in to a broadcaster
  socket.on('join-broadcast', (broadcasterId) => {
    socket.join(`listeners:${broadcasterId}`);
    console.log(`User ${socket.id} joined broadcast ${broadcasterId}`);
  });
  
  // When a listener leaves a broadcast
  socket.on('leave-broadcast', (broadcasterId) => {
    socket.leave(`listeners:${broadcasterId}`);
    console.log(`User ${socket.id} left broadcast ${broadcasterId}`);
  });
  
  // Request for available broadcasters
  socket.on('get-broadcasters', () => {
    socket.emit('update-broadcasters', Array.from(activeBroadcasters.values()));
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    if (activeBroadcasters.has(socket.id)) {
      activeBroadcasters.delete(socket.id);
      io.emit('update-broadcasters', Array.from(activeBroadcasters.values()));
      console.log(`Broadcaster ${socket.id} disconnected`);
    }
    console.log('User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
