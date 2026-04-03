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
const OFFLINE_GRACE_MS = 60000;
const offlineTimers = new Map();
const playerSocketMap = new Map();

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
  const onlinePlayers = players.filter(p => !p.offline);
  const pool = onlinePlayers.length >= 2 ? onlinePlayers : players;
  const idx = pool.findIndex(p => p.openId === currentDealerOpenId);
  if (idx === -1) return pool[0].openId;
  return pool[(idx + 1) % pool.length].openId;
}

function getRoundPlayers(room) {
  return room.players.filter(p => !p.spectating);
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
      spectating: p.spectating || false,
      offline: p.offline || false,
      autoBet: p.autoBet || false,
      retainedCard: p.retainedCard || false
    }))
  };
}

function broadcastRoom(roomId) {
  const room = roomStore.get(roomId);
  if (room) {
    io.to(`room:${roomId}`).emit('roomUpdate', sanitizeRoom(room));
  }
}

function removePlayerFromRoom(room, playerId) {
  room.players = room.players.filter(p => p.openId !== playerId);
}

function handleOfflineExpiry(roomId, playerId) {
  const room = roomStore.get(roomId);
  if (!room) return;
  const p = room.players.find(x => x.openId === playerId);
  if (!p || !p.offline) return;

  const status = room.status;
  const roundPlayers = getRoundPlayers(room);
  const isRoundPlayer = !p.spectating;

  if (status === 'waiting') {
    removePlayerFromRoom(room, playerId);
    if (room.dealerOpenId === playerId && room.players.length > 0) {
      room.dealerOpenId = room.players[0].openId;
    }
    if (room.ownerOpenId === playerId && room.players.length > 0) {
      room.ownerOpenId = room.players[0].openId;
    }
    room.updatedAt = new Date();
    broadcastRoom(roomId);
    cleanupEmptyRoom(roomId);
    return;
  }

  if (!isRoundPlayer) {
    removePlayerFromRoom(room, playerId);
    room.updatedAt = new Date();
    broadcastRoom(roomId);
    cleanupEmptyRoom(roomId);
    return;
  }

  const onlineRoundPlayers = roundPlayers.filter(x => !x.offline);
  if (onlineRoundPlayers.length < 1) {
    roomStore.delete(roomId);
    return;
  }

  if (status === 'betting') {
    if (playerId !== room.dealerOpenId && p.bet == null) {
      p.bet = 1;
      p.autoBet = true;
    }
    const nonDealer = roundPlayers.filter(x => x.openId !== room.dealerOpenId);
    const allBet = nonDealer.every(x => x.bet != null);
    if (allBet) room.status = 'opening';
    room.updatedAt = new Date();
    broadcastRoom(roomId);

    if (room.status === 'opening' && room.dealerOpenId === playerId) {
      autoOpenForDealer(room, roomId);
    }
    return;
  }

  if (status === 'opening' && playerId === room.dealerOpenId) {
    autoOpenForDealer(room, roomId);
    return;
  }

  if (status === 'opened' && playerId === room.dealerOpenId) {
    autoResetRound(room, roomId);
    return;
  }

  broadcastRoom(roomId);
}

function autoOpenForDealer(room, roomId) {
  const roundPlayers = getRoundPlayers(room);
  const publicCard = room.publicCard;
  if (!publicCard) return;

  const dealer = roundPlayers.find(p => p.openId === room.dealerOpenId);
  if (!dealer || !dealer.card) return;

  const mode = 'openAllNoPass';
  const targetOpenIds = roundPlayers.filter(p => p.openId !== room.dealerOpenId).map(p => p.openId);
  if (!targetOpenIds.length) return;

  executeOpen(room, roomId, mode, targetOpenIds);
}

function autoResetRound(room, roomId) {
  executeResetRound(room, roomId);
  io.to(`room:${roomId}`).emit('roundReset', { roomId });
}

function cleanupEmptyRoom(roomId) {
  const room = roomStore.get(roomId);
  if (room && room.players.length === 0) {
    roomStore.delete(roomId);
  }
}

function checkMinPlayers(room) {
  const onlineRound = getRoundPlayers(room).filter(p => !p.offline);
  if (onlineRound.length < 2 && room.status !== 'waiting' && room.status !== 'opened') {
    room.status = 'waiting';
    room.publicCard = null;
    room.roundResult = null;
    room.players.forEach(p => {
      p.hasDealt = false; p.card = null; p.bet = null;
      p.spectating = false; p.retainedCard = false; p.autoBet = false;
    });
    return true;
  }
  return false;
}

// ============================================================
// Core game operations (shared by API and auto-actions)
// ============================================================

