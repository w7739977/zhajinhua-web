# 小程序版 ↔ Web 版 联动映射表

本文档记录两个版本之间的代码对应关系，**任何一边改动时，查此表同步另一边**。

- 小程序版：`pj_zhajinhua/`
- Web 版：`pj_zhajinhua_web/`

---

## 1. 文件级映射

### 后端（云函数 → API 路由）

| 小程序云函数 | Web 版位置 | 说明 |
|---|---|---|
| `cloudfunctions/createRoom/index.js` | `server.js` → `POST /api/createRoom` | 创建房间 |
| `cloudfunctions/joinRoom/index.js` | `server.js` → `POST /api/joinRoom` | 加入房间 |
| `cloudfunctions/getRoom/index.js` | `server.js` → `POST /api/getRoom` | 查询房间 |
| `cloudfunctions/deal/index.js` | `server.js` → `POST /api/deal` | 发牌 |
| `cloudfunctions/bet/index.js` | `server.js` → `POST /api/bet` | 下注 |
| `cloudfunctions/open/index.js` | `server.js` → `POST /api/open` | 开牌（含牌型引擎） |
| `cloudfunctions/resetRound/index.js` | `server.js` → `POST /api/resetRound` | 新一局 |
| — | `server.js` → `POST /api/kickPlayer` | 踢人（Web 独有） |
| — | `server.js` → `POST /api/_cleanTestRooms` | 测试房间清理（Web 独有，密钥保护） |

> **改动规则**：修改任何云函数的业务逻辑时，必须同步修改 `server.js` 中对应的路由处理函数。

### 前端（页面对应）

| 小程序文件 | Web 版位置 | 说明 |
|---|---|---|
| `pages/index/index.js` | `public/app.js` → `initLobbyPage()` / `renderLobby()` | 大厅页逻辑 |
| `pages/index/index.wxml` | `public/app.js` → `renderLobby()` 内 HTML 模板 | 大厅页模板 |
| `pages/index/index.wxss` | `public/style.css` → `/* Lobby Page */` 区块 | 大厅页样式 |
| `pages/room/room.js` | `public/app.js` → `initRoomPage()` / `updateRoomView()` / `renderRoom()` | 房间页逻辑 |
| `pages/room/room.wxml` | `public/app.js` → `renderRoom()` / `renderPlayerItem()` 内 HTML 模板 | 房间页模板 |
| `pages/room/room.wxss` | `public/style.css` → `/* Room Page */` 区块 | 房间页样式 |
| `pages/result/result.js` | `public/app.js` → `initResultPage()` / `renderResult()` | 结果页逻辑 |
| `pages/result/result.wxml` | `public/app.js` → `renderResult()` 内 HTML 模板 | 结果页模板 |
| `pages/result/result.wxss` | `public/style.css` → `/* Result Page */` 区块 | 结果页样式 |
| `app.js` | `public/app.js` → 顶部 `state` 对象 | 全局状态 |
| `app.wxss` | `public/style.css` → 顶部全局样式 | 全局样式 |

### 测试文件（Web 独有）

| Web 版文件 | 说明 |
|---|---|
| `public/test-runner.js` | 部署后自动化测试运行器（44+ 用例，实时诊断） |
| `public/app.js` → `initTestPage()` / `renderTestPage()` | 测试页路由与 UI |
| `public/style.css` → `.test-*` 样式 | 测试页面样式（进度条、通过/失败状态） |
| `server.js` → `POST /api/_cleanTestRooms` | 测试房间清理接口（TEST_KEY 密钥保护） |

> **访问方式**：`http://IP:端口/#/test?key=密钥`，密钥在 `server.js` 的 `TEST_KEY` 常量中配置。

### 配置文件

| 小程序文件 | Web 版对应 | 说明 |
|---|---|---|
| `app.json` (pages/window) | `public/index.html` + hash 路由 | 页面注册 & 导航栏 |
| `project.config.json` | `package.json` | 项目配置 |

---

## 2. 游戏引擎（核心算法 — 必须完全一致）

牌型计算引擎在两个版本中**必须保持逻辑完全一致**，否则比牌结果会不同。

