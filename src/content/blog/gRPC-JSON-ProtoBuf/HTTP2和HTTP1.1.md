---
title: "gRPC 为什么使用 HTTP/2"
description: "从连接复用、二进制分帧和流式传输理解 HTTP/1.1 与 HTTP/2 的差异，以及 gRPC 如何映射到 HTTP/2。"
date: 2026-08-29
order: 1
authors:
  - maokaihe
tags:
  - gRPC
  - HTTP/2
  - Networking
draft: true
---

## HTTP/1.1 的限制

HTTP/1.1 支持持久连接，一条 TCP 连接可以连续处理多个请求，不需要每次都重新握手。问题在于，同一连接上的请求和响应仍按顺序关联。

HTTP/1.1 也定义过 pipelining：客户端可以不等前一个响应就继续发送请求。但服务端必须按请求顺序返回响应。假设请求 A 很慢、请求 B 很快，B 的结果已经准备好，也不能越过 A 先返回。这是应用层的队头阻塞。现实中的客户端通常选择建立多条连接来获得并发，而不是依赖 pipelining。[RFC 9113 对 HTTP/1.1 限制的说明](https://www.rfc-editor.org/rfc/rfc9113.html#name-introduction)

```text
HTTP/1.1 connection

request A ──────────────── response A
          request B ────── response B
                     ↑
             B 必须等待 A 返回
```

## HTTP/2：Connection、Stream 与 Frame

HTTP/2 没有改变 `GET`、`POST`、header 和 status code 这些 HTTP 语义，改变的是它们在连接上的编码和传输方式。协议把消息拆成二进制 frame，再把属于同一次请求/响应的 frame 放进同一个 stream。[RFC 9113](https://www.rfc-editor.org/rfc/rfc9113.html)给出的三层关系可以概括为：

```text
一条 TCP connection
├── stream 1：HEADERS + DATA + ...
├── stream 3：HEADERS + DATA + ...
└── stream 5：HEADERS + DATA + ...

不同 stream 的 frame 可以交错传输
```

Frame 是 HTTP/2 的最小协议单位，常见类型包括：

- `HEADERS`：请求或响应的 header block。
- `DATA`：请求体或响应体的数据。
- `SETTINGS`：连接参数，例如允许并发的 stream 数量。
- `WINDOW_UPDATE`：更新 stream 或整条连接的流控窗口。
- `RST_STREAM`：中止某个 stream，不必关闭整条连接。

Stream 是一条连接内独立的、双向的 frame 序列。每个 stream 有自己的 ID 和生命周期，多条 stream 可以并发打开，因此慢请求不会在 HTTP 层阻止其他 stream 继续收发 frame。HTTP/2 还使用 HPACK 压缩 header，减少同一连接中重复字段的传输。[HPACK 规范](https://www.rfc-editor.org/rfc/rfc7541.html)

## 多路复用不等于完全没有队头阻塞

HTTP/2 消除了 HTTP/1.1 的应用层队头阻塞，但它通常仍运行在一条 TCP 连接上。TCP 向上提供有序字节流；如果某个 TCP segment 丢失，后面已经到达的数据也要等待重传完成。因为多个 HTTP/2 stream 共用这条字节流，一次丢包可能暂时影响所有 stream。

所以更准确的结论是：

- HTTP/2 stream 解决了请求/响应必须按顺序完成的问题。
- HTTP/2 没有解决 TCP 层的队头阻塞。

HTTP/3 改用 QUIC，让不同 stream 不再共用同一条有序字节流，处理的正是后一类问题。

## gRPC 怎样映射到 HTTP/2

在原生 gRPC over HTTP/2 中，一次 RPC call 对应一条 HTTP/2 stream，而不是一条新的 TCP 连接。多个 RPC 可以在同一连接上并发执行；client streaming、server streaming 和双向 streaming 也都可以沿着同一条 stream 逐条传递 message。

一次 unary RPC 大致包含：

```text
Client                                      Server

HEADERS  :method=POST
         :path=/package.Service/Method  ──▶
DATA     5-byte prefix + request message ──▶
         END_STREAM

                                      ◀── HEADERS  :status=200
                                      ◀── DATA     response message
                                      ◀── HEADERS  grpc-status=0
                                                   END_STREAM
```

请求路径通常是 `/{Service-Name}/{Method-Name}`，内容类型以 `application/grpc` 开头。业务 message 放在 `DATA` frame 中，最终调用状态一般通过 response trailers 中的 `grpc-status` 返回。这里要注意，HTTP/2 frame 的边界与 gRPC message 的边界没有对应关系：一个 message 可以跨多个 `DATA` frame，一个 `DATA` frame 也可能包含多段 message 数据。[gRPC over HTTP/2 协议](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md)

每条 gRPC message 前还有 5 字节前缀：1 字节压缩标志，加上 4 字节大端序消息长度。服务端依据长度从连续的 DATA 数据中还原 message，再交给 Protobuf 或其他 codec 解码。

## 流量控制与取消

stream 可以并发，不代表发送方能无限写入。HTTP/2 同时维护 connection-level 和 stream-level flow-control window，接收方通过 `WINDOW_UPDATE` 告诉发送方还能接收多少 DATA。某条 streaming RPC 的消费速度太慢时，它会受到自己 stream 窗口的限制；整条连接的窗口耗尽时，其他 stream 也可能暂时无法继续发送。

客户端取消 RPC 时，可以使用 `RST_STREAM` 终止对应 stream，而不关闭同一连接上的其他调用。gRPC 的 deadline、取消和 backpressure 最终都需要和这些 stream 生命周期及流控机制配合。

## 为什么它适合 gRPC

gRPC 需要在一条可复用连接上承载大量并发调用，也需要原生支持单向和双向流式消息。HTTP/2 正好提供 stream、多路复用、二进制 frame、header 压缩和流量控制。gRPC 再在这套传输之上增加 service/method 路径、message framing、metadata、deadline 和 status 等约定。

因此，gRPC 不是简单地“用 HTTP/2 发送一个 Protobuf 文件”。更准确的分层是：Protobuf 等 codec 负责把业务对象编码成 message；gRPC 规定一次远程调用的生命周期和消息边界；HTTP/2 负责在连接上并发传输这些消息。