function executeOpen(room, roomId, mode, targetOpenIds) {
  const roundPlayers = getRoundPlayers(room);
  const publicCard = room.publicCard;
  const dealer = roundPlayers.find(p => p.openId === room.dealerOpenId);
  if (!dealer || !dealer.card || !publicCard) return;

  const dealerBest = findBestHand(publicCard, dealer.card);
  const playerResults = [];
  let dealerWinAll = true;

  for (const targetId of targetOpenIds) {
    const target = roundPlayers.find(p => p.openId === targetId);
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
  const allPlayers = room.players;
  const dealerIdx = allPlayers.findIndex(p => p.openId === room.dealerOpenId);

  if (dealerFullLoss) {
    for (const pr of playerResults) { pr.playerDrinks = 0; pr.dealerDrinks = 0; }
    dealerTotalDrinks = playerResults.reduce((sum, pr) => sum + (pr.bet || 0), 0);
    if (dealerIdx !== -1) allPlayers[dealerIdx].score = (allPlayers[dealerIdx].score || 0) + dealerTotalDrinks;
  } else {
    for (const pr of playerResults) {
      const pIdx = allPlayers.findIndex(p => p.openId === pr.openId);
      if (pIdx === -1) continue;
      if (pr.playerDrinks > 0) allPlayers[pIdx].score = (allPlayers[pIdx].score || 0) + pr.playerDrinks;
      dealerTotalDrinks += pr.dealerDrinks;
    }
    if (dealerIdx !== -1) allPlayers[dealerIdx].score = (allPlayers[dealerIdx].score || 0) + dealerTotalDrinks;
  }

  let passDealer = false;
  let nextDealerOpenId = room.dealerOpenId;
  if (isOpenAll && dealerWinAll && targetOpenIds.length > 0) {
    passDealer = true;
    nextDealerOpenId = getNextDealer(allPlayers, room.dealerOpenId);
  }

  const openedPlayerIds = targetOpenIds.slice();

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
    mode,
    openedPlayerIds
  };

  room.status = 'opened';
  room.dealerOpenId = nextDealerOpenId;
  room.roundResult = roundResult;
  room.updatedAt = new Date();
  broadcastRoom(roomId);

  return roundResult;
}

