// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors()); // Allow cross-origin requests

const server = http.createServer(app);

// This is where the magic happens
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (for Vercel)
    methods: ["GET", "POST"],
  },
});

// This will store all our game room data in memory
const rooms = {};

// Helper function to generate a random 5-digit code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // --- ROOM MANAGEMENT ---

  // When a host creates a room
  socket.on("create-room", () => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: [],
      drawingData: [], // Store the drawing history
    };

    socket.join(roomCode);
    const hostPlayer = {
      id: socket.id,
      name: "Player1 (Host)",
      isHost: true,
    };
    rooms[roomCode].players.push(hostPlayer);

    // Send the room code back to the host
    socket.emit("room-created", { roomCode, player: hostPlayer });
  });

  // When a player tries to join a room
  socket.on("join-room", (roomCode) => {
    roomCode = roomCode.toUpperCase();
    const room = rooms[roomCode];

    if (!room) {
      return socket.emit("error-message", "Room not found.");
    }
    if (room.players.length >= 4) {
      return socket.emit("error-message", "Room is full.");
    }

    socket.join(roomCode);
    const newPlayer = {
      id: socket.id,
      name: `Player${room.players.length + 1}`,
      isHost: false,
    };
    room.players.push(newPlayer);

    // Send to the new player that they joined
    socket.emit("joined-room", { roomCode, player: newPlayer });
    // Send to everyone else in the room that a new player joined
    io.to(roomCode).emit("update-lobby", room.players);
  });

  // --- GAME LOGIC ---

  // When the host starts the game
  socket.on("start-game", (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.players[0].id === socket.id) {
      // Check if it's the host
      io.to(roomCode).emit("game-started");
    }
  });

  // When the drawer chooses a song
  socket.on("song-chosen", (data) => {
    const { roomCode, song } = data;
    const masked = song.replace(/[^\s]/g, "_");
    // Send to everyone *except* the drawer
    socket.broadcast.to(roomCode).emit("song-chosen-update", masked);
  });

  // When the drawer is drawing
  socket.on("drawing-data", (data) => {
    const { roomCode } = data;
    // Store this line
    if (rooms[roomCode]) {
      rooms[roomCode].drawingData.push(data);
    }
    // Send to everyone *except* the drawer
    socket.broadcast.to(roomCode).emit("drawing-update", data);
  });

  // When the drawer clears the canvas
  socket.on("clear-canvas", (roomCode) => {
    if (rooms[roomCode]) {
      rooms[roomCode].drawingData = []; // Clear history
    }
    io.to(roomCode).emit("canvas-cleared");
  });

  // When a player submits a guess
  socket.on("submit-guess", (data) => {
    const { roomCode, guess, player } = data;
    const room = rooms[roomCode];
    if (!room) return;

    // In a real app, you'd check this against the 'currentSong'
    // For now, we'll just broadcast the message
    const message = {
      user: player.name,
      text: guess,
      type: "normal",
    };

    // Simulate correct guess
    if (guess.toLowerCase().includes("munbe")) {
      message.type = "correct";
    }

    io.to(roomCode).emit("new-message", message);
  });

  // When a player disconnects
  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
    // Find which room they were in and remove them
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);

      if (playerIndex !== -1) {
        const leftPlayer = room.players.splice(playerIndex, 1)[0];
        // If the room is empty, delete it
        if (room.players.length === 0) {
          delete rooms[roomCode];
        } else {
          // If the host left, assign a new host
          if (leftPlayer.isHost) {
            room.players[0].isHost = true;
          }
          // Tell everyone else who is left
          io.to(roomCode).emit("player-left", room.players);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});