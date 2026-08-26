---
title: "Rust 的 `!` 为什么等了十年？"
description: "从 never type fallback 出发，看看 `!` 的稳定化为什么反复撤回。"
date: 2026-08-27
authors:
  - maokaihe
tags:
  - Rust
  - Type System
  - Compiler
---

2026 年 8 月 24 日，Rust 合入了稳定 never type 的 [PR #155499](https://github.com/rust-lang/rust/pull/155499)。这个 PR 已经进入 `main`，预计随 Rust 1.100 在 11 月 12 日发布。

`!` 的 RFC 在 2015 年就有了。Rust 先后在 2018 和 2019 年尝试稳定它，两次都撤回。拖住它的是一条藏在类型推断里的旧规则：never type fallback。

## `()` 有一个值，`!` 一个值也没有

Rust 里的 `()` 是 unit type，它唯一的值也是 `()`。下面的函数会正常回到调用者，只是返回值没带信息：

```rust
fn log_message() -> () {
    println!("hello");
}
```

`!` 没有值，可以把它看作 `enum Never {}`，一个没有 variant 的 enum。

`fn exit() -> !` 表示函数不会沿正常控制流回到调用者。`panic!()`、`return`、`break`、`continue` 和没有可达 `break` 的 `loop {}`，都会产生 `!` 类型的表达式。

```rust
let num: u32 = match value {
    Some(x) => x,
    None => panic!("missing value"),
};
```

这个 `match` 的第一个分支得到 `u32`，第二个分支得到 `!`。`panic!()` 永远不会交出一个值，所以 Rust 允许它出现在要求 `u32` 的位置。这次转换叫 never-to-any coercion，常写成 `! -> T`。

## 把不可能写进类型

Rust 很早就允许函数返回 `!`。这次稳定化以后，`!` 还能出现在 associated type、`Result<T, !>` 和其他普通的类型位置里。

假设一个 decoder trait 要求实现者声明错误类型：

```rust
trait Decoder {
    type Error;

    fn decode(&self, input: &[u8]) -> Result<Data, Self::Error>;
}
```

某个实现不会失败，就可以把错误类型写成 `!`：

```rust
impl Decoder for IdentityDecoder {
    type Error = !;

    fn decode(&self, input: &[u8]) -> Result<Data, !> {
        Ok(Data::from(input))
    }
}
```

构造 `Err` 需要提供一个 `!` 类型的值，这种值不存在，因此 `Result<T, !>` 只有 `Ok(T)`。`Result<!, E>` 则只有 `Err(E)`，可以用在长期运行的任务上：

```rust
fn server_loop() -> Result<!, ConnectionError> {
    loop {
        let (client, request) = get_request()?;
        request.process().send(client);
    }
}
```

标准库里的 `std::convert::Infallible` 也没有任何值。PR #155499 把它改成了 `!` 的类型别名。

## `!` 为什么会变成 `()`

看下面这段代码：

```rust
fn print_ret_ty<T>(_: impl FnOnce() -> T) {
    println!("{}", std::any::type_name::<T>());
}

print_ret_ty(|| loop {});
```

`loop {}` 的类型是 `!`，但旧版 Rust 可能把 `T` 推断成 `()`。

编译器可以把 never-to-any coercion 想成一次 `absurd` 调用：

```rust
fn absurd<T>(x: !) -> T {
    x
}
```

上下文要求 `String` 时，`T` 很容易确定。上面的 `print_ret_ty` 没给 `T` 任何线索，编译器只能自己填一个类型。早期 Rust 在这里填 `()`，这个默认值就是 never type fallback。

于是 `loop {}` 在没有类型要求的地方会变成 `()`。WaffleLapkin 后来把这种现象叫作 “spontaneous never type decay”。现在的规则会保留 `!`，除非上下文要求转换到其他类型。

## 已经有人依赖旧规则了

[Edition Guide](https://doc.rust-lang.org/nightly/edition-guide/rust-2024/never-type-fallback.html) 里有一个很小的例子：

```rust
trait Unit {}
impl Unit for () {}

fn run<R: Unit>(f: impl FnOnce() -> R) {
    f();
}

run(|| panic!());
```

旧规则给闭包的返回类型填了 `()`，刚好满足 `R: Unit`。新规则留下 `!`，而代码里没有 `impl Unit for !`，编译器就会报错。可以明确写成 `run(|| -> () { panic!() });`，这样就不需要 fallback 猜类型了。

类型变化流入 `unsafe` 时还要多看一眼：

```rust
if true {
    return;
} else {
    unsafe { std::mem::zeroed() }
};
```

`zeroed()` 的返回类型没有写出来。旧规则可能得到 `zeroed::<()>()`，改用 `!` 后则可能得到 `zeroed::<!>()`。后者试图制造一个不存在的值，会产生 undefined behavior。Rust 为这类代码加入了 `never_type_fallback_flowing_into_unsafe` lint。

稳定版 rustc 接受一段代码以后，哪怕代码依赖的是隐蔽的推断细节，后续改动也得处理它。

## 两次撤回

Rust 在 2018 年[第一次合入稳定 `!` 的 PR](https://github.com/rust-lang/rust/pull/47630)。把 `Infallible` 换成 `!` 后，一些泛型和 trait object 代码走上了不同的推断路径，这次稳定化很快被撤回。

2019 年的[第二次尝试](https://github.com/rust-lang/rust/pull/65355)原本计划进入 Rust 1.41，随后又遇到了 inference regression。`!` 在推断中变成 `()`，trait solver 因此查找了错误的 trait impl。[撤回 PR](https://github.com/rust-lang/rust/pull/67224) 在发布前合入。

后面几年试过 conditional decay，让编译器判断哪些 `!` 应该保留，哪些需要变成 `()`。判断条件越补越多，crater 依然能找到编译失败的 crate。crater 是 Rust 用来批量编译生态项目的工具，语言改动会先用它估算影响范围。

2024 年，WaffleLapkin 重新梳理了这些失败案例，并决定固定使用一条规则：never-to-any 的目标类型无法从上下文推断时，fallback 到 `!`。

Rust 2024 Edition 先启用了新规则。旧 edition 继续使用 `()`，编译器通过 future-compat lint 提前标出受影响的代码。Rust 1.92 把两个相关 lint 提升为 deny-by-default，[官方当时估计约有 500 个 crate 需要修改](https://blog.rust-lang.org/2025/12/11/Rust-1.92.0/)。

Edition 给每个 crate 留出了迁移时间，lint 指出具体位置，crater 用来观察整个生态。等这轮迁移基本完成，[PR #155499](https://github.com/rust-lang/rust/pull/155499) 才在所有 edition 上统一使用 `!` fallback。

## 平时会在哪里写 `!`

显式使用 `!` 的代码主要集中在泛型库、状态机、executor 和嵌入式程序里。比如 `type Error = !` 表示某个实现不会失败，`fn kernel_main() -> !` 表示入口函数不会返回。

平时更常见的是编译器替我们使用它：

```rust
let value = match option {
    Some(x) => x,
    None => panic!(),
};

let result = if ready {
    calculate()
} else {
    return;
};
```

`panic!()` 和 `return` 都产生 `!`，然后被转换成分支要求的类型。Rust 1.100 发布后，我们也能在稳定版里明确写出 `Result<T, !>`、associated type 和其他使用 `!` 的类型。

主文里出现了 coercion、unify、inference variable 和 fallback。下面单独拆一篇，看看 rustc 在这些步骤里分别做了什么。
