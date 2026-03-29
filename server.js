const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Game Engine (ported from cloudfunctions/open/index.js)
// ============================================================

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const HAND_TYPE = {
  HIGH_CARD: 0, PAIR: 1, STRAIGHT: 2, FLUSH: 3, STRAIGHT_FLUSH: 4, THREE_OF_A_KIND: 5
};

function rankValue(rank) {
  if (rank === 'A') return 14;
  if (rank === 'K') return 13;
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  return parseInt(rank);
}

function parseCard(cardStr) {
  const suit = cardStr[0];
  const rank = cardStr.slice(1);
  return { suit, rank, value: rankValue(rank), text: cardStr };
}

function evaluateThreeCards(c1, c2, c3) {
  const cards = [parseCard(c1), parseCard(c2), parseCard(c3)];
  cards.sort((a, b) => b.value - a.value);

  const values = cards.map(c => c.value);
  const suits = cards.map(c => c.suit);
  const sameSuit = suits[0] === suits[1] && suits[1] === suits[2];

  const sorted = values.slice().sort((a, b) => a - b);
  const is235 = sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 5;
  const isSpecial235 = is235 && !sameSuit;

  if (values[0] === values[1] && values[1] === values[2]) {
    return { type: HAND_TYPE.THREE_OF_A_KIND, typeName: '豹子', cmp: values, is235: false };
  }

  let isStraight = false;
  let straightCmp = values;
  if (values[0] - values[1] === 1 && values[1] - values[2] === 1) isStraight = true;
  if (values[0] === 14 && values[1] === 3 && values[2] === 2) {
    isStraight = true;
    straightCmp = [3, 2, 1];
  }

  if (sameSuit && isStraight) return { type: HAND_TYPE.STRAIGHT_FLUSH, typeName: '同花顺', cmp: straightCmp, is235: false };
  if (sameSuit) return { type: HAND_TYPE.FLUSH, typeName: '同花', cmp: values, is235: false };
  if (isStraight) return { type: HAND_TYPE.STRAIGHT, typeName: '顺子', cmp: straightCmp, is235: false };

  if (values[0] === values[1]) return { type: HAND_TYPE.PAIR, typeName: '对子', cmp: [values[0], values[0], values[2]], is235: false };
  if (values[1] === values[2]) return { type: HAND_TYPE.PAIR, typeName: '对子', cmp: [values[1], values[1], values[0]], is235: false };

  return {
    type: HAND_TYPE.HIGH_CARD,
    typeName: isSpecial235 ? '散牌(2-3-5)' : '散牌',
    cmp: values,
    is235: isSpecial235
  };
}

function compareHands(a, b) {
  if (a.is235 && b.type === HAND_TYPE.THREE_OF_A_KIND) return 1;
  if (b.is235 && a.type === HAND_TYPE.THREE_OF_A_KIND) return -1;
  if (a.type !== b.type) return a.type - b.type;
  for (let i = 0; i < a.cmp.length; i++) {
    if (a.cmp[i] !== b.cmp[i]) return a.cmp[i] - b.cmp[i];
  }
  return 0;
}

function findBestHand(publicCard, handCard) {
  let bestHand = null;
  let bestWild = null;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const wild = `${suit}${rank}`;
      const hand = evaluateThreeCards(publicCard, handCard, wild);
      if (!bestHand || compareHands(hand, bestHand) > 0) {
        bestHand = hand;
        bestWild = wild;
      }
    }
  }
  return { hand: bestHand, wildCard: bestWild };
}

// ============================================================
// Room Store (in-memory, replaces cloud database)
// ============================================================

const roomStore = new Map();

