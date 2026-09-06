---
title: "JSON 与 Protobuf：数据到底怎样传输"
description: "从字段名、字段编号和 wire format 理解 JSON 与 Protocol Buffers 的差异。"
date: 2026-08-29
order: 2
authors:
  - maokaihe
tags:
  - JSON
  - Protobuf
  - Serialization
draft: true
---

JSON 和 Protobuf 都能把内存中的对象变成可以存储或传输的数据。区别在于，JSON 把结构直接写进文本，Protobuf 则要求通信双方提前知道同一份 schema。

## JSON 把字段名一起传输

下面是一条 JSON 数据：

```json
{
  "id": 150,
  "name": "Kai"
}
```

字段名、标点和数字的十进制文本都会出现在数据中。这样做的好处是可读，调试时直接打开就能看，浏览器和各种工具也能轻松处理。代价是同一批字段名会反复出现，类型约束也要由接口文档、JSON Schema 或业务代码另行保证。

## Protobuf 依赖 `.proto` schema

同一份数据可以定义成：

```protobuf
message User {
  int32 id = 1;
  string name = 2;
}
```

等号后的 `1`、`2` 是字段编号。编码后的二进制数据不会写入字符串 `id` 和 `name`；接收方根据字段编号回到 `.proto`，才知道某个值应该放进哪个字段。

所以“字段名不参与 Protobuf 二进制编码”有一个前提：两边都知道 schema。Protobuf 数据脱离 `.proto` 或 descriptor 后，不像 JSON 那样容易直接阅读。

## tag：字段编号与 wire type

每个已编码字段前都有一个 tag：

$$
\text{tag} = (\text{field number} \ll 3)\;|\;\text{wire type}
$$

其中：

- `field number` 是 `.proto` 中等号右边的字段编号；
- `wire type` 描述后面的数据该怎样读取，例如 Varint、32 位定长、64 位定长或 length-delimited；
- `<< 3` 表示左移三位，为最低三位的 wire type 留出位置；
- `|` 是按位或，用来合并两部分。

wire type 不是完整的 Protobuf 字段类型。例如 `int32`、`bool` 和 `enum` 都可以使用 Varint。具体解释仍然来自 schema。

常见 wire type 如下：

| 编号 | 编码形式 | 常见字段 |
| --- | --- | --- |
| 0 | Varint | `int32`、`int64`、`bool`、`enum` |
| 1 | 64-bit | `fixed64`、`double` |
| 2 | Length-delimited | `string`、`bytes`、嵌套 message、packed repeated |
| 5 | 32-bit | `fixed32`、`float` |

对于 `id = 150`，字段编号是 1，类型使用 Varint：

```text
08 96 01
│  └──── 150 的 Varint 编码
└─────── tag：(1 << 3) | 0 = 8，即 0x08
```

`name = "Kai"` 使用 length-delimited：

```text
12 03 4b 61 69
│  │  └──────── UTF-8 字节 "Kai"
│  └─────────── 长度为 3
└────────────── tag：(2 << 3) | 2 = 18，即 0x12
```

完整消息是 `08 96 01 12 03 4b 61 69`。这个例子能解释 Protobuf 为什么通常比带字段名的 JSON 紧凑，但不能推出“任何数据下都一定更小、更快”。消息内容、字段类型、实现和压缩方式都会影响结果。

## Varint 为什么能节省空间

Varint 每个字节用 7 位保存数据，最高位表示后面是否还有字节。较小的非负整数通常只占一两个字节；数值越大，需要的字节越多。

普通 `int32`、`int64` 对负数不够友好，负数可能占用 10 字节。如果字段经常出现负数，应考虑使用 `sint32` 或 `sint64`。它们会先经过 ZigZag 编码，把绝对值较小的负数映射到较小的无符号整数，再进行 Varint 编码。

## Protobuf 怎样保持兼容

Protobuf 的兼容性主要依靠字段编号，而不是字段名。协议发布后应遵守这些规则：

- 不要修改现有字段编号，也不要把它改作其他含义。
- 删除字段后，用 `reserved` 保留原编号和字段名，避免以后误用。
- 新增字段通常是安全的。旧程序读到不认识的字段时，会把它作为 unknown field 处理。
- 不要随意修改字段类型。即使两个类型使用同一种 wire type，业务语义也可能已经不兼容。

例如：

```protobuf
message User {
  reserved 2;
  reserved "name";

  int64 id = 1;
  string display_name = 3;
}
```

这里删除了原来的字段 2，并明确禁止再次使用。`display_name` 使用新的编号 3，而不是占用旧位置。

## JSON 和 Protobuf 怎么选

| 维度 | JSON | Protobuf binary |
| --- | --- | --- |
| 可读性 | 文本可直接阅读 | 需要 schema 和解码工具 |
| 数据结构 | 字段名随数据传输 | 字段编号随数据传输 |
| 类型约束 | 格式本身较弱 | `.proto` 明确定义类型 |
| 体积 | 通常较大 | 通常更紧凑 |
| 接口演进 | 常依赖约定 | 有明确的字段编号兼容规则 |
| 常见场景 | Web API、配置、日志 | 内部 RPC、事件消息、存储 |

JSON 适合需要人直接查看、生态兼容优先的边界；Protobuf 适合双方都能共享 schema、调用频繁且重视类型约束的系统。实际项目也常混用：外部 HTTP API 返回 JSON，内部服务之间使用 gRPC 和 Protobuf。

需要注意，Protobuf 也有官方 ProtoJSON 映射。它把 Protobuf message 表示成 JSON，方便接入只接受 JSON 的系统，但传输结果不再是上面讲的 Protobuf binary wire format，兼容规则也会受到字段名的影响。

参考：[Protobuf encoding guide](https://protobuf.dev/programming-guides/encoding/)、[Proto best practices](https://protobuf.dev/best-practices/dos-donts/)、[ProtoJSON format](https://protobuf.dev/programming-guides/json/)
