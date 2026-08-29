(function () {
  'use strict';

  var tests = [];
  var passed = 0;
  var failed = 0;
  var total = 0;
  var startTime = 0;

  function post(path, data) {
    return fetch('/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    }).then(function (r) { return r.json(); });
  }

  function httpGet(path) {
    return fetch(path).then(function (r) { return r.status; });
  }

  function brief(obj) {
    try { var s = JSON.stringify(obj); return s.length > 200 ? s.slice(0, 200) + '...' : s; }
    catch (e) { return String(obj); }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function connectTestSocket() {
    return new Promise(function (resolve, reject) {
      var socket = io({ forceNew: true, reconnection: false });
      var timer = setTimeout(function () {
        socket.disconnect();
        reject(new Error('Socket 连接超时'));
      }, 2000);

      socket.once('connect', function () {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('connect_error', function (err) {
        clearTimeout(timer);
        socket.disconnect();
        reject(err || new Error('Socket 连接失败'));
      });
    });
  }

  function emitWithAck(socket, eventName, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error(eventName + ' ACK 超时'));
      }, timeoutMs || 1500);

      socket.emit(eventName, payload, function (response) {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  function emitArgsWithAck(socket, eventName, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error(eventName + ' ACK 超时'));
      }, timeoutMs || 1500);
      var emitArgs = [eventName].concat(args || [], [function (response) {
        clearTimeout(timer);
        resolve(response);
      }]);
      socket.emit.apply(socket, emitArgs);
    });
  }

  function waitForEvent(socket, eventName, predicate, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        socket.off(eventName, handler);
        reject(new Error('等待 ' + eventName + ' 超时'));
      }, timeoutMs || 1500);

      function handler(data) {
        if (predicate && !predicate(data)) return;
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(data);
      }

      socket.on(eventName, handler);
    });
  }

  function expectNoEvent(socket, eventName, predicate, timeoutMs) {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        socket.off(eventName, handler);
        resolve(true);
      }, timeoutMs || 250);

      function handler(data) {
        if (predicate && !predicate(data)) return;
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(false);
      }

      socket.on(eventName, handler);
    });
  }

  function roomStateSnapshot(room) {
    if (!room) return null;
    return {
      status: room.status,
      dealerOpenId: room.dealerOpenId,
      publicCard: room.publicCard,
      roundResult: room.roundResult,
      players: (room.players || []).map(function (p) {
        return {
          openId: p.openId,
          hasDealt: p.hasDealt,
          card: p.card,
          bet: p.bet,
          score: p.score,
          spectating: p.spectating,
          offline: p.offline,
          retainedCard: p.retainedCard
        };
      })
    };
  }

  function updateUI() {
    var el = document.getElementById('test-results');
    if (!el) return;

    var groupMap = {};
    tests.forEach(function (t) {
      if (!groupMap[t.group]) groupMap[t.group] = [];
      groupMap[t.group].push(t);
    });

    var html = '';
    var groups = Object.keys(groupMap);
    for (var g = 0; g < groups.length; g++) {
      var groupName = groups[g];
      var items = groupMap[groupName];
      html += '<div class="test-group">';
      html += '<div class="test-group-title">' + esc(groupName) + '</div>';
      for (var i = 0; i < items.length; i++) {
        var t = items[i];
        var cls = t.status === 'pass' ? 'test-pass' : t.status === 'fail' ? 'test-fail' : t.status === 'running' ? 'test-running' : 'test-pending';
        var icon = t.status === 'pass' ? '✅' : t.status === 'fail' ? '❌' : t.status === 'running' ? '⏳' : '⬜';
        html += '<div class="test-row ' + cls + '">';
        html += '<span class="test-icon">' + icon + '</span>';
        html += '<span class="test-name">' + esc(t.name) + '</span>';
        if (t.ms != null) html += '<span class="test-time">' + t.ms + 'ms</span>';
        if (t.detail && t.status === 'fail') html += '<div class="test-detail">' + esc(t.detail) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;

    var done = passed + failed;
    var pct = total > 0 ? Math.round(done / total * 100) : 0;
    var bar = document.getElementById('test-progress');
    if (bar) bar.style.width = pct + '%';

    var sum = document.getElementById('test-summary');
    if (sum) {
      var elapsed = Date.now() - startTime;
      sum.innerHTML = '<span class="test-sum-pass">通过 ' + passed + '</span>' +
        '<span class="test-sum-fail">失败 ' + failed + '</span>' +
        '<span class="test-sum-total">总计 ' + done + '/' + total + '</span>' +
        '<span class="test-sum-time">耗时 ' + (elapsed / 1000).toFixed(1) + 's</span>';
    }
  }

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function register(group, name) {
    var t = { group: group, name: name, status: 'pending', ms: null, detail: null };
    tests.push(t);
    total++;
    return t;
  }

  function check(t, condition, detail) {
    if (condition) {
      t.status = 'pass';
      passed++;
    } else {
      t.status = 'fail';
      t.detail = detail || 'condition=false';
      failed++;
    }
    updateUI();
  }

  async function run(testKey) {
    tests = [];
    passed = 0;
    failed = 0;
    total = 0;
    startTime = Date.now();

    var G1 = '1. 基础流程';
    var G2 = '2. 庄家驱动';
    var G3 = '3. 选择开牌+保留手牌';
    var G4 = '4. 中途加入观战';
    var G5 = '5. 权限控制';
    var G6 = '6. 踢人功能';
    var G7 = '7. 全开模式';
    var G8 = '8. 边界防护';
    var G9 = '9. 牌组管理';
    var G10 = '10. 静态资源';
    var G11 = '11. Socket.IO 连通';
    var G12 = '12. 玩家道具互动';
    var G13 = '13. VIP 会员横幅';
    var G14 = '14. VIP 强牌结果特效';

    var t1_1 = register(G1, '创建房间');
    var t1_2 = register(G1, '玩家B加入');
    var t1_3 = register(G1, '玩家C加入');
    var t1_4 = register(G1, '庄家一键发牌');
    var t1_5 = register(G1, '全员已发牌+公牌+betting');
    var t1_6 = register(G1, 'B下注');
    var t1_7 = register(G1, 'C下注→全员opening');
    var t1_8 = register(G1, '全开不过庄');
    var t1_9 = register(G1, '庄家resetRound');

    var t2_1 = register(G2, '单人发牌被拒(≥2人)');
    var t2_2 = register(G2, '非庄发牌被拒');
    var t2_3 = register(G2, '庄家下注被拒');

    var t3_1 = register(G3, '选择开B,C未选');
    var t3_2 = register(G3, 'C保留手牌');
    var t3_3 = register(G3, 'B手牌已清除');
    var t3_4 = register(G3, '第二轮发牌');
    var t3_5 = register(G3, 'C留牌仍在');
    var t3_6 = register(G3, '新公牌');

    var t4_1 = register(G4, '游戏中D加入(观战)');
    var t4_2 = register(G4, 'D标记spectating');
    var t4_3 = register(G4, '观战者D下注被拒');
    var t4_4 = register(G4, 'reset后D不再观战');

    var t5_1 = register(G5, '非庄resetRound被拒');
    var t5_2 = register(G5, '庄家resetRound成功');

    var t6_1 = register(G6, '非房主踢人被拒');
    var t6_2 = register(G6, '房主踢人成功(无需 offline)');
    var t6_3 = register(G6, '不能踢自己');
    var t6_4 = register(G6, '踢庄家后庄家迁移');

    var t7_1 = register(G7, '全开');
    var t7_2 = register(G7, 'openedPlayerIds 完整');

    var t8_1 = register(G8, '空房间号被拒');
    var t8_2 = register(G8, '不存在房间被拒');
    var t8_3 = register(G8, '缺playerId被拒');
    var t8_4 = register(G8, '非waiting发牌被拒');
    var t8_5 = register(G8, '重复下注被拒');
    var t8_6 = register(G8, '非庄开牌被拒');

    var t9_1 = register(G9, '16轮后自动洗牌+发牌');

    var t10_1 = register(G10, '首页 200');
    var t10_2 = register(G10, 'app.js 200');
    var t10_3 = register(G10, 'style.css 200');
    var t10_4 = register(G10, 'qrcode.min.js 200');
    var t10_5 = register(G10, 'test-runner.js 200');
    var t10_6 = register(G10, '鸡蛋飞行模型 200');
    var t10_7 = register(G10, '鸡蛋命中效果 200');
    var t10_8 = register(G10, '鸡蛋飞溅效果 200');
    var t10_9 = register(G10, '西红柿飞行模型 200');
    var t10_10 = register(G10, '西红柿命中效果 200');
    var t10_11 = register(G10, '西红柿飞溅效果 200');
    var t10_12 = register(G10, 'member-banner-queue.js 200');
    var t10_13 = register(G10, 'result-member-highlight.js 200');

    var t11_1 = register(G11, 'Socket.IO 握手');

    var t12_1 = register(G12, '合法鸡蛋向全房间广播');
    var t12_2 = register(G12, '未入桌订阅者不能发送');
    var t12_3 = register(G12, '拒绝向自己扔道具');
    var t12_4 = register(G12, '拒绝非法道具类型');
    var t12_5 = register(G12, '拒绝不存在的目标');
    var t12_6 = register(G12, '旧连接不能代表玩家发送');
    var t12_7 = register(G12, '离开频道后不能发送');
    var t12_8 = register(G12, '一秒内重复发送被限流');
    var t12_9 = register(G12, '被移出房间后不能发送');
    var t12_10 = register(G12, '房间删除后返回不存在');
    var t12_11 = register(G12, '冷却结束后恢复发送');
    var t12_12 = register(G12, '失败请求不消耗冷却');
    var t12_13 = register(G12, '邀请订阅者入桌后可发送');
    var t12_14 = register(G12, '互动不触发房间状态更新');
    var t12_15 = register(G12, '可向房内离线玩家发送');
    var t12_16 = register(G12, '结果阶段拒绝道具互动');
    var t12_17 = register(G12, '被踢旧连接重入后仍失效');

    var t13_1 = register(G13, 'VIP 创建响应按 banker→join 排序');
    var t13_2 = register(G13, '首次 VIP 加入 HTTP/Socket eventId 一致');
    var t13_3 = register(G13, 'VIP 重入不重复触发 join');
    var t13_4 = register(G13, 'VIP 下注在 roomUpdate 后广播且无额外更新');
    var t13_5 = register(G13, '8 秒内再次下注成功但横幅被冷却');
    var t13_6 = register(G13, 'VIP 主动开牌广播正确 openMode');
    var t13_7 = register(G13, '普通玩家成功下注和开牌均无横幅');
    var t13_8 = register(G13, '错误页面上下文不渲染横幅 DOM');

    var t14_1 = register(G14, '仅会员同花顺/豹子命中特效');
    var t14_2 = register(G14, '同花顺结果 DOM 与动画样式正确');
    var t14_3 = register(G14, '豹子变体与普通玩家降级正确');
    var t14_4 = register(G14, '公开预览页展示两种真实三牌效果');
    var t14_5 = register(G14, '预览页支持重播与静态模式');

    updateUI();

    var runPrefix = "_test_" + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + '_';
    var A = runPrefix + 'A_' + Date.now();
    var B = runPrefix + 'B_' + Date.now();
    var C = runPrefix + 'C_' + Date.now();
    var D = runPrefix + 'D_' + Date.now();
    var roomId = '';
    var dealer = A;
    var testSockets = [];

    function ms(t, fn) {
      t.status = 'running';
      updateUI();
      var s = Date.now();
      return fn().then(function (v) {
        t.ms = Date.now() - s;
        return v;
      });
    }

    function getNonDealer(ids, dl) {
      return ids.filter(function (x) { return x !== dl; });
    }

    async function betAll(ids, dl, rid, amt) {
      var nd = getNonDealer(ids, dl);
      for (var i = 0; i < nd.length; i++) {
        await post('bet', { playerId: nd[i], roomId: rid, bet: amt || 1 });
      }
    }

    async function finishRound(dl, rid, players) {
      await betAll(players, dl, rid, 1);
      var ro = await post('open', { playerId: dl, roomId: rid, mode: 'openAllNoPass', selectedOpenIds: [] });
      if (!ro.ok) return dl;
      var nd = ro.roundResult.nextDealerOpenId;
      var rr = await post('resetRound', { playerId: nd, roomId: rid });
      return rr.ok ? rr.dealerOpenId : nd;
    }

    try {
      // =============== G1: 基础流程 ===============
      var r1 = await ms(t1_1, function () { return post('createRoom', { playerId: A, nickName: 'A' }); });
      roomId = r1.roomId;
      check(t1_1, r1.ok && roomId, 'ok=' + r1.ok + ' roomId=' + roomId + ' resp=' + brief(r1));
      dealer = A;

      var r1_2 = await ms(t1_2, function () { return post('joinRoom', { playerId: B, roomId: roomId, nickName: 'B' }); });
      check(t1_2, r1_2.ok, 'resp=' + brief(r1_2));

      var r1_3 = await ms(t1_3, function () { return post('joinRoom', { playerId: C, roomId: roomId, nickName: 'C' }); });
      check(t1_3, r1_3.ok, 'resp=' + brief(r1_3));

      var r4 = await ms(t1_4, function () { return post('deal', { playerId: dealer, roomId: roomId }); });
      check(t1_4, r4.ok, 'ok=' + r4.ok + ' code=' + r4.code + ' msg=' + r4.message + ' resp=' + brief(r4));

      if (r4.ok && r4.room) {
        var allDealt = r4.room.players.every(function (p) { return p.hasDealt; });
        var hasPub = !!r4.room.publicCard;
        var isBetting = r4.room.status === 'betting';
        check(t1_5, allDealt && hasPub && isBetting,
          'allDealt=' + allDealt + ' publicCard=' + r4.room.publicCard + ' status=' + r4.room.status +
          ' players=' + brief(r4.room.players.map(function (p) { return { id: p.openId.slice(-6), dealt: p.hasDealt, card: !!p.card }; })));
      } else {
        check(t1_5, false, 'deal failed, no room data. deal resp=' + brief(r4));
      }

      var rB = await ms(t1_6, function () { return post('bet', { playerId: B, roomId: roomId, bet: 2 }); });
      check(t1_6, rB.ok, 'ok=' + rB.ok + ' code=' + rB.code + ' msg=' + rB.message);

      var rC = await ms(t1_7, function () { return post('bet', { playerId: C, roomId: roomId, bet: 3 }); });
      check(t1_7, rC.ok && rC.room && rC.room.status === 'opening',
        'ok=' + rC.ok + ' status=' + (rC.room && rC.room.status) + ' code=' + rC.code);

      var rOpen = await ms(t1_8, function () { return post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] }); });
      check(t1_8, rOpen.ok, 'ok=' + rOpen.ok + ' code=' + rOpen.code + ' msg=' + rOpen.message);
      if (rOpen.ok) dealer = rOpen.roundResult.nextDealerOpenId;

      var rReset = await ms(t1_9, function () { return post('resetRound', { playerId: dealer, roomId: roomId }); });
      check(t1_9, rReset.ok, 'ok=' + rReset.ok + ' code=' + rReset.code + ' msg=' + rReset.message);
      if (rReset.ok) dealer = rReset.dealerOpenId;

      // =============== G2: 庄家驱动 ===============
      var rSolo = await post('createRoom', { playerId: A, nickName: 'A' });
      var soloRoomId = rSolo.roomId;
      var r2_1 = await ms(t2_1, function () { return post('deal', { playerId: A, roomId: soloRoomId }); });
      check(t2_1, !r2_1.ok && r2_1.code === 'NOT_ENOUGH_PLAYERS',
        'ok=' + r2_1.ok + ' code=' + r2_1.code + ' (expect NOT_ENOUGH_PLAYERS)');

      var nd0 = getNonDealer([A, B, C], dealer);
      var r2_2 = await ms(t2_2, function () { return post('deal', { playerId: nd0[0], roomId: roomId }); });
      check(t2_2, !r2_2.ok && r2_2.code === 'NOT_DEALER',
        'ok=' + r2_2.ok + ' code=' + r2_2.code + ' (expect NOT_DEALER)');

      await post('deal', { playerId: dealer, roomId: roomId });
      var r2_3 = await ms(t2_3, function () { return post('bet', { playerId: dealer, roomId: roomId, bet: 1 }); });
      check(t2_3, !r2_3.ok && r2_3.code === 'DEALER_NO_BET',
        'ok=' + r2_3.ok + ' code=' + r2_3.code + ' (expect DEALER_NO_BET)');

      dealer = await finishRound(dealer, roomId, [A, B, C]);

      // =============== G3: 选择开牌+保留手牌 ===============
      await post('deal', { playerId: dealer, roomId: roomId });
      var nd3 = getNonDealer([A, B, C], dealer);
      await betAll([A, B, C], dealer, roomId, 1);
      var targetB = nd3[0], targetC = nd3[1];

      var r3_1 = await ms(t3_1, function () { return post('open', { playerId: dealer, roomId: roomId, mode: 'selectPlayers', selectedOpenIds: [targetB] }); });
      check(t3_1, r3_1.ok && r3_1.roundResult.openedPlayerIds.indexOf(targetB) >= 0 && r3_1.roundResult.openedPlayerIds.indexOf(targetC) < 0,
        'ok=' + r3_1.ok + ' opened=' + brief(r3_1.roundResult && r3_1.roundResult.openedPlayerIds));
      if (r3_1.ok) dealer = r3_1.roundResult.nextDealerOpenId;

      var r3_r = await ms(t3_2, function () { return post('resetRound', { playerId: dealer, roomId: roomId }); });
      if (r3_r.ok) dealer = r3_r.dealerOpenId;
      var pCr = r3_r.room && r3_r.room.players.find(function (p) { return p.openId === targetC; });
      var pBr = r3_r.room && r3_r.room.players.find(function (p) { return p.openId === targetB; });
      check(t3_2, pCr && pCr.card !== null && pCr.retainedCard === true,
        'C: card=' + (pCr && pCr.card) + ' retained=' + (pCr && pCr.retainedCard));
      check(t3_3, pBr && pBr.card === null,
        'B: card=' + (pBr && pBr.card));

      var r3_d = await ms(t3_4, function () { return post('deal', { playerId: dealer, roomId: roomId }); });
      check(t3_4, r3_d.ok, 'ok=' + r3_d.ok + ' code=' + r3_d.code);
      if (r3_d.ok && r3_d.room) {
        var pC2 = r3_d.room.players.find(function (p) { return p.openId === targetC; });
        check(t3_5, pC2 && pC2.card !== null && pC2.hasDealt, 'C: card=' + (pC2 && pC2.card) + ' dealt=' + (pC2 && pC2.hasDealt));
        check(t3_6, !!r3_d.room.publicCard, 'publicCard=' + r3_d.room.publicCard);
      } else {
        check(t3_5, false, 'deal failed: ' + brief(r3_d));
        check(t3_6, false, 'deal failed: ' + brief(r3_d));
      }

      dealer = await finishRound(dealer, roomId, [A, B, C]);

      // =============== G4: 中途加入观战 ===============
      await post('deal', { playerId: dealer, roomId: roomId });

      var r4_1r = await ms(t4_1, function () { return post('joinRoom', { playerId: D, roomId: roomId, nickName: 'D' }); });
      check(t4_1, r4_1r.ok && r4_1r.spectating === true,
        'ok=' + r4_1r.ok + ' spectating=' + r4_1r.spectating);
      var pD = r4_1r.room && r4_1r.room.players.find(function (p) { return p.openId === D; });
      check(t4_2, pD && pD.spectating === true,
        'D spectating=' + (pD && pD.spectating));

      var r4_3r = await ms(t4_3, function () { return post('bet', { playerId: D, roomId: roomId, bet: 1 }); });
      check(t4_3, !r4_3r.ok && r4_3r.code === 'SPECTATING',
        'ok=' + r4_3r.ok + ' code=' + r4_3r.code + ' (expect SPECTATING)');

      var nd4a = getNonDealer([A, B, C], dealer);
      for (var i4 = 0; i4 < nd4a.length; i4++) await post('bet', { playerId: nd4a[i4], roomId: roomId, bet: 1 });
      var ro3 = await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      if (ro3.ok) dealer = ro3.roundResult.nextDealerOpenId;
      var rr3 = await ms(t4_4, function () { return post('resetRound', { playerId: dealer, roomId: roomId }); });
      if (rr3.ok) dealer = rr3.dealerOpenId;
      var pD2 = rr3.room && rr3.room.players.find(function (p) { return p.openId === D; });
      check(t4_4, pD2 && pD2.spectating === false,
        'D spectating=' + (pD2 && pD2.spectating));

      // =============== G5: 权限控制 ===============
      await post('deal', { playerId: dealer, roomId: roomId });
      var nd5 = getNonDealer([A, B, C, D], dealer);
      for (var i5 = 0; i5 < nd5.length; i5++) await post('bet', { playerId: nd5[i5], roomId: roomId, bet: 1 });
      var ro4 = await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      var nd5d = ro4.ok ? ro4.roundResult.nextDealerOpenId : dealer;

      var nonAuth = [A, B, C, D].filter(function (x) { return x !== nd5d; });
      var r5_1r = await ms(t5_1, function () { return post('resetRound', { playerId: nonAuth[0], roomId: roomId }); });
      check(t5_1, !r5_1r.ok, 'ok=' + r5_1r.ok + ' code=' + r5_1r.code + ' (expect NOT_AUTHORIZED)');

      var r5_2r = await ms(t5_2, function () { return post('resetRound', { playerId: nd5d, roomId: roomId }); });
      check(t5_2, r5_2r.ok, 'ok=' + r5_2r.ok + ' code=' + r5_2r.code);
      if (r5_2r.ok) dealer = r5_2r.dealerOpenId;

      // =============== G6: 踢人 ===============
      // 非房主（B）踢人应被拒，且 D 仍在房间
      var r6_1r = await ms(t6_1, function () { return post('kickPlayer', { playerId: B, roomId: roomId, targetPlayerId: D }); });
      check(t6_1, !r6_1r.ok && r6_1r.code === 'NOT_OWNER', 'ok=' + r6_1r.ok + ' code=' + r6_1r.code + ' (expect NOT_OWNER)');

      // 房主（A）踢 D 成功（D 在线，验证无需 offline 也可踢）
      var r6_2r = await ms(t6_2, function () { return post('kickPlayer', { playerId: A, roomId: roomId, targetPlayerId: D }); });
      check(t6_2, r6_2r.ok && !r6_2r.room.players.find(function (p) { return p.openId === D; }),
        'ok=' + r6_2r.ok + ' D still in=' + !!(r6_2r.room && r6_2r.room.players.find(function (p) { return p.openId === D; })));

      // 房主不能踢自己
      var r6_3r = await ms(t6_3, function () { return post('kickPlayer', { playerId: A, roomId: roomId, targetPlayerId: A }); });
      check(t6_3, !r6_3r.ok && r6_3r.code === 'CANNOT_KICK_SELF',
        'ok=' + r6_3r.ok + ' code=' + r6_3r.code);

      // 踢掉庄家后，房间应自动指派新庄家（非被踢者）
      var rBeforeKick = await post('getRoom', { playerId: A, roomId: roomId });
      var curDealer = rBeforeKick.ok ? rBeforeKick.room.dealerOpenId : dealer;
      var kickDealerTarget = (curDealer && curDealer !== A) ? curDealer : B;
      var r6_4r = await ms(t6_4, function () { return post('kickPlayer', { playerId: A, roomId: roomId, targetPlayerId: kickDealerTarget }); });
      var newDealerOk = r6_4r.ok && r6_4r.room && r6_4r.room.dealerOpenId && r6_4r.room.dealerOpenId !== kickDealerTarget &&
        !!r6_4r.room.players.find(function (p) { return p.openId === r6_4r.room.dealerOpenId; });
      check(t6_4, newDealerOk,
        'ok=' + r6_4r.ok + ' kickedDealer=' + kickDealerTarget + ' newDealer=' + (r6_4r.room && r6_4r.room.dealerOpenId));
      if (r6_4r.ok) dealer = r6_4r.room.dealerOpenId;

      // =============== G7: 全开 ===============
      // 经 G6 多次踢人后房间可能只剩 2 人，从当前房间快照取真实玩家列表
      var rRoom7 = await post('getRoom', { playerId: A, roomId: roomId });
      var remainIds7 = rRoom7.ok ? rRoom7.room.players.map(function (p) { return p.openId; }) : [A, B, C];
      await post('deal', { playerId: dealer, roomId: roomId });
      var nd7 = getNonDealer(remainIds7, dealer);
      for (var i7 = 0; i7 < nd7.length; i7++) await post('bet', { playerId: nd7[i7], roomId: roomId, bet: 2 });
      var r7_1r = await ms(t7_1, function () { return post('open', { playerId: dealer, roomId: roomId, mode: 'openAll', selectedOpenIds: [] }); });
      check(t7_1, r7_1r.ok, 'ok=' + r7_1r.ok + ' code=' + r7_1r.code);
      check(t7_2, r7_1r.ok && r7_1r.roundResult && r7_1r.roundResult.openedPlayerIds.length === nd7.length,
        'opened=' + (r7_1r.roundResult && r7_1r.roundResult.openedPlayerIds.length) + ' expected=' + nd7.length);
      if (r7_1r.ok) dealer = r7_1r.roundResult.nextDealerOpenId;
      await post('resetRound', { playerId: dealer, roomId: roomId });

      // =============== G8: 边界防护 ===============
      var r8_1r = await ms(t8_1, function () { return post('deal', { playerId: A, roomId: '' }); });
      check(t8_1, !r8_1r.ok, 'ok=' + r8_1r.ok + ' code=' + r8_1r.code);

      var r8_2r = await ms(t8_2, function () { return post('deal', { playerId: A, roomId: '999999' }); });
      check(t8_2, !r8_2r.ok && r8_2r.code === 'ROOM_NOT_FOUND', 'code=' + r8_2r.code);

      var r8_3r = await ms(t8_3, function () { return post('deal', { roomId: roomId }); });
      check(t8_3, !r8_3r.ok && r8_3r.code === 'NO_PLAYER_ID', 'code=' + r8_3r.code);

      var rGetRoom = await post('getRoom', { playerId: dealer, roomId: roomId });
      if (rGetRoom.ok) dealer = rGetRoom.room.dealerOpenId;
      await post('deal', { playerId: dealer, roomId: roomId });
      var r8_4r = await ms(t8_4, function () { return post('deal', { playerId: dealer, roomId: roomId }); });
      check(t8_4, !r8_4r.ok && r8_4r.code === 'WRONG_STATUS', 'code=' + r8_4r.code);

      var repeatA = runPrefix + 'repeat_A_' + Date.now();
      var repeatB = runPrefix + 'repeat_B_' + Date.now();
      var repeatC = runPrefix + 'repeat_C_' + Date.now();
      var repeatRoom = await post('createRoom', { playerId: repeatA, nickName: '重复A' });
      await post('joinRoom', { playerId: repeatB, roomId: repeatRoom.roomId, nickName: '重复B' });
      await post('joinRoom', { playerId: repeatC, roomId: repeatRoom.roomId, nickName: '重复C' });
      await post('deal', { playerId: repeatA, roomId: repeatRoom.roomId });
      await post('bet', { playerId: repeatB, roomId: repeatRoom.roomId, bet: 1 });
      var r8_5r = await ms(t8_5, function () { return post('bet', { playerId: repeatB, roomId: repeatRoom.roomId, bet: 2 }); });
      check(t8_5, !r8_5r.ok && r8_5r.code === 'ALREADY_BET', 'code=' + r8_5r.code);

      var currentRoom8 = await post('getRoom', { playerId: dealer, roomId: roomId });
      var currentIds8 = currentRoom8.ok ? currentRoom8.room.players.map(function (p) { return p.openId; }) : [A, B, C];
      var nd8 = getNonDealer(currentIds8, dealer);
      var r8_6r = await ms(t8_6, function () { return post('open', { playerId: nd8[0], roomId: roomId, mode: 'openAll' }); });
      check(t8_6, !r8_6r.ok && r8_6r.code === 'NOT_DEALER', 'code=' + r8_6r.code);

      for (var i8 = 0; i8 < nd8.length; i8++) await post('bet', { playerId: nd8[i8], roomId: roomId, bet: 1 });
      await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      var rGetRoom2 = await post('getRoom', { playerId: dealer, roomId: roomId });
      if (rGetRoom2.ok) dealer = rGetRoom2.room.dealerOpenId;
      await post('resetRound', { playerId: dealer, roomId: roomId });

      // =============== G9: 牌组管理 ===============
      var X1 = runPrefix + 'X1_' + Date.now();
      var X2 = runPrefix + 'X2_' + Date.now();
      var rx = await post('createRoom', { playerId: X1, nickName: 'X1' });
      var rid2 = rx.roomId;
      await post('joinRoom', { playerId: X2, roomId: rid2, nickName: 'X2' });
      var d2 = X1;
      t9_1.status = 'running'; updateUI();
      var s9 = Date.now();
      for (var ix = 0; ix < 16; ix++) {
        await post('deal', { playerId: d2, roomId: rid2 });
        var nd9 = d2 === X1 ? X2 : X1;
        await post('bet', { playerId: nd9, roomId: rid2, bet: 1 });
        var or9 = await post('open', { playerId: d2, roomId: rid2, mode: 'openAllNoPass', selectedOpenIds: [] });
        d2 = or9.roundResult ? or9.roundResult.nextDealerOpenId : d2;
        var rr9 = await post('resetRound', { playerId: d2, roomId: rid2 });
        d2 = rr9.ok ? rr9.dealerOpenId : d2;
      }
      var rDeal9 = await post('deal', { playerId: d2, roomId: rid2 });
      t9_1.ms = Date.now() - s9;
      check(t9_1, rDeal9.ok, 'ok=' + rDeal9.ok + ' code=' + rDeal9.code);

      // =============== G10: 静态资源 ===============
      var s10_1 = await ms(t10_1, function () { return httpGet('/'); });
      check(t10_1, s10_1 === 200, 'status=' + s10_1);

      var s10_2 = await ms(t10_2, function () { return httpGet('/app.js'); });
      check(t10_2, s10_2 === 200, 'status=' + s10_2);

      var s10_3 = await ms(t10_3, function () { return httpGet('/style.css'); });
      check(t10_3, s10_3 === 200, 'status=' + s10_3);

      var s10_4 = await ms(t10_4, function () { return httpGet('/qrcode.min.js'); });
      check(t10_4, s10_4 === 200, 'status=' + s10_4);

      var s10_5 = await ms(t10_5, function () { return httpGet('/test-runner.js'); });
      check(t10_5, s10_5 === 200, 'status=' + s10_5);

      var s10_6 = await ms(t10_6, function () { return httpGet('/assets/props/egg-projectile.webp'); });
      check(t10_6, s10_6 === 200, 'status=' + s10_6);
      var s10_7 = await ms(t10_7, function () { return httpGet('/assets/props/egg-impact.webp'); });
      check(t10_7, s10_7 === 200, 'status=' + s10_7);
      var s10_8 = await ms(t10_8, function () { return httpGet('/assets/props/egg-splat.webp'); });
      check(t10_8, s10_8 === 200, 'status=' + s10_8);
      var s10_9 = await ms(t10_9, function () { return httpGet('/assets/props/tomato-projectile.webp'); });
      check(t10_9, s10_9 === 200, 'status=' + s10_9);
      var s10_10 = await ms(t10_10, function () { return httpGet('/assets/props/tomato-impact.webp'); });
      check(t10_10, s10_10 === 200, 'status=' + s10_10);
      var s10_11 = await ms(t10_11, function () { return httpGet('/assets/props/tomato-splat.webp'); });
      check(t10_11, s10_11 === 200, 'status=' + s10_11);
      var s10_12 = await ms(t10_12, function () { return httpGet('/member-banner-queue.js'); });
      check(t10_12, s10_12 === 200, 'status=' + s10_12);
      var s10_13 = await ms(t10_13, function () { return httpGet('/result-member-highlight.js'); });
      check(t10_13, s10_13 === 200, 'status=' + s10_13);

      // =============== G11: Socket.IO ===============
      var s11 = await ms(t11_1, function () { return httpGet('/socket.io/socket.io.js'); });
      check(t11_1, s11 === 200, 'status=' + s11);

      // =============== G12: 玩家道具互动 ===============
      try {
        var propResult = await ms(t12_1, async function () {
          var PA = runPrefix + 'prop_A_' + Date.now();
          var PB = runPrefix + 'prop_B_' + Date.now();
          var created = await post('createRoom', { playerId: PA, nickName: '道具A' });
          await post('joinRoom', { playerId: PB, roomId: created.roomId, nickName: '道具B' });

          var socketA = await connectTestSocket();
          var socketB = await connectTestSocket();
          testSockets.push(socketA, socketB);
          await Promise.all([
            emitArgsWithAck(socketA, 'joinRoom', [created.roomId, PA]),
            emitArgsWithAck(socketB, 'joinRoom', [created.roomId, PB])
          ]);

          var matchesThrow = function (data) {
            return data && data.roomId === created.roomId &&
              data.senderPlayerId === PA && data.targetPlayerId === PB && data.propType === 'egg';
          };
          var eventA = waitForEvent(socketA, 'propThrown', matchesThrow);
          var eventB = waitForEvent(socketB, 'propThrown', matchesThrow);
          var ack = emitWithAck(socketA, 'throwProp', {
            roomId: created.roomId,
            targetPlayerId: PB,
            propType: 'egg'
          });

          var values = await Promise.all([ack, eventA, eventB]);
          return { ack: values[0], eventA: values[1], eventB: values[2] };
        });
        check(t12_1, propResult.ack && propResult.ack.ok && propResult.eventA && propResult.eventB,
          'resp=' + brief(propResult));
      } catch (propErr) {
        check(t12_1, false, propErr.message || String(propErr));
      }

      try {
        var visitorAck = await ms(t12_2, async function () {
          var ownerId = runPrefix + 'prop_owner_' + Date.now();
          var visitorId = runPrefix + 'prop_visitor_' + Date.now();
          var created = await post('createRoom', { playerId: ownerId, nickName: '房主' });
          var visitorSocket = await connectTestSocket();
          testSockets.push(visitorSocket);
          await emitArgsWithAck(visitorSocket, 'joinRoom', [created.roomId, visitorId]);
          return emitWithAck(visitorSocket, 'throwProp', {
            roomId: created.roomId,
            targetPlayerId: ownerId,
            propType: 'egg'
          });
        });
        check(t12_2, visitorAck && !visitorAck.ok && visitorAck.code === 'SENDER_NOT_IN_ROOM',
          'resp=' + brief(visitorAck));
      } catch (visitorErr) {
        check(t12_2, false, visitorErr.message || String(visitorErr));
      }

      try {
        var invalidA = runPrefix + 'prop_invalid_A_' + Date.now();
        var invalidB = runPrefix + 'prop_invalid_B_' + Date.now();
        var invalidRoom = await post('createRoom', { playerId: invalidA, nickName: '校验A' });
        await post('joinRoom', { playerId: invalidB, roomId: invalidRoom.roomId, nickName: '校验B' });
        var invalidSocket = await connectTestSocket();
        testSockets.push(invalidSocket);
        await emitArgsWithAck(invalidSocket, 'joinRoom', [invalidRoom.roomId, invalidA]);

        var selfAck = await ms(t12_3, function () {
          return emitWithAck(invalidSocket, 'throwProp', {
            roomId: invalidRoom.roomId,
            targetPlayerId: invalidA,
            propType: 'egg'
          });
        });
        check(t12_3, selfAck && !selfAck.ok && selfAck.code === 'CANNOT_TARGET_SELF',
          'resp=' + brief(selfAck));

        var typeAck = await ms(t12_4, function () {
          return emitWithAck(invalidSocket, 'throwProp', {
            roomId: invalidRoom.roomId,
            targetPlayerId: invalidB,
            propType: 'watermelon'
          });
        });
        check(t12_4, typeAck && !typeAck.ok && typeAck.code === 'INVALID_PROP',
          'resp=' + brief(typeAck));

        var targetAck = await ms(t12_5, function () {
          return emitWithAck(invalidSocket, 'throwProp', {
            roomId: invalidRoom.roomId,
            targetPlayerId: runPrefix + 'missing_player',
            propType: 'tomato'
          });
        });
        check(t12_5, targetAck && !targetAck.ok && targetAck.code === 'TARGET_NOT_FOUND',
          'resp=' + brief(targetAck));
      } catch (invalidErr) {
        if (t12_3.status !== 'pass' && t12_3.status !== 'fail') check(t12_3, false, invalidErr.message || String(invalidErr));
        if (t12_4.status !== 'pass' && t12_4.status !== 'fail') check(t12_4, false, invalidErr.message || String(invalidErr));
        if (t12_5.status !== 'pass' && t12_5.status !== 'fail') check(t12_5, false, invalidErr.message || String(invalidErr));
      }

      try {
        var staleA = runPrefix + 'prop_stale_A_' + Date.now();
        var staleB = runPrefix + 'prop_stale_B_' + Date.now();
        var staleRoom = await post('createRoom', { playerId: staleA, nickName: '旧连接A' });
        await post('joinRoom', { playerId: staleB, roomId: staleRoom.roomId, nickName: '目标B' });
        var oldSocket = await connectTestSocket();
        var newSocket = await connectTestSocket();
        testSockets.push(oldSocket, newSocket);
        await emitArgsWithAck(oldSocket, 'joinRoom', [staleRoom.roomId, staleA]);
        await emitArgsWithAck(newSocket, 'joinRoom', [staleRoom.roomId, staleA]);
        await emitWithAck(newSocket, 'throwProp', {
          roomId: staleRoom.roomId,
          targetPlayerId: staleA,
          propType: 'egg'
        });

        var staleAck = await ms(t12_6, function () {
          return emitWithAck(oldSocket, 'throwProp', {
            roomId: staleRoom.roomId,
            targetPlayerId: staleB,
            propType: 'egg'
          });
        });
        check(t12_6, staleAck && !staleAck.ok && staleAck.code === 'STALE_SOCKET',
          'resp=' + brief(staleAck));
      } catch (staleErr) {
        check(t12_6, false, staleErr.message || String(staleErr));
      }

      try {
        var leaveA = runPrefix + 'prop_leave_A_' + Date.now();
        var leaveB = runPrefix + 'prop_leave_B_' + Date.now();
        var leaveRoom = await post('createRoom', { playerId: leaveA, nickName: '离开A' });
        await post('joinRoom', { playerId: leaveB, roomId: leaveRoom.roomId, nickName: '目标B' });
        var leaveSocket = await connectTestSocket();
        testSockets.push(leaveSocket);
        await emitArgsWithAck(leaveSocket, 'joinRoom', [leaveRoom.roomId, leaveA]);
        await emitArgsWithAck(leaveSocket, 'leaveRoom', [leaveRoom.roomId]);

        var leaveAck = await ms(t12_7, function () {
          return emitWithAck(leaveSocket, 'throwProp', {
            roomId: leaveRoom.roomId,
            targetPlayerId: leaveB,
            propType: 'tomato'
          });
        });
        check(t12_7, leaveAck && !leaveAck.ok && leaveAck.code === 'SENDER_NOT_IN_ROOM',
          'resp=' + brief(leaveAck));
      } catch (leaveErr) {
        check(t12_7, false, leaveErr.message || String(leaveErr));
      }

      try {
        var rateA = runPrefix + 'prop_rate_A_' + Date.now();
        var rateB = runPrefix + 'prop_rate_B_' + Date.now();
        var rateRoom = await post('createRoom', { playerId: rateA, nickName: '限流A' });
        await post('joinRoom', { playerId: rateB, roomId: rateRoom.roomId, nickName: '目标B' });
        var rateSocket = await connectTestSocket();
        testSockets.push(rateSocket);
        await emitArgsWithAck(rateSocket, 'joinRoom', [rateRoom.roomId, rateA]);

        var firstAck = await emitWithAck(rateSocket, 'throwProp', {
          roomId: rateRoom.roomId,
          targetPlayerId: rateB,
          propType: 'egg'
        });
        var secondAck = await ms(t12_8, function () {
          return emitWithAck(rateSocket, 'throwProp', {
            roomId: rateRoom.roomId,
            targetPlayerId: rateB,
            propType: 'tomato'
          });
        });
        check(t12_8, firstAck && firstAck.ok && secondAck && !secondAck.ok && secondAck.code === 'RATE_LIMITED',
          'first=' + brief(firstAck) + ' second=' + brief(secondAck));
      } catch (rateErr) {
        check(t12_8, false, rateErr.message || String(rateErr));
      }

      try {
        var kickOwner = runPrefix + 'prop_kick_owner_' + Date.now();
        var kickedSender = runPrefix + 'prop_kicked_' + Date.now();
        var kickRoom = await post('createRoom', { playerId: kickOwner, nickName: '房主' });
        await post('joinRoom', { playerId: kickedSender, roomId: kickRoom.roomId, nickName: '被移出者' });
        var kickedSocket = await connectTestSocket();
        testSockets.push(kickedSocket);
        await emitArgsWithAck(kickedSocket, 'joinRoom', [kickRoom.roomId, kickedSender]);
        await post('kickPlayer', {
          playerId: kickOwner,
          roomId: kickRoom.roomId,
          targetPlayerId: kickedSender
        });

        var kickedAck = await ms(t12_9, function () {
          return emitWithAck(kickedSocket, 'throwProp', {
            roomId: kickRoom.roomId,
            targetPlayerId: kickOwner,
            propType: 'egg'
          });
        });
        check(t12_9, kickedAck && !kickedAck.ok && kickedAck.code === 'SENDER_NOT_IN_ROOM',
          'resp=' + brief(kickedAck));

        await post('joinRoom', { playerId: kickedSender, roomId: kickRoom.roomId, nickName: '重新加入者' });
        var rejoinedOldAck = await ms(t12_17, function () {
          return emitWithAck(kickedSocket, 'throwProp', {
            roomId: kickRoom.roomId,
            targetPlayerId: kickOwner,
            propType: 'tomato'
          });
        });
        check(t12_17, rejoinedOldAck && !rejoinedOldAck.ok &&
          (rejoinedOldAck.code === 'STALE_SOCKET' || rejoinedOldAck.code === 'SENDER_NOT_IN_ROOM'),
          'resp=' + brief(rejoinedOldAck));
      } catch (kickedErr) {
        if (t12_9.status !== 'pass' && t12_9.status !== 'fail') check(t12_9, false, kickedErr.message || String(kickedErr));
        if (t12_17.status !== 'pass' && t12_17.status !== 'fail') check(t12_17, false, kickedErr.message || String(kickedErr));
      }

      try {
        var recoveryA = runPrefix + 'prop_recovery_A_' + Date.now();
        var recoveryB = runPrefix + 'prop_recovery_B_' + Date.now();
        var recoveryRoom = await post('createRoom', { playerId: recoveryA, nickName: '恢复A' });
        await post('joinRoom', { playerId: recoveryB, roomId: recoveryRoom.roomId, nickName: '目标B' });
        var recoverySocket = await connectTestSocket();
        testSockets.push(recoverySocket);
        await emitArgsWithAck(recoverySocket, 'joinRoom', [recoveryRoom.roomId, recoveryA]);
        var recoveryFirst = await emitWithAck(recoverySocket, 'throwProp', {
          roomId: recoveryRoom.roomId,
          targetPlayerId: recoveryB,
          propType: 'egg'
        });
        await delay(1050);
        var recoverySecond = await ms(t12_11, function () {
          return emitWithAck(recoverySocket, 'throwProp', {
            roomId: recoveryRoom.roomId,
            targetPlayerId: recoveryB,
            propType: 'tomato'
          });
        });
        check(t12_11, recoveryFirst && recoveryFirst.ok && recoverySecond && recoverySecond.ok,
          'first=' + brief(recoveryFirst) + ' second=' + brief(recoverySecond));
      } catch (recoveryErr) {
        check(t12_11, false, recoveryErr.message || String(recoveryErr));
      }

      try {
        var noCostA = runPrefix + 'prop_no_cost_A_' + Date.now();
        var noCostB = runPrefix + 'prop_no_cost_B_' + Date.now();
        var noCostRoom = await post('createRoom', { playerId: noCostA, nickName: '失败A' });
        await post('joinRoom', { playerId: noCostB, roomId: noCostRoom.roomId, nickName: '目标B' });
        var noCostSocket = await connectTestSocket();
        testSockets.push(noCostSocket);
        await emitArgsWithAck(noCostSocket, 'joinRoom', [noCostRoom.roomId, noCostA]);
        var rejectedAck = await emitWithAck(noCostSocket, 'throwProp', {
          roomId: noCostRoom.roomId,
          targetPlayerId: noCostA,
          propType: 'egg'
        });
        var acceptedAck = await ms(t12_12, function () {
          return emitWithAck(noCostSocket, 'throwProp', {
            roomId: noCostRoom.roomId,
            targetPlayerId: noCostB,
            propType: 'egg'
          });
        });
        check(t12_12, rejectedAck && !rejectedAck.ok && rejectedAck.code === 'CANNOT_TARGET_SELF' &&
          acceptedAck && acceptedAck.ok,
          'rejected=' + brief(rejectedAck) + ' accepted=' + brief(acceptedAck));
      } catch (noCostErr) {
        check(t12_12, false, noCostErr.message || String(noCostErr));
      }

      try {
        var inviteA = runPrefix + 'prop_invite_A_' + Date.now();
        var inviteB = runPrefix + 'prop_invite_B_' + Date.now();
        var inviteVisitor = runPrefix + 'prop_invite_visitor_' + Date.now();
        var inviteRoom = await post('createRoom', { playerId: inviteA, nickName: '邀请A' });
        await post('joinRoom', { playerId: inviteB, roomId: inviteRoom.roomId, nickName: '目标B' });
        var inviteSenderSocket = await connectTestSocket();
        var inviteVisitorSocket = await connectTestSocket();
        testSockets.push(inviteSenderSocket, inviteVisitorSocket);
        await Promise.all([
          emitArgsWithAck(inviteSenderSocket, 'joinRoom', [inviteRoom.roomId, inviteA]),
          emitArgsWithAck(inviteVisitorSocket, 'joinRoom', [inviteRoom.roomId, inviteVisitor])
        ]);
        var inviteEventPromise = waitForEvent(inviteVisitorSocket, 'propThrown', function (data) {
          return data && data.senderPlayerId === inviteA && data.targetPlayerId === inviteB;
        });
        var inviteThrowAck = emitWithAck(inviteSenderSocket, 'throwProp', {
          roomId: inviteRoom.roomId,
          targetPlayerId: inviteB,
          propType: 'egg'
        });
        var inviteValues = await Promise.all([inviteEventPromise, inviteThrowAck]);
        await post('joinRoom', {
          playerId: inviteVisitor,
          roomId: inviteRoom.roomId,
          nickName: '邀请访客'
        });
        await emitArgsWithAck(inviteVisitorSocket, 'joinRoom', [inviteRoom.roomId, inviteVisitor]);
        var inviteSyncAck = await emitWithAck(inviteVisitorSocket, 'throwProp', {
          roomId: inviteRoom.roomId,
          targetPlayerId: inviteVisitor,
          propType: 'egg'
        });
        var inviteMemberAck = await ms(t12_13, function () {
          return emitWithAck(inviteVisitorSocket, 'throwProp', {
            roomId: inviteRoom.roomId,
            targetPlayerId: inviteB,
            propType: 'tomato'
          });
        });
        check(t12_13, inviteValues[0] && inviteValues[1] && inviteValues[1].ok &&
          inviteSyncAck && !inviteSyncAck.ok && inviteSyncAck.code === 'CANNOT_TARGET_SELF' &&
          inviteMemberAck && inviteMemberAck.ok,
          'subscribe=' + brief(inviteValues) + ' member=' + brief(inviteMemberAck));
      } catch (inviteErr) {
        check(t12_13, false, inviteErr.message || String(inviteErr));
      }

      try {
        var pureA = runPrefix + 'prop_pure_A_' + Date.now();
        var pureB = runPrefix + 'prop_pure_B_' + Date.now();
        var pureRoom = await post('createRoom', { playerId: pureA, nickName: '纯事件A' });
        await post('joinRoom', { playerId: pureB, roomId: pureRoom.roomId, nickName: '纯事件B' });
        var pureSocket = await connectTestSocket();
        testSockets.push(pureSocket);
        await emitArgsWithAck(pureSocket, 'joinRoom', [pureRoom.roomId, pureA]);
        var beforeRoom = await post('getRoom', { playerId: pureA, roomId: pureRoom.roomId });
        var noUpdatePromise = expectNoEvent(pureSocket, 'roomUpdate', function (data) {
          return data && data.roomId === pureRoom.roomId;
        }, 250);
        var pureEventPromise = waitForEvent(pureSocket, 'propThrown', function (data) {
          return data && data.roomId === pureRoom.roomId;
        });
        var pureAckPromise = emitWithAck(pureSocket, 'throwProp', {
          roomId: pureRoom.roomId,
          targetPlayerId: pureB,
          propType: 'egg'
        });
        var pureValues = await Promise.all([pureAckPromise, pureEventPromise, noUpdatePromise]);
        var afterRoom = await post('getRoom', { playerId: pureA, roomId: pureRoom.roomId });
        var sameState = JSON.stringify(roomStateSnapshot(beforeRoom.room)) === JSON.stringify(roomStateSnapshot(afterRoom.room));
        check(t12_14, pureValues[0] && pureValues[0].ok && pureValues[1] && pureValues[2] === true && sameState,
          'ack=' + brief(pureValues[0]) + ' noRoomUpdate=' + pureValues[2] + ' sameState=' + sameState);
      } catch (pureErr) {
        check(t12_14, false, pureErr.message || String(pureErr));
      }

      try {
        var offlineA = runPrefix + 'prop_offline_A_' + Date.now();
        var offlineB = runPrefix + 'prop_offline_B_' + Date.now();
        var offlineC = runPrefix + 'prop_offline_C_' + Date.now();
        var offlineRoom = await post('createRoom', { playerId: offlineA, nickName: '在线A' });
        await post('joinRoom', { playerId: offlineB, roomId: offlineRoom.roomId, nickName: '离线B' });
        await post('joinRoom', { playerId: offlineC, roomId: offlineRoom.roomId, nickName: '旁观C' });
        var offlineSenderSocket = await connectTestSocket();
        var offlineTargetSocket = await connectTestSocket();
        var offlineObserverSocket = await connectTestSocket();
        testSockets.push(offlineSenderSocket, offlineTargetSocket, offlineObserverSocket);
        await Promise.all([
          emitArgsWithAck(offlineSenderSocket, 'joinRoom', [offlineRoom.roomId, offlineA]),
          emitArgsWithAck(offlineTargetSocket, 'joinRoom', [offlineRoom.roomId, offlineB]),
          emitArgsWithAck(offlineObserverSocket, 'joinRoom', [offlineRoom.roomId, offlineC])
        ]);
        var offlineUpdatePromise = waitForEvent(offlineSenderSocket, 'roomUpdate', function (room) {
          var target = room && room.players && room.players.find(function (p) { return p.openId === offlineB; });
          return target && target.offline === true;
        });
        offlineTargetSocket.disconnect();
        var offlineUpdate = await offlineUpdatePromise;
        var offlineEventPromise = waitForEvent(offlineObserverSocket, 'propThrown', function (data) {
          return data && data.targetPlayerId === offlineB;
        });
        var offlineAckPromise = emitWithAck(offlineSenderSocket, 'throwProp', {
          roomId: offlineRoom.roomId,
          targetPlayerId: offlineB,
          propType: 'tomato'
        });
        var offlineValues = await Promise.all([offlineAckPromise, offlineEventPromise]);
        check(t12_15, offlineUpdate && offlineValues[0] && offlineValues[0].ok && offlineValues[1],
          'ack=' + brief(offlineValues[0]) + ' event=' + brief(offlineValues[1]));
      } catch (offlineErr) {
        check(t12_15, false, offlineErr.message || String(offlineErr));
      }

      try {
        var openedA = runPrefix + 'prop_opened_A_' + Date.now();
        var openedB = runPrefix + 'prop_opened_B_' + Date.now();
        var openedRoom = await post('createRoom', { playerId: openedA, nickName: '结果A' });
        await post('joinRoom', { playerId: openedB, roomId: openedRoom.roomId, nickName: '结果B' });
        var openedSocket = await connectTestSocket();
        testSockets.push(openedSocket);
        await emitArgsWithAck(openedSocket, 'joinRoom', [openedRoom.roomId, openedA]);
        await post('deal', { playerId: openedA, roomId: openedRoom.roomId });
        await post('bet', { playerId: openedB, roomId: openedRoom.roomId, bet: 1 });
        await post('open', { playerId: openedA, roomId: openedRoom.roomId, mode: 'openAllNoPass', selectedOpenIds: [] });

        var openedAck = await ms(t12_16, function () {
          return emitWithAck(openedSocket, 'throwProp', {
            roomId: openedRoom.roomId,
            targetPlayerId: openedB,
            propType: 'egg'
          });
        });
        check(t12_16, openedAck && !openedAck.ok && openedAck.code === 'WRONG_STATUS',
          'resp=' + brief(openedAck));
      } catch (openedErr) {
        check(t12_16, false, openedErr.message || String(openedErr));
      }

      // =============== G13: VIP 会员横幅 ===============
      try {
        var vipCreateId = runPrefix + 'banner_create_' + Date.now();
        var vipCreate = await ms(t13_1, function () {
          return post('createRoom', { playerId: vipCreateId, nickName: 'wxw' });
        });
        var createTypes = (vipCreate.memberBanners || []).map(function (event) { return event.type; });
        check(t13_1, vipCreate.ok && createTypes.join(',') === 'banker,join' &&
          vipCreate.memberBanners[0].playerId === vipCreateId &&
          vipCreate.memberBanners[0].eventId !== vipCreate.memberBanners[1].eventId,
          'resp=' + brief(vipCreate));
      } catch (vipCreateErr) {
        check(t13_1, false, vipCreateErr.message || String(vipCreateErr));
      }

      try {
        var bannerOwnerId = runPrefix + 'banner_owner_' + Date.now();
        var bannerVipId = runPrefix + 'banner_vip_' + Date.now();
        var bannerRoom = await post('createRoom', { playerId: bannerOwnerId, nickName: '横幅房主' });
        var bannerSocket = await connectTestSocket();
        testSockets.push(bannerSocket);
        await emitArgsWithAck(bannerSocket, 'joinRoom', [bannerRoom.roomId, bannerOwnerId]);

        var joinOrder = [];
        function recordJoinUpdate(room) {
          if (room && room.roomId === bannerRoom.roomId &&
              room.players.some(function (player) { return player.openId === bannerVipId; })) {
            joinOrder.push('roomUpdate');
          }
        }
        function recordJoinBanner(event) {
          if (event && event.roomId === bannerRoom.roomId && event.playerId === bannerVipId && event.type === 'join') {
            joinOrder.push('memberBanner');
          }
        }
        bannerSocket.on('roomUpdate', recordJoinUpdate);
        bannerSocket.on('memberBanner', recordJoinBanner);
        var joinUpdatePromise = waitForEvent(bannerSocket, 'roomUpdate', function (room) {
          return room && room.roomId === bannerRoom.roomId &&
            room.players.some(function (player) { return player.openId === bannerVipId; });
        });
        var joinBannerPromise = waitForEvent(bannerSocket, 'memberBanner', function (event) {
          return event && event.roomId === bannerRoom.roomId && event.playerId === bannerVipId && event.type === 'join';
        });
        var joinResponsePromise = post('joinRoom', {
          playerId: bannerVipId,
          roomId: bannerRoom.roomId,
          nickName: 'wxw'
        });
        var joinValues = await ms(t13_2, function () {
          return Promise.all([joinResponsePromise, joinUpdatePromise, joinBannerPromise]);
        });
        bannerSocket.off('roomUpdate', recordJoinUpdate);
        bannerSocket.off('memberBanner', recordJoinBanner);
        var joinResponse = joinValues[0];
        var joinEvent = joinValues[2];
        check(t13_2, joinResponse.ok && joinResponse.memberBanners.length === 1 &&
          joinResponse.memberBanners[0].eventId === joinEvent.eventId &&
          joinOrder[0] === 'roomUpdate' && joinOrder[1] === 'memberBanner',
          'order=' + joinOrder.join('>') + ' http=' + brief(joinResponse.memberBanners) + ' socket=' + brief(joinEvent));

        var noRejoinEvent = expectNoEvent(bannerSocket, 'memberBanner', function (event) {
          return event && event.roomId === bannerRoom.roomId && event.playerId === bannerVipId && event.type === 'join';
        }, 300);
        var rejoinResponse = await post('joinRoom', {
          playerId: bannerVipId,
          roomId: bannerRoom.roomId,
          nickName: 'wxw'
        });
        var rejoinSilent = await ms(t13_3, function () { return noRejoinEvent; });
        check(t13_3, rejoinResponse.ok && rejoinSilent === true &&
          Array.isArray(rejoinResponse.memberBanners) && rejoinResponse.memberBanners.length === 0,
          'silent=' + rejoinSilent + ' resp=' + brief(rejoinResponse));

        await post('deal', { playerId: bannerOwnerId, roomId: bannerRoom.roomId });
        var betOrder = [];
        var betRoomUpdates = 0;
        function recordBetUpdate(room) {
          if (room && room.roomId === bannerRoom.roomId) {
            betRoomUpdates++;
            betOrder.push('roomUpdate');
          }
        }
        function recordBetBanner(event) {
          if (event && event.roomId === bannerRoom.roomId && event.playerId === bannerVipId && event.type === 'bet') {
            betOrder.push('memberBanner');
          }
        }
        bannerSocket.on('roomUpdate', recordBetUpdate);
        bannerSocket.on('memberBanner', recordBetBanner);
        var betBannerPromise = waitForEvent(bannerSocket, 'memberBanner', function (event) {
          return event && event.roomId === bannerRoom.roomId && event.playerId === bannerVipId && event.type === 'bet';
        });
        var betResponsePromise = post('bet', {
          playerId: bannerVipId,
          roomId: bannerRoom.roomId,
          bet: 3
        });
        var betValues = await ms(t13_4, function () {
          return Promise.all([betResponsePromise, betBannerPromise]);
        });
        await delay(100);
        bannerSocket.off('roomUpdate', recordBetUpdate);
        bannerSocket.off('memberBanner', recordBetBanner);
        check(t13_4, betValues[0].ok && betValues[1].amount === 3 && betRoomUpdates === 1 &&
          betOrder[0] === 'roomUpdate' && betOrder[1] === 'memberBanner',
          'updates=' + betRoomUpdates + ' order=' + betOrder.join('>') + ' event=' + brief(betValues[1]));

        await post('open', {
          playerId: bannerOwnerId,
          roomId: bannerRoom.roomId,
          mode: 'openAllNoPass',
          selectedOpenIds: []
        });
        await post('resetRound', { playerId: bannerOwnerId, roomId: bannerRoom.roomId });
        await post('deal', { playerId: bannerOwnerId, roomId: bannerRoom.roomId });
        var noCooldownBanner = expectNoEvent(bannerSocket, 'memberBanner', function (event) {
          return event && event.roomId === bannerRoom.roomId && event.playerId === bannerVipId && event.type === 'bet';
        }, 350);
        var cooldownBet = await post('bet', {
          playerId: bannerVipId,
          roomId: bannerRoom.roomId,
          bet: 2
        });
        var cooldownSilent = await ms(t13_5, function () { return noCooldownBanner; });
        check(t13_5, cooldownBet.ok && cooldownSilent === true &&
          cooldownBet.room.players.find(function (player) { return player.openId === bannerVipId; }).bet === 2,
          'betOk=' + cooldownBet.ok + ' silent=' + cooldownSilent);
      } catch (bannerFlowErr) {
        [t13_2, t13_3, t13_4, t13_5].forEach(function (test) {
          if (test.status !== 'pass' && test.status !== 'fail') check(test, false, bannerFlowErr.message || String(bannerFlowErr));
        });
      }

      try {
        var openVipId = runPrefix + 'banner_open_vip_' + Date.now();
        var openPlayerId = runPrefix + 'banner_open_player_' + Date.now();
        var openRoom = await post('createRoom', { playerId: openVipId, nickName: 'wxw' });
        await post('joinRoom', { playerId: openPlayerId, roomId: openRoom.roomId, nickName: '普通玩家' });
        var openSocket = await connectTestSocket();
        testSockets.push(openSocket);
        await emitArgsWithAck(openSocket, 'joinRoom', [openRoom.roomId, openPlayerId]);
        await post('deal', { playerId: openVipId, roomId: openRoom.roomId });
        await post('bet', { playerId: openPlayerId, roomId: openRoom.roomId, bet: 1 });
        var openBannerPromise = waitForEvent(openSocket, 'memberBanner', function (event) {
          return event && event.roomId === openRoom.roomId && event.playerId === openVipId && event.type === 'open_card';
        });
        var openResponsePromise = post('open', {
          playerId: openVipId,
          roomId: openRoom.roomId,
          mode: 'openAllNoPass',
          selectedOpenIds: []
        });
        var openValues = await ms(t13_6, function () {
          return Promise.all([openResponsePromise, openBannerPromise]);
        });
        check(t13_6, openValues[0].ok && openValues[1].openMode === 'openAllNoPass' &&
          openValues[1].message.indexOf('霸气全开，王座不让') !== -1,
          'resp=' + brief(openValues));
      } catch (openBannerErr) {
        check(t13_6, false, openBannerErr.message || String(openBannerErr));
      }

      try {
        var ordinaryOwner = runPrefix + 'banner_ordinary_owner_' + Date.now();
        var ordinaryPlayer = runPrefix + 'banner_ordinary_player_' + Date.now();
        var ordinaryRoom = await post('createRoom', { playerId: ordinaryOwner, nickName: '普通庄家' });
        await post('joinRoom', { playerId: ordinaryPlayer, roomId: ordinaryRoom.roomId, nickName: '普通闲家' });
        var ordinarySocket = await connectTestSocket();
        testSockets.push(ordinarySocket);
        await emitArgsWithAck(ordinarySocket, 'joinRoom', [ordinaryRoom.roomId, ordinaryOwner]);
        await post('deal', { playerId: ordinaryOwner, roomId: ordinaryRoom.roomId });
        var noOrdinaryBet = expectNoEvent(ordinarySocket, 'memberBanner', function (event) {
          return event && event.roomId === ordinaryRoom.roomId && event.type === 'bet';
        }, 300);
        var ordinaryBet = await post('bet', { playerId: ordinaryPlayer, roomId: ordinaryRoom.roomId, bet: 1 });
        var ordinaryBetSilent = await noOrdinaryBet;
        var noOrdinaryOpen = expectNoEvent(ordinarySocket, 'memberBanner', function (event) {
          return event && event.roomId === ordinaryRoom.roomId && event.type === 'open_card';
        }, 300);
        var ordinaryOpen = await post('open', {
          playerId: ordinaryOwner,
          roomId: ordinaryRoom.roomId,
          mode: 'openAllNoPass',
          selectedOpenIds: []
        });
        var ordinaryOpenSilent = await ms(t13_7, function () { return noOrdinaryOpen; });
        check(t13_7, ordinaryBet.ok && ordinaryOpen.ok && ordinaryBetSilent && ordinaryOpenSilent,
          'betSilent=' + ordinaryBetSilent + ' openSilent=' + ordinaryOpenSilent);
      } catch (ordinaryErr) {
        check(t13_7, false, ordinaryErr.message || String(ordinaryErr));
      }

      try {
        var beforeBannerNodes = document.querySelectorAll('.member-banner-layer').length;
        var acceptedWrongContext = await ms(t13_8, function () {
          return Promise.resolve(window.MemberBannerManager.enqueue({
            eventId: 'test-wrong-context-' + Date.now(),
            roomId: 'not-current-room',
            type: 'join',
            priority: 20,
            playerId: 'vip-test',
            nickname: 'wxw',
            memberLevel: 'vip',
            bannerTheme: 'casino_spectacle',
            privilegeFlags: ['banner:join'],
            message: '♛ VIP · wxw 尊耀降临，华丽入局',
            subtitle: 'ROYAL MEMBER ARRIVAL'
          }));
        });
        var afterBannerNodes = document.querySelectorAll('.member-banner-layer').length;
        check(t13_8, acceptedWrongContext === false && beforeBannerNodes === afterBannerNodes,
          'accepted=' + acceptedWrongContext + ' before=' + beforeBannerNodes + ' after=' + afterBannerNodes);
      } catch (contextErr) {
        check(t13_8, false, contextErr.message || String(contextErr));
      }

      // =============== G14: VIP 强牌结果特效 ===============
      function createResultHighlightFixture(memberLevel, handType) {
        var variant = window.ResultMemberHighlight.getResultMemberHighlightVariant(memberLevel, handType);
        var root = document.createElement('div');
        root.className = 'player-result-card';
        root.setAttribute('data-player-id', 'result-highlight-test');
        root.setAttribute('data-hand-type', String(handType));
        root.style.cssText = 'position:fixed;left:-9999px;top:0;';
        if (variant) {
          root.setAttribute('data-member-highlight', variant);
          root.innerHTML = '<div class="result-hand-highlight result-hand-highlight--' + variant + '">' +
            '<span class="result-hand-highlight-particles" aria-hidden="true">✦</span>' +
            '<div class="cards-row"></div></div>';
        } else {
          root.innerHTML = '<div class="cards-row"></div>';
        }
        document.body.appendChild(root);
        return { root: root, variant: variant };
      }

      try {
        var highlightMatrix = await ms(t14_1, function () {
          var api = window.ResultMemberHighlight;
          return Promise.resolve({
            straightFlush: api.getResultMemberHighlightVariant('vip', 4),
            threeOfAKind: api.getResultMemberHighlightVariant('svip', 5),
            ordinary: api.getResultMemberHighlightVariant(null, 4),
            otherHand: api.getResultMemberHighlightVariant('vip', 3)
          });
        });
        check(t14_1,
          highlightMatrix.straightFlush === 'straight-flush' &&
          highlightMatrix.threeOfAKind === 'three-of-a-kind' &&
          highlightMatrix.ordinary === null && highlightMatrix.otherHand === null,
          brief(highlightMatrix));
      } catch (highlightMatrixErr) {
        check(t14_1, false, highlightMatrixErr.message || String(highlightMatrixErr));
      }

      var straightFlushFixture = null;
      try {
        var straightFlushDom = await ms(t14_2, function () {
          straightFlushFixture = createResultHighlightFixture('vip', 4);
          var highlight = straightFlushFixture.root.querySelector('.result-hand-highlight');
          var particles = straightFlushFixture.root.querySelector('.result-hand-highlight-particles');
          var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          var highlightStyle = window.getComputedStyle(highlight);
          var particleStyle = window.getComputedStyle(particles);
          return Promise.resolve({
            variant: straightFlushFixture.variant,
            dataValue: straightFlushFixture.root.getAttribute('data-member-highlight'),
            hasModifier: highlight.classList.contains('result-hand-highlight--straight-flush'),
            hasParticles: !!particles,
            animationReady: reducedMotion
              ? highlightStyle.animationName === 'none' && particleStyle.display === 'none'
              : highlightStyle.animationName.indexOf('resultHandHighlightReveal') !== -1 &&
                particleStyle.animationName.indexOf('resultHandParticleBurst') !== -1
          });
        });
        check(t14_2,
          straightFlushDom.variant === 'straight-flush' &&
          straightFlushDom.dataValue === 'straight-flush' &&
          straightFlushDom.hasModifier && straightFlushDom.hasParticles && straightFlushDom.animationReady,
          brief(straightFlushDom));
      } catch (straightFlushErr) {
        check(t14_2, false, straightFlushErr.message || String(straightFlushErr));
      } finally {
        if (straightFlushFixture && straightFlushFixture.root.parentNode) straightFlushFixture.root.remove();
      }

      var threeOfAKindFixture = null;
      var ordinaryFixture = null;
      try {
        var variantDom = await ms(t14_3, function () {
          threeOfAKindFixture = createResultHighlightFixture('vip', 5);
          ordinaryFixture = createResultHighlightFixture(null, 4);
          return Promise.resolve({
            threeVariant: threeOfAKindFixture.variant,
            threeModifier: !!threeOfAKindFixture.root.querySelector('.result-hand-highlight--three-of-a-kind'),
            ordinaryVariant: ordinaryFixture.variant,
            ordinaryHighlight: !!ordinaryFixture.root.querySelector('.result-hand-highlight'),
            ordinaryData: ordinaryFixture.root.hasAttribute('data-member-highlight')
          });
        });
        check(t14_3,
          variantDom.threeVariant === 'three-of-a-kind' && variantDom.threeModifier &&
          variantDom.ordinaryVariant === null && !variantDom.ordinaryHighlight && !variantDom.ordinaryData,
          brief(variantDom));
      } catch (variantDomErr) {
        check(t14_3, false, variantDomErr.message || String(variantDomErr));
      } finally {
        if (threeOfAKindFixture && threeOfAKindFixture.root.parentNode) threeOfAKindFixture.root.remove();
        if (ordinaryFixture && ordinaryFixture.root.parentNode) ordinaryFixture.root.remove();
      }

      var originalTestHash = window.location.hash;
      try {
        var previewRouteDom = await ms(t14_4, async function () {
          window.location.hash = '/member-highlight-preview';
          await delay(30);
          var preview = document.querySelector('.member-highlight-preview');
          var groups = preview ? Array.from(preview.querySelectorAll('.member-highlight-preview-card')) : [];
          return {
            hasPreview: !!preview,
            denied: !!document.querySelector('.test-denied'),
            straightFlush: !!document.querySelector('.result-hand-highlight--straight-flush'),
            threeOfAKind: !!document.querySelector('.result-hand-highlight--three-of-a-kind'),
            particleLayers: document.querySelectorAll('.result-hand-highlight-particles').length,
            cardCounts: groups.map(function (group) { return group.querySelectorAll('.card-with-label').length; }),
            labels: groups.map(function (group) {
              return Array.from(group.querySelectorAll('.card-label-mini')).map(function (label) {
                return label.textContent;
              }).join('/');
            })
          };
        });
        check(t14_4,
          previewRouteDom.hasPreview && !previewRouteDom.denied &&
          previewRouteDom.straightFlush && previewRouteDom.threeOfAKind &&
          previewRouteDom.particleLayers === 2 &&
          previewRouteDom.cardCounts.length === 2 && previewRouteDom.cardCounts.every(function (count) { return count === 3; }) &&
          previewRouteDom.labels.every(function (labels) { return labels === '公/手/万能'; }),
          brief(previewRouteDom));

        var previewControls = await ms(t14_5, async function () {
          var before = document.querySelector('.result-hand-highlight--straight-flush');
          window.App.replayMemberHighlightPreview();
          var afterReplay = document.querySelector('.result-hand-highlight--straight-flush');
          window.App.toggleMemberHighlightPreviewReducedMotion(true);
          var preview = document.querySelector('.member-highlight-preview');
          var afterStatic = document.querySelector('.result-hand-highlight--straight-flush');
          var particles = document.querySelector('.result-hand-highlight-particles');
          var pokerCard = document.querySelector('.member-highlight-preview .poker-card');
          var checkbox = document.getElementById('member-highlight-preview-motion');
          return {
            nodeReplaced: !!before && !!afterReplay && before !== afterReplay && !before.isConnected,
            reducedAttribute: preview && preview.getAttribute('data-reduced-motion'),
            animationName: afterStatic && window.getComputedStyle(afterStatic).animationName,
            particleDisplay: particles && window.getComputedStyle(particles).display,
            cardAnimationName: pokerCard && window.getComputedStyle(pokerCard).animationName,
            checkboxChecked: !!(checkbox && checkbox.checked)
          };
        });
        check(t14_5,
          previewControls.nodeReplaced && previewControls.reducedAttribute === 'true' &&
          previewControls.animationName === 'none' && previewControls.particleDisplay === 'none' &&
          previewControls.cardAnimationName === 'none' && previewControls.checkboxChecked,
          brief(previewControls));
      } catch (previewErr) {
        if (t14_4.status === 'running' || t14_4.status === 'pending') {
          check(t14_4, false, previewErr.message || String(previewErr));
        }
        if (t14_5.status === 'running' || t14_5.status === 'pending') {
          check(t14_5, false, previewErr.message || String(previewErr));
        }
      } finally {
        window.location.hash = originalTestHash || ('/test?key=' + encodeURIComponent(testKey));
        await delay(30);
        updateUI();
      }

      try {
        var goneA = runPrefix + 'prop_gone_A_' + Date.now();
        var goneB = runPrefix + 'prop_gone_B_' + Date.now();
        var goneRoom = await post('createRoom', { playerId: goneA, nickName: '删除A' });
        await post('joinRoom', { playerId: goneB, roomId: goneRoom.roomId, nickName: '删除B' });
        var goneSocket = await connectTestSocket();
        testSockets.push(goneSocket);
        await emitArgsWithAck(goneSocket, 'joinRoom', [goneRoom.roomId, goneA]);
        var cleanResult = await post('_cleanTestRooms', { key: testKey, ownerPrefix: runPrefix });

        var goneAck = await ms(t12_10, function () {
          return emitWithAck(goneSocket, 'throwProp', {
            roomId: goneRoom.roomId,
            targetPlayerId: goneB,
            propType: 'tomato'
          });
        });
        check(t12_10, cleanResult && cleanResult.ok && cleanResult.cleaned > 0 &&
          goneAck && !goneAck.ok && goneAck.code === 'ROOM_NOT_FOUND',
          'clean=' + brief(cleanResult) + ' resp=' + brief(goneAck));
      } catch (goneErr) {
        check(t12_10, false, goneErr.message || String(goneErr));
      }

    } catch (err) {
      var errTest = register('ERROR', '测试运行异常');
      errTest.status = 'fail';
      errTest.detail = (err.message || '') + ' | ' + (err.stack || '').split('\n').slice(0, 3).join(' ');
      failed++;
    }

    testSockets.forEach(function (socket) {
      if (socket && socket.connected) socket.disconnect();
    });

    try {
      await post('_cleanTestRooms', { key: testKey, ownerPrefix: runPrefix });
    } catch (e) { /* ignore */ }

    updateUI();

    var btn = document.getElementById('test-run-btn');
    if (btn) { btn.disabled = false; btn.textContent = '重新运行'; }
  }

  window.TestRunner = { run: run };
})();