function createDeck() {
  const deck = [];
  SUITS.forEach(s => RANKS.forEach(r => deck.push(`${s}${r}`)));
  return deck;
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateRoomId() {
  for (let i = 0; i < 100; i++) {
    const id = Math.floor(100000 + Math.random() * 900000).toString();
    if (!roomStore.has(id)) return id;
  }
  throw new Error('无法生成房间号');
}

function getNextDealer(players, currentDealerOpenId) {
  const idx = players.findIndex(p => p.openId === currentDealerOpenId);
  if (idx === -1) return players[0].openId;
  return players[(idx + 1) % players.length].openId;
}

function sanitizeRoom(room) {
  return {
    roomId: room.roomId,
    ownerOpenId: room.ownerOpenId,
    dealerOpenId: room.dealerOpenId,
    status: room.status,
    publicCard: room.publicCard,
    roundResult: room.roundResult,
    players: room.players.map(p => ({
      openId: p.openId,
      nickName: p.nickName,
      avatarUrl: p.avatarUrl,
      hasDealt: p.hasDealt,
      card: p.card,
      bet: p.bet,
      score: p.score,
      isMock: p.isMock || false
    }))
  };
}

function broadcastRoom(roomId) {
  const room = roomStore.get(roomId);
  if (room) {
    io.to(`room:${roomId}`).emit('roomUpdate', sanitizeRoom(room));
  }
}

// ============================================================
// API Routes
// ============================================================

app.post('/api/createRoom', (req, res) => {
  try {
    const { playerId, nickName = '玩家', avatarUrl = '' } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = generateRoomId();
    const deck = shuffle(createDeck());

    const room = {
      roomId,
      ownerOpenId: playerId,
      dealerOpenId: playerId,
      status: 'waiting',
      deck,
      publicCard: null,
      roundResult: null,
      players: [{
        openId: playerId, nickName, avatarUrl,
        hasDealt: false, card: null, bet: null, score: 0
      }],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    roomStore.set(roomId, room);
    res.json({ ok: true, roomId, openId: playerId });
  } catch (err) {
    console.error('createRoom error:', err);
    res.json({ ok: false, code: 'CREATE_FAILED', message: err.message });
  }
});

app.post('/api/joinRoom', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, nickName = '玩家', avatarUrl = '' } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    const players = room.players;
    const idx = players.findIndex(p => p.openId === playerId);
    const isNewPlayer = idx === -1;

    if (isNewPlayer && room.status !== 'waiting') {
      return res.json({ ok: false, code: 'GAME_IN_PROGRESS', message: '游戏中，请等待本局结束后再加入' });
    }

    if (isNewPlayer) {
      players.push({
        openId: playerId, nickName, avatarUrl,
        hasDealt: false, card: null, bet: null, score: 0
      });
    } else {
      players[idx].nickName = nickName;
      players[idx].avatarUrl = avatarUrl;
    }

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, openId: playerId, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('joinRoom error:', err);
    res.json({ ok: false, code: 'JOIN_FAILED', message: err.message });
  }
});

app.post('/api/getRoom', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    res.json({ ok: true, openId: playerId || '', room: sanitizeRoom(room) });
  } catch (err) {
    console.error('getRoom error:', err);
    res.json({ ok: false, code: 'GET_ROOM_FAILED', message: err.message });
  }
});

app.post('/api/deal', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    const players = room.players;
    const idx = players.findIndex(p => p.openId === playerId);
    if (idx === -1) return res.json({ ok: false, code: 'PLAYER_NOT_IN_ROOM', message: '玩家不在房间内' });

    if (room.status !== 'waiting' && room.status !== 'dealing') {
      return res.json({ ok: false, code: 'WRONG_STATUS', message: '当前不在发牌阶段' });
    }

    if (players[idx].hasDealt) {
      return res.json({ ok: true, currentOpenId: playerId, room: sanitizeRoom(room) });
    }

    if (!room.deck.length) {
      return res.json({ ok: false, code: 'DECK_EMPTY', message: '牌已经发完' });
    }

    players[idx].card = room.deck.shift();
    players[idx].hasDealt = true;

    const allDealt = players.every(p => p.hasDealt);
    if (allDealt && !room.publicCard && room.deck.length) {
      room.publicCard = room.deck.shift();
    }

    room.status = allDealt ? 'betting' : 'dealing';
    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, currentOpenId: playerId, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('deal error:', err);
    res.json({ ok: false, code: 'DEAL_FAILED', message: err.message });
  }
});

app.post('/api/bet', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, bet: rawBet } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    const betAmount = parseInt(rawBet);
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });
    if (![1, 2, 3].includes(betAmount)) return res.json({ ok: false, code: 'INVALID_BET', message: '注码无效' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    const players = room.players;
    const idx = players.findIndex(p => p.openId === playerId);
    if (idx === -1) return res.json({ ok: false, code: 'PLAYER_NOT_IN_ROOM', message: '玩家不在房间内' });
    if (playerId === room.dealerOpenId) return res.json({ ok: false, code: 'DEALER_NO_BET', message: '庄家无需下注' });
    if (room.status !== 'betting') return res.json({ ok: false, code: 'NOT_BETTING', message: '当前不在下注阶段' });
    if (players[idx].bet != null) return res.json({ ok: false, code: 'ALREADY_BET', message: '你已经下注了' });

    players[idx].bet = betAmount;

    const nonDealerPlayers = players.filter(p => p.openId !== room.dealerOpenId);
    const allBet = nonDealerPlayers.every(p => p.bet != null);
    room.status = allBet ? 'opening' : 'betting';
    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('bet error:', err);
    res.json({ ok: false, code: 'BET_FAILED', message: err.message });
  }
});