function executeResetRound(room, roomId) {
  const openedPlayerIds = (room.roundResult && room.roundResult.openedPlayerIds) || [];
  const prevDealerOpenId = (room.roundResult && room.roundResult.dealerOpenId) || '';

  let dealerOpenId = room.dealerOpenId || room.ownerOpenId;

  room.players.forEach(p => {
    p.spectating = false;
    p.autoBet = false;

    const wasOpened = openedPlayerIds.includes(p.openId);
    const wasDealer = p.openId === prevDealerOpenId;
    const isNewDealer = p.openId === dealerOpenId;

    if (wasDealer || wasOpened || isNewDealer || !p.card) {
      p.hasDealt = false;
      p.card = null;
      p.retainedCard = false;
    } else {
      p.retainedCard = true;
    }

    p.bet = null;
  });

  const playersNeedCard = room.players.filter(p => !p.card);
  const cardsNeeded = playersNeedCard.length + 1;
  let deck = room.deck;
  let autoPassed = false;

  if (deck.length < cardsNeeded) {
    dealerOpenId = getNextDealer(room.players, dealerOpenId);
    deck = shuffle(createDeck());
    autoPassed = true;
    room.players.forEach(p => {
      p.hasDealt = false; p.card = null; p.retainedCard = false;
    });
  }

  room.deck = deck;
  room.publicCard = null;
  room.status = 'waiting';
  room.dealerOpenId = dealerOpenId;
  room.roundResult = null;
  room.updatedAt = new Date();

  broadcastRoom(roomId);
  return { autoPassed, dealerOpenId };
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
        hasDealt: false, card: null, bet: null, score: 0,
        spectating: false, offline: false, autoBet: false, retainedCard: false
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
    const isGameInProgress = room.status !== 'waiting';

    if (isNewPlayer) {
      players.push({
        openId: playerId, nickName, avatarUrl,
        hasDealt: false, card: null, bet: null, score: 0,
        spectating: isGameInProgress,
        offline: false, autoBet: false, retainedCard: false
      });
    } else {
      players[idx].nickName = nickName;
      players[idx].avatarUrl = avatarUrl;
      players[idx].offline = false;
      const timerKey = `${roomId}:${playerId}`;
      if (offlineTimers.has(timerKey)) {
        clearTimeout(offlineTimers.get(timerKey));
        offlineTimers.delete(timerKey);
      }
    }

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({
      ok: true, openId: playerId,
      spectating: isNewPlayer && isGameInProgress,
      room: sanitizeRoom(room)
    });
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

    if (playerId !== room.dealerOpenId) {
      return res.json({ ok: false, code: 'NOT_DEALER', message: '只有庄家才能发牌' });
    }

    if (room.status !== 'waiting') {
      return res.json({ ok: false, code: 'WRONG_STATUS', message: '当前不在等待阶段' });
    }

    const roundPlayers = getRoundPlayers(room);
    if (roundPlayers.length < 2) {
      return res.json({ ok: false, code: 'NOT_ENOUGH_PLAYERS', message: '至少需要2名玩家才能发牌' });
    }

    const needCard = roundPlayers.filter(p => !p.card);
    const cardsNeeded = needCard.length + 1;

    if (room.deck.length < cardsNeeded) {
      room.deck = shuffle(createDeck());
      roundPlayers.forEach(p => { p.card = null; p.hasDealt = false; p.retainedCard = false; });
    }

    const playersToReceive = roundPlayers.filter(p => !p.card);
    for (const p of playersToReceive) {
      if (!room.deck.length) break;
      p.card = room.deck.shift();
      p.hasDealt = true;
    }

    roundPlayers.filter(p => p.retainedCard).forEach(p => { p.hasDealt = true; });

    if (room.deck.length) {
      room.publicCard = room.deck.shift();
    }

    room.status = 'betting';

    const nonDealer = roundPlayers.filter(p => p.openId !== room.dealerOpenId);
    if (nonDealer.length === 0) {
      room.status = 'opening';
    }

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    res.json({ ok: true, room: sanitizeRoom(room) });
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
    if (players[idx].spectating) return res.json({ ok: false, code: 'SPECTATING', message: '观战中，请等待下一局' });
    if (playerId === room.dealerOpenId) return res.json({ ok: false, code: 'DEALER_NO_BET', message: '庄家无需下注' });
    if (room.status !== 'betting') return res.json({ ok: false, code: 'NOT_BETTING', message: '当前不在下注阶段' });
    if (players[idx].bet != null) return res.json({ ok: false, code: 'ALREADY_BET', message: '你已经下注了' });

    players[idx].bet = betAmount;

    const roundPlayers = getRoundPlayers(room);
    const nonDealerPlayers = roundPlayers.filter(p => p.openId !== room.dealerOpenId);
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

    if (playerId !== room.dealerOpenId) return res.json({ ok: false, code: 'NOT_DEALER', message: '只有庄家才能开牌' });
    if (room.status !== 'opening') return res.json({ ok: false, code: 'NOT_OPENING', message: '当前不在开牌阶段' });
    if (!['selectPlayers', 'openAll', 'openAllNoPass'].includes(mode)) {
      return res.json({ ok: false, code: 'INVALID_MODE', message: '无效的开牌模式' });
    }

    const publicCard = room.publicCard;
    if (!publicCard) return res.json({ ok: false, code: 'NO_PUBLIC_CARD', message: '公牌不存在' });

    const roundPlayers = getRoundPlayers(room);
    let targetOpenIds;
    if (mode === 'openAll' || mode === 'openAllNoPass') {
      targetOpenIds = roundPlayers.filter(p => p.openId !== room.dealerOpenId).map(p => p.openId);
    } else {
      targetOpenIds = selectedOpenIds.filter(id => {
        const p = roundPlayers.find(x => x.openId === id);
        return p && id !== room.dealerOpenId;
      });
    }
    if (!targetOpenIds.length) return res.json({ ok: false, code: 'NO_TARGET', message: '请选择至少一位玩家' });

    const roundResult = executeOpen(room, roomId, mode, targetOpenIds);
    res.json({ ok: true, roundResult });
  } catch (err) {
    console.error('open error:', err);
    res.json({ ok: false, code: 'OPEN_FAILED', message: err.message });
  }
});

app.post('/api/resetRound', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (playerId !== room.dealerOpenId && playerId !== room.ownerOpenId) {
      return res.json({ ok: false, code: 'NOT_AUTHORIZED', message: '只有庄家或房主才能开始下一局' });
    }

    const result = executeResetRound(room, roomId);

    io.to(`room:${roomId}`).emit('roundReset', { roomId });

    res.json({
      ok: true, autoPassed: result.autoPassed, dealerOpenId: result.dealerOpenId,
      room: sanitizeRoom(room)
    });
  } catch (err) {
    console.error('resetRound error:', err);
    res.json({ ok: false, code: 'RESET_FAILED', message: err.message });
  }
});

