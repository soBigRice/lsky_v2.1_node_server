# Lsky Pro 相册代理服务

这是一个基于兰空图床 `Lsky Pro 2.1` 开发的 Node.js 服务，用来为博客、个人主页或前端项目提供稳定的相册与图片数据接口。

## 简介

本项目定位为 `Lsky Pro 2.1` 的中间层代理服务，主要用于解决前端无法直接安全访问兰空图床私有接口的问题。服务端负责完成 `API Token` 获取、自动缓存、本地失效重试、网页登录以及数据转发，前端只需要请求这个 Node.js 服务，就可以获取相册列表、图片列表和指定相册下的图片数据。

## 上游项目

本项目适配和对接的上游开源项目为 `Lsky Pro`：

- 上游仓库: <https://github.com/lsky-org/lsky-pro>
- 官方文档: <https://docs.lsky.pro/>
- 上游许可证: `GPL-3.0`

说明：

- 本仓库是一个独立的 Node.js 代理服务，用于对接 `Lsky Pro 2.1` 提供的接口与网页登录能力
- 本仓库不附带 `lsky-pro` 的完整源码分发
- 如果你后续直接复制、修改或再分发 `lsky-pro` 源码本体，应遵守其上游 `GPL-3.0` 许可证要求

它解决的核心问题是：

- 你的博客前端不适合直接保存 Lsky 登录态
- 你的 Lsky 接口需要先登录或携带 Bearer Token
- 你需要一个稳定的中间层把相册列表转成博客可直接消费的 JSON

## 功能

- 支持 `token` 直连 Lsky Pro
- 支持 Lsky Pro 2.1 的 API token
- 支持账号密码自动换取 token
- 支持 token 本地缓存，服务重启后继续复用
- 支持 token 失效后自动重新获取
- 支持 Lsky Pro 2.1 的表单登录 + session cookie
- 提供私有相册列表接口
- 提供公开用户相册列表接口
- 自带基础 CORS，前端可直接调用

## 环境要求

- Node.js 18 或更高版本

## 安装

```bash
npm install
cp .env.example .env
```

然后编辑 `.env`：

```env
PORT=3000
CORS_ORIGIN=*
LSKY_BASE_URL=https://your-lsky-domain.com

LSKY_AUTH_MODE=auto

LSKY_API_PREFIX=/api/v1
LSKY_API_TOKEN_PATH=/tokens
LSKY_LOGIN_PATH=/login
LSKY_LOGIN_PAGE_PATH=/login
LSKY_SESSION_LOGIN_PATH=/login
LSKY_LOGIN_FIELD=email
LSKY_API_TOKEN_FIELD=email
LSKY_PRIVATE_ALBUMS_PATH=/user/albums
LSKY_PRIVATE_IMAGES_PATH=/user/images
LSKY_API_PRIVATE_ALBUMS_PATH=/albums
LSKY_API_PRIVATE_IMAGES_PATH=/images
LSKY_PUBLIC_USER_ALBUMS_PATH=/explore/users/{username}/albums

LSKY_ACCESS_TOKEN=
LSKY_TOKEN_STORAGE_PATH=./data/lsky-token.json

LSKY_LOGIN_TYPE=username
LSKY_USERNAME=your-email@example.com
LSKY_PASSWORD=your-password
LSKY_REMEMBER=true
LSKY_LOGIN_TOKEN=
```

## 启动

```bash
npm start
```

默认启动地址：

```text
http://127.0.0.1:3000
```

## Docker 部署

