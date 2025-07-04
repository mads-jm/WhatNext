#!/bin/bash
#
# WhatNext Project Initialization Script
#
# This script will:
# 1. Create the main project directory and initialize a Git repository.
# 2. Set up the monorepo structure with directories for the app and helper service.
# 3. Scaffold a modern Electron + React + TypeScript application using electron-vite.
# 4. Install all necessary dependencies for the client application.
# 5. Create placeholder files for documentation and the helper service.
#

# --- Configuration ---
PROJECT_NAME="whatnext"

# --- Script Start ---
echo "--- Initializing WhatNext Project: $PROJECT_NAME ---"

# 1. Create project directory and initialize Git
mkdir "$PROJECT_NAME"
cd "$PROJECT_NAME"
git init
echo "Git repository initialized in $(pwd)"

# 2. Create monorepo structure
mkdir -p app service docs
echo "Created directory structure: /app, /service, /docs"

# 3. Scaffold the Electron/React app in the 'app' directory
echo "--- Scaffolding the Electron application in /app ---"
cd app

# Using electron-vite with the React + TypeScript template
npm create vite@latest . -- --template electron-react-ts
echo "Electron + React + TypeScript app created."

# 4. Install core application dependencies as per the spec
echo "--- Installing core application dependencies ---"

# RxDB for the reactive database and its plugins
# rxdb: The core library
# rxdb/plugin-replication-webrtc: For P2P synchronization
# rxdb/plugin-local-documents: For storing non-collection data
# rxdb/plugin-storage-dexie: For the IndexedDB storage adapter (MVP)
npm install rxdb @rxdb/plugin-replication-webrtc @rxdb/plugin-local-documents @rxdb/plugin-storage-dexie

# State management
# zustand: Lightweight global state management
npm install zustand

# P2P Networking Dependencies (required by RxDB replication)
# simple-peer: WebRTC wrapper
# webrtc-adapter: WebRTC polyfill
npm install simple-peer webrtc-adapter

# Utility libraries
# uuid: For generating unique IDs for playlists, tracks, etc.
npm install uuid
npm install -D @types/uuid # Developer dependency for TypeScript types

echo "All core dependencies installed."

# 5. Create placeholder documentation and service files
echo "--- Creating placeholder documentation and service files ---"
cd .. # Back to project root

# Create root README
cat > README.md << EOL
# WhatNext

A resilient, user-centric music management platform.

See the full project specification in \`docs/whtnxt-nextspec.md\`.
EOL

# Copy the spec into the docs folder
# Assuming you have the spec file in the current directory or can copy it here
# cp path/to/whtnxt-nextspec.md docs/whtnxt-nextspec.md

# Create a basic .gitignore
cat > .gitignore << EOL
# Node
node_modules/
dist/
dist-electron/
release/
.npm/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
*.env

# OS-specific
.DS_Store
Thumbs.db
EOL

# Create placeholder for the helper service
cd service
npm init -y
npm install typescript express ws @types/express @types/ws ts-node nodemon --save-dev
# Create a basic tsconfig for the service
cat > tsconfig.json << EOL
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  }
}
EOL
# Create a placeholder server file
mkdir -p src
cat > src/server.ts << EOL
import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();
const port = 3001;

app.get('/', (req, res) => {
  res.send('WhatNext Helper Service');
});

const server = app.listen(port, () => {
  console.log(\`Helper service listening on http://localhost:\${port}\`);
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
EOL
cd .. # Back to project root

echo "--- Project Initialization Complete ---"
echo ""
echo "Next Steps:"
echo "1. cd $PROJECT_NAME/app"
echo "2. npm install (to ensure all scaffolded dependencies are there)"
echo "3. npm run dev (to start the development server for the Electron app)"
echo "4. In a separate terminal, cd $PROJECT_NAME/service and run 'npx ts-node src/server.ts' to start the helper service."