app.post('/api/kickPlayer', (req, res) => {
  try {
    const { playerId, roomId: rawRoomId, targetPlayerId } = req.body;
    if (!playerId) return res.json({ ok: false, code: 'NO_PLAYER_ID', message: '缺少玩家ID' });

    const roomId = String(rawRoomId || '').trim();
    if (!roomId) return res.json({ ok: false, code: 'ROOM_ID_EMPTY', message: '房间号为空' });

    const room = roomStore.get(roomId);
    if (!room) return res.json({ ok: false, code: 'ROOM_NOT_FOUND', message: '房间不存在' });

    if (playerId !== room.dealerOpenId && playerId !== room.ownerOpenId) {
      return res.json({ ok: false, code: 'NOT_AUTHORIZED', message: '只有庄家或房主才能踢人' });
    }

    if (targetPlayerId === playerId) {
      return res.json({ ok: false, code: 'CANNOT_KICK_SELF', message: '不能踢自己' });
    }

    const target = room.players.find(p => p.openId === targetPlayerId);
    if (!target) return res.json({ ok: false, code: 'PLAYER_NOT_FOUND', message: '目标玩家不在房间' });

    removePlayerFromRoom(room, targetPlayerId);

    const timerKey = `${roomId}:${targetPlayerId}`;
    if (offlineTimers.has(timerKey)) {
      clearTimeout(offlineTimers.get(timerKey));
      offlineTimers.delete(timerKey);
    }

    io.to(`room:${roomId}`).emit('playerKicked', { roomId, kickedPlayerId: targetPlayerId });

    if (checkMinPlayers(room)) {
      broadcastRoom(roomId);
      return res.json({ ok: true, roundAborted: true, room: sanitizeRoom(room) });
    }

    if (room.status === 'betting') {
      const roundPlayers = getRoundPlayers(room);
      const nonDealer = roundPlayers.filter(p => p.openId !== room.dealerOpenId);
      if (nonDealer.every(p => p.bet != null)) {
        room.status = 'opening';
      }
    }

    room.updatedAt = new Date();
    broadcastRoom(roomId);
    cleanupEmptyRoom(roomId);
    res.json({ ok: true, room: sanitizeRoom(room) });
  } catch (err) {
    console.error('kickPlayer error:', err);
    res.json({ ok: false, code: 'KICK_FAILED', message: err.message });
  }
});

// ============================================================
// Socket.IO — online tracking + room channels
// ============================================================

io.on('connection', (socket) => {
  let socketPlayerId = null;
  let socketRoomId = null;

  socket.on('joinRoom', (roomId, playerId) => {
    socket.join(`room:${roomId}`);
    if (playerId) {
      socketPlayerId = playerId;
      socketRoomId = roomId;
      playerSocketMap.set(playerId, socket.id);

      const room = roomStore.get(roomId);
      if (room) {
        const p = room.players.find(x => x.openId === playerId);
        if (p && p.offline) {
          p.offline = false;
          const timerKey = `${roomId}:${playerId}`;
          if (offlineTimers.has(timerKey)) {
            clearTimeout(offlineTimers.get(timerKey));
            offlineTimers.delete(timerKey);
          }
          room.updatedAt = new Date();
          broadcastRoom(roomId);
        }
      }
    }
  });

  socket.on('leaveRoom', (roomId) => {
    socket.leave(`room:${roomId}`);
  });

  socket.on('disconnect', () => {
    if (!socketPlayerId || !socketRoomId) return;
    if (playerSocketMap.get(socketPlayerId) !== socket.id) return;

    playerSocketMap.delete(socketPlayerId);
    const room = roomStore.get(socketRoomId);
    if (!room) return;
    const p = room.players.find(x => x.openId === socketPlayerId);
    if (!p) return;

    p.offline = true;
    room.updatedAt = new Date();
    broadcastRoom(socketRoomId);

    const timerKey = `${socketRoomId}:${socketPlayerId}`;
    const pid = socketPlayerId;
    const rid = socketRoomId;
    offlineTimers.set(timerKey, setTimeout(() => {
      offlineTimers.delete(timerKey);
      handleOfflineExpiry(rid, pid);
    }, OFFLINE_GRACE_MS));
  });
});

// ============================================================
// Test utilities (key-protected)
// ============================================================

const TEST_KEY = process.env.TEST_KEY || 'zhajinhua2026';

app.post('/api/_cleanTestRooms', (req, res) => {
  if (req.body.key !== TEST_KEY) {
    return res.json({ ok: false, code: 'UNAUTHORIZED', message: '密钥错误' });
  }
  let count = 0;
  for (const [roomId] of roomStore) {
    if (roomId.startsWith('_test_')) {
      roomStore.delete(roomId);
      count++;
    }
  }
  res.json({ ok: true, cleaned: count });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`诈金花 Web 版运行在 http://localhost:${PORT}`);
});
