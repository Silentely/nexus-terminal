FROM node:20 AS builder

WORKDIR /app


# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package.json files to ensure npm ci works correctly in monorepo
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/

# Install dependencies (using install instead of ci for potential armv7 compatibility issues)
RUN npm install


COPY packages/frontend/src ./packages/frontend/src
COPY packages/frontend/index.html ./packages/frontend/
COPY packages/frontend/tsconfig.json ./packages/frontend/
COPY packages/frontend/vite.config.ts ./packages/frontend/
COPY packages/frontend/public ./packages/frontend/public/
# 覆盖 VERSION，确保与根版本一致，避免老版本遗留
COPY VERSION ./packages/frontend/public/VERSION

# 不要在镜像构建阶段 COPY 本地 .env：CI checkout 通常不会包含该文件。
# 如需注入前端构建时变量，请使用 VITE_* 环境变量或 build-arg（并确保不把敏感信息烘焙进镜像）。

RUN npm run build --workspace=@nexus-terminal/frontend


FROM nginx:stable-alpine


RUN rm -rf /usr/share/nginx/html/*


COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html


COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf


EXPOSE 80


CMD ["nginx", "-g", "daemon off;"]
