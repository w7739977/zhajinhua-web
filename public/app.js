(function () {
  'use strict';

  // ============================================================
  // Utilities
  // ============================================================

  const $ = (sel) => document.querySelector(sel);
  const $app = () => $('#app');

  function generateId() {
    return 'p_' + Math.random().toString(36).substr(2, 10) + Date.now().toString(36);
  }

  function hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    const colors = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
    return colors[Math.abs(h) % colors.length];
  }

  function renderAvatar(name, size, extraClass) {
    const initial = (name || '?')[0];
    const bg = hashColor(name || '?');
    return '<div class="avatar ' + (extraClass || '') + '" style="background:' + bg +
      ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.45) + 'px">' +
      escHtml(initial) + '</div>';
  }

  function getCardColorClass(card) {
    const text = typeof card === 'string' ? card : (card && card.text);
    if (!text) return '';
    return (text.startsWith('♥') || text.startsWith('♦')) ? 'poker-card-text-red' : '';
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ============================================================
  // Toast & Loading
  // ============================================================

  function showToast(msg, duration) {
    duration = duration || 2000;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(function () { el.remove(); }, duration);
  }

  function showLoading(msg) {
    var overlay = $('#loading-overlay');
    overlay.querySelector('.loading-text').textContent = msg || '加载中...';
    overlay.style.display = 'flex';
  }

  function hideLoading() {
    $('#loading-overlay').style.display = 'none';
  }

  // ============================================================
  // State
  // ============================================================

  var state = {
    playerId: localStorage.getItem('playerId') || (function () {
      var id = generateId();
      localStorage.setItem('playerId', id);
      return id;
    })(),
    userInfo: JSON.parse(localStorage.getItem('userInfo') || 'null'),
    currentPage: '',

    // Room page
    roomId: '',
    isOwner: false,
    room: null,
    selfPlayer: null,
    otherPlayers: [],
    leftPlayers: [],
    rightPlayers: [],
    status: 'waiting',
    dealerOpenId: '',
    isDealer: false,
    hasDealt: false,
    canDeal: true,
    hasBet: false,
    canBet: false,
    canOpen: false,
    selectedPlayers: {},
    selectedCount: 0,
    isNavigatingToResult: false,

    // Result
    roundResult: null,
    roomPlayers: []
  };

  // ============================================================
  // API
  // ============================================================

  function api(endpoint, data) {
    var body = Object.assign({}, data || {}, { playerId: state.playerId });
    return fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  // ============================================================
  // Socket.IO
  // ============================================================

  var socket = null;
  var currentSocketRoom = null;

  function initSocket() {
    if (socket) return;
    socket = io({ reconnectionDelay: 1000, reconnectionDelayMax: 5000 });

    socket.on('roomUpdate', function (room) {
      if (state.currentPage === 'room' && room.roomId === state.roomId) {
        updateRoomView(room);
      }
    });

    socket.on('reconnect', function () {
      if (currentSocketRoom) {
        socket.emit('joinRoom', currentSocketRoom);
        if (state.currentPage === 'room') fetchRoom();
      }
    });
  }

  function joinSocketRoom(roomId) {
    if (!socket) return;
    if (currentSocketRoom && currentSocketRoom !== roomId) {
      socket.emit('leaveRoom', currentSocketRoom);
    }
    currentSocketRoom = roomId;
    socket.emit('joinRoom', roomId);
  }

  function leaveSocketRoom() {
    if (!socket || !currentSocketRoom) return;
    socket.emit('leaveRoom', currentSocketRoom);
    currentSocketRoom = null;
  }

  // ============================================================
  // Router (hash-based)
  // ============================================================

  function navigate(hash) {
    window.location.hash = hash;
  }

  function parseRoute() {
    var hash = window.location.hash.slice(1) || '/';
    var parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'room' && parts[1]) {
      return { page: 'room', roomId: parts[1], isOwner: parts[2] === 'owner' };
    }
    if (parts[0] === 'result' && parts[1]) {
      return { page: 'result', roomId: parts[1] };
    }
    return { page: 'lobby' };
  }

  function handleRoute() {
    var route = parseRoute();
    var prevPage = state.currentPage;
    state.currentPage = route.page;

    if (prevPage === 'room' && route.page !== 'room') {
      leaveSocketRoom();
    }

    switch (route.page) {
      case 'room':
        state.roomId = route.roomId;
        state.isOwner = route.isOwner;
        state.isNavigatingToResult = false;
        state.selectedPlayers = {};
        state.selectedCount = 0;
        initRoomPage();
        break;
      case 'result':
        state.roomId = route.roomId;
        initResultPage();
        break;
      default:
        initLobbyPage();
        break;
    }
  }

  // ============================================================
  // Lobby Page
  // ============================================================

  function initLobbyPage() {
    var hasUser = !!state.userInfo;
    renderLobby(!hasUser);
  }

  function renderLobby(showAuth) {
    var userInfo = state.userInfo;
    var html = '<div class="lobby-container">';
    html += '<div class="lobby-title">诈金花</div>';

    if (!showAuth) {
      html += '<div class="action-panel">';
      html += '<div class="action-row btn-primary" onclick="App.createRoom()">创建房间</div>';
      html += '<div class="action-row btn-secondary" onclick="App.toggleJoinInput()">加入房间</div>';
      html += '<div id="join-section" style="display:none">';
      html += '<div class="action-row input-row"><input class="action-input" placeholder="请输入房间号" maxlength="10" id="join-room-input"></div>';
      html += '<div class="action-row btn-primary" onclick="App.confirmJoin()">确认加入</div>';
      html += '</div>';
      html += '</div>';
    }

    if (showAuth) {
      html += '<div class="auth-mask"><div class="auth-modal">';
      html += '<div class="auth-header">';
      html += '<span class="auth-title">设置你的游戏昵称</span>';
      html += '<span class="auth-desc">输入昵称后即可创建或加入房间</span>';
      html += '</div>';

      if (userInfo) {
        html += '<div class="profile-preview">';
        html += renderAvatar(userInfo.nickName, 60, '');
        html += '<span class="profile-name">' + escHtml(userInfo.nickName) + '</span>';
        html += '</div>';
      }

      html += '<div class="auth-action-group">';
      html += '<div class="action-row input-row"><input class="action-input" placeholder="请输入你的昵称" maxlength="12" id="nickname-input" value="' + escHtml((userInfo && userInfo.nickName) || '') + '"></div>';
      html += '<div class="action-row btn-primary" onclick="App.confirmProfile()">确认并进入大厅</div>';
      html += '</div>';
      html += '</div></div>';
    }

    html += '</div>';
    $app().innerHTML = html;
  }

  window.App = {};

  App.confirmProfile = function () {
    var input = $('#nickname-input');
    var name = (input && input.value || '').trim();
    if (!name) { showToast('请输入昵称'); return; }

    state.userInfo = { nickName: name };
    localStorage.setItem('userInfo', JSON.stringify(state.userInfo));
    showToast('已确认昵称');
    renderLobby(false);
  };

  App.createRoom = function () {
    if (!state.userInfo) return;
    showLoading('创建中...');
    api('createRoom', {
      nickName: state.userInfo.nickName,
      avatarUrl: ''
    }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '创建失败'); return; }
      navigate('/room/' + result.roomId + '/owner');
    }).catch(function () {
      hideLoading();
      showToast('创建失败');
    });
  };

  var joinInputShown = false;
  App.toggleJoinInput = function () {
    joinInputShown = !joinInputShown;
    var sec = $('#join-section');
    if (sec) sec.style.display = joinInputShown ? 'flex' : 'none';
    if (sec && !sec.style.flexDirection) {
      sec.style.flexDirection = 'column';
      sec.style.gap = '12px';
    }
  };

  App.confirmJoin = function () {
    if (!state.userInfo) return;
    var input = $('#join-room-input');
    var roomId = (input && input.value || '').trim();
    if (!roomId) { showToast('请输入房间号'); return; }

    showLoading('加入中...');
    api('joinRoom', {
      roomId: roomId,
      nickName: state.userInfo.nickName,
      avatarUrl: ''
    }).then(function (result) {
      hideLoading();
      if (!result.ok) {
        showToast(result.message || '加入失败');
        return;
      }
      navigate('/room/' + roomId);
    }).catch(function () {
      hideLoading();
      showToast('加入失败');
    });
  };

  // ============================================================
  // Room Page
  // ============================================================

  function initRoomPage() {
    $app().innerHTML = '<div class="room-page"><div style="text-align:center;padding-top:40px;color:#9ca3af">加载中...</div></div>';

    joinSocketRoom(state.roomId);

    var needReset = localStorage.getItem('roomNeedResetRound');
    if (needReset) {
      localStorage.removeItem('roomNeedResetRound');
      state.selectedPlayers = {};
      state.selectedCount = 0;
      showLoading('新一局...');
      api('resetRound', { roomId: state.roomId }).then(function (result) {
        hideLoading();
        if (!result.ok) showToast(result.message || '重置失败');
        var passed = result.autoPassed || localStorage.getItem('roomPassedDealer');
        localStorage.removeItem('roomPassedDealer');
        if (passed) {
          var tip = result.autoPassed ? '牌组不足，自动过庄' : '庄家全胜，自动过庄';
          showToast(tip, 2500);
        }
        fetchRoom();
      }).catch(function () {
        hideLoading();
        localStorage.removeItem('roomPassedDealer');
        showToast('重置失败');
        fetchRoom();
      });
      return;
    }

    fetchRoom();
  }

  function fetchRoom() {
    api('getRoom', { roomId: state.roomId }).then(function (result) {
      if (!result.ok) { showToast(result.message || '房间不存在'); return; }
      updateRoomView(result.room);
    }).catch(function () {
      showToast('加载失败');
    });
  }

  function rotatePlayers(players, selfOpenId) {
    if (!selfOpenId) return players;
    var idx = players.findIndex(function (p) { return p.openId === selfOpenId; });
    if (idx === -1) return players;
    return players.slice(idx + 1).concat(players.slice(0, idx + 1));
  }

  function updateRoomView(room) {
    if (!room) return;

    var players = (room.players || []).map(function (p) {
      return Object.assign({}, p, {
        hasDealt: p.hasDealt === true,
        card: p.card || null,
        bet: p.bet != null ? p.bet : null,
        score: p.score != null ? p.score : 0
      });
    });

    var status = room.status || 'waiting';
    var dealerOpenId = room.dealerOpenId || room.ownerOpenId || '';
    var selfOpenId = state.playerId;

    var ordered = rotatePlayers(players, selfOpenId).map(function (p) {
      return Object.assign({}, p, {
        isSelf: p.openId === selfOpenId,
        isDealer: p.openId === dealerOpenId
      });
    });

    var self = players.find(function (p) { return p.openId === selfOpenId; }) || null;
    if (self && state.userInfo) {
      self = Object.assign({}, self, { nickName: state.userInfo.nickName || self.nickName });
    }

    var isDealer = selfOpenId === dealerOpenId;

    var otherPlayers = ordered.filter(function (p) { return !p.isSelf; }).map(function (p) {
      return Object.assign({}, p, {
        card: null,
        selected: !!(state.selectedPlayers && state.selectedPlayers[p.openId])
      });
    });

    var splitIndex = Math.ceil(otherPlayers.length / 2);
    var rightPlayers = otherPlayers.slice(0, splitIndex).reverse();
    var leftPlayers = otherPlayers.slice(splitIndex);

    var hasDealt = !!(self && self.hasDealt === true);
    var canDeal = !hasDealt && (status === 'waiting' || status === 'dealing');
    var hasBet = !!(self && self.bet != null);
    var canBet = status === 'betting' && !isDealer && !hasBet;
    var canOpen = status === 'opening' && isDealer;
    var selectedCount = Object.values(state.selectedPlayers || {}).filter(Boolean).length;

    state.room = room;
    state.selfPlayer = self;
    state.otherPlayers = otherPlayers;
    state.leftPlayers = leftPlayers;
    state.rightPlayers = rightPlayers;
    state.status = status;
    state.dealerOpenId = dealerOpenId;
    state.isDealer = isDealer;
    state.hasDealt = hasDealt;
    state.canDeal = canDeal;
    state.hasBet = hasBet;
    state.canBet = canBet;
    state.canOpen = canOpen;
    state.selectedCount = selectedCount;

    if (status !== 'opened') state.isNavigatingToResult = false;

    if (status === 'opened' && !state.isNavigatingToResult) {
      state.isNavigatingToResult = true;
      state.roundResult = room.roundResult || null;
      state.roomPlayers = players;
      navigate('/result/' + room.roomId);
      return;
    }

    renderRoom();
  }

  function renderPlayerItem(p, status, dealerOpenId, isSelectable) {
    var avatarClass = p.isDealer ? 'avatar-dealer' : (p.hasDealt ? 'avatar-dealt' : 'avatar-pending');
    var selectedClass = p.selected ? 'player-selected' : '';
    var clickable = isSelectable ? ' selectable' : '';
    var onclick = isSelectable ? ' onclick="App.togglePlayer(\'' + p.openId + '\')"' : '';

    var html = '<div class="other-player-item ' + selectedClass + clickable + '"' + onclick + '>';
    html += '<div class="seat-base"></div>';
    html += '<div class="avatar-wrap">';
    html += renderAvatar(p.nickName, 36, avatarClass);
    if (p.isDealer) html += '<span class="crown-badge">👑</span>';
    html += '</div>';
    html += '<span class="nickname">' + escHtml(p.nickName || '玩家') + '</span>';
    if (p.hasDealt) {
      html += '<span class="deal-tag">已发牌</span>';
    } else if (status === 'waiting' || status === 'dealing') {
      html += '<span class="deal-tag pending">未发牌</span>';
    }
    if (p.bet != null) {
      html += '<span class="bet-tag">注码：' + p.bet + '</span>';
    } else if (status === 'betting') {
      html += '<span class="bet-tag pending">待下注</span>';
    }
    if (p.score > 0) html += '<span class="score-tag">🍺' + p.score + '</span>';
    html += '</div>';
    return html;
  }

  function renderRoom() {
    var self = state.selfPlayer;
    var status = state.status;
    var isDealer = state.isDealer;
    var publicCard = state.room ? state.room.publicCard : null;
    var publicCardText = publicCard || '';
    var publicCardColor = getCardColorClass(publicCard);
    var selfCardColor = getCardColorClass(self && self.card);
    var isSelectable = status === 'opening' && isDealer;

    var html = '<div class="room-page">';

    // Header
    html += '<div class="room-header">';
    html += '<span class="room-id">房间号：' + escHtml(state.roomId) + '</span>';
    html += '<button class="invite-btn" onclick="App.invite()">复制邀请链接</button>';
    html += '</div>';

    // Table stage
    if (state.otherPlayers.length > 0 || publicCardText) {
      html += '<div class="table-stage">';

      // Left column
      html += '<div class="side-column left-column">';
      state.leftPlayers.forEach(function (p) { html += renderPlayerItem(p, status, state.dealerOpenId, isSelectable); });
      html += '</div>';

      // Center
      html += '<div class="center-zone">';
      if (publicCard) {
        html += '<div class="center-card"><span class="center-card-label">公牌</span>';
        html += '<div class="poker-card poker-card-large"><span class="poker-card-text ' + publicCardColor + '">' + escHtml(publicCardText) + '</span></div>';
        html += '</div>';
      } else {
        html += '<div class="card-placeholder"><span class="center-card-label">等待公牌</span></div>';
      }
      html += '</div>';

      // Right column
      html += '<div class="side-column right-column">';
      state.rightPlayers.forEach(function (p) { html += renderPlayerItem(p, status, state.dealerOpenId, isSelectable); });
      html += '</div>';

      html += '</div>';
    }

    // Self block
    if (self) {
      var selfAvatarClass = isDealer ? 'avatar-dealer' : (self.hasDealt ? 'avatar-dealt' : 'avatar-pending');
      html += '<div class="self-block"><div class="self-seat-base"></div>';
      html += '<div class="avatar-wrap">';
      html += renderAvatar(self.nickName, 50, selfAvatarClass);
      if (isDealer) html += '<span class="crown-badge crown-badge-self">👑</span>';
      html += '</div>';
      html += '<span class="self-nickname">' + escHtml(self.nickName || '我') + (isDealer ? ' (庄)' : '') + '</span>';
      if (self.score > 0) html += '<span class="score-tag score-tag-self">🍺累计：' + self.score + ' 杯</span>';
      if (self.card) {
        html += '<div class="self-card-row"><span class="self-hand-label">手牌：</span>';
        html += '<div class="poker-card"><span class="poker-card-text ' + selfCardColor + '">' + escHtml(typeof self.card === 'string' ? self.card : self.card.text) + '</span></div>';
        html += '</div>';
      } else {
        html += '<span class="self-hand-card placeholder">手牌：未发牌</span>';
      }
      if (self.bet != null && !isDealer) {
        html += '<span class="self-bet-info">已下注：' + self.bet + '</span>';
      }
      html += '</div>';
    }

    // Bottom bar
    if (status === 'waiting' || status === 'dealing') {
      html += '<div class="bottom-bar">';
      html += '<button class="btn btn-primary btn-full' + (state.canDeal ? '' : ' disabled') + '" onclick="App.deal()">';
      html += state.hasDealt ? '已发牌' : '发牌';
      html += '</button></div>';
    } else if (status === 'betting') {
      html += '<div class="bottom-bar">';
      if (isDealer) {
        html += '<div class="bet-bar"><span class="status-text">等待玩家下注...</span></div>';
      } else if (state.hasBet) {
        html += '<div class="bet-bar"><span class="status-text">已下注 ' + (self && self.bet) + ' 杯，等待其他玩家</span></div>';
      } else {
        html += '<div class="bet-picker"><span class="bet-label">选择注码</span><div class="bet-options">';
        html += '<div class="bet-chip" onclick="App.bet(1)">1</div>';
        html += '<div class="bet-chip" onclick="App.bet(2)">2</div>';
        html += '<div class="bet-chip" onclick="App.bet(3)">3</div>';
        html += '</div></div>';
      }
      html += '</div>';
    } else if (status === 'opening' && isDealer) {
      html += '<div class="bottom-bar bottom-bar-open">';
      html += '<button class="btn btn-primary btn-sm' + (state.selectedCount > 0 ? '' : ' disabled') + '" onclick="App.openSelected()">开牌(' + state.selectedCount + ')</button>';
      html += '<button class="btn btn-secondary btn-sm" onclick="App.openAll()">全开</button>';
      html += '<button class="btn btn-secondary btn-sm" onclick="App.openAllNoPass()">不过庄</button>';
      html += '</div>';
    } else if (status === 'opening' && !isDealer) {
      html += '<div class="bottom-bar"><span class="status-text">等待庄家开牌...</span></div>';
    }

    html += '</div>';
    $app().innerHTML = html;
  }

  // Room actions

  App.invite = function () {
    var url = window.location.origin + '/#/room/' + state.roomId;
    var overlay = document.createElement('div');
    overlay.className = 'invite-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    var modal = document.createElement('div');
    modal.className = 'invite-modal';

    var header = '<div class="invite-header"><span class="invite-title">邀请好友</span><span class="invite-close" onclick="this.closest(\'.invite-overlay\').remove()">✕</span></div>';

    var qrWrap = '<div class="invite-qr" id="invite-qr-container"></div>';

    var info = '<div class="invite-info">' +
      '<div class="invite-room">房间号：<span class="invite-room-id">' + escHtml(state.roomId) + '</span></div>' +
      '<div class="invite-url">' + escHtml(url) + '</div>' +
      '</div>';

    var actions = '<div class="invite-actions">' +
      '<button class="btn btn-primary invite-copy-btn" onclick="App.copyInviteLink()">复制邀请链接</button>' +
      '</div>';

    modal.innerHTML = header + qrWrap + info + actions;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    try {
      var qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      var container = document.getElementById('invite-qr-container');
      if (container) {
        container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
      }
    } catch (e) {
      var container = document.getElementById('invite-qr-container');
      if (container) container.innerHTML = '<span style="color:#9ca3af;font-size:12px">二维码生成失败</span>';
    }
  };

  App.copyInviteLink = function () {
    var url = window.location.origin + '/#/room/' + state.roomId;
    copyText(url).then(function (ok) {
      if (ok) showToast('邀请链接已复制');
      else showToast('复制失败，房间号：' + state.roomId);
    });
  };

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return Promise.resolve(ok);
  }

  App.deal = function () {
    if (!state.canDeal) return;
    showLoading('发牌中...');
    api('deal', { roomId: state.roomId }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '发牌失败'); return; }
      if (result.room) updateRoomView(result.room);
    }).catch(function () { hideLoading(); showToast('发牌失败'); });
  };

  App.bet = function (amount) {
    if (!state.canBet) return;
    showLoading('下注中...');
    api('bet', { roomId: state.roomId, bet: amount }).then(function (result) {
      hideLoading();
      if (!result.ok) { showToast(result.message || '下注失败'); return; }
      if (result.room) updateRoomView(result.room);
    }).catch(function () { hideLoading(); showToast('下注失败'); });
  };

  App.togglePlayer = function (openId) {
    if (!state.isDealer || state.status !== 'opening') return;
    if (openId === state.playerId) return;

    state.selectedPlayers[openId] = !state.selectedPlayers[openId];
    state.selectedCount = Object.values(state.selectedPlayers).filter(Boolean).length;

    state.otherPlayers = state.otherPlayers.map(function (p) {
      return Object.assign({}, p, { selected: !!state.selectedPlayers[p.openId] });
    });
    var splitIndex = Math.ceil(state.otherPlayers.length / 2);
    state.rightPlayers = state.otherPlayers.slice(0, splitIndex).reverse();
    state.leftPlayers = state.otherPlayers.slice(splitIndex);

    renderRoom();
  };

  App.openSelected = function () {
    if (!state.canOpen || state.selectedCount === 0) return;
    var ids = Object.keys(state.selectedPlayers).filter(function (k) { return state.selectedPlayers[k]; });
    doOpen('selectPlayers', ids);
  };

  App.openAll = function () {
    if (!state.canOpen) return;
    doOpen('openAll', []);
  };

  App.openAllNoPass = function () {
    if (!state.canOpen) return;
    doOpen('openAllNoPass', []);
  };

  function doOpen(mode, selectedOpenIds) {
    showLoading('开牌中...');
    api('open', { roomId: state.roomId, mode: mode, selectedOpenIds: selectedOpenIds }).then(function (result) {
      hideLoading();
      if (!result.ok) showToast(result.message || '开牌失败');
    }).catch(function () { hideLoading(); showToast('开牌失败'); });
  }

  // ============================================================
  // Result Page
  // ============================================================

  function initResultPage() {
    var rr = state.roundResult;
    var allPlayers = state.roomPlayers || [];

    if (!rr) {
      $app().innerHTML = '<div class="result-page"><div style="text-align:center;padding-top:40px;color:#9ca3af">加载结果中...</div></div>';
      api('getRoom', { roomId: state.roomId }).then(function (result) {
        if (result.ok && result.room && result.room.roundResult) {
          state.roundResult = result.room.roundResult;
          state.roomPlayers = result.room.players || [];
          renderResult();
        }
      });
      return;
    }

    renderResult();
  }

  function renderResult() {
    var rr = state.roundResult;
    var allPlayers = state.roomPlayers || [];
    if (!rr) return;

    var publicCard = rr.publicCard || null;
    var dealerFullLoss = !!rr.dealerFullLoss;

    var dealerPlayer = allPlayers.find(function (p) { return p.openId === rr.dealerOpenId; });
    var dealerCards = [
      { text: publicCard, label: '公', colorClass: getCardColorClass(publicCard) },
      { text: rr.dealerHandCard, label: '手', colorClass: getCardColorClass(rr.dealerHandCard) },
      { text: rr.dealerWildCard, label: '万能', colorClass: getCardColorClass(rr.dealerWildCard) }
    ];

    var dealer = {
      nickName: rr.dealerNickName || (dealerPlayer && dealerPlayer.nickName) || '庄家',
      handTypeName: rr.dealerHandTypeName,
      cards: dealerCards,
      drinks: rr.dealerDrinks || 0,
      totalScore: dealerPlayer ? dealerPlayer.score || 0 : 0,
      fullLoss: dealerFullLoss
    };

    var playerResults = (rr.playerResults || []).map(function (pr) {
      var p = allPlayers.find(function (x) { return x.openId === pr.openId; });
      var cards = [
        { text: publicCard, label: '公', colorClass: getCardColorClass(publicCard) },
        { text: pr.handCard, label: '手', colorClass: getCardColorClass(pr.handCard) },
        { text: pr.wildCard, label: '万能', colorClass: getCardColorClass(pr.wildCard) }
      ];

      var resultText, resultClass;
      if (dealerFullLoss) {
        if (pr.result === 'playerWin') { resultText = '玩家赢'; resultClass = 'result-win'; }
        else { resultText = '比牌胜'; resultClass = 'result-neutral'; }
      } else if (pr.result === 'dealerWin') { resultText = '庄家赢'; resultClass = 'result-lose'; }
      else if (pr.result === 'playerWin') { resultText = '玩家赢'; resultClass = 'result-win'; }
      else { resultText = '平局'; resultClass = 'result-tie'; }

      return {
        openId: pr.openId,
        nickName: pr.nickName || (p && p.nickName) || '玩家',
        cards: cards,
        handTypeName: pr.handTypeName,
        resultText: resultText,
        resultClass: resultClass,
        bet: pr.bet,
        drinks: pr.playerDrinks || 0,
        totalScore: p ? p.score || 0 : 0
      };
    });

    var modeMap = { selectPlayers: '选择开牌', openAll: '全开', openAllNoPass: '全开不过庄' };
    var modeText = modeMap[rr.mode] || '';
    var passDealer = !!rr.passDealer;

    var html = '<div class="result-page">';

    // Header
    html += '<div class="result-header"><span>房间号：' + escHtml(state.roomId) + '</span>';
    if (modeText) html += '<span class="mode-badge">' + escHtml(modeText) + '</span>';
    html += '</div>';

    // Tips
    if (passDealer) html += '<div class="pass-dealer-tip">🔄 庄家全开全胜，自动过庄</div>';
    if (dealerFullLoss) html += '<div class="dealer-loss-tip">💥 庄家全开输了，所有注码合计记庄家喝酒</div>';

    // Dealer section
    html += '<div class="dealer-section ' + (dealerFullLoss ? 'dealer-section-loss' : '') + '">';
    html += '<div class="section-title"><span class="section-title-icon">👑</span><span>庄家</span>';
    if (dealer.fullLoss) html += '<span class="dealer-loss-badge">庄家输</span>';
    html += '</div>';
    html += '<div class="dealer-row">';
    html += '<div class="player-left"><div class="avatar-wrap-result">';
    html += renderAvatar(dealer.nickName, 36, 'avatar-dealer-result');
    html += '<span class="crown-result">👑</span></div>';
    html += '<div class="player-info"><span class="player-name">' + escHtml(dealer.nickName) + '</span>';
    html += '<span class="hand-type-tag">' + escHtml(dealer.handTypeName) + '</span></div></div>';

    // Dealer cards
    html += '<div class="cards-row">';
    dealer.cards.forEach(function (c) {
      html += '<div class="card-with-label"><span class="card-label-mini">' + escHtml(c.label) + '</span>';
      html += '<div class="poker-card"><span class="poker-card-text ' + c.colorClass + '">' + escHtml(c.text) + '</span></div></div>';
    });
    html += '</div>';

    // Dealer score
    html += '<div class="score-change-row">';
    if (dealer.drinks > 0) html += '<span class="drinks-tag">🍺 喝 ' + dealer.drinks + ' 杯</span>';
    else html += '<span class="drinks-tag drinks-zero">未喝酒</span>';
    html += '<span class="score-total">累计：' + dealer.totalScore + ' 杯</span>';
    html += '</div></div></div>';

    // Player results
    html += '<div class="players-section"><div class="section-title"><span>对比结果</span></div>';
    playerResults.forEach(function (pr) {
      html += '<div class="player-result-card">';
      html += '<div class="result-badge ' + pr.resultClass + '">' + escHtml(pr.resultText) + '</div>';
      html += '<div class="player-left">';
      html += renderAvatar(pr.nickName, 36, '');
      html += '<div class="player-info"><span class="player-name">' + escHtml(pr.nickName) + '</span>';
      html += '<span class="hand-type-tag">' + escHtml(pr.handTypeName) + '</span></div></div>';

      html += '<div class="cards-row">';
      pr.cards.forEach(function (c) {
        html += '<div class="card-with-label"><span class="card-label-mini">' + escHtml(c.label) + '</span>';
        html += '<div class="poker-card"><span class="poker-card-text ' + c.colorClass + '">' + escHtml(c.text) + '</span></div></div>';
      });
      html += '</div>';

      html += '<div class="settle-row">';
      html += '<span class="bet-info">注码：' + pr.bet + '</span>';
      if (pr.drinks > 0) html += '<span class="drinks-tag">🍺 喝 ' + pr.drinks + ' 杯</span>';
      else html += '<span class="drinks-tag drinks-zero">未喝酒</span>';
      html += '<span class="score-total">累计：' + pr.totalScore + ' 杯</span>';
      html += '</div></div>';
    });
    html += '</div>';

    // Back button
    html += '<button class="back-btn" onclick="App.backToRoom()">返回游戏</button>';
    html += '</div>';

    $app().innerHTML = html;
  }

  App.backToRoom = function () {
    localStorage.setItem('roomNeedResetRound', '1');
    if (state.roundResult && state.roundResult.passDealer) {
      localStorage.setItem('roomPassedDealer', '1');
    }
    state.roundResult = null;
    state.roomPlayers = [];
    navigate('/room/' + state.roomId + (state.isOwner ? '/owner' : ''));
  };

  // ============================================================
  // Init
  // ============================================================

  initSocket();
  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (socket && currentSocketRoom) {
      socket.emit('joinRoom', currentSocketRoom);
    }
    if (state.currentPage === 'room' && state.roomId) {
      fetchRoom();
    }
  });

})();
