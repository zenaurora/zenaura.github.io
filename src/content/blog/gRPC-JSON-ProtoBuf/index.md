---
title: "从 RPC 到 gRPC：一次远程调用是怎样发生的"
description: "从本地函数调用出发，理解 RPC、gRPC、.proto 接口定义和一次完整的调用流程。"
date: 2026-08-29
authors:
  - maokaihe
tags:
  - RPC
  - gRPC
  - Protobuf
draft: true
---

## RPC

RPC 是 Remote Procedure Call，即远程过程调用。它想提供的体验很直接：调用远程服务时，代码看起来尽量像调用本地函数。

例如客户端写下：

```typescript
const user = await client.getUser({ id: 42 })
```

`getUser` 实际运行在另一台机器上。若直接使用 HTTP 接口，我们通常要自己确定地址、拼请求、序列化参数、处理响应和错误。RPC 框架把这些步骤收进生成代码和运行时中，调用方主要面对函数、参数和返回值。

不过，“像本地函数”只是一层编程抽象。远程调用仍然会遇到网络延迟、超时、连接中断和服务端错误，这些都不是普通本地函数会遇到的问题。

## gRPC 是什么

gRPC 是一种 RPC 框架。它默认使用 Protocol Buffers 描述接口和编码消息，原生 gRPC 通常通过 HTTP/2 传输。两者并不是同一个东西：Protobuf 负责定义并编码数据，gRPC 负责组织一次远程调用，HTTP/2 负责把消息送到对端。

```text
业务代码
   ↓ 调用生成的 client stub
gRPC：方法、状态、metadata、deadline
   ↓
Protobuf：对象 ↔ 二进制 message
   ↓
HTTP/2：connection、stream、frame
   ↓
TCP / TLS
```

这篇主文先讲 gRPC 的使用模型。HTTP/2 的连接复用和分帧细节放在子文 [gRPC 为什么使用 HTTP/2](/blog/gRPC-JSON-ProtoBuf/HTTP2和HTTP1.1) 中；JSON 与 Protobuf 的编码差异放在 [JSON 与 Protobuf](/blog/gRPC-JSON-ProtoBuf/JSON和ProtoBuf) 中。

## 用 `.proto` 定义接口

gRPC 开发通常从一个 `.proto` 文件开始：

```protobuf
syntax = "proto3";

package user.v1;

message GetUserRequest {
  int64 id = 1;
}

message User {
  int64 id = 1;
  string name = 2;
  repeated string roles = 3;
}

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
}
```

这份文件同时定义数据结构和远程接口：

- `syntax = "proto3"` 指定使用 proto3 语法。
- `package user.v1` 是协议命名空间，避免不同模块的类型重名。
- `message` 定义消息结构，可以理解成跨语言的数据类型。
- `int64 id = 1` 中，`int64` 是字段类型，`id` 是代码中的字段名，`1` 是字段编号。
- `repeated` 表示字段可以重复零次或多次，生成代码里通常对应列表。
- `service` 定义服务，`rpc` 定义方法以及它的请求、响应类型。

字段编号不是数组下标。Protobuf 的二进制数据不会重复写入 `id`、`name` 这样的字段名，而是写入由“字段编号 + wire type”组成的 tag。因此同一条消息里的字段编号必须唯一，发布后也不能随意更换或复用。编码细节在 Protobuf 子文中展开。

## `.proto` 怎样变成可调用的代码

编译器会根据 `.proto` 和对应语言的 gRPC 插件生成两类代码：

1. message 类型及其序列化、反序列化逻辑；
2. client stub 和 server interface。

客户端调用 stub，服务端实现 interface。地址解析、消息编码和网络传输由生成代码与 gRPC runtime 配合完成，所以两边可以使用不同语言，只要它们遵守同一份协议定义。

```text
                 protoc + gRPC plugin
user.proto ─────────────────────────────────▶
             client stub        server interface
                  │                    │
          client.getUser()       实现 GetUser()
```

生成代码不是服务本身。服务端仍然要实现查询数据库、检查权限等业务逻辑，然后把实现注册到 gRPC server。

## 一次调用是怎样发生的

以普通的一问一答调用为例：

```text
Client                                                Server

业务对象
  ↓ Protobuf 编码
request message
  ↓ gRPC framing
HTTP/2 stream ──────────────────────────────────────▶ 解码并调用 handler
                                                      ↓
拿到返回对象 ◀────────────────────────────────────── 编码 response message
  ↓
检查 gRPC status
```

更具体一点：

1. client stub 把参数编码为 Protobuf message。
2. gRPC 为这次调用创建一条 HTTP/2 stream，写入方法路径、metadata 和消息。
3. 服务端根据方法路径找到 handler，解码请求并执行实现。
4. 返回值被编码后写回同一条 stream，最终状态放在 gRPC trailers 中。
5. client stub 解码响应，把结果或错误交给业务代码。