| 函数 | 小程序位置 | Web 版位置 |
|---|---|---|
| `evaluateThreeCards()` | `cloudfunctions/open/index.js` L48-98 | `server.js` 搜索 `evaluateThreeCards` |
| `compareHands()` | `cloudfunctions/open/index.js` L100-110 | `server.js` 搜索 `compareHands` |
| `findBestHand()` | `cloudfunctions/open/index.js` L112-128 | `server.js` 搜索 `findBestHand` |
| `rankValue()` | `cloudfunctions/open/index.js` L34-40 | `server.js` 搜索 `rankValue` |
| `parseCard()` | `cloudfunctions/open/index.js` L42-46 | `server.js` 搜索 `parseCard` |
| `getNextDealer()` | `cloudfunctions/open/index.js` L130-134 | `server.js` 搜索 `getNextDealer` |
| `createDeck()` / `shuffle()` | `cloudfunctions/createRoom/index.js` L10-29 | `server.js` 搜索 `createDeck` / `shuffle` |

> **改动规则**：修改任何牌型判断、比大小逻辑、洗牌算法时，两边必须逐行同步。

---

## 3. API 调用映射

### 请求方式

| 小程序 | Web 版 |
|---|---|
| `wx.cloud.callFunction({ name: 'xxx', data: {...} })` | `fetch('/api/xxx', { method:'POST', body: JSON.stringify({...}) })` |

### 身份标识

| 小程序 | Web 版 | 说明 |
|---|---|---|
| `cloud.getWXContext().OPENID` (服务端自动获取) | `req.body.playerId` (客户端传入) | 玩家唯一 ID |
| 微信 OpenID | `localStorage.getItem('playerId')` | 持久化方式 |

### 各接口参数对照

| 接口 | 共同参数 | 小程序特有 | Web 特有 |
|---|---|---|---|
| createRoom | `nickName`, `avatarUrl` | — | `playerId` |
| joinRoom | `roomId`, `nickName`, `avatarUrl` | — | `playerId` |
| getRoom | `roomId` | — | `playerId` |
| deal | `roomId` | — | `playerId` |
| bet | `roomId`, `bet` | — | `playerId` |
| open | `roomId`, `mode`, `selectedOpenIds` | — | `playerId` |
| resetRound | `roomId` | — | `playerId` |
| mockRoomAction | `roomId`, `action` | — | `playerId` |

**Web `POST /api/resetRound` 成功响应（除 `ok`、`room` 外）**：

| 字段 | 说明 |
|------|------|
| `autoPassed` | `true` 表示牌堆不够、已自动过庄并洗牌 |
| `passDealerShuffle` | `true` 表示上一局 `roundResult.passDealer`（全开全胜过庄），本局已 `shuffle(createDeck())` |
| `dealerOpenId` | 重置后当前庄家 |

> **改动规则**：新增/修改接口参数时，两边同步改；Web 版始终多传 `playerId`。

---

## 4. 实时同步机制映射

| 功能 | 小程序 | Web 版 |
|---|---|---|
| 监听房间变化 | `db.collection('rooms').where({roomId}).watch()` | `socket.on('roomUpdate', callback)` |
| 触发更新 | 云函数写入数据库后 watch 自动触发 | API 路由调用 `broadcastRoom(roomId)` |
| 断线重连 | `onError` → 3秒后 `_createWatcher()` | Socket.IO 自动重连 + `reconnect` 事件 |
| 切后台恢复 | 小程序 `onShow()` 重新 `_createWatcher()` | `visibilitychange` → 重新 `joinRoom` + `fetchRoom()` |
| 在线状态追踪 | — | Socket `disconnect` → 60s 宽限 → 离线自动处理 |
| 离线托管(下注) | — | 自动下注 1，标记 `autoBet` |
| 离线托管(庄家) | — | 自动全开不过庄 / 自动 resetRound |
| 中途加入观战 | — | `joinRoom` → `spectating: true`，下轮自动参与 |
| 选择开牌保留手牌 | — | `resetRound` 保留未选中玩家 `card`，标记 `retainedCard` |
| 庄家下一局广播 | — | `resetRound` 发送 `roundReset` 事件，全员自动返回房间 |
| 过庄后整副洗牌 | — | `executeResetRound`：`roundResult.passDealer` 时 `shuffle(createDeck())` 并清空全员手牌；否则沿用 `deck`，不足则自动过庄洗牌 |
| 邀请直链进房 | — | `/#/room/:id` → `getRoom` 后若 `playerId ∉ players` 则 `renderPendingJoin`；确认后 `joinRoom` 再 `updateRoomView`（避免只看不入桌） |
| 加入房间频道 | watch 自动按 `where` 条件过滤 | `socket.emit('joinRoom', roomId)`（Socket 频道，与 HTTP 入桌分离） |
| 离开房间频道 | `watcher.close()` | `socket.emit('leaveRoom', roomId)` |

