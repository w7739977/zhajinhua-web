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

    var t6_1 = register(G6, '非庄踢人被拒');
    var t6_2 = register(G6, '庄家踢人成功');
    var t6_3 = register(G6, '不能踢自己');

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

    var t11_1 = register(G11, 'Socket.IO 握手');

    updateUI();

    var A = '_test_A_' + Date.now();
    var B = '_test_B_' + Date.now();
    var C = '_test_C_' + Date.now();
    var D = '_test_D_' + Date.now();
    var roomId = '';
    var dealer = A;

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
      var nonOwner = [B, C, D].filter(function (x) { return x !== dealer; })[0];
      var r6_1r = await ms(t6_1, function () { return post('kickPlayer', { playerId: nonOwner, roomId: roomId, targetPlayerId: D }); });
      check(t6_1, !r6_1r.ok, 'ok=' + r6_1r.ok + ' code=' + r6_1r.code + ' (expect NOT_AUTHORIZED)');

      var r6_2r = await ms(t6_2, function () { return post('kickPlayer', { playerId: dealer, roomId: roomId, targetPlayerId: D }); });
      check(t6_2, r6_2r.ok && !r6_2r.room.players.find(function (p) { return p.openId === D; }),
        'ok=' + r6_2r.ok + ' D still in=' + !!(r6_2r.room && r6_2r.room.players.find(function (p) { return p.openId === D; })));

      var r6_3r = await ms(t6_3, function () { return post('kickPlayer', { playerId: dealer, roomId: roomId, targetPlayerId: dealer }); });
      check(t6_3, !r6_3r.ok && r6_3r.code === 'CANNOT_KICK_SELF',
        'ok=' + r6_3r.ok + ' code=' + r6_3r.code);

      // =============== G7: 全开 ===============
      await post('deal', { playerId: dealer, roomId: roomId });
      var nd7 = getNonDealer([A, B, C], dealer);
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

      var nd8 = getNonDealer([A, B, C], dealer);
      await post('bet', { playerId: nd8[0], roomId: roomId, bet: 1 });
      var r8_5r = await ms(t8_5, function () { return post('bet', { playerId: nd8[0], roomId: roomId, bet: 2 }); });
      check(t8_5, !r8_5r.ok && r8_5r.code === 'ALREADY_BET', 'code=' + r8_5r.code);

      var r8_6r = await ms(t8_6, function () { return post('open', { playerId: nd8[0], roomId: roomId, mode: 'openAll' }); });
      check(t8_6, !r8_6r.ok && r8_6r.code === 'NOT_DEALER', 'code=' + r8_6r.code);

      for (var i8 = 1; i8 < nd8.length; i8++) await post('bet', { playerId: nd8[i8], roomId: roomId, bet: 1 });
      await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      var rGetRoom2 = await post('getRoom', { playerId: dealer, roomId: roomId });
      if (rGetRoom2.ok) dealer = rGetRoom2.room.dealerOpenId;
      await post('resetRound', { playerId: dealer, roomId: roomId });

      // =============== G9: 牌组管理 ===============
      var X1 = '_test_X1_' + Date.now();
      var X2 = '_test_X2_' + Date.now();
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

      // =============== G11: Socket.IO ===============
      var s11 = await ms(t11_1, function () { return httpGet('/socket.io/socket.io.js'); });
      check(t11_1, s11 === 200, 'status=' + s11);

    } catch (err) {
      var errTest = register('ERROR', '测试运行异常');
      errTest.status = 'fail';
      errTest.detail = (err.message || '') + ' | ' + (err.stack || '').split('\n').slice(0, 3).join(' ');
      failed++;
    }

    try {
      await post('_cleanTestRooms', { key: testKey });
    } catch (e) { /* ignore */ }

    updateUI();

    var btn = document.getElementById('test-run-btn');
    if (btn) { btn.disabled = false; btn.textContent = '重新运行'; }
  }

  window.TestRunner = { run: run };
})();