客户端通常通过 channel 复用底层 HTTP/2 连接，多次 RPC 不需要各建一条 TCP 连接。这里不宜简单理解成“程序启动时建立一条永不变化的长连接”：连接可能按需建立，也可能在断线后重连，具体行为由 gRPC 实现和配置决定。

## gRPC的四种调用方式

gRPC 定义了四种调用方式。它们的区别在于一次 RPC 中，客户端和服务端各自可以发送几条 message。

在 `.proto` 里，`stream` 写在哪一侧，就表示哪一侧可以连续发送多条消息：

```protobuf
service DataService {
  // 一条请求，一条响应
  rpc Get(GetRequest) returns (GetResponse);

  // 一条请求，多条响应
  rpc Download(DownloadRequest) returns (stream DataChunk);

  // 多条请求，一条响应
  rpc Upload(stream DataChunk) returns (UploadResult);

  // 两边都可以连续发送
  rpc Sync(stream SyncRequest) returns (stream SyncEvent);
}
```

| 类型 | 请求 | 响应 | 常见用途 |
| --- | --- | --- | --- |
| Unary | 一条 | 一条 | 查询、普通命令 |
| Server streaming | 一条 | 多条 | 持续返回结果 |
| Client streaming | 多条 | 一条 | 分批上传、聚合 |
| Bidirectional streaming | 多条 | 多条 | 实时协作、双向事件流 |

### Unary RPC

Unary 是最接近普通函数调用的一种：客户端提交一个 request，服务端返回一个 response。

```text
Client                         Server
   │──── GetRequest ─────────────▶│
   │◀─── GetResponse + status ────│
```

前面的 `GetUser` 就属于 Unary RPC。这里的“一条消息”是 gRPC 层的语义，不代表底层只发送一个 HTTP/2 frame；较大的 message 仍然可能被拆成多个 frame。

### Server streaming RPC

客户端只发送一个 request，服务端可以逐条返回多个 response，适合下载分块、订阅进度或遍历大量结果。

```text
Client                         Server
   │──── DownloadRequest ────────▶│
   │◀─── DataChunk 1 ────────────│
   │◀─── DataChunk 2 ────────────│
   │◀─── DataChunk 3 ────────────│
   │◀─── final status ───────────│
```

客户端不必等服务端把所有数据准备好才开始处理。收到一块就可以消费一块，流量控制会限制发送方，避免接收方处理不过来时无限堆积数据。

### Client streaming RPC

客户端连续发送多个 request，发送完成后关闭自己的发送方向；这个动作通常叫 half-close。服务端仍然可以继续处理，并返回一个最终 response。

```text
Client                         Server
   │──── DataChunk 1 ───────────▶│
   │──── DataChunk 2 ───────────▶│
   │──── DataChunk 3 ───────────▶│
   │──── half-close ─────────────▶│
   │◀─── UploadResult + status ──│
```

half-close 结束的是本次 RPC 的客户端发送方向，不是关闭整条 HTTP/2 connection。分批上传和服务端聚合是这种模式的常见用法。

### Bidirectional streaming RPC

双向流中，两边都可以发送多条 message。客户端发送和服务端返回彼此独立，不要求严格遵循“发一条、回一条”的节奏。

```text
Client                         Server
   │──── SyncRequest 1 ─────────▶│
   │──── SyncRequest 2 ─────────▶│
   │◀─── SyncEvent 1 ───────────│
   │──── SyncRequest 3 ─────────▶│
   │◀─── SyncEvent 2 ───────────│
```

同一方向上的 message 顺序会被保留：客户端先写入的两条消息，服务端会按相同顺序读取；服务端写回的消息也是如此。但两个方向之间没有统一的先后关系，读取和写入策略由应用自己决定。

streaming 的含义是一条 RPC 内可以连续发送多条 message，不是把所有数据拼成一个很大的 Protobuf 对象。四种调用都可以设置 metadata、deadline 和取消，并以最终的 gRPC status 结束。它们通常各自占用一条 HTTP/2 stream，但可以和其他 RPC 一起复用同一条 connection。

## 远程调用不能完全伪装成本地调用

写 gRPC 接口时还有三件事不能省略：

- 设置合理的 `deadline`。很多 gRPC API 默认不会替你设置业务超时。
- 根据 gRPC status code 区分参数错误、服务不可用和超时，不要只返回一个布尔值。
- 谨慎重试。查询通常容易做到幂等，扣款、创建订单一类操作需要幂等键或服务端去重。

RPC 框架省掉的是重复的通信代码，不是网络本身的不确定性。理解这一点之后，再看 Protobuf 编码与 HTTP/2 传输就不会把三层概念混在一起了。

参考：[gRPC Core concepts](https://grpc.io/docs/what-is-grpc/core-concepts/)、[Protocol Buffers proto3 language guide](https://protobuf.dev/programming-guides/proto3/)
