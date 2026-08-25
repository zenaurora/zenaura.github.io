---
title: "Reactor 和 Proactor"
description: "通过就绪事件和完成事件理解 Reactor、Proactor，以及它们和 epoll、IOCP、io_uring 的关系。"
date: 2026-08-25
order: 3
authors:
  - maokaihe
tags:
  - Redis
  - I/O
  - Networking
---

二者的核心目的都是为了使用较少的线程来处理大量连接。

## Reactor 模式

Reactor 和 `epoll` 的关系很大。

在 Reactor 模式中，应用程序负责监听就绪事件。当 I/O 就绪时，Reactor 将事件分发给对应的 Handler，由 Handler 自己执行真正的同步读写操作。

AI 给我写了一个流程，感觉可以帮助理解：

1. **注册事件**：Handler 向多路复用器（如 `epoll`）注册“关注 socket 的可读事件”。
2. **事件监听**：Reactor 线程阻塞在 `epoll_wait()` 上，等待事件发生。
3. **事件就绪**：当客户端发送的数据到达后，内核将 socket 标记为可读，`epoll_wait()` 返回。
4. **事件分发**：Reactor 将可读事件分发给对应的 Handler。
5. **执行 I/O（关键）**：Handler 调用 `read()`，把数据读取到用户缓冲区。socket 一般会设置为非阻塞，代码仍然需要处理短读和 `EAGAIN`。
6. **业务处理**：Handler 处理读取到的业务数据。

`epoll` + non-blocking socket 是现代网络并发的基石。

缺点是读写操作（`read()` / `write()`）仍然在用户线程中同步执行，如果处理不当，可能会影响事件循环的效率。

## Proactor 模式

Proactor 面向的是完成事件，在概念上对应真正的异步 I/O。

应用程序发起一个异步 I/O 之后，可以直接去干别的事，不需要等待。直到操作完成，系统发送一个完成事件，然后 Proactor 再将完成事件分发给 Handler。此时 Handler 拿到的已经是读写完成的结果。

1. **发起异步读**：Handler 调用异步读 API，例如 Windows 中带 `OVERLAPPED` 结构的 `ReadFile`，告诉系统把 socket 数据读到指定 Buffer。
2. **执行 I/O**：系统在后台完成读取，应用线程继续执行其他逻辑。
3. **完成事件入队**：操作完成后，一个完成事件进入 Completion Queue。
4. **获取完成事件**：Proactor 线程从队列中获取完成事件。
5. **事件分发**：Proactor 将完成事件分发给对应的 Handler。
6. **业务处理（关键）**：Handler 不需要再为同一次操作调用 `read()`，直接处理 Buffer 中已经就绪的数据。

这个模式的缺点是编程比较复杂，而且不同操作系统的支持程度不同。Windows 的 Overlapped I/O + IOCP（I/O Completion Port）是典型的 Proactor 实现。

Linux 在 5.1 中引入了 `io_uring`，它使用提交队列和完成队列，在模型上和 Proactor 很接近。不过它不是所有异步运行时的默认实现，很多能力也依赖较新的内核版本。

Rust 的普通 Tokio 网络 I/O 主要还是就绪事件模型。要使用 `io_uring`，需要启用对应的可选支持或使用 `tokio-uring` 这类额外依赖，并不是把现有代码无缝切换一下就可以。
