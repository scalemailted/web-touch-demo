// --- START OF FILE server.js ---

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
// REMOVED: const shortid = require('shortid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- Room Code Generation ---
const CODE_LENGTH = 4;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    return code;
}

// --- Per-Room State Store ---
// Map<RoomCode (4-letter UPPERCASE), RoomState>
const roomStates = new Map();

// Function to create initial state for a new room
function createInitialRoomState(appSocketId) { /* ... same ... */ return { appSocketId: appSocketId, controllerSocketIds: new Set(), lastKnownCursor: { x: 400, y: 300, isVisible: false }, lastKnownFocusSelector: null, lastKnownFocusValue: '', controllerState: { keyboardMode: 'letters', isShiftActive: false }, sensitivity: 2.0 }; }
// --- Helper Functions ---
function getInitialStateForApp(roomState) { /* ... same ... */ if (!roomState) return {}; return { cursor: roomState.lastKnownCursor, focusedElementSelector: roomState.lastKnownFocusSelector, focusedElementValue: roomState.lastKnownFocusValue, hoveredElementSelector: null }; }
function broadcastControllerStateToRoom(roomCode) { /* ... same logic, uses roomCode ... */ const roomState = roomStates.get(roomCode); if (!roomState) return; const stateToSend = { controllerState: roomState.controllerState }; roomState.controllerSocketIds.forEach(sid => { io.to(sid).emit('update_controller_state', stateToSend); }); }

// --- Express Routes ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'app.html')); });
app.get('/controller', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'controller.html')); });

// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    let currentRoomCode = null; // Track the 4-letter room code

    // --- Disconnection ---
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}, From Room: ${currentRoomCode}`);
        if (currentRoomCode) {
            const roomState = roomStates.get(currentRoomCode); // Lookup by code
            if (roomState) {
                if (socket.id === roomState.appSocketId) {
                    console.log(`App owner (Socket: ${socket.id}) of room ${currentRoomCode} disconnected.`);
                     roomState.controllerSocketIds.forEach(controllerSid => { /* ... inform controllers ... */ const controllerSocket = io.sockets.sockets.get(controllerSid); if(controllerSocket) { console.log(`Informing controller ${controllerSid} in room ${currentRoomCode} about app disconnect.`); controllerSocket.emit('app_disconnected'); controllerSocket.leave(currentRoomCode); } });
                    roomStates.delete(currentRoomCode);
                    console.log(`Room ${currentRoomCode} removed.`);
                } else if (roomState.controllerSocketIds.has(socket.id)) {
                    roomState.controllerSocketIds.delete(socket.id);
                    console.log(`Controller ${socket.id} left room ${currentRoomCode}. Remaining: ${roomState.controllerSocketIds.size}`);
                    if (roomState.controllerSocketIds.size === 0 && roomState.lastKnownCursor.isVisible) { /* ... update visibility ... */ roomState.lastKnownCursor.isVisible = false; console.log(`Last controller left room ${currentRoomCode}. Updating app cursor state.`); if(roomState.appSocketId) { io.to(roomState.appSocketId).emit('set_cursor_visibility', false); } }
                }
            } else { console.log(`Disconnected socket ${socket.id} claimed room ${currentRoomCode}, but room state not found.`); }
        }
    });

    // --- Registration ---
    socket.on('register_app_room', () => {
        let roomCode = generateRoomCode();
        // Ensure uniqueness
        while (roomStates.has(roomCode)) {
            roomCode = generateRoomCode();
        }
        currentRoomCode = roomCode;
        console.log(`App (Socket: ${socket.id}) registering for NEW room code: ${roomCode}`);

        const newRoomState = createInitialRoomState(socket.id);
        roomStates.set(roomCode, newRoomState); // Use 4-letter code as the map key

        socket.join(roomCode); // Join the Socket.IO room named with the code

        socket.emit('your_room_id', roomCode); // Send the code back
        socket.emit('initial_state', getInitialStateForApp(newRoomState));
        socket.emit('set_cursor_visibility', false);
    });

    // Rejoin logic also uses uppercase code
    socket.on('rejoin_app_room', (roomCode) => {
        const upperRoomCode = roomCode.toUpperCase(); // Ensure lookup is case-insensitive
        console.log(`App (Socket: ${socket.id}) attempting to REJOIN room code: ${upperRoomCode}`);
        const roomState = roomStates.get(upperRoomCode);

        if (roomState) {
            currentRoomCode = upperRoomCode; // Associate with uppercase code
            const oldAppSocketId = roomState.appSocketId;
            roomState.appSocketId = socket.id; // Update socket ID

            socket.join(upperRoomCode);

            console.log(`App (Socket: ${socket.id}) successfully REJOINED room ${upperRoomCode}. Old socket was ${oldAppSocketId}.`);

            socket.emit('your_room_id', upperRoomCode); // Confirm the code
            socket.emit('initial_state', getInitialStateForApp(roomState));
            socket.emit('set_cursor_visibility', roomState.lastKnownCursor.isVisible);

             roomState.controllerSocketIds.forEach(controllerSid => { io.to(controllerSid).emit('app_reconnected'); });

        } else {
            console.warn(`App (Socket: ${socket.id}) failed to REJOIN room ${upperRoomCode}: Room not found.`);
            socket.emit('rejoin_failed', upperRoomCode);
        }
    });

    socket.on('register_controller_room', (roomCode) => { // roomCode might be mixed case from URL/input
        const upperRoomCode = roomCode.toUpperCase(); // Standardize to uppercase for lookup and joining
        console.log(`Controller ${socket.id} attempting to join room: ${upperRoomCode} (Original: ${roomCode})`);
        const roomState = roomStates.get(upperRoomCode);

        if (roomState) {
             currentRoomCode = upperRoomCode; // Associate with uppercase code
             roomState.controllerSocketIds.add(socket.id);
             socket.join(upperRoomCode); // Join room named with uppercase code
             console.log(`Controller ${socket.id} successfully joined room ${upperRoomCode}. Total: ${roomState.controllerSocketIds.size}`);

             let cursorVisibilityChanged = false;
             if (!roomState.lastKnownCursor.isVisible) { /* ... update visibility ... */ roomState.lastKnownCursor.isVisible = true; cursorVisibilityChanged = true; console.log(`First controller joined room ${upperRoomCode}. Updating app cursor state.`); }

             socket.emit('update_controller_state', { controllerState: roomState.controllerState });

             if (cursorVisibilityChanged && roomState.appSocketId) { /* ... update app visibility ... */ const appSocket = io.sockets.sockets.get(roomState.appSocketId); if (appSocket) { io.to(roomState.appSocketId).emit('set_cursor_visibility', true); } else { console.warn(`Room ${upperRoomCode}: App owner socket ${roomState.appSocketId} not found.`); roomState.lastKnownCursor.isVisible = true; } }
         } else {
            console.warn(`Controller ${socket.id} failed to join room ${upperRoomCode}: Room not found.`);
            socket.emit('invalid_room', upperRoomCode); // Send back the code that failed
            socket.disconnect();
         }
    });

    // --- State Reporting ---
    // Ensure roomId is standardized (although app sends the one it was given, which is already upper)
    socket.on('report_cursor_position', (data) => { /* ... validation ... */ if (data && data.roomId && data.pos) { const roomState = roomStates.get(data.roomId); if (roomState && socket.id === roomState.appSocketId) { roomState.lastKnownCursor.x = data.pos.x; roomState.lastKnownCursor.y = data.pos.y; } } });
    socket.on('report_focus_change', (data) => { /* ... validation ... */ if (data && data.roomId && data.focusInfo) { const roomState = roomStates.get(data.roomId); if (roomState && socket.id === roomState.appSocketId) { roomState.lastKnownFocusSelector = data.focusInfo.selector; roomState.lastKnownFocusValue = data.focusInfo.value || ''; } } });

    // --- Controller Actions ---
    // Standardize roomId to uppercase for lookup in all action handlers
    socket.on('cursor_move', (data) => { /* ... */ if (data && data.roomId) { const upperRoomCode = data.roomId.toUpperCase(); const roomState = roomStates.get(upperRoomCode); if (roomState && roomState.controllerSocketIds.has(socket.id)) { if (roomState.appSocketId) { const appSocket = io.sockets.sockets.get(roomState.appSocketId); if (appSocket) { const sensitiveData = { deltaX: (data.deltaX || 0) * roomState.sensitivity, deltaY: (data.deltaY || 0) * roomState.sensitivity }; io.to(roomState.appSocketId).emit('cursor_move', sensitiveData); } else console.warn(`[Server] cursor_move: App socket ${roomState.appSocketId} not connected in room ${upperRoomCode}.`); } } else console.warn(`[Server] cursor_move: Validation failed for room ${upperRoomCode} or sender ${socket.id}.`); } });
    socket.on('tap', (data) => { /* ... */ if (data && data.roomId) { const upperRoomCode = data.roomId.toUpperCase(); const roomState = roomStates.get(upperRoomCode); if (roomState && roomState.controllerSocketIds.has(socket.id)) { if (roomState.appSocketId) { const appSocket = io.sockets.sockets.get(roomState.appSocketId); if (appSocket) { io.to(roomState.appSocketId).emit('tap', { source: data.source }); } else console.warn(`[Server] tap: App socket ${roomState.appSocketId} not connected in room ${upperRoomCode}.`); } } else console.warn(`[Server] tap: Validation failed for room ${upperRoomCode} or sender ${socket.id}.`); } });
    socket.on('key_input', (data) => { /* ... */ if (data && data.roomId && data.key) { const upperRoomCode = data.roomId.toUpperCase(); const roomState = roomStates.get(upperRoomCode); if (roomState && roomState.controllerSocketIds.has(socket.id)) { const key = data.key; let controllerStateChanged = false; let keyToBroadcast = null; if (key === 'ToggleMode') { /* ... */ if (data.targetMode && ['letters', 'numbers', 'symbols2'].includes(data.targetMode)) { if (roomState.controllerState.keyboardMode !== data.targetMode) { roomState.controllerState.keyboardMode = data.targetMode; roomState.controllerState.isShiftActive = false; controllerStateChanged = true; } } } else if (key === 'ToggleShift') { /* ... */ if (roomState.controllerState.keyboardMode === 'letters') { roomState.controllerState.isShiftActive = !roomState.controllerState.isShiftActive; controllerStateChanged = true; } } else { /* ... */ if (roomState.controllerState.keyboardMode === 'letters' && roomState.controllerState.isShiftActive && key.length === 1 && key >= 'a' && key <= 'z') { keyToBroadcast = key.toUpperCase(); roomState.controllerState.isShiftActive = false; controllerStateChanged = true; } else { keyToBroadcast = key; } } if (controllerStateChanged) { broadcastControllerStateToRoom(upperRoomCode); } if (keyToBroadcast && roomState.appSocketId) { const appSocket = io.sockets.sockets.get(roomState.appSocketId); if (appSocket) { io.to(roomState.appSocketId).emit('key_input', { key: keyToBroadcast }); } else console.warn(`[Server] key_input: App socket ${roomState.appSocketId} not connected in room ${upperRoomCode}.`); } } else console.warn(`[Server] key_input: Validation failed for room ${upperRoomCode} or sender ${socket.id}.`); } });

});

server.listen(PORT, () => { console.log(`Server listening on *:${PORT}`); });

// --- END OF FILE server.js ---