# 会员高亮横幅系统（华丽版）设计规格

日期：2026-08-15

## 1. 目标

为炸金花 Web 房间增加统一的会员高亮横幅系统。特定会员玩家首次入局、主动下注、成为庄家或开牌时，房间内在线客户端按统一协议接收会员事件，并在房间标题下方、牌桌上方播放“赌场盛典”黑金横幅。

横幅是瞬时视觉事件，不改变牌局状态，不写入房间事件历史，不产生额外 `roomUpdate`。客户端使用独立队列串行播放，避免多个横幅同时出现；同一房间从房间页进入结果页时允许当前横幅和等待队列继续播放。

## 2. 已确认需求

- 会员识别采用服务端昵称白名单。
- 默认会员昵称：`wxw`、`傻叼刘敏`。
- 默认配置写在代码中，同时支持 `MEMBER_PROFILES_JSON` 环境变量覆盖。
- 玩家对象增加并对外返回：`memberLevel`、`bannerTheme`、`privilegeFlags`。
- 统一事件类型：`join`、`bet`、`banker`、`open_card`。
- 队列优先级：`banker > open_card > join > bet`。
- 正在播放的横幅不被中断；优先级只调整等待队列。
- 同一会员下注横幅冷却 8 秒。
- `join` 只在首次新增到 `room.players` 时触发，刷新、重连、离线恢复和已有玩家更新昵称不触发。
- `banker` 只在庄家身份实际变化时触发，包括首庄、过庄、牌不足自动过庄和踢庄迁移；同一庄家下一局不重复。
- 三种开牌 mode 使用不同华丽文案。
- `open_card` 可从房间页跨到同一房间结果页播放完成。
- 视觉采用已确认的 C 方案“赌场盛典”：强金色辉光、双层金边、大皇冠、快速扫光、明显但轻量的 CSS 粒子。
- 纯 HTML/CSS/JavaScript，不增加大型依赖。

## 3. 已知边界与非目标

### 已知边界

当前项目没有账号或昵称所有权认证。昵称由浏览器用户自行填写，因此其他用户可以冒用白名单昵称获得会员横幅。服务端仍禁止客户端直接上报会员等级，但无法在现有身份体系中证明昵称归属。

若会员未来代表付费权益，必须另行设计账号登录、服务端会话和可信会员数据源。

### 本次非目标

- 会员购买、到期、续费或支付；
- 账号登录和昵称唯一性；
- 横幅历史、回放或数据库持久化；
- 会员积分、礼物、库存或经济系统；
- 微信小程序端同步实现；
- 结果页新增独立会员面板；
- 横幅音效和震动。

## 4. 会员配置

### 4.1 默认配置

```js
const DEFAULT_MEMBER_PROFILES = {
  'wxw': {
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: [
      'banner:join',
      'banner:bet',
      'banner:banker',
      'banner:open_card'
    ]
  },
  '傻叼刘敏': {
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: [
      'banner:join',
      'banner:bet',
      'banner:banker',
      'banner:open_card'
    ]
  }
};
```

### 4.2 环境覆盖

```bash
MEMBER_PROFILES_JSON='{
  "wxw": {
    "memberLevel": "svip",
    "bannerTheme": "casino_spectacle",
    "privilegeFlags": ["banner:join","banner:bet","banner:banker","banner:open_card"]
  }
}'
```

合并规则：

- 昵称先执行 `String(nickname).trim()`，再精确匹配；大小写不折叠。
- 环境配置与默认配置浅合并。
- 同名配置以环境变量为准。
- 环境配置可增加昵称。
- 环境配置将昵称设为 `null` 时，从最终配置中禁用。
- JSON 无效、值不是对象或字段类型错误时记录 `console.warn`，服务继续使用有效的默认配置。
- 服务端只接受规范化后的 `memberLevel`、`bannerTheme` 和字符串数组 `privilegeFlags`。

建议 helper：

```js
loadMemberProfiles()
normalizeMemberProfile(profile)
getMemberProfile(nickname)
applyMemberProfile(player)
hasMemberPrivilege(player, eventType)
```

## 5. 玩家数据结构

房主创建、新玩家加入、已有玩家更新昵称时，服务端调用 `applyMemberProfile()`。玩家对象增加：