app.post('/api/open', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, mode, selectedOpenIds = [] } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    const players = room.players;
    if (playerId !== room.dealerOpenId) return res.json({ ok: false, code: 'NOT_DEALER', message: '只有庄家才能开牌' });
    if (room.status !== 'opening') return res.json({ ok: false, code: 'NOT_OPENING', message: '当前不在开牌阶段' });
    if (!['selectPlayers', 'openAll', 'openAllNoPass'].includes(mode)) {
      return res.json({ ok: false, code: 'INVALID_MODE', message: '无效的开牌模式' });
    }

    const publicCard = room.publicCard;
    if (!publicCard) return res.json({ ok: false, code: 'NO_PUBLIC_CARD', message: '公牌不存在' });

    let targetOpenIds;
    if (mode === 'openAll' || mode === 'openAllNoPass') {
      targetOpenIds = players.filter(p => p.openId !== room.dealerOpenId).map(p => p.openId);
    } else {
      targetOpenIds = selectedOpenIds.filter(id => id !== room.dealerOpenId);
    }
    if (!targetOpenIds.length) return res.json({ ok: false, code: 'NO_TARGET', message: '请选择至少一位玩家' });

    const dealer = players.find(p => p.openId === room.dealerOpenId);
    if (!dealer || !dealer.card) return res.json({ ok: false, code: 'DEALER_NO_CARD', message: '庄家未发牌' });

    const dealerBest = findBestHand(publicCard, dealer.card);
    const playerResults = [];
    let dealerWinAll = true;

    for (const targetId of targetOpenIds) {
      const target = players.find(p => p.openId === targetId);
      if (!target || !target.card) continue;

      const targetBest = findBestHand(publicCard, target.card);
      const cmp = compareHands(dealerBest.hand, targetBest.hand);
      const bet = target.bet || 0;
      const result = cmp >= 0 ? 'dealerWin' : 'playerWin';
      if (result === 'playerWin') dealerWinAll = false;

      playerResults.push({
        openId: targetId,
        nickName: target.nickName,
        avatarUrl: target.avatarUrl,
        handCard: target.card,
        wildCard: targetBest.wildCard,
        handType: targetBest.hand.type,
        handTypeName: targetBest.hand.typeName,
        bet, result,
        playerDrinks: result === 'dealerWin' ? bet : 0,
        dealerDrinks: result === 'playerWin' ? bet : 0
      });
    }

    const isOpenAll = mode === 'openAll';
    const dealerFullLoss = isOpenAll && !dealerWinAll && targetOpenIds.length > 0;

    let dealerTotalDrinks = 0;
    const dealerIdx = players.findIndex(p => p.openId === room.dealerOpenId);

    if (dealerFullLoss) {
      for (const pr of playerResults) { pr.playerDrinks = 0; pr.dealerDrinks = 0; }
      dealerTotalDrinks = playerResults.reduce((sum, pr) => sum + (pr.bet || 0), 0);
      if (dealerIdx !== -1) players[dealerIdx].score = (players[dealerIdx].score || 0) + dealerTotalDrinks;
    } else {
      for (const pr of playerResults) {
        const pIdx = players.findIndex(p => p.openId === pr.openId);
        if (pIdx === -1) continue;
        if (pr.playerDrinks > 0) players[pIdx].score = (players[pIdx].score || 0) + pr.playerDrinks;
        dealerTotalDrinks += pr.dealerDrinks;
      }
      if (dealerIdx !== -1) players[dealerIdx].score = (players[dealerIdx].score || 0) + dealerTotalDrinks;
    }

    let passDealer = false;
    let nextDealerOpenId = room.dealerOpenId;
    if (isOpenAll && dealerWinAll && targetOpenIds.length > 0) {
      passDealer = true;
      nextDealerOpenId = getNextDealer(players, room.dealerOpenId);
    }

    const roundResult = {
      dealerOpenId: room.dealerOpenId,
      dealerNickName: dealer.nickName,
      dealerAvatarUrl: dealer.avatarUrl,
      dealerHandCard: dealer.card,
      dealerWildCard: dealerBest.wildCard,
      dealerHandType: dealerBest.hand.type,
      dealerHandTypeName: dealerBest.hand.typeName,
      dealerDrinks: dealerTotalDrinks,
      dealerFullLoss: !!dealerFullLoss,
      publicCard,
      playerResults,
      passDealer,
      nextDealerOpenId,
      mode
    };

    room.status = 'opened';
    room.dealerOpenId = nextDealerOpenId;
    room.roundResult = roundResult;
    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, roundResult });
  } catch (err) {
    console.error('open error:', err);
    res.json({ ok: false, code: 'OPEN_FAILED', message: err.message });
  }
});

