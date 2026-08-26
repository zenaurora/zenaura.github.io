---
title: "Rust 类型推断里的 coercion、unify 和 fallback"
description: "用几个小例子区分类型推断、unification、coercion，以及编译器什么时候需要 fallback。"
date: 2026-08-27
order: 1
authors:
  - maokaihe
tags:
  - Rust
  - Type System
  - Compiler
---

主文谈 never type fallback 时用了几个编译器术语。把它们混在一起看很容易绕，因为它们都发生在类型检查阶段，做的事情却不一样。

## inference variable 是待填写的类型

这段代码只有 `Vec::new()`，元素类型还没有线索：

```rust
let values = Vec::new();
```

检查到这里时，编译器会先留一个 inference variable，可以暂时记成 `?T`，于是 `values` 的类型是 `Vec<?T>`。如果后面出现 `values.push(1_u32)`，`?T` 就能确定为 `u32`。

inference variable 只存在于编译器的推断过程中，Rust 源码里不能直接写 `?T`。报错里的 “type annotations needed” 通常意味着某个 inference variable 到最后还没有答案。

## unify 会让两个类型相等

```rust
let mut values = Vec::new();
values.push(1_u32);
```

`push` 要求参数类型和 `Vec` 的元素类型相同。编译器手里有一个约束：`?T = u32`。处理这个约束的过程叫 unification，后面再往 `values` 里放 `String` 就会报错，因为 `?T` 已经确定成了 `u32`。

函数的泛型参数也会这样推断：

```rust
fn same<T>(left: T, right: T) {}

same(1_u32, 2_u32);
```

第一个参数让 `T` 确定为 `u32`，第二个参数也得满足这个类型。

## coercion 接受一次受限的隐式转换

coercion 发生在编译器已经知道目标类型的位置，例如带类型标注的 `let`、函数参数、返回值，以及需要合并类型的 `if` 或 `match` 分支。

```rust
let owned = String::from("hello");
let text: &str = &owned;
```

右边的类型是 `&String`，左边要求 `&str`。Rust 在这里使用 deref coercion。`&String` 自己的类型没有被改写，编译器只在这次赋值上做调整。

never-to-any 也是 coercion：

```rust
let name: String = panic!("missing name");
```

左边已经给出 `String`，`panic!()` 产生的 `!` 便可以转到 `String`。这段代码不会产生一个假的 `String`，程序会在赋值完成前进入 panic。

## `NeverToAny` 为什么不能直接 unify

目标类型有时也是 inference variable。比如编译器检查多个 `match` 分支时，会先找一个共同类型 `?T`，然后分别处理每个分支。

如果某个分支是 `panic!()`，rustc 会记录一次从 `!` 到 `?T` 的 `NeverToAny` coercion。此时 `?T` 仍然可以由其他分支确定：

```rust
let value = match input {
    Some(text) => text.to_owned(),
    None => panic!("missing input"),
};
```

`Some` 分支让共同类型成为 `String`，之前记录的 `NeverToAny` 也就有了目标。

如果一开始直接 unify `?T = !`，共同类型会立刻锁定为 `!`，`String` 分支随后就无法加入。rustc 因此保留这次 coercion，等待周围代码提供类型。

## fallback 负责最后还没填上的空位

到了类型检查末尾，有些 inference variable 仍然没有答案：

```rust
fn ret<T>(_: impl FnOnce() -> T) {}

ret(|| loop {});
```

闭包只产生 `!`，周围也没提供目标类型。编译器已经记录了 `NeverToAny`，现在需要给它选一个最终类型。这个收尾步骤就是 fallback。

旧规则选择 `()`，所以泛型参数 `T` 会成为 `()`。新规则选择 `!`，闭包的返回类型就留在 `!`。

fallback 发生得很晚。它选出的类型还要满足 `T: SomeTrait` 之类的约束，因此默认值从 `()` 变成 `!` 后，编译结果也可能跟着变化。主文里的 `Unit` 例子就是这种情况。

Rust 的 [Reference](https://doc.rust-lang.org/reference/type-coercions.html) 列出了 coercion 可以发生的位置和转换种类；[rustc dev guide](https://rustc-dev-guide.rust-lang.org/hir-typeck/coercions.html#never-to-any-coercions) 则解释了 `NeverToAny` 与 unification 的区别。
