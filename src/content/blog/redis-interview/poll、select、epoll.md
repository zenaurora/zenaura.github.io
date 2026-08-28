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

在 Linux 中，可以把“感知就绪”分成扫描和唤醒两步：

1. 内核扫描 `fd_set` 中置位的 fd，查询每个 fd 对应对象当前是否满足可读、可写或异常条件。
2. 如果一个都没有就绪且调用允许阻塞，内核会把当前任务挂到这些 fd 对应的等待队列并让它睡眠。I/O 状态变化时，相关等待队列唤醒任务，`select` 再扫描一次并把结果写回 `fd_set`。

所以 `select` 不是在用户态不断调用 `recv()` 轮询，也不是内核直接执行用户态回调。返回后，应用通过 `FD_ISSET()` 检查哪些 fd 仍在结果集合中。Linux 的具体扫描与等待队列逻辑可以在 [`fs/select.c`](https://github.com/torvalds/linux/blob/master/fs/select.c) 中看到。

另外，`select` 的 fd 编号有限制。它本质上使用位图，在 glibc 中默认是：

```c
#define FD_SETSIZE 1024
```

这里限制的是 fd 编号必须小于 1024，不是说程序一定最多只能存在 1024 个连接。

更准确地说，glibc 默认的一个 `fd_set` 能表示 fd 0-1023。`select()` 的 `nfds` 参数应是三个集合中最大 fd 编号加 1，它确定扫描上界，不等于 socket 数量。一次调用实际监听多少个 socket，取决于集合中置位了多少个 socket fd；程序即使拥有更多连接，也不能用这个默认 `fd_set` 表示编号大于 1023 的 fd。

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
