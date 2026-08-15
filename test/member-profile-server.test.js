'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = 23000 + (process.pid % 10000);
let serverProcess;

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => reject(new Error('server start timed out')), 5000);
    serverProcess.once('error', reject);
    serverProcess.stdout.setEncoding('utf8');
    serverProcess.stdout.on('data', chunk => {
      if (!chunk.includes('运行在')) return;
      clearTimeout(timeout);
      resolve();
    });
    serverProcess.stderr.on('data', chunk => process.stderr.write(chunk));
  });
}

before(startServer);
after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

test('created VIP player exposes server-owned member fields', async () => {
  const created = await post('/api/createRoom', {
    playerId: '_test_member_owner',
    nickName: 'wxw',
    avatarUrl: ''
  });
  assert.equal(created.ok, true);
  assert.deepEqual(created.memberBanners.map(event => event.type), ['banker', 'join']);
  assert.equal(created.memberBanners[0].roomId, created.roomId);
  assert.equal(created.memberBanners[0].playerId, '_test_member_owner');
  assert.notEqual(created.memberBanners[0].eventId, created.memberBanners[1].eventId);

  const fetched = await post('/api/getRoom', {
    playerId: '_test_member_owner',
    roomId: created.roomId
  });
  const player = fetched.room.players[0];

  assert.deepEqual({
    memberLevel: player.memberLevel,
    bannerTheme: player.bannerTheme,
    privilegeFlags: player.privilegeFlags
  }, {
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: [
      'banner:join',
      'banner:bet',
      'banner:banker',
      'banner:open_card'
    ]
  });
});

test('newly joined VIP player receives member fields', async () => {
  const created = await post('/api/createRoom', {
    playerId: '_test_regular_owner',
    nickName: '普通房主',
    avatarUrl: ''
  });
  assert.deepEqual(created.memberBanners, []);
  const joined = await post('/api/joinRoom', {
    playerId: '_test_joining_member',
    roomId: created.roomId,
    nickName: '傻叼刘敏',
    avatarUrl: ''
  });
  const player = joined.room.players.find(item => item.openId === '_test_joining_member');
  assert.equal(joined.memberBanners.length, 1);
  assert.equal(joined.memberBanners[0].type, 'join');
  assert.equal(joined.memberBanners[0].playerId, '_test_joining_member');

  assert.deepEqual({
    memberLevel: player.memberLevel,
    bannerTheme: player.bannerTheme,
    privilegeFlags: player.privilegeFlags
  }, {
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: [
      'banner:join',
      'banner:bet',
      'banner:banker',
      'banner:open_card'
    ]
  });
});

test('existing player rejoin reapplies and clears member fields after nickname changes', async () => {
  const created = await post('/api/createRoom', {
    playerId: '_test_rejoin_owner',
    nickName: '房主',
    avatarUrl: ''
  });
  await post('/api/joinRoom', {
    playerId: '_test_rejoining_player',
    roomId: created.roomId,
    nickName: '普通玩家',
    avatarUrl: ''
  });

  const upgraded = await post('/api/joinRoom', {
    playerId: '_test_rejoining_player',
    roomId: created.roomId,
    nickName: 'wxw',
    avatarUrl: ''
  });
  const upgradedPlayer = upgraded.room.players.find(item => item.openId === '_test_rejoining_player');
  assert.deepEqual(upgraded.memberBanners, []);
  assert.equal(upgradedPlayer.memberLevel, 'vip');
  assert.equal(upgradedPlayer.bannerTheme, 'casino_spectacle');
  assert.deepEqual(upgradedPlayer.privilegeFlags, [
    'banner:join',
    'banner:bet',
    'banner:banker',
    'banner:open_card'
  ]);

  const downgraded = await post('/api/joinRoom', {
    playerId: '_test_rejoining_player',
    roomId: created.roomId,
    nickName: '普通玩家',
    avatarUrl: ''
  });
  const downgradedPlayer = downgraded.room.players.find(item => item.openId === '_test_rejoining_player');
  assert.deepEqual(downgraded.memberBanners, []);
  assert.equal(downgradedPlayer.memberLevel, null);
  assert.equal(downgradedPlayer.bannerTheme, null);
  assert.deepEqual(downgradedPlayer.privilegeFlags, []);
});