```js
{
  openId,
  nickName,
  avatarUrl,

  memberLevel: 'vip',               // 非会员 null
  bannerTheme: 'casino_spectacle', // 非会员 null
  privilegeFlags: [                // 非会员 []
    'banner:join',
    'banner:bet',
    'banner:banker',
    'banner:open_card'
  ],

  hasDealt,
  card,
  bet,
  score,
  spectating,
  offline,
  autoBet,
  retainedCard
}
```

`sanitizeRoom()` 必须返回三个会员字段；前端 `updateRoomView()` 必须用安全默认值规范化：

```js
memberLevel: p.memberLevel || null
bannerTheme: p.bannerTheme || null
privilegeFlags: Array.isArray(p.privilegeFlags) ? p.privilegeFlags : []
```

客户端字段只用于显示和未来扩展；横幅是否触发始终由服务端决定。

## 6. 统一事件协议

服务端统一广播：

```js
io.to(`room:${roomId}`).emit('memberBanner', payload);
```

Payload：

```js
{
  eventId: 'mb_628792_banker_42',
  roomId: '628792',

  type: 'banker', // join | bet | banker | open_card
  priority: 40,

  playerId: 'p_xxx',
  nickname: 'wxw',
  memberLevel: 'vip',
  bannerTheme: 'casino_spectacle',
  privilegeFlags: ['banner:banker'],

  amount: null,
  openMode: null,
  message: '♛ VIP · wxw 王者加冕，执掌庄位',
  subtitle: 'THE CROWN IS CLAIMED',

  duration: 3000,
  createdAt: 1786789000000
}
```

优先级：

```text
banker    40
open_card 30
join      20
bet       10
```

服务端统一构造和发送：

```js
buildMemberBanner(room, player, type, detail)
emitMemberBanner(roomId, player, type, detail)
emitMemberBanners(roomId, events)
```

所有业务路径必须调用统一 helper，不能自行拼接文案或事件字段。`emitMemberBanners()` 接收同一业务操作产生的事件数组，先按 priority 降序排序，再依次广播；这保证同一次开牌产生 banker 和 open_card 时，无论客户端微任务时序如何，banker 都先进入队列。

## 7. 文案规范

### join

```text
♛ VIP · {nickname} 尊耀降临，华丽入局
ROYAL MEMBER ARRIVAL
```

### bet

```text
♛ VIP · {nickname} 豪掷 {amount} 杯，气势压场
GOLDEN WAGER
```

### banker

```text
♛ VIP · {nickname} 王者加冕，执掌庄位
THE CROWN IS CLAIMED
```

### open_card / selectPlayers

```text
♛ VIP · {nickname} 御令翻牌，点将对决
ROYAL SHOWDOWN
```

### open_card / openAll

```text
♛ VIP · {nickname} 号令全开，决胜此局
ROYAL SHOWDOWN
```

### open_card / openAllNoPass

```text
♛ VIP · {nickname} 霸气全开，王座不让
ROYAL SHOWDOWN
```

## 8. 事件触发流

### 8.1 创建房间

会员创建房间时，服务端生成：

```text
banker
join
```

由于创建响应时客户端尚未订阅房间 Socket，`POST /api/createRoom` 响应增加：

```js
memberBanners: [bankerPayload, joinPayload]
```

客户端导航到房间后把响应中的事件送入统一队列。服务端无需向空房间频道广播这两条创建事件。

### 8.2 首次加入房间

`POST /api/joinRoom` 仅在 `existingIndex === -1` 且新玩家为会员时生成 `join`。

服务端：

1. 新增玩家并应用会员字段；
2. 更新房间状态；
3. 执行已有 `broadcastRoom(roomId)`；
4. 广播 `memberBanner`；
5. HTTP 响应返回相同 payload 的 `memberBanners`。

邀请直链玩家可能已订阅 Socket，会同时从 Socket 和 HTTP 收到相同 `eventId`；客户端去重后只播放一次。大厅加入者在 HTTP 返回前尚未订阅，可依靠响应中的 payload 看到自己的横幅。

已有玩家重入只更新昵称、头像、在线状态和会员字段，不生成 `join`。

### 8.3 下注

`POST /api/bet` 完成全部校验并写入 `player.bet` 后：

1. 按现有逻辑更新 `room.status`；
2. 执行已有 `broadcastRoom(roomId)`；
3. 若玩家拥有 `banner:bet`，且服务端 8 秒冷却允许，广播 `bet`；
4. 返回正常下注响应。

冷却键：

```text
roomId + ':' + playerId + ':bet'
```

冷却只阻止横幅，不阻止下注。离线托管自动下注不触发。