> **改动规则**：如果修改了云函数中的数据库写入字段，Web 版 `broadcastRoom()` 调用的 `sanitizeRoom()` 也要同步返回该字段。
> 修改小程序 `onShow` 恢复逻辑时，需同步修改 Web 版 `visibilitychange` 处理。

---

## 5. 前端 API 替换映射

| 小程序 API | Web 版等价实现 | 位置 |
|---|---|---|
| `wx.navigateTo({url})` | `navigate(hash)` → `window.location.hash = hash` | `app.js` → `navigate()` |
| `wx.navigateBack()` | `navigate('/room/' + roomId)` | `app.js` → `App.backToRoom()` |
| `wx.showToast({title})` | `showToast(msg)` | `app.js` → `showToast()` |
| `wx.showLoading({title})` | `showLoading(msg)` | `app.js` → `showLoading()` |
| `wx.hideLoading()` | `hideLoading()` | `app.js` → `hideLoading()` |
| `wx.getStorageSync(key)` | `localStorage.getItem(key)` | 直接替换 |
| `wx.setStorageSync(key, val)` | `localStorage.setItem(key, val)` | 直接替换 |
| `wx.removeStorageSync(key)` | `localStorage.removeItem(key)` | 直接替换 |
| `wx.getUserProfile()` | 自定义昵称输入框 | `app.js` → `App.confirmProfile()` |
| `getApp().globalData` | `state` 对象 | `app.js` 顶部 |
| `this.setData({...})` | 修改 `state` + 调用 `renderXxx()` | 各 render 函数 |
| `button open-type="share"` | 二维码弹窗 + 复制链接 | `app.js` → `App.invite()` / `App.copyInviteLink()` |
| — | 庄家踢人 | `app.js` → `App.kickPlayer()` → `POST /api/kickPlayer` |
| — | 庄家下一局 | `app.js` → `App.nextRound()` → `POST /api/resetRound` + `roundReset` 事件 |
| — | 部署后自动化测试 | `app.js` → `initTestPage()` + `test-runner.js` → `TestRunner.run()` |
| — | 邀请链接先入桌 | `app.js` → `playerInRoom()` / `renderPendingJoin()` / `App.joinRoomFromInvite()` / `App.backToLobbyFromInvite()` |

### 邀请链接进房（Web 独有流程说明）

- **链接形态**：`/#/room/{roomId}`（与 `App.invite()` / `App.copyInviteLink()` 生成一致）。
- **路由**：`handleRoute` → `initRoomPage()` → `fetchRoom()`（`getRoom`）。
- **入桌判定**：`updateRoomView` 开头若 `!playerInRoom(room, state.playerId)`，不渲染牌桌，改为 `renderPendingJoin`。
- **确认加入**：`App.joinRoomFromInvite()` → 校验昵称、写 `localStorage.userInfo` → `POST /api/joinRoom` → `updateRoomView(result.room)`。
- **失败回退**：`getRoom` 非 `ok` 时 `navigate('/')`。
- **小程序对照**：小程序通过分享进房仍走各自页面逻辑；若要对齐「直链必 join」，需在对应页面增加等价判定。

---

## 6. 数据模型（两版完全一致）

Room 文档结构必须保持一致，任何字段变动两边同步：

```
roomId, ownerOpenId, dealerOpenId, status, deck,
publicCard, roundResult, players[], createdAt, updatedAt
```

