const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'app.html')); });
app.get('/controller', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'controller.html')); });

// --- Socket.IO Logic ---
let appSid = null;
const controllerSids = new Set();

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // --- Disconnection ---
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        if (socket.id === appSid) { appSid = null; }
        else if (controllerSids.has(socket.id)) {
            controllerSids.delete(socket.id);
            if (controllerSids.size === 0 && appSid) { io.to(appSid).emit('hide_cursor'); }
        } else { console.log("Unknown client disconnected"); }
    });

    // --- Registration ---
    socket.on('register_app', () => {
        if (appSid && appSid !== socket.id) { const oldSocket = io.sockets.sockets.get(appSid); if(oldSocket) oldSocket.disconnect(); }
        appSid = socket.id;
        console.log(`App display client registered with sid: ${appSid}`);
        if (controllerSids.size > 0) { io.to(appSid).emit('show_cursor'); }
        else { io.to(appSid).emit('hide_cursor'); }
    });
    socket.on('register_controller', () => {
        controllerSids.add(socket.id);
        console.log(`Controller client registered: ${socket.id}. Total: ${controllerSids.size}`);
        if (appSid) { if (controllerSids.size === 1) { io.to(appSid).emit('show_cursor'); } }
    });

    // --- Event Relaying ---
    socket.on('cursor_move', (data) => { if (controllerSids.has(socket.id) && appSid) { io.to(appSid).emit('cursor_move', data); } });
    socket.on('tap', (data) => { if (controllerSids.has(socket.id) && appSid) { io.to(appSid).emit('tap', data); } });
    socket.on('key_input', (data) => { if (controllerSids.has(socket.id) && appSid) { io.to(appSid).emit('key_input', data); } });

    // --- REMOVED Focus/Blur Handlers ---
    // socket.on('input_focused', () => { ... });
    // socket.on('input_blurred', () => { ... });
});

server.listen(PORT, () => { console.log(`Server listening on *:${PORT}`); });