### 8.4 庄家变化

所有可能改变 `dealerOpenId` 的路径都保存：

```js
const previousDealerId = room.dealerOpenId;
```

完成业务逻辑后调用：

```js
emitBankerBannerIfChanged(roomId, room, previousDealerId)
```

覆盖：

- 创建房间首庄；
- `executeOpen()` 全开全胜过庄；
- `executeResetRound()` 牌不足自动过庄；
- `kickPlayer` 踢庄迁移。

只有：

```js
previousDealerId !== room.dealerOpenId
```

且新庄家拥有 `banner:banker` 时触发。同一庄家 resetRound 不触发。

### 8.5 开牌

`POST /api/open` 的状态、庄家、mode 和目标校验全部成功后执行开牌。开牌结算完成才生成 `open_card`，失败路径不生成。

当前 `executeOpen()` 内部先发送 `roomUpdate`。HTTP 路径在其返回后构造本次业务事件数组：

```text
open_card
banker（如果本次过庄且新庄是会员）
```

该数组交给 `emitMemberBanners()`，由服务端按 priority 排序并实际按以下顺序广播：

```text
banker
open_card
```

Socket.IO 对同一连接保持消息顺序，因此客户端不依赖跨回调的微任务批处理也能得到正确顺序。横幅允许在同一 roomId 的结果页继续播放。

离线庄家的服务端自动开牌不触发 `open_card`，因为它不是会员玩家主动操作；若自动开牌导致新庄家会员产生，则仍可触发 `banker`。

## 9. 客户端统一 Banner 组件

建议独立对象：

```js
const MemberBannerManager = {
  enqueue(event),
  scheduleDrain(),
  drain(),
  play(event),
  clear(reason),
  isContextAllowed(roomId),
  hasSeen(eventId)
};
```

内部状态：

```js
{
  queue: [],
  activeEvent: null,
  activeNode: null,
  activeAnimations: [],
  seenEventIds: new Map(),
  sequence: 0,
  drainScheduled: false
}
```

### 9.1 队列

- 最大等待数量 `MAX_PENDING_BANNERS = 8`。
- 当前横幅不被中断。
- 等待队列按 priority 降序、sequence 升序。
- `enqueue()` 只安排微任务 drain，同一 tick 到达的事件先统一排序。
- 超限时先丢弃最旧 `bet`；没有 bet 时丢弃最低优先级最旧事件。
- 记录最近 100 个 `eventId`，HTTP/Socket 重复事件只播放一次；超过上限删除最旧 ID。

### 9.2 页面上下文

允许：

```text
state.currentPage === 'room' && state.roomId === event.roomId
state.currentPage === 'result' && state.roomId === event.roomId
```

同一房间 room → result 不清理。

清理：

- 返回 lobby；
- 进入 test；
- 被踢；
- roomId 变化；
- payload roomId 与当前上下文不一致。

横幅 DOM 挂在 `document.body`，不受 `$app().innerHTML` 全量重绘影响。

## 10. 赌场盛典视觉

结构：

```html
<div class="member-banner-layer">
  <div class="member-banner member-banner--casino-spectacle" role="status" aria-live="polite">
    <span class="member-banner-ornament ornament-top"></span>
    <span class="member-banner-ornament ornament-bottom"></span>
    <span class="member-banner-crown">♛</span>
    <div class="member-banner-copy">
      <div class="member-banner-message"></div>
      <div class="member-banner-subtitle"></div>
    </div>
    <span class="member-banner-particles"></span>
    <span class="member-banner-shine"></span>
  </div>
</div>
```

定位：

```css
.member-banner-layer {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 54px);
  left: 50%;
  width: min(calc(100vw - 24px), 440px);
  transform: translateX(-50%);
  z-index: 38;
  pointer-events: none;
}
```

层级位于道具动画 35 与道具菜单 40 之间，低于认证、邀请、Loading 和 Toast。

视觉要求：

- 62–70px 高度；
- 黑色到暗褐渐变背景；
- 双层亮金边；
- 渐变金字和轻微文字辉光；
- 大皇冠呼吸光；
- 上下金色装饰线；
- CSS 伪元素粒子；
- 约 1.5 秒的斜向扫光；
- 深色投影和明显但克制的外发光；
- 不拦截任何点击。

时间线：

```text
滑入 350ms → 停留 1850ms → 淡出 800ms = 3000ms
```

### Reduced Motion

`prefers-reduced-motion: reduce` 时：

