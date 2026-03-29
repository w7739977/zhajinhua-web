# 诈金花 Web 版

基于原微信小程序 `pj_zhajinhua` 完整移植的 Web 版本，不依赖微信生态，可在任意浏览器中运行。

## 项目状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 游戏核心引擎 | ✅ 已完成 | 牌型判定、比牌逻辑、万能牌最优解 |
| 房间管理 | ✅ 已完成 | 创建/加入房间、邀请链接 |
| 发牌流程 | ✅ 已完成 | 公牌 + 手牌，全员发牌后进入下注 |
| 下注流程 | ✅ 已完成 | 非庄家选择 1-3 注码 |
| 开牌结算 | ✅ 已完成 | 选择开牌 / 全开 / 全开不过庄 |
| 过庄机制 | ✅ 已完成 | 全开全胜自动过庄、牌组不足自动过庄 |
| 累计喝酒统计 | ✅ 已完成 | 庄家全开输的特殊规则 |
| 实时同步 | ✅ 已完成 | Socket.IO 房间内实时广播 |
| 服务器部署 | ✅ 已完成 | PM2 进程管理，支持生产环境运行 |
| HTTPS + 域名 | 🔲 待完成 | Nginx 反向代理 + Let's Encrypt 证书 |
| 断线重连优化 | 🔲 待完成 | 玩家掉线后重进房间的体验优化 |
| 数据持久化 | 🔲 待完成 | 当前为内存存储，重启后数据丢失 |

## 技术栈

- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 HTML / CSS / JavaScript（SPA，Hash 路由）
- **状态管理**: 服务端内存 `Map`，客户端 `localStorage`
- **实时通信**: Socket.IO（替代小程序云数据库 `watch`）

## 项目结构

```
├── server.js          # 后端：API 路由 + 游戏引擎 + Socket.IO
├── public/
│   ├── index.html     # 入口 HTML
│   ├── app.js         # 前端：路由、状态管理、页面渲染、交互逻辑
│   └── style.css      # 全局样式
├── package.json
├── SYNC_MAP.md        # 小程序版 ↔ Web 版联动映射表
└── .gitignore
```

## 快速开始

### 本地开发

```bash
npm install
npm start
# 访问 http://localhost:3000
```

### 服务器部署

```bash
git clone https://github.com/w7739977/zhajinhua-web.git
cd zhajinhua-web
npm install
pm2 start server.js --name zhajinhua-web
pm2 save
```

后续更新：

```bash
cd ~/zhajinhua-web && git pull && pm2 restart zhajinhua-web
```

## 游戏规则

1. 房主创建房间，其他玩家通过邀请链接或房间号加入
2. 所有玩家点击「发牌」，每人获得一张手牌，同时翻出一张公牌
3. 非庄家玩家选择注码（1 / 2 / 3 杯）
4. 庄家选择开牌方式：
   - **选择开牌**：指定与某些玩家比牌
   - **全开**：与所有玩家比牌，全胜则过庄
   - **全开不过庄**：与所有玩家比牌，不过庄
5. 每位玩家的最优牌型 = 公牌 + 手牌 + 最优万能牌，三张组合
6. 牌型大小：豹子 > 同花顺 > 同花 > 顺子 > 对子 > 散牌（特殊：2-3-5 散牌可胜豹子）

## 与小程序版的关系

本项目从微信小程序 `pj_zhajinhua` 完整移植而来，详细的代码映射关系见 [SYNC_MAP.md](./SYNC_MAP.md)，两个版本的功能修改可参照该文档进行联动同步。
