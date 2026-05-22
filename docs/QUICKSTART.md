# NGA 镜像站 — 快速开始

## 1. 一键部署 (推荐 — Windows)

```bash
# 双击 setup.bat  —— 自动检查环境、安装 Node.js、配置依赖
# 双击 start.bat  —— 一键启动服务
# 双击 stop.bat   —— 停止服务

# 或命令行:
npm run setup              # 环境检查 + 依赖安装 + 板块树初始化
npm run setup -- --full    # 含完整数据抓取 (首次推荐)
npm run start              # 构建 + 启动
powershell scripts/manage.ps1 status  # 查看运行状态
```

`scripts/manage.ps1` 提供完整管理功能:

| 子命令 | 说明 | 示例 |
|--------|------|------|
| `setup` | 环境检查与配置 | `manage.ps1 setup --full` |
| `start` | 启动服务 | `manage.ps1 start --dev` |
| `stop` | 停止服务 | `manage.ps1 stop` |
| `restart` | 重启服务 | `manage.ps1 restart` |
| `status` | 查看状态 | `manage.ps1 status` |
| `update` | 增量抓取 | `manage.ps1 update` |

## 2. 手动安装

```bash
# Windows: 安装 Node.js 22+ from https://nodejs.org
npm install
```

## 3. 抓取数据

```bash
npm run scrape
```

约 3-5 分钟。抓取后数据存入 `data/nga-cache.db`。

## 4. 启动

```bash
npm run build && npm run start
```

访问 `http://localhost:3000`

## 日常使用

| 操作 | 命令 |
|------|------|
| 首次部署 | `npm install && npm run scrape && npm run scrape-boards && npm run build && npm run start` |
| 一键启动 | `start.bat` 或 `npm run start` |
| 更新板块树 | `npx tsx scripts/scrape-boards.ts` |
| 更新帖子数据（当前FID） | `npm run scrape` |
| 更新多板块 | `npx tsx scripts/scrape-all.ts` |
| 增量更新 | `npm run manage update` |
| 开发调试 | `npm run dev`（热重载模式） |

## 数据存放

所有数据在 `data/nga-cache.db`，删除后重跑 `npm run scrape` 即可重建。

## 添加新板块

### 5 步接入

1. **找 FID** — 打开 NGA 板块网页，URL 中 `fid=` 后的数字（子版为负数）
2. **复制插件模板** — `src/plugins/_template.ts` → `your-forum.ts`，修改 `fid` 和 `name`
3. **注册到首页** — `src/app/layout.tsx` 中 `import "@/plugins/your-forum"`
4. **配置 CLI** — `scripts/scrape.ts` 顶部改 `const FID = 目标板块号`
5. **运行抓取** — `npm run scrape`，启动网站后首页显示新板块

详细说明见 [`MASTER.md`](./MASTER.md)。
