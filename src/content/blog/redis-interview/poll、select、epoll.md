---
title: "select、poll 和 epoll"
description: "简单梳理 Linux 下 select、poll、epoll 的区别，以及 epoll 的 LT 和 ET 模式。"
date: 2026-08-25
order: 2
authors:
  - maokaihe
tags:
  - Redis
  - I/O
  - Networking
---

每一个 socket 在进程中都通过一个 fd 来引用。常说“Linux 中一切皆文件”，可以把它理解成 Linux 为 socket、管道、普通文件等对象提供了统一的 fd 接口，但它们的具体行为并不完全相同。

## `select`

`select` 接收一批 fd，让内核从 `fd_set` 中遍历并找到 ready 的 fd 返回。

每次调用都需要把整个 fd 集合传给内核，并遍历检查，复杂度是 $O(n)$。

另外，`select` 的 fd 编号有限制。它本质上使用位图，在 glibc 中默认是：

```c
#define FD_SETSIZE 1024
```

这里限制的是 fd 编号必须小于 1024，不是说程序一定最多只能存在 1024 个连接。

## `poll`

`poll` 是 `select` 的改进版本，接收的不再是位图，而是一个 `pollfd` 结构体数组，解决了 `FD_SETSIZE` 的固定限制。

不过 `poll` 每次调用仍然需要传入并遍历整个数组，所以 fd 很多时依然有线性扫描的开销。

## `epoll`

`epoll` 是 Linux 用来处理大量 fd 事件的机制，主要有三个 API：

```text
epoll_create1()
epoll_ctl()
epoll_wait()
```

`epoll` 的思路和 `select`、`poll` 不同，更像一种注册机制：先告诉内核需要关注哪些 fd，等这些 fd ready 时，再由 `epoll_wait()` 返回就绪事件。

```c
int epfd = epoll_create1(0);
```

可以把 epoll 实例理解成维护了一个 fd 关注列表和一个 ready list。

`epoll_ctl()` 负责告诉内核监听哪个 fd，`epoll_wait()` 则直接返回一批已经就绪的事件，不需要应用再次扫描全部 fd。

这里不是触发用户态回调，也不一定只返回一个 fd；一次 `epoll_wait()` 可以返回多个就绪事件。

## epoll 的两种模式：LT、ET

LT 是 level-triggered，水平触发。只要条件仍然满足，就会继续通知。

ET 是 edge-triggered，边缘触发。它只在状态发生变化时通知。实际使用 ET 时应该配合非阻塞 socket，并且一次读到 `EAGAIN` 为止，否则数据没有读完时可能收不到新的通知。