项目根目录已经提供了 `Dockerfile` 和 `docker-compose.yml`，直接使用现有 `.env` 即可：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs -f lsky-server
```

停止服务：

```bash
docker compose down
```

说明：

- Compose 会读取项目根目录 `.env`
- 容器内服务端口和宿主机映射都跟随 `PORT`，默认是 `3000`
- `./data` 会挂载到容器内 `/app/data`，用于持久化缓存的 token
- 健康检查会访问容器内的 `/health`

## 接口

### 1. 获取私有相册列表

这个接口会按 `LSKY_AUTH_MODE` 工作：

- `auto`: 优先使用 `LSKY_ACCESS_TOKEN` 或本地缓存 token；没有 token 时用账号密码请求 `/api/v1/tokens`；token 失效后自动重新获取
- `session`: 先访问 `/login`，提交表单，拿到 session cookie 后请求 `/user/albums`
- `api`: 行为和 `auto` 一致，但语义上表示你只希望走 token 链路

```bash
curl "http://127.0.0.1:3000/api/albums?page=1&per_page=20&q="
```

返回示例：

```json
{
  "success": true,
  "mode": "private",
  "message": "successful",
  "items": [
    {
      "id": 3,
      "name": "旅行",
      "intro": "2026",
      "is_public": true,
      "photo_count": 6
    }
  ],
  "pagination": {
    "currentPage": 1,
    "perPage": 20,
    "total": 10,
    "from": 1,
    "to": 10,
    "lastPage": 1,
    "nextPageUrl": null,
    "prevPageUrl": null
  }
}
```

### 2. 获取公开用户相册列表

如果你的 Lsky Pro 已经开放广场/用户公开资料，可以直接走公开接口，不需要登录。

```bash
curl "http://127.0.0.1:3000/api/public/users/your-username/albums?page=1&per_page=20"
```

### 3. 获取图片列表

获取当前账号下的全部图片：

```bash
curl "http://127.0.0.1:3000/api/images?page=1"
```

获取某个相册下的图片：

```bash
curl "http://127.0.0.1:3000/api/albums/123/images?page=1"
```

也可以直接走查询参数形式：

```bash
curl "http://127.0.0.1:3000/api/images?page=1&album_id=123"
```

### 4. 输出 Lsky 原始返回

调试时可以追加 `raw=1`：

```bash
curl "http://127.0.0.1:3000/api/albums?page=1&raw=1"
```

## 你这个站点的推荐配置

如果你的站点和你给我的这台 Lsky Pro 2.1 机器一致，直接用下面这一组：

```env
LSKY_AUTH_MODE=auto
LSKY_BASE_URL=http://154.222.27.37:40027
LSKY_API_PREFIX=/api/v1
LSKY_API_TOKEN_PATH=/tokens
LSKY_LOGIN_PAGE_PATH=/login
LSKY_SESSION_LOGIN_PATH=/login
LSKY_LOGIN_FIELD=email
LSKY_API_TOKEN_FIELD=email
LSKY_PRIVATE_ALBUMS_PATH=/user/albums
LSKY_PRIVATE_IMAGES_PATH=/user/images
LSKY_API_PRIVATE_ALBUMS_PATH=/albums
LSKY_API_PRIVATE_IMAGES_PATH=/images
```

## 如果你是其它版本 Lsky

默认示例同时兼容两类模式：

- 新版 API 模式：改 `LSKY_AUTH_MODE=api`
- Lsky Pro 2.1 网页登录模式：保留 `LSKY_AUTH_MODE=session`
- 自动 token 模式：使用 `LSKY_AUTH_MODE=auto`

如果你的接口不是这些路径，可以直接改 `.env` 里的这些值：

- `LSKY_API_PREFIX`
- `LSKY_API_TOKEN_PATH`
- `LSKY_LOGIN_PATH`
- `LSKY_LOGIN_PAGE_PATH`
- `LSKY_SESSION_LOGIN_PATH`
- `LSKY_LOGIN_FIELD`
- `LSKY_API_TOKEN_FIELD`
- `LSKY_PRIVATE_ALBUMS_PATH`
- `LSKY_PRIVATE_IMAGES_PATH`
- `LSKY_API_PRIVATE_ALBUMS_PATH`
- `LSKY_API_PRIVATE_IMAGES_PATH`
- `LSKY_PUBLIC_USER_ALBUMS_PATH`

例如某些其它部署的私有相册列表路径可能是：

```env
LSKY_API_PREFIX=/api/v1
LSKY_PRIVATE_ALBUMS_PATH=/albums
```

## 推荐用法

默认推荐用法是：

1. 如果你已经有长期 Token，直接填到 `LSKY_ACCESS_TOKEN`
2. 如果没有，就配置 `LSKY_USERNAME` 和 `LSKY_PASSWORD`
3. 服务会自动获取 token 并写入 `LSKY_TOKEN_STORAGE_PATH`
4. 之后优先使用本地缓存 token，失效后再自动重新获取

这样更稳定，也更适合长期部署和 Docker 重启场景。

## 开源协议

- 当前仓库中的 Node.js 代理服务代码采用 `MIT License`
- 上游 `Lsky Pro` 项目采用 `GPL-3.0`

当前仓库许可证见 [LICENSE](/Users/superrice/MyPersionFile/CodeWork/CodePublic/2026个人主页/个人主页（new）/lsky_server/LICENSE)。
