// --- START OF FILE server.js ---

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

const CODE_LENGTH = 4;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function generateRoomCode() { /* ... */ let code = ''; for (let i = 0; i < CODE_LENGTH; i++) { code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length)); } return code; }

const roomStates = new Map();
const adminSockets = new Set();

function createInitialRoomState(appSocketId) { /* ... same ... */ return { appSocketId: appSocketId, controllerSocketIds: new Set(), lastKnownCursor: { x: 400, y: 300, isVisible: false }, lastKnownFocusSelector: null, lastKnownFocusValue: '', controllerState: { keyboardMode: 'letters', isShiftActive: false }, sensitivity: 2.0 }; }
function getCurrentRoomAppState(roomState) { /* ... same ... */ if (!roomState) return {}; return { cursor: roomState.lastKnownCursor, focusedElementSelector: roomState.lastKnownFocusSelector, focusedElementValue: roomState.lastKnownFocusValue }; }
function broadcastControllerStateToRoom(roomCode) { /* ... same ... */ const roomState = roomStates.get(roomCode); if (!roomState) return; const stateToSend = { controllerState: roomState.controllerState }; roomState.controllerSocketIds.forEach(sid => { io.to(sid).emit('update_controller_state', stateToSend); }); }

// **MODIFIED:** Broadcast to Admins (can target specific admin if needed)
function broadcastToAdmins(eventName, data, targetAdminSid = null) {
    if (targetAdminSid) {
        io.to(targetAdminSid).emit(eventName, data);
    } else {
        adminSockets.forEach(adminSid => {
            io.to(adminSid).emit(eventName, data);
        });
    }
}

// **NEW:** Helper to get room list data for admin (includes controller status)
function getAdminRoomListData() {
    const roomListData = [];
    for (const [roomCode, roomState] of roomStates.entries()) {
        roomListData.push({
            code: roomCode,
            hasControllers: roomState.controllerSocketIds.size > 0
        });
    }
    return roomListData;
}


