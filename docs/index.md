---
layout: home
title: 星枢终端 - Web SSH/RDP/VNC 远程连接客户端
description: 现代化 Web SSH / RDP / VNC 客户端，支持 Docker 一键部署、2FA 安全认证、AI 智能助手，提供高度可定制的远程连接体验

hero:
  name: Nexus Terminal
  text: 现代化 Web SSH / RDP / VNC 远程连接客户端
  tagline: Docker 一键部署，支持 2FA / Passkey 安全认证，内置 AI 智能助手
  image:
    src: /favicon.ico
    alt: Nexus Terminal logo
  actions:
    - theme: primary
      text: 快速开始
      link: /deployment
    - theme: alt
      text: 在 GitHub 上查看
      link: https://github.com/Silentely/nexus-terminal

features:
  - icon: 🖥️
    title: 多协议支持
    details: 支持 SSH、SFTP、RDP、VNC 等主流远程连接协议，满足不同场景需求
  - icon: 📑
    title: 多标签管理
    details: 在单一浏览器窗口管理多个远程会话，提升工作效率
  - icon: ⏸️
    title: 会话挂起与恢复
    details: 网络断开后自动保持会话，随时恢复，确保长任务不中断
  - icon: 🎨
    title: 高度可定制
    details: 终端主题、布局、背景动效、键盘映射，打造个性化工作环境
  - icon: 📊
    title: 审计与监控
    details: 完整的用户行为日志、通知系统（Webhook / Email / Telegram）
  - icon: 🤖
    title: 智能运维
    details: AI 智能助手、批量命令执行、系统健康分析，提升运维效率
  - icon: 🐳
    title: 轻量化部署
    details: 基于 Node.js 后端，资源占用低，支持 Docker 一键部署
  - icon: 📱
    title: 移动端适配
    details: 响应式设计，支持移动端访问，随时随地管理服务器
---

## 一键部署

::: tip 三条命令即可启动
:::

```bash
mkdir nexus-terminal && cd nexus-terminal
wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/.env -O .env
docker compose up -d
# 访问 http://localhost:18111
```

HTTP 直连适合内网学习和本地测试；公网生产环境建议通过 HTTPS 反向代理访问，HTTPS 下会话 Cookie 会自动启用 Secure。

## 技术栈

| 类别         | 技术                                                        |
| ------------ | ----------------------------------------------------------- |
| **前端**     | Vue 3 + TypeScript + Vite + Pinia + Element Plus + Xterm.js |
| **后端**     | Node.js + Express + TypeScript + SQLite3 + SSH2 + WebSocket |
| **远程桌面** | Guacamole Lite + Guacd                                      |
| **部署**     | Docker Compose + Nginx                                      |
