FROM node:18-alpine

WORKDIR /app

# 先复制 package.json 和 package-lock.json，利用 Docker 缓存层加速构建
COPY package*.json ./

# 安装生产依赖（sqlite3 需要 python/make/g++ 来编译原生模块）
RUN apk add --no-cache python3 make g++ \
    && npm ci --production \
    && apk del python3 make g++

# 复制应用源码
COPY . .

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# 启动服务
CMD ["node", "server.js"]
