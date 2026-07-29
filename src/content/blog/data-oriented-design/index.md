---
title: "数据导向设计的解析器-Yuku 博客阅读"
description: ""
date: 2026-07-14
image: ./assets/banner.jpg
authors:
  - maokaihe
tags:
  - Data Oriented Design
---

I read a blog [Data Oriented Design](https://www.arshad.fyi/writings/engineering-high-performance-parsers)
This is about make parser faster by using data oriented design.

Yuku，一个用 Zig 编写的 JavaScript/TypeScript 解析器和编译工具链。作者强调，它的语法分析算法并不特殊，真正的性能来源是 AST、Token、字符串和跨语言数据的内存表示。


## 数据导向设计

- 首先需要靠考虑数据是如何被访问的
- 再思考如何组织数据，使得访问数据更加高效
- 最后让算法适应这种数据设计，并让算法更加高效

## 

假设解析：

`const x = a + b * c;`

解析器最终会产生一棵 AST：
```
VariableDeclaration
└── BinaryExpression(+)
    ├── Identifier(a)
    └── BinaryExpression(*)
        ├── Identifier(b)
        └── Identifier(c)
```

教科书式实现，通常会写成类似：
```
BinaryExpression {
    left:  *Node,
    right: *Node,
    op:    Operator
}
```

每创建一个节点，就在堆上申请一块内存：
```
heap allocation 1 → Identifier(a)
heap allocation 2 → Identifier(b)
heap allocation 3 → Identifier(c)
heap allocation 4 → BinaryExpression(*)
heap allocation 5 → BinaryExpression(+)
```

问题不在于 + 和 * 怎么解析，而在于这些节点可能散落在内存各处：
```
地址 0x1000: Identifier(a)
地址 0x9280: BinaryExpression(+)
地址 0x3700: Identifier(b)
地址 0xE910: BinaryExpression(*)
```

所以对AST进行遍历的时候，需要不断的取出指针然后跳转过去，这个过程浪费了大量时间。
原文翻译：
`缓存未命中而访问主存的加载操作耗时约 100 纳秒，而算术运算仅需不到一纳秒。一个在散落堆对象间追踪指针的程序，其大部分时间都停滞在加载操作上。`

此外还需要进行大量的堆分配，通用分配器的调用耗时数十至数百纳秒，并将相关对象分散到地址空间中。一个为每个节点进行内存分配的解析器，处理每个文件时需执行数万次此类调用。

## 核心改进：用数组下标代替指针

Yuku 并没有让 AST 节点直接保存指针，而是改成保存一个 `u32` 下标。这样一来，节点之间不再通过内存地址互相引用，而是通过数组中的位置来建立关系。

```zig
pub const NodeIndex = enum(u32) {
    null = std.math.maxInt(u32),
    _,
};
```

所有节点都会被顺序放进一个连续数组里：

```text
nodes[0] = Identifier(a)
nodes[1] = Identifier(b)
nodes[2] = Identifier(c)
nodes[3] = BinaryExpression(*, left=1, right=2)
nodes[4] = BinaryExpression(+, left=0, right=3)
```

此时整棵 AST 的根节点就是：

```text
root = 4
```

如果我们再看节点 `4`，它的孩子也不再是某个分散的内存地址，而是数组下标：

```text
left  = 0
right = 3
```

也就是说，AST 在逻辑上仍然是一棵树，但在物理结构上已经变成了一段连续的数组。它的表达方式变了，结构却没有变；变的是存储方式，不变的是语义关系。

```
逻辑结构：Tree
物理结构：Array<Node>
```

这种做法的好处非常直接。首先，节点连续存放在内存中，遍历时更容易命中 CPU cache，减少频繁的指针跳转。其次，节点之间只保存一个整数下标，结构更紧凑，也更方便批量管理。对于解析器这种“创建很多节点、再反复遍历节点”的场景来说，这种布局通常会比传统的指针树更高效。

## 用数组下标代替指针的优势

1. 更容易命中 CPU cache， 因为是连续的数据
2. 在64位机器上，指针通常是8字节，而u32只有4字节
3. 指针指向的是绝对地址
4. 所有节点由一个Arena进行管理，可以一起释放

## Struct Of Arrays

Yuku 的一个 AST 节点大致包含：

```
pub const Node = struct {
    data: NodeData,
    span: Span,
};
```

其中：`data` 是节点类型和实际内容，`span` 是节点在源代码中的起止位置。

如果用最常见的“对象数组”方式来存，它看起来大概是这样：

```
[data0, span0]
[data1, span1]
[data2, span2]
[data3, span3]
```

但 Yuku 不是把每个节点的字段混在一起存，而是使用一种叫 `Struct of Arrays`，也就是 SoA 的布局，把同一种字段拆成多个数组：

```
data = [data0, data1, data2, data3]
span = [span0, span1, span2, span3]
```

这样做的好处很明显。如果某一次分析只关心节点类型，那它只需要读取 `data` 数组，不必顺手把 `span` 也一起加载进来。反过来，如果只想看位置信息，也可以只访问 `span`。

和前面的“节点下标代替指针”一样，这里优化的重点不是语法层面，而是数据的排列方式。数据越集中、越规整，CPU 访问起来就越省力。

另外，这种布局还有一个很实用的优点：**追加新节点时，只需要在对应数组末尾增加一项，并更新长度计数**。不需要为每个节点单独分配一块对象，也不需要在内存里到处找位置。

## 可变长度子节点

前面讲的二元表达式很简单，因为它固定只有两个孩子，直接把左右孩子的下标放进节点里就行了。但并不是所有语法结构都这么规整。比如代码块 `block`、参数列表、数组元素列表，这些东西的长度往往是不固定的，可能是 0 个，也可能是很多个。

如果给每一种节点都预留“最多可能出现的孩子数量”，那会很浪费空间。大多数节点根本用不到那么多位置，但这些空位还是要一起存进去。Yuku 的做法是：**把这类可变长度的数据单独放到一块共享数组里，然后节点自己只保存一个“范围描述”**。

这个范围描述长这样：

```text
IndexRange = { start, len }
```
- `start` 表示这串数据在共享数组里的起点
- `len` 表示这一段一共有多少个元素

也就是说，节点只存自己的children在数组里的位置。真正的children列表，统一放在 `tree.extras` 里：

```zig
/// Returns the extra node indices for the given range.
pub inline fn extra(self: *const Tree, range: IndexRange) []const NodeIndex {
    return self.extras.items[range.start..][0..range.len];
}
```

这其实就是一个很常见的技巧：**用“起点 + 长度”来表示一段连续数据**。很多语言里的字符串切片、数组切片，本质上都是类似的思路。

比如一个 block 里有 3 个语句，那么它在 `extras` 里的存法可能像这样：

```text
extras[0] = statement A
extras[1] = statement B
extras[2] = statement C
```

而这个 block 节点自己只需要记住：

```text
start = 0
len   = 3
```

这样它就能准确找到自己的那 3 个子节点，而不用把它们一个个塞进节点结构里。

### 解析器为什么不能直接边读边开可变列表

这里还有一个很关键的问题：解析器在读到左大括号 `{` 的时候，并不知道这个 block 最后会有多少条语句。只有等它读到右大括号 `}`，它才知道列表到底有多长。

如果这时候给每个 block 单独创建一个会自动扩容的列表，就会产生很多额外的分配和回收开销。Yuku 选择的是更轻量的办法：**先借用一个解析器自己的临时缓冲区，把语句先暂存在里面，等 block 结束后，再一次性拷贝到最终数组**。

这个临时缓冲区可以理解成“栈式工作区”：进入一个 block 时记下当前长度，离开时恢复到这个长度。这样就能自然地支持嵌套 block。

伪代码可以这样理解：

```text
ScratchBuffer:
  items = empty list

  begin():
    return current length of items

  reset(checkpoint):
    shrink items back to checkpoint
```

大致的流程可以理解成这样：

```text
parseBody(terminator):
  checkpoint = remember current position in scratch buffer
  when function ends, restore scratch buffer to checkpoint

  while not reach end of body:
    statement = parse one statement
    append statement to scratch buffer

  copy all statements in scratch buffer into tree.extras at once
  return the range of that batch in tree.extras
```

1. 先记住当前缓冲区的位置
2. 继续解析 block 里的语句，并临时放进缓冲区
3. 直到遇到结束符 `}` 才停下来
4. 把这一段语句一次性复制到最终的共享数组里
5. 然后把临时缓冲区恢复到原来的状态，留给外层结构继续使用

这样做的好处是，临时缓冲区可以在递归解析时反复复用。比如一个 block 里面还套着另一个 block，内层会临时占用外层上方的那一段空间，解析完成后再回退，不会互相干扰。于是整个解析过程中，真正的扩容次数很少，而每次追加子节点只是一次边界检查加一次写入。

作者提到，Yuku 为了应对不同场景，一共保留了 5 个这样的缓冲区，分别给不同类型的列表使用，比如语句、覆盖语法、装饰器，以及两个通用缓冲区。这样既避免了频繁分配，也避免了多个地方同时抢同一个临时数组。

### 同一个思路还能复用到别的地方

这种“起点 + 长度”的表示法不只用于子节点列表。作者还把它用在了注释和节点的关联上：每个节点对应一个前缀和数组，通过相邻两个偏移量就能知道这个节点有哪些注释。

你可以把它理解为：
- 第 `i` 个节点的注释，不是单独挂一份链表
- 而是存在一个大数组里
- 节点只记录自己对应的那一段范围

这样，整个 AST 里很多“数量不固定”的信息，最后都被统一成了一个很朴素的形式：**连续数组 + 范围描述**。

## 字符串不复制，只保存源代码偏移量

到这里，思路其实已经很清楚了：Yuku 一直在做的事，就是尽量不要把“原本就已经存在的数据”再复制一遍。字符串也是一样。

解析器在处理代码时，会不断遇到各种字符串相关的信息，比如变量名、函数名、属性名、字符串字面量，甚至模块路径。普通做法通常是：读到一个标识符之后，给它单独分配一块内存，再把字符拷贝进去。这样虽然直观，但很多时候其实有点多余，因为这些字符串本来就已经写在源代码里了。

比如下面这段代码里，`foobar` 早就存在于源文本中：

```text
const foobar = 123;
      ^^^^^^
```

既然源代码里已经有这几个字节了，为什么还要再复制一份呢？Yuku 的做法更简单：它不把字符串内容本身存起来，而是只记录它在源代码中的位置。也就是说，字符串只需要两个偏移量：开始位置和结束位置。

```text
String = { start, end }
```

比如：

```text
source = "const foobar = 123;"
start  = 6
end    = 12
```

当需要真正取出名字时，直接从源代码里切一段出来就行了：

```text
source[6..12] = "foobar"
```

这就是所谓的 zero-copy string，也就是零复制字符串。它的意思不是“完全没有字符串”，而是“只保存引用，不重复存内容”。对大多数普通标识符来说，这个办法几乎是免费的，因为它根本不需要额外分配，也不需要把字符复制进另一块内存。

### 只有少数特殊情况才需要额外处理

当然，这种方法不是对所有字符串都适用。有些字符串虽然在源码里长得像字符序列，但真正的值并不是源文本本身，而是经过了解码之后的结果。

比如：

```text
const \u0061 = 1;
```

源码里看到的是 `\u0061`，但真正的标识符名字其实是 `a`。再比如：

```text
"hello\nworld"
```

源码中的 `\n` 是两个字符，可是解码之后，它表示的是一个换行符。也就是说，这些字符串如果只是简单地引用源码，就拿不到正确的最终值。

Yuku 的处理方式是：**普通字符串直接引用源代码，只有这类带转义的少数情况，才真正做解码，并把结果放进一个额外的字符串池里**。如果这种解码后的字符串后面还会重复出现，系统还可以顺便做一次去重，也就是 intern，让同样的内容只保存一份。

这样一来，最常见的情况几乎零成本，只有罕见的异常情况才需要付出解码和额外存储的代价。这个设计很符合数据导向设计的思路：先照顾最频繁发生的路径，把普通情况做得尽可能轻；再把少数特殊情况单独拎出来处理。

### 什么时候才真正去解码

还有一个很重要的点是，Yuku 并不会一开始就把所有字符串都解码好。它甚至不会在词法分析阶段就急着处理这些内容，而只是先记下一个跨度，并在看到反斜杠时打一个标记。

也就是说，lexer 的工作很克制：它不提前做多余的事情，只负责记录“这段字符串在哪儿”“它是不是可能需要解码”。真正需要字符串名字的时候，才去决定是直接取源代码切片，还是把它解码后放进池子里。

可以把这个过程理解成下面这样：

```text
if token is escaped:
  decode it and store in extra pool
else:
  return the source slice directly
```

这个设计的核心不是“技巧多复杂”，而是“把最常见的路径做得最便宜”。大部分标识符都能直接引用源代码，只有少数带转义的字符串才需要额外成本。对于解析器来说，这种差别会非常实在，因为它每天都在和大量字符串打交道，省下来的每一次复制，最后都会积累成明显的性能收益。

## Unicode 标识符

JavaScript 的标识符不仅仅只有ASCII字符，还有Unicode字符。
比如一些特殊的字符，π等

Unicode 标准给每个字符定义了属性：
- ID_Start：哪些字符可以作为标识符的第一个字符（比如字母、汉字、下划线）
- ID_Continue：哪些字符可以作为标识符的后续字符（比 ID_Start 更宽松，比如数字也可以）

要判断一个 Unicode 字符能否作为标识符开头，最直接的方法是：
做一个巨大的位图（bitset），每个代码点占 1 位，代码点空间有 0x10FFFF + 1 ≈ 111 万 个位置，
两个属性（ID_Start + ID_Continue）大约需要 512 KB 左右的空间

如此大的表格无法常驻缓存，而词法分析器需要频繁查询它。

### 解决方案就是使用两层表结构

把 Unicode 空间按 512 个 code point 分块：
```
chunk 0:     0～511
chunk 1:   512～1023
chunk 2:  1024～1535
...
```

```zig
inline fn queryBitTable(cp: u32, comptime root: []const u8, comptime leaf: []const u64) bool {
    const chunk_idx = cp / 512;                       // which 512-codepoint chunk
    const leaf_base = @as(u32, root[chunk_idx]) * 16; // where its pattern lives
    const offset_in_chunk = cp % 512;
    const word = leaf[leaf_base + offset_in_chunk / 32];
    const bit: u5 = @truncate(offset_in_chunk % 32);
    return (word >> bit) & 1 == 1;
}
```

手动执行一次 π (U+03C0，码点 960)
摘自原文伪代码：
```
cp        = 960
chunk_idx = 960 / 512  = 1          codepoints 512..1023
root[1]   = 1                        this chunk uses leaf pattern #1
leaf_base = 1 * 16     = 16          pattern #1 starts at word 16
offset    = 960 % 512  = 448
word      = leaf[16 + 448/32] = leaf[30]
bit       = 448 % 32   = 0
(leaf[30] >> 0) & 1    = 1           π may start an identifier
```

文章称，两个 Unicode 属性合计可从约 512 KB 压缩到约 29 KB。生成程序在构建阶段读取 Unicode 数据库并完成分块、去重，运行时只面对固定数组。

大多数代码文件主要是 ASCII，所以扫描标识符时先使用 256 项小表：

```
while (pos < src.len and ascii_table[src[pos]]) {
    pos += 1;
}
```

只有看到高位为 1 的字节： byte >= 0x80

才进入 UTF-8 解码和 Unicode 表查询。

## Tree本身就可以被JS使用

Yuku 的原生解析器用 Zig 编写，但是消费端却是JavaScript，原生解析器运行后，Node 需要将 AST 转换为普通对象。
传统的解析器采用的方法为：
```
Zig/Rust AST
    ↓ JSON.stringify / 原生序列化
JSON 字符串
    ↓ 跨 N-API 边界
JavaScript
    ↓ JSON.parse
JS Object AST
```
原生解析可能很快，但生成 JSON、复制字符串和 JSON.parse 可能比真正解析代码花费的时间还多。

另一种方式是不经过JSON，直接从native code种调用Node的N-API。
伪代码类似：
```
createObject()
setProperty(node, "type", createString("BinaryExpression"))
setProperty(node, "operator", createString("+"))
setProperty(node, "left", createObject())
setProperty(node, "right", createObject())
...
```
虽然看起来省略掉了JSON，但是这种设计往往更加糟糕。因为每一个AST节点就需要调用JS引擎的API，分配一个V8对象，设置属性，还有处理引用和垃圾回收问题，这个在native和V8之间的边界反复切换，会带来很多额外的开销。

Yuku之所以可以做到不使用传统的序列化方法，是因为Yuku本身使用了一个扁平化的表示方式。
子节点不是指针，而是一个u32下标，只要nodes整体数组的布局没有变化，复制到任何位置之后，都可以正常工作。

列表是extras数组中的范围，仍然没有指针，只是指向了extras数组中的一个片段，也就是只有offset和length。

字符串只是源码的一个范围，也就是源代码的一个slice，使用start和end就可以获得字符串的内容。所以不用再重新创建一份字符串，也不需要进行反序列化之类的操作。

因此树中的东西都是与内存位置无关的。
假设 AST 当前位于 Zig 内存地址：
`0x10000000`
复制到 JS 后位于：
`0x90000000`
如果 AST 内部存的是绝对指针，复制后就坏了：
`left = 0x10001230`
但是如果保存的是：
`left_node_index = 42`，
复制到哪里都可以，42永远都指向数组中的低42项

这意味着序列化并非转换过程，而是一次复制操作。

Yuku 将所有内容打包到一个缓冲区中，并以 ArrayBuffer 的形式返回给 JavaScript：
┌─────────────┬─────────────────┬──────────────┬─────────────┬──────────┬─────────────┐
│ Header      │ Nodes           │ Extras       │ String Pool │ Comments │ Diagnostics │
│ 元数据       │ 固定 48B/节点    │ u32 数组      │ 原始字节      │ 注释数据  │ 错误/警告数据│
└─────────────┴─────────────────┴──────────────┴─────────────┴──────────┴─────────────┘



## Token Bits 设计

一个Token包括span，tag以及flags。

span是token在源代码中的位置(包括start和end)，tag是token的类型，比如是关键字，数字，标识符等等；flags是一个额外标志位，使用u8类型。

解析器对每个词元都会提出相同的问题：它的优先级是什么，是否为二元运算符，是否为关键字。答案并非通过分支或查找表给出，而是在声明时直接编码在标签的整数值中：
```zig
pub const Mask = struct {
    pub const IsBinaryOp: u32 = 1 << 14;
    pub const IsUnaryOp: u32 = 1 << 16;
    pub const IsIdentifierLike: u32 = 1 << 18;
    pub const IsKeyword: u32 = 1 << 21;
    pub const PrecShift: u32 = 8; // bits 8..12 hold precedence
};
```

例子：TokenTag 的定义
```
pub const TokenTag = enum(u32) {
    // low 8 bits: ordinal. the rest: precomputed answers.
    plus = 15 | (11 << Mask.PrecShift) | Mask.IsBinaryOp | Mask.IsUnaryOp,
    star = 17 | (12 << Mask.PrecShift) | Mask.IsBinaryOp,
    in = 119 | (9 << Mask.PrecShift) | Mask.IsBinaryOp | Mask.IsKeyword
        | Mask.IsIdentifierLike | Mask.IsUnconditionallyReserved,
    // ...
};
```
这三行分别定义了 +、*、in 这几个 token 的整数值。

一个一个来看：
`plus = 15 | (11 << Mask.PrecShift) | Mask.IsBinaryOp | Mask.IsUnaryOp,`
表示token编号为15，优先级是11，是二元运算符也是一元运算符

`star = 17 | (12 << Mask.PrecShift) | Mask.IsBinaryOp,`
表示token编号为17，优先级是12，是二元运算符

`in = 119 | (9 << Mask.PrecShift) | Mask.IsBinaryOp | Mask.IsKeyword| Mask.IsIdentifierLike | Mask.IsUnconditionallyReserved,`
表示token编号为119，优先级是9，是二元运算符，是关键字，是标识符，而且是保留字

由于parser在解析表达式的时候，需要反复的查询这个token的优先级，是不是关键字，是不是标识符，是不是二元运算符等等这些。如果不使用这种编码方式，就需要使用其他方法：

1. switch/if 的分支判断方法，每一个都要进行判断，编译器可能不能将其优化为较快的形式，分支预测也有可能失败
2. 查表，使用一个数组或者map来存储信息，但是需要使用额外的内存，内存访问可能慢，尤其如果没命中 cache

使用将信息编码进Token对bit位里面的方法，实现了每次查询仅对已在寄存器中的值进行一次移位和掩码操作。无需查表、无需分支、无需加载。
位运算对于cpu来说是一个很cheap的操作