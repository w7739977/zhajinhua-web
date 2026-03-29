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

> **改动规则**：新增/修改接口参数时，两边同步改；Web 版始终多传 `playerId`。

---

## 4. 实时同步机制映射

| 功能 | 小程序 | Web 版 |
|---|---|---|
| 监听房间变化 | `db.collection('rooms').where({roomId}).watch()` | `socket.on('roomUpdate', callback)` |
| 触发更新 | 云函数写入数据库后 watch 自动触发 | API 路由调用 `broadcastRoom(roomId)` |
| 断线重连 | `onError` → 3秒后 `_createWatcher()` | Socket.IO 自动重连 + `reconnect` 事件 |
| 加入房间频道 | watch 自动按 `where` 条件过滤 | `socket.emit('joinRoom', roomId)` |
| 离开房间频道 | `watcher.close()` | `socket.emit('leaveRoom', roomId)` |

> **改动规则**：如果修改了云函数中的数据库写入字段，Web 版 `broadcastRoom()` 调用的 `sanitizeRoom()` 也要同步返回该字段。

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
| `button open-type="share"` | 复制链接到剪贴板 | `app.js` → `App.invite()` |

---

## 6. 数据模型（两版完全一致）

Room 文档结构必须保持一致，任何字段变动两边同步：

```
roomId, ownerOpenId, dealerOpenId, status, deck,
publicCard, roundResult, players[], createdAt, updatedAt
```

Player 对象：
```
openId, nickName, avatarUrl, hasDealt, card, bet, score, [isMock]
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

---

## 7. 状态流转（两版完全一致）

```
waiting → dealing → betting → opening → opened
   ↑                                        |
   +────────── resetRound ←─────────────────+
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
- [ ] 接口参数变动 → 同步云函数 & API 路由 & 前端调用
- [ ] 数据模型字段变动 → 同步云函数写入 & API 路由 & `sanitizeRoom()` & 前端渲染
- [ ] 状态流转变动 → 同步所有涉及 `status` 判断的云函数 & API 路由 & 前端条件渲染
- [ ] UI/样式变动 → 同步 WXSS & CSS（注意 rpx→px 换算）
- [ ] 新增页面/功能 → 两边同时新增对应文件/路由/模板