app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'app.html')); });
app.get('/controller', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'controller.html')); });
app.get('/admin', (req, res) => { /* ... */ res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    let currentRoomCode = null;
    let isAdmin = false;

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}, From Room: ${currentRoomCode}, IsAdmin: ${isAdmin}`);
        if (isAdmin) {
            adminSockets.delete(socket.id);
            console.log(`Admin disconnected: ${socket.id}. Remaining admins: ${adminSockets.size}`);
        } else if (currentRoomCode) {
            const roomState = roomStates.get(currentRoomCode);
            if (roomState) {
                if (socket.id === roomState.appSocketId) {
                    // ... App disconnect logic ...
                    console.log(`App owner (Socket: ${socket.id}) of room ${currentRoomCode} disconnected.`);
                    io.to(currentRoomCode).emit('app_disconnected');
                    roomStates.delete(currentRoomCode);
                    console.log(`Room ${currentRoomCode} removed.`);
                    broadcastToAdmins('room_destroyed', currentRoomCode); // Inform admins room is gone
                } else if (roomState.controllerSocketIds.has(socket.id)) {
                    // ... Controller disconnect logic ...
                    roomState.controllerSocketIds.delete(socket.id);
                    console.log(`Controller ${socket.id} left room ${currentRoomCode}. Remaining: ${roomState.controllerSocketIds.size}`);

                    const wasLastController = roomState.controllerSocketIds.size === 0;

                    // Update cursor visibility if needed
                    if (wasLastController && roomState.lastKnownCursor.isVisible) {
                        roomState.lastKnownCursor.isVisible = false;
                        console.log(`Last controller left room ${currentRoomCode}. Broadcasting cursor visibility.`);
                        io.to(currentRoomCode).emit('set_cursor_visibility', false);
                    }
                    // *** Inform admins about controller status change ***
                    broadcastToAdmins('room_controller_status', {
                        code: currentRoomCode,
                        hasControllers: !wasLastController // false if it was the last one
                    });
                }
            }
        }
    });

    // --- Admin Registration ---
    socket.on('register_admin', () => {
        isAdmin = true;
        adminSockets.add(socket.id);
        console.log(`Admin registered: ${socket.id}. Total admins: ${adminSockets.size}`);
        // Send current list of rooms *with controller status*
        socket.emit('initial_room_list', getAdminRoomListData());
    });

    // --- App Registration ---
    socket.on('register_app_room', () => {
        if (isAdmin) return;
        let roomCode = generateRoomCode();
        while (roomStates.has(roomCode)) { roomCode = generateRoomCode(); }
        currentRoomCode = roomCode;
        console.log(`App (Socket: ${socket.id}) registering for NEW room code: ${roomCode}`);
        const newRoomState = createInitialRoomState(socket.id);
        roomStates.set(roomCode, newRoomState);
        socket.join(roomCode);
        socket.emit('your_room_id', roomCode);
        socket.emit('initial_state', getCurrentRoomAppState(newRoomState));
        socket.emit('set_cursor_visibility', false);
        // Inform admins about the new room (initially no controllers)
        broadcastToAdmins('room_created', {
            code: roomCode,
            hasControllers: false
        });
    });

    // --- App Rejoin ---
    socket.on('rejoin_app_room', (roomCode) => { /* ... same logic ... */ const upperRoomCode = roomCode.toUpperCase(); console.log(`App (Socket: ${socket.id}) attempting to REJOIN room code: ${upperRoomCode}`); const roomState = roomStates.get(upperRoomCode); if (roomState) { currentRoomCode = upperRoomCode; roomState.appSocketId = socket.id; socket.join(upperRoomCode); console.log(`App (Socket: ${socket.id}) successfully REJOINED room ${upperRoomCode}.`); socket.emit('your_room_id', upperRoomCode); socket.emit('initial_state', getCurrentRoomAppState(roomState)); socket.emit('set_cursor_visibility', roomState.lastKnownCursor.isVisible); roomState.controllerSocketIds.forEach(controllerSid => { io.to(controllerSid).emit('app_reconnected'); }); } else { console.warn(`App (Socket: ${socket.id}) failed to REJOIN room ${upperRoomCode}: Room not found.`); socket.emit('rejoin_failed', upperRoomCode); } });

     // --- Controller Registration ---
     socket.on('register_controller_room', (roomCode) => {
          if (isAdmin) return;
          const upperRoomCode = roomCode.toUpperCase();
          console.log(`Controller ${socket.id} attempting to join room: ${upperRoomCode}`);
          const roomState = roomStates.get(upperRoomCode);
          if (roomState) {
              currentRoomCode = upperRoomCode;
              const wasFirstController = roomState.controllerSocketIds.size === 0; // Check BEFORE adding
              roomState.controllerSocketIds.add(socket.id);
              socket.join(upperRoomCode);
              console.log(`Controller ${socket.id} joined room ${upperRoomCode}. Total: ${roomState.controllerSocketIds.size}`);

              let cursorVisibilityChanged = false;
              if (wasFirstController) { // If it WAS the first controller
                   roomState.lastKnownCursor.isVisible = true; // Now visible
                   cursorVisibilityChanged = true;
                   console.log(`First controller joined room ${upperRoomCode}. Broadcasting cursor visibility.`);
                   // *** Inform admins controller status is now true ***
                   broadcastToAdmins('room_controller_status', {
                       code: upperRoomCode,
                       hasControllers: true
                   });
              }

              socket.emit('update_controller_state', { controllerState: roomState.controllerState });

              if (cursorVisibilityChanged) {
                   io.to(upperRoomCode).emit('set_cursor_visibility', true);
              }
          } else { /* ... invalid room handling ... */ console.warn(`Controller ${socket.id} failed to join room ${upperRoomCode}: Room not found.`); socket.emit('invalid_room', upperRoomCode); socket.disconnect(); }
     });

    // --- Admin Peek Logic --- (No changes needed here)
    socket.on('peek_request', (roomCode) => { /* ... */ if (!isAdmin) return; const upperRoomCode = roomCode.toUpperCase(); const roomState = roomStates.get(upperRoomCode); if (roomState) { console.log(`Admin ${socket.id} peeking into room ${upperRoomCode}`); socket.join(upperRoomCode); socket.emit('peek_initial_state', getCurrentRoomAppState(roomState)); } else { console.warn(`Admin ${socket.id} failed peek request for room ${upperRoomCode}: Not found.`); } });
    socket.on('stop_peeking', (roomCode) => { /* ... */ if (!isAdmin) return; const upperRoomCode = roomCode.toUpperCase(); console.log(`Admin ${socket.id} stopped peeking room ${upperRoomCode}`); socket.leave(upperRoomCode); });

    // --- State Reporting & Broadcasting --- (No changes needed here)
    socket.on('report_cursor_position', (data) => { /* ... */ if (data && data.roomId && data.pos) { const roomState = roomStates.get(data.roomId); if (roomState && socket.id === roomState.appSocketId) { roomState.lastKnownCursor.x = data.pos.x; roomState.lastKnownCursor.y = data.pos.y; io.to(data.roomId).emit('cursor_position_update', roomState.lastKnownCursor); } } });
    socket.on('report_focus_change', (data) => { /* ... */ if (data && data.roomId && data.focusInfo) { const roomState = roomStates.get(data.roomId); if (roomState && socket.id === roomState.appSocketId) { roomState.lastKnownFocusSelector = data.focusInfo.selector; roomState.lastKnownFocusValue = data.focusInfo.value || ''; io.to(data.roomId).emit('focus_update', { selector: roomState.lastKnownFocusSelector, value: roomState.lastKnownFocusValue }); } } });

    // --- Controller Actions -> Relay TO ROOM --- (No changes needed here)
    socket.on('cursor_move', (data) => { /* ... */ if (data && data.roomId) { const upperRoomCode = data.roomId.toUpperCase(); const roomState = roomStates.get(upperRoomCode); if (roomState && roomState.controllerSocketIds.has(socket.id)) { if (roomState.appSocketId) { const appSocket = io.sockets.sockets.get(roomState.appSocketId); if (appSocket) { const sensitiveData = { deltaX: (data.deltaX || 0) * roomState.sensitivity, deltaY: (data.deltaY || 0) * roomState.sensitivity }; io.to(roomState.appSocketId).emit('cursor_move', sensitiveData); } } } } });
    socket.on('tap', (data) => { /* ... */ if (data && data.roomId) { const upperRoomCode = data.roomId.toUpperCase(); const roomState = roomStates.get(upperRoomCode); if (roomState && roomState.controllerSocketIds.has(socket.id)) { io.to(upperRoomCode).emit('tap', { source: data.source }); } } });
    socket.on('key_input', (data) => { /* ... */ if (data && data.roomId && data.key) { const upperRoomCode = data.roomId.toUpperCase(); const roomState = roomStates.get(upperRoomCode); if (roomState && roomState.controllerSocketIds.has(socket.id)) { const key = data.key; let controllerStateChanged = false; let keyToBroadcast = null; if (key === 'ToggleMode'){ if (data.targetMode && ['letters', 'numbers', 'symbols2'].includes(data.targetMode)) { if (roomState.controllerState.keyboardMode !== data.targetMode) { roomState.controllerState.keyboardMode = data.targetMode; roomState.controllerState.isShiftActive = false; controllerStateChanged = true; } } } else if (key === 'ToggleShift'){ if (roomState.controllerState.keyboardMode === 'letters') { roomState.controllerState.isShiftActive = !roomState.controllerState.isShiftActive; controllerStateChanged = true; } } else { if (roomState.controllerState.keyboardMode === 'letters' && roomState.controllerState.isShiftActive && key.length === 1 && key >= 'a' && key <= 'z') { keyToBroadcast = key.toUpperCase(); roomState.controllerState.isShiftActive = false; controllerStateChanged = true; } else { keyToBroadcast = key; } } if (controllerStateChanged) { broadcastControllerStateToRoom(upperRoomCode); } if (keyToBroadcast) { io.to(upperRoomCode).emit('key_input', { key: keyToBroadcast }); } } } });

});

server.listen(PORT, () => { console.log(`Server listening on *:${PORT}`); });

// --- END OF FILE server.js ---