- 不位移；
- 不播放皇冠呼吸、扫光或粒子；
- 120ms 淡入、停留、200ms 淡出。

动画优先使用 CSS Animation；监听 `animationend`，并使用约 3.3 秒兜底计时器保证 DOM 清理。

## 11. 错误处理

静默忽略：

- 缺少 eventId/roomId/nickname；
- type 不受支持；
- bannerTheme 不受支持；
- 当前不是同房间 room/result 页面；
- 重复 eventId；
- 非会员或缺少对应 privilegeFlags。

横幅异常不得弹 Toast、阻止操作、修改房间状态或产生额外 `roomUpdate`。

## 12. 测试设计

### 12.1 配置与玩家字段

- `wxw`、`傻叼刘敏` 得到默认会员字段；
- 普通昵称为 `null/null/[]`；
- 昵称首尾空格规范化；
- 大小写精确匹配；
- 环境配置覆盖、增加和 `null` 禁用；
- 无效环境 JSON 回退默认配置。

### 12.2 事件协议

- 创建房间会员响应含 banker + join；
- 首次加入会员触发 join；已有玩家重入不触发；
- 会员成功下注触发 amount；普通玩家、失败下注、重复下注不触发；
- 8 秒冷却不影响下注结果；
- 首庄、全开过庄、牌不足自动过庄、踢庄迁移触发 banker；同庄 resetRound 不触发；
- 三种 open mode 返回正确文案和 openMode；失败开牌不触发；
- 未入桌订阅者、旧 Socket 和普通客户端不能自行触发会员事件；
- HTTP 和 Socket 的 eventId 一致。

### 12.3 状态副作用

- 会员事件不会产生额外 roomUpdate；
- 不改变下注、手牌、分数、房间 status、roundResult；
- 冷却和去重状态不写入 room。

### 12.4 浏览器验证

- 两客户端同步显示；
- 一次只显示一条；
- banker > open_card > join > bet；
- 当前项不被打断；
- 队列上限和 bet 丢弃策略；
- room → result 继续；换房/lobby/被踢清空；
- 320px 窄屏不越界；
- 不拦截下注、开牌、踢人和道具菜单；
- Reduced Motion；
- 动画结束无残留节点、计时器和监听器。

## 13. 关键代码改动点

### `server.js`

- 增加默认/环境会员配置加载和规范化 helper；
- 房主、新玩家、已有玩家重入时应用三个会员字段；
- `sanitizeRoom()` 返回会员字段；
- 增加统一 banner payload 构造、eventId、权限、冷却和广播 helper；
- 在 createRoom、joinRoom、bet、open、过庄、resetRound 自动过庄、kickPlayer 庄家迁移路径触发；
- HTTP create/join 响应增加 `memberBanners`。

### `public/app.js`

- 前端玩家字段规范化；
- Socket 监听 `memberBanner`；
- create/join HTTP 响应送入统一 manager；
- 实现队列、去重、优先级、播放、路由上下文和清理；
- 横幅挂载到 body，并允许同房间 room/result 跨页。

### `public/style.css`

- 增加赌场盛典黑金横幅、双层金边、皇冠、扫光、粒子、滑入/停留/淡出；
- 增加窄屏和 reduced-motion 规则；
- 层级保持在 prop effect 与 prop menu 之间。

### `public/test-runner.js`

- 增加会员配置/字段、四类事件、三种开牌 mode、庄家变化、冷却、去重和无额外 roomUpdate 测试；
- 继续使用真实 Socket join ACK、事件等待和测试运行前缀隔离。

### `README.md` / `SYNC_MAP.md`

- 记录默认会员、环境变量、横幅类型、视觉主题和测试覆盖；
- 标记三个玩家字段为 Web 端新增字段；
- 标记 `memberBanner` 为 Web-only 瞬时 Socket 事件，不写 room 历史，不与小程序自动同步。

## 14. 验收标准

- 两个默认昵称在四类成功操作时触发正确横幅；
- 普通昵称不触发；
- 三个会员字段在房间快照中存在且由服务端决定；
- 队列、优先级、8 秒下注冷却和 eventId 去重符合设计；
- 赌场盛典样式在移动端清晰、不阻断操作；
- 开牌横幅可跨同房间结果页播放；
- 所有失败操作、重连和历史 roomUpdate 不产生误播；
- 自动测试和双浏览器端到端验证通过；
- 不增加大型依赖，不引入房间历史数据或额外持久化。
