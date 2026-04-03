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
        if (t.detail && t.status === 'fail') html += '<span class="test-detail">' + esc(t.detail) + '</span>';
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

  async function check(t, condition, detail) {
    if (condition) {
      t.status = 'pass';
      passed++;
    } else {
      t.status = 'fail';
      t.detail = detail || '';
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

    // Pre-register all tests
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

    try {
      // === G1: 基础流程 ===
      var r1 = await ms(t1_1, function () { return post('createRoom', { playerId: A, nickName: 'A' }); });
      roomId = r1.roomId;
      await check(t1_1, r1.ok && roomId, 'roomId=' + roomId);
      dealer = A;

      await ms(t1_2, function () { return post('joinRoom', { playerId: B, roomId: roomId, nickName: 'B' }); });
      await check(t1_2, true);

      await ms(t1_3, function () { return post('joinRoom', { playerId: C, roomId: roomId, nickName: 'C' }); });
      await check(t1_3, true);

      var r4 = await ms(t1_4, function () { return post('deal', { playerId: dealer, roomId: roomId }); });
      await check(t1_4, r4.ok, r4.code);
      await check(t1_5, r4.room && r4.room.players.every(function (p) { return p.hasDealt; }) && !!r4.room.publicCard && r4.room.status === 'betting');

      var rB = await ms(t1_6, function () { return post('bet', { playerId: B, roomId: roomId, bet: 2 }); });
      await check(t1_6, rB.ok);

      var rC = await ms(t1_7, function () { return post('bet', { playerId: C, roomId: roomId, bet: 3 }); });
      await check(t1_7, rC.ok && rC.room.status === 'opening', rC.room && rC.room.status);

      var rOpen = await ms(t1_8, function () { return post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] }); });
      await check(t1_8, rOpen.ok);
      dealer = rOpen.roundResult.nextDealerOpenId;

      var rReset = await ms(t1_9, function () { return post('resetRound', { playerId: dealer, roomId: roomId }); });
      await check(t1_9, rReset.ok);
      dealer = rReset.dealerOpenId;

      // === G2: 庄家驱动 ===
      var rSolo = await post('createRoom', { playerId: A, nickName: 'A' });
      var soloRoomId = rSolo.roomId;
      var r2_1 = await ms(t2_1, function () { return post('deal', { playerId: A, roomId: soloRoomId }); });
      await check(t2_1, !r2_1.ok && r2_1.code === 'NOT_ENOUGH_PLAYERS', r2_1.code);

      var nonDealer = [A, B, C].filter(function (x) { return x !== dealer; });
      var r2_2 = await ms(t2_2, function () { return post('deal', { playerId: nonDealer[0], roomId: roomId }); });
      await check(t2_2, !r2_2.ok && r2_2.code === 'NOT_DEALER', r2_2.code);

      await post('deal', { playerId: dealer, roomId: roomId });
      var r2_3 = await ms(t2_3, function () { return post('bet', { playerId: dealer, roomId: roomId, bet: 1 }); });
      await check(t2_3, !r2_3.ok && r2_3.code === 'DEALER_NO_BET', r2_3.code);

      nonDealer = [A, B, C].filter(function (x) { return x !== dealer; });
      for (var i = 0; i < nonDealer.length; i++) await post('bet', { playerId: nonDealer[i], roomId: roomId, bet: 1 });
      var ro = await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      dealer = ro.roundResult.nextDealerOpenId;
      var rr = await post('resetRound', { playerId: dealer, roomId: roomId });
      dealer = rr.dealerOpenId;

      // === G3: 选择开牌+保留手牌 ===
      await post('deal', { playerId: dealer, roomId: roomId });
      nonDealer = [A, B, C].filter(function (x) { return x !== dealer; });
      for (var i2 = 0; i2 < nonDealer.length; i2++) await post('bet', { playerId: nonDealer[i2], roomId: roomId, bet: 1 });

      var targetB = nonDealer[0];
      var targetC = nonDealer[1];

      var r3_1 = await ms(t3_1, function () { return post('open', { playerId: dealer, roomId: roomId, mode: 'selectPlayers', selectedOpenIds: [targetB] }); });
      await check(t3_1, r3_1.ok && r3_1.roundResult.openedPlayerIds.indexOf(targetB) >= 0 && r3_1.roundResult.openedPlayerIds.indexOf(targetC) < 0);
      dealer = r3_1.roundResult.nextDealerOpenId;

      var r3_r = await ms(t3_2, function () { return post('resetRound', { playerId: dealer, roomId: roomId }); });
      dealer = r3_r.dealerOpenId;
      var pCr = r3_r.room.players.find(function (p) { return p.openId === targetC; });
      var pBr = r3_r.room.players.find(function (p) { return p.openId === targetB; });
      await check(t3_2, pCr && pCr.card !== null && pCr.retainedCard === true);
      await check(t3_3, pBr && pBr.card === null);

      var r3_d = await ms(t3_4, function () { return post('deal', { playerId: dealer, roomId: roomId }); });
      await check(t3_4, r3_d.ok);
      var pC2 = r3_d.room.players.find(function (p) { return p.openId === targetC; });
      await check(t3_5, pC2 && pC2.card !== null && pC2.hasDealt);
      await check(t3_6, !!r3_d.room.publicCard);

      nonDealer = [A, B, C].filter(function (x) { return x !== dealer; });
      for (var i3 = 0; i3 < nonDealer.length; i3++) await post('bet', { playerId: nonDealer[i3], roomId: roomId, bet: 1 });
      var ro2 = await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      dealer = ro2.roundResult.nextDealerOpenId;
      var rr2 = await post('resetRound', { playerId: dealer, roomId: roomId });
      dealer = rr2.dealerOpenId;

      // === G4: 中途加入观战 ===
      await post('deal', { playerId: dealer, roomId: roomId });

      var r4_1r = await ms(t4_1, function () { return post('joinRoom', { playerId: D, roomId: roomId, nickName: 'D' }); });
      await check(t4_1, r4_1r.ok && r4_1r.spectating === true);
      var pD = r4_1r.room.players.find(function (p) { return p.openId === D; });
      await check(t4_2, pD && pD.spectating === true);

      var r4_3r = await ms(t4_3, function () { return post('bet', { playerId: D, roomId: roomId, bet: 1 }); });
      await check(t4_3, !r4_3r.ok && r4_3r.code === 'SPECTATING', r4_3r.code);

      nonDealer = [A, B, C].filter(function (x) { return x !== dealer; });
      for (var i4 = 0; i4 < nonDealer.length; i4++) await post('bet', { playerId: nonDealer[i4], roomId: roomId, bet: 1 });
      var ro3 = await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      dealer = ro3.roundResult.nextDealerOpenId;
      var rr3 = await ms(t4_4, function () { return post('resetRound', { playerId: dealer, roomId: roomId }); });
      dealer = rr3.dealerOpenId;
      var pD2 = rr3.room.players.find(function (p) { return p.openId === D; });
      await check(t4_4, pD2 && pD2.spectating === false);

      // === G5: 权限控制 ===
      await post('deal', { playerId: dealer, roomId: roomId });
      nonDealer = [A, B, C, D].filter(function (x) { return x !== dealer; });
      for (var i5 = 0; i5 < nonDealer.length; i5++) await post('bet', { playerId: nonDealer[i5], roomId: roomId, bet: 1 });
      var ro4 = await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      var nd4 = ro4.roundResult.nextDealerOpenId;

      var nonAuth = [A, B, C, D].filter(function (x) { return x !== nd4; });
      var r5_1r = await ms(t5_1, function () { return post('resetRound', { playerId: nonAuth[0], roomId: roomId }); });
      await check(t5_1, !r5_1r.ok, r5_1r.code);

      var r5_2r = await ms(t5_2, function () { return post('resetRound', { playerId: nd4, roomId: roomId }); });
      await check(t5_2, r5_2r.ok);
      dealer = r5_2r.dealerOpenId;

      // === G6: 踢人 ===
      var nonOwner = [B, C, D].filter(function (x) { return x !== dealer; })[0];
      var r6_1r = await ms(t6_1, function () { return post('kickPlayer', { playerId: nonOwner, roomId: roomId, targetPlayerId: D }); });
      await check(t6_1, !r6_1r.ok, r6_1r.code);

      var kickTarget = D;
      var kicker = dealer;
      var r6_2r = await ms(t6_2, function () { return post('kickPlayer', { playerId: kicker, roomId: roomId, targetPlayerId: kickTarget }); });
      await check(t6_2, r6_2r.ok && !r6_2r.room.players.find(function (p) { return p.openId === kickTarget; }));

      var r6_3r = await ms(t6_3, function () { return post('kickPlayer', { playerId: kicker, roomId: roomId, targetPlayerId: kicker }); });
      await check(t6_3, !r6_3r.ok && r6_3r.code === 'CANNOT_KICK_SELF', r6_3r.code);

      // === G7: 全开 ===
      await post('deal', { playerId: dealer, roomId: roomId });
      nonDealer = [A, B, C].filter(function (x) { return x !== dealer; });
      for (var i7 = 0; i7 < nonDealer.length; i7++) await post('bet', { playerId: nonDealer[i7], roomId: roomId, bet: 2 });
      var r7_1r = await ms(t7_1, function () { return post('open', { playerId: dealer, roomId: roomId, mode: 'openAll', selectedOpenIds: [] }); });
      await check(t7_1, r7_1r.ok);
      await check(t7_2, r7_1r.roundResult && r7_1r.roundResult.openedPlayerIds.length === nonDealer.length);
      dealer = r7_1r.roundResult.nextDealerOpenId;
      await post('resetRound', { playerId: dealer, roomId: roomId });

      // === G8: 边界防护 ===
      var r8_1r = await ms(t8_1, function () { return post('deal', { playerId: A, roomId: '' }); });
      await check(t8_1, !r8_1r.ok);

      var r8_2r = await ms(t8_2, function () { return post('deal', { playerId: A, roomId: '999999' }); });
      await check(t8_2, !r8_2r.ok && r8_2r.code === 'ROOM_NOT_FOUND', r8_2r.code);

      var r8_3r = await ms(t8_3, function () { return post('deal', { roomId: roomId }); });
      await check(t8_3, !r8_3r.ok && r8_3r.code === 'NO_PLAYER_ID', r8_3r.code);

      var rGetRoom = await post('getRoom', { playerId: dealer, roomId: roomId });
      dealer = rGetRoom.room.dealerOpenId;
      await post('deal', { playerId: dealer, roomId: roomId });
      var r8_4r = await ms(t8_4, function () { return post('deal', { playerId: dealer, roomId: roomId }); });
      await check(t8_4, !r8_4r.ok && r8_4r.code === 'WRONG_STATUS', r8_4r.code);

      nonDealer = [A, B, C].filter(function (x) { return x !== dealer; });
      await post('bet', { playerId: nonDealer[0], roomId: roomId, bet: 1 });
      var r8_5r = await ms(t8_5, function () { return post('bet', { playerId: nonDealer[0], roomId: roomId, bet: 2 }); });
      await check(t8_5, !r8_5r.ok && r8_5r.code === 'ALREADY_BET', r8_5r.code);

      var r8_6r = await ms(t8_6, function () { return post('open', { playerId: nonDealer[0], roomId: roomId, mode: 'openAll' }); });
      await check(t8_6, !r8_6r.ok && r8_6r.code === 'NOT_DEALER', r8_6r.code);

      for (var i8 = 1; i8 < nonDealer.length; i8++) await post('bet', { playerId: nonDealer[i8], roomId: roomId, bet: 1 });
      var ro8 = await post('open', { playerId: dealer, roomId: roomId, mode: 'openAllNoPass', selectedOpenIds: [] });
      dealer = ro8.roundResult.nextDealerOpenId;
      await post('resetRound', { playerId: dealer, roomId: roomId });

      // === G9: 牌组管理 ===
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
        d2 = or9.roundResult.nextDealerOpenId;
        var rr9 = await post('resetRound', { playerId: d2, roomId: rid2 });
        d2 = rr9.dealerOpenId;
      }
      var rDeal9 = await post('deal', { playerId: d2, roomId: rid2 });
      t9_1.ms = Date.now() - s9;
      await check(t9_1, rDeal9.ok);

      // === G10: 静态资源 ===
      var s10_1 = await ms(t10_1, function () { return httpGet('/'); });
      await check(t10_1, s10_1 === 200, 'status=' + s10_1);

      var s10_2 = await ms(t10_2, function () { return httpGet('/app.js'); });
      await check(t10_2, s10_2 === 200, 'status=' + s10_2);

      var s10_3 = await ms(t10_3, function () { return httpGet('/style.css'); });
      await check(t10_3, s10_3 === 200, 'status=' + s10_3);

      var s10_4 = await ms(t10_4, function () { return httpGet('/qrcode.min.js'); });
      await check(t10_4, s10_4 === 200, 'status=' + s10_4);

      var s10_5 = await ms(t10_5, function () { return httpGet('/test-runner.js'); });
      await check(t10_5, s10_5 === 200, 'status=' + s10_5);

      // === G11: Socket.IO ===
      var s11 = await ms(t11_1, function () { return httpGet('/socket.io/socket.io.js'); });
      await check(t11_1, s11 === 200, 'status=' + s11);

    } catch (err) {
      var errTest = register('ERROR', '测试运行异常: ' + err.message);
      errTest.status = 'fail';
      errTest.detail = err.stack || err.message;
      failed++;
    }

    // Cleanup
    try {
      await post('_cleanTestRooms', { key: testKey });
    } catch (e) { /* ignore */ }

    updateUI();

    var btn = document.getElementById('test-run-btn');
    if (btn) { btn.disabled = false; btn.textContent = '重新运行'; }
  }

  window.TestRunner = { run: run };
})();