app.post('/api/resetRound', (req, res) => {
  try {
    const { roomId: rawRoomId } = req.body;
    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    const players = room.players;
    let deck = room.deck;
    let dealerOpenId = room.dealerOpenId || room.ownerOpenId;

    const cardsNeeded = players.length + 1;
    let autoPassed = false;

    if (deck.length < cardsNeeded) {
      dealerOpenId = getNextDealer(players, dealerOpenId);
      deck = shuffle(createDeck());
      autoPassed = true;
    }

    const nextPlayers = players.map(p => ({
      ...p, hasDealt: false, card: null, bet: null
    }));

    room.deck = deck;
    room.players = nextPlayers;
    room.publicCard = null;
    room.status = 'waiting';
    room.dealerOpenId = dealerOpenId;
    room.roundResult = null;
    room.updatedAt = new Date();

    broadcastRoom(roomId);
    res.json({
      ok: true, autoPassed, dealerOpenId,
      room: sanitizeRoom(room)
    });
  } catch (err) {
    console.error('resetRound error:', err);
    res.json({ ok: false, code: 'RESET_FAILED', message: err.message });
  }
});

app.post('/api/mockRoomAction', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, action } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });
    if (!action) return res.json({ ok: false, code: 'ACTION_EMPTY', message: '缺少测试动作' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (room.ownerOpenId !== playerId) {
      return res.json({ ok: false, code: 'ONLY_OWNER_ALLOWED', message: '仅房主可操作测试面板' });
    }

    const mockNames = ['测试A', '测试B', '测试C', '测试D', '测试E', '测试F', '测试G'];

    if (action === 'setupMocks') {
      const realPlayers = room.players.filter(p => !p.isMock).map(p => ({
        ...p, hasDealt: false, card: null, bet: null
      }));
      const mockPlayers = mockNames.map((name, i) => ({
        openId: `mock-player-${String.fromCharCode(97 + i)}`,
        nickName: name, avatarUrl: '', isMock: true,
        hasDealt: false, card: null, bet: null, score: 0
      }));
      room.players = realPlayers.concat(mockPlayers);
      room.deck = shuffle(createDeck());
      room.publicCard = null;
      room.status = 'waiting';
      room.roundResult = null;
      room.updatedAt = new Date();
      broadcastRoom(roomId);
      return res.json({ ok: true, room: sanitizeRoom(room) });
    }

    if (action === 'clearMocks') {
      room.players = room.players.filter(p => !p.isMock).map(p => ({
        ...p, hasDealt: false, card: null, bet: null
      }));
      room.deck = shuffle(createDeck());
      room.publicCard = null;
      room.status = 'waiting';
      room.roundResult = null;
      room.updatedAt = new Date();
      broadcastRoom(roomId);
      return res.json({ ok: true, room: sanitizeRoom(room) });
    }

    if (!room.players.some(p => p.isMock)) {
      return res.json({ ok: false, code: 'NO_MOCK_PLAYERS', message: '请先添加模拟玩家' });
    }

    if (action === 'mockDealOthers') {
      const deck = room.deck;
      if (!deck.length) return res.json({ ok: false, code: 'DECK_EMPTY', message: '牌已经发完' });

      room.players.forEach(p => {
        if (p.isMock && !p.hasDealt && deck.length) {
          p.card = deck.shift();
          p.hasDealt = true;
        }
      });

      const allDealt = room.players.every(p => p.hasDealt);
      if (allDealt && !room.publicCard && deck.length) room.publicCard = deck.shift();
      room.status = allDealt ? 'betting' : 'dealing';
      room.updatedAt = new Date();
      broadcastRoom(roomId);
      return res.json({ ok: true, room: sanitizeRoom(room) });
    }

    if (action === 'mockBetOthers') {
      if (room.status !== 'betting') return res.json({ ok: false, code: 'NOT_BETTING', message: '当前不在下注阶段' });

      const dealerOpenId = room.dealerOpenId || room.ownerOpenId;
      room.players.forEach(p => {
        if (p.isMock && p.bet == null && p.openId !== dealerOpenId) {
          p.bet = Math.floor(Math.random() * 3) + 1;
        }
      });

      const nonDealer = room.players.filter(p => p.openId !== dealerOpenId);
      room.status = nonDealer.every(p => p.bet != null) ? 'opening' : 'betting';
      room.updatedAt = new Date();
      broadcastRoom(roomId);
      return res.json({ ok: true, room: sanitizeRoom(room) });
    }

    res.json({ ok: false, code: 'UNKNOWN_ACTION', message: '未知测试动作' });
  } catch (err) {
    console.error('mockRoomAction error:', err);
    res.json({ ok: false, code: 'MOCK_ACTION_FAILED', message: err.message });
  }
});

// ============================================================
// Socket.IO
// ============================================================

io.on('connection', (socket) => {
  socket.on('joinRoom', (roomId) => {
    socket.join(`room:${roomId}`);
  });
  socket.on('leaveRoom', (roomId) => {
    socket.leave(`room:${roomId}`);
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`诈金花 Web 版运行在 http://localhost:${PORT}`);
});
