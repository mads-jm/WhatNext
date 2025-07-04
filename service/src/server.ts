import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();
const port = 3001;

app.get('/', (req, res) => {
  res.send('WhatNext Helper Service');
});

const server = app.listen(port, () => {
  console.log(`Helper service listening on http://localhost:${port}`);
});

// Basic WebSocket server for WebRTC signaling
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  console.log('Signaling client connected');
  ws.on('message', message => {
    console.log('received: %s', message);
    // Broadcast to all other clients
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === ws.OPEN) {
        client.send(message.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log('Signaling client disconnected');
  });
});

console.log('Signaling server started.');
