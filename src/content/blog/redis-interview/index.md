---
title: "Redis 面试笔记"
description: "从内存访问、单线程模型与 I/O 多路复用梳理 Redis 高性能的原因。"
date: 2026-08-23
authors:
  - maokaihe
tags:
  - Redis
  - Database
  - Performance
---

为什么Redis很快？

1. redis是内存数据库，避免了过多使用磁盘，读写的时候减少使用磁盘IO
2. 单线程操作，避免了上下文切换开销和竞争
3. 减少了多线程模式化中的锁开销
4. 采用多路 I/O 复用技术可以让单个线程高效的处理多个连接请求，减少网络IO时间消耗
5. 内存操作延迟低