Player 对象：
```
openId, nickName, avatarUrl, hasDealt, card, bet, score,
spectating, offline, autoBet, retainedCard, [isMock]
```

RoundResult 对象：
```
dealerOpenId, dealerNickName, dealerAvatarUrl, dealerHandCard,
dealerWildCard, dealerHandType, dealerHandTypeName, dealerDrinks,
dealerFullLoss, publicCard, playerResults[], passDealer,
nextDealerOpenId, mode
```

PlayerResult 对象：
```
openId, nickName, avatarUrl, handCard, wildCard, handType,
handTypeName, bet, result, playerDrinks, dealerDrinks
```

> **改动规则**：新增/删除/重命名任何字段时，两边的读写代码都必须同步。

**Web 版 `resetRound`（`executeResetRound`）牌组**：若上一局 `roundResult.passDealer === true`（全开全胜过庄），**强制** `shuffle(createDeck())` 并清空全员手牌，保证下一局从整副 52 张起算；否则沿用剩余 `deck`，仅当 `deck.length < 所需张数` 时自动过庄并洗牌。

---

## 7. 状态流转（两版完全一致）

```
waiting ──庄家发牌──→ betting ──全员下注──→ opening ──庄家开牌──→ opened
   ↑                                                              |
   +──────────── 庄家点"下一局" (resetRound) ←───────────────────+
```

> **改动规则**：新增状态或修改流转条件时，两边同步。

---

## 8. 样式映射

CSS 类名两版保持一致，便于视觉联动调整：

| 类别 | 共用类名 |
|---|---|
| 牌桌背景 | `.room-page`, `.result-page`, `.lobby-container` |
| 扑克牌 | `.poker-card`, `.poker-card-large`, `.poker-card-text`, `.poker-card-text-red` |
| 头像状态 | `.avatar-dealer`, `.avatar-dealt`, `.avatar-pending` |
| 庄家标识 | `.crown-badge`, `.crown-badge-self` |
| 选人高亮 | `.player-selected` |
| 下注筹码 | `.bet-chip`, `.bet-picker`, `.bet-label` |
| 状态标签 | `.deal-tag`, `.bet-tag`, `.score-tag`, `.mock-tag` |
| 结果标签 | `.result-win`, `.result-lose`, `.result-tie`, `.result-neutral` |
| 操作按钮 | `.btn-primary`, `.btn-secondary`, `.btn-full`, `.btn-sm` |

> **改动规则**：修改小程序 WXSS 时，Web 版 `style.css` 同名类一起改。单位换算：`rpx / 2 = px`。

---

## 联动修改 Checklist

每次改动时对照此表打勾：

- [ ] 游戏规则/牌型算法变动 → 同步 `open` 云函数 & `server.js` 引擎部分
- [ ] 牌组 / 过庄洗牌 / `resetRound` 行为变动 → 同步 `resetRound` 云函数 & `executeResetRound` & 前端 toast（`passDealerShuffle` / `autoPassed`）
- [ ] 接口参数变动 → 同步云函数 & API 路由 & 前端调用
- [ ] 数据模型字段变动 → 同步云函数写入 & API 路由 & `sanitizeRoom()` & 前端渲染
- [ ] 状态流转变动 → 同步所有涉及 `status` 判断的云函数 & API 路由 & 前端条件渲染
- [ ] UI/样式变动 → 同步 WXSS & CSS（注意 rpx→px 换算）
- [ ] 新增页面/功能 → 两边同时新增对应文件/路由/模板

> **注意**：在线状态追踪、离线托管、中途观战、保留手牌、踢人功能、部署后自动化测试、**邀请直链先入桌（`renderPendingJoin` + `joinRoomFromInvite`）** 目前仅 Web 版实现。小程序版如需对齐，需在对应云函数和页面中实现等价逻辑。
>
> **牌组**：Web 版已在 `executeResetRound` 实现 **全开全胜过庄（`passDealer`）后必洗 52 张**；小程序 `resetRound` 云函数若规则一致，须在 `passDealer` 时同样整副洗牌并清空本局手牌，避免与 Web 行为不一致。
