const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }   // allow connection from browser
});

// Serve static files (game.html, etc.) from the current folder
app.use(express.static(__dirname));

// Simple root page
app.get('/', (req, res) => {
  res.send(`
    <h1>Coinflip prototype is running 🚀</h1>
    <p><a href="/game.html">Open the game page</a></p>
  `);
});

// Fake balances: socket.id → number of coins
const balances = {};

// Games: gameId → game object
const games = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Give new player 100 fake coins
  if (!balances[socket.id]) {
    balances[socket.id] = 100;
  }

  // Send current balance to this player
  socket.emit('balanceUpdate', balances[socket.id]);

  // Create a new game
  socket.on('createGame', ({ bet }) => {
    bet = Number(bet);

    if (isNaN(bet) || bet <= 0 || bet > balances[socket.id]) {
      socket.emit('error', 'Invalid bet or not enough coins');
      return;
    }

    const gameId = Math.random().toString(36).substring(2, 10);

    games[gameId] = {
      player1: socket.id,
      player2: null,
      bet,
      status: 'waiting'
    };

    // Deduct bet from creator
    balances[socket.id] -= bet;
    socket.emit('balanceUpdate', balances[socket.id]);

    socket.emit('gameCreated', {
      gameId,
      message: `Waiting for player 2... Bet: ${bet} coins`
    });
  });

  // Join an existing game
  socket.on('joinGame', ({ gameId }) => {
    const game = games[gameId];

    if (!game || game.status !== 'waiting') {
      socket.emit('error', 'Game not found or already started');
      return;
    }

    if (game.player1 === socket.id) {
      socket.emit('error', 'You cannot join your own game');
      return;
    }

    if (balances[socket.id] < game.bet) {
      socket.emit('error', 'Not enough coins to join');
      return;
    }

    game.player2 = socket.id;
    game.status = 'ready';

    // Deduct bet from joiner
    balances[socket.id] -= game.bet;
    socket.emit('balanceUpdate', balances[socket.id]);

    // Notify both players
    io.to(game.player1).emit('gameReady', { gameId, opponent: socket.id });
    socket.emit('gameReady', { gameId, opponent: game.player1 });
  });

  // Flip the coin (anyone can trigger after ready)
  socket.on('flip', ({ gameId }) => {
    const game = games[gameId];
    if (!game || game.status !== 'ready') {
      socket.emit('error', 'Game not ready or not found');
      return;
    }

    const isHeads = Math.random() < 0.5;
    const winnerId = isHeads ? game.player1 : game.player2;

    const pot = game.bet * 2;
    const fee = Math.floor(pot * 0.1);
    const winAmount = pot - fee;

    // Give winnings to winner
    balances[winnerId] += winAmount;

    game.status = 'finished';
    game.outcome = isHeads ? 'heads' : 'tails';
    game.winner = winnerId;

    // Send personalized result to each player
    io.to(game.player1).emit('gameResult', {
      outcome: game.outcome.toUpperCase(),
      message: winnerId === game.player1 ? 'You win!' : 'You lose!',
      winAmount: winnerId === game.player1 ? winAmount : 0,
      fee,
      yourNewBalance: balances[game.player1]
    });

    io.to(game.player2).emit('gameResult', {
      outcome: game.outcome.toUpperCase(),
      message: winnerId === game.player2 ? 'You win!' : 'You lose!',
      winAmount: winnerId === game.player2 ? winAmount : 0,
      fee,
      yourNewBalance: balances[game.player2]
    });

    // Update balances for both
    io.to(game.player1).emit('balanceUpdate', balances[game.player1]);
    io.to(game.player2).emit('balanceUpdate', balances[game.player2]);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server started → http://localhost:${PORT}`);
  console.log(`Game page: http://localhost:${PORT}/game.html`);
});