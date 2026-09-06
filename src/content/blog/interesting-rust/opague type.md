---
title: "Rust 不透明类型：Defining Use 与 Typing Mode"
description: "记录 impl Trait 的 defining use、non-defining use，以及 TypingEnv 和 rigid alias 对类型展开的影响。"
date: 2026-09-06
authors:
  - maokaihe
tags:
  - Rust
  - Compiler
order: 2
---

## defining use and non-defining use

defining use 是指向编译器reveal 不透明类型背后的具体类型，也就是impl Trait背后的底层是什么具体的类型。

当编译器遇到 `impl Trait` 时，它需要知道这个类型在内存中到底长什么样（具体类型是什么）。Defining use 就是编译器用来收集线索、推断并最终问题确定这个具体类型的地方。

```rust
fn get_number() -> impl std::fmt::Display {
    42  // <--- 这是 Defining Use
}
```

看到42之后就可以推断出来std::fmt::Display背后的具体类型是i32

---

Non-defining use 是指那些使用了该 `impl Trait` 类型，但**不会**让编译器去推断其底层具体类型的代码，在这些位置，编译器只检查你的操作是否符合 `impl Trait` 声明的 Trait 边界（Bounds），而把它的具体类型视为未知。

比如

```rust
fn foo() -> impl Iterator<Item = i32> {
    vec![1, 2, 3].into_iter()
}
```

rust故意让调用者不知道这个 具体的类型，对于调用者来说它不知道是一个具体的`Vec<i32>::Iterator`，而是一个`impl Iterator<Item = i32>`

在定义 opaque type 的上下文中，是可以确定它背后的类型具体是啥，但是对于调用者来说保持隐藏。

```rust
fn get_number() -> impl std::fmt::Display {
    42 // Defining use (决定了类型是 i32)
}

fn use_number() {
    let x = get_number(); // <--- Non-defining use
    println!("{}", x);    // <--- Non-defining use
}
```

在 `use_number` 中，编译器不关心 `x` 到底是 `i32` 还是 `String`，它只知道 `x` 实现了 `Display`，所以可以传给 `println!`。这里不会去“定义”或改变 `get_number` 返回的具体类型。

TAIT 中经典Non-defining use的例子：

```rust
type MyOpaque = impl Copy;

fn define_it() -> MyOpaque {
    1 // Defining use: 决定 MyOpaque 是 i32
}

fn pass_it_through() -> MyOpaque {
    define_it() // <--- Non-defining use!
}
```

Rust 这么设计的目的是为了防止类型推断的时候过于全局性，增加编译速度，防止出现一些循环依赖和难以理解的报错。所以具体的类型只能由Defining use单项决定；impl Trait的设计的目的是为了隐藏具体的实现，如果允许调用方去反推底层类型，破坏了不透明类型的封装意义.


---


- **#156742：引入回归的改动** —— `Add rigid alias marker`
- **#158993：真正修正逻辑的改动** —— `rerun in original typing mode if we meet any opaques in post analysis`
- **#161555：把 #158993 backport 到 Rust 1.98 stable，形成 1.98.1**

这个156742 PR 之前大致相当于Alias(AliasTy)，这个PR之后改成了Alias(Isrigid,AliasTy)

并增加了一个 enum IsRigid，包括yes和no两个变体。
它表示一个 alias 是 rigid 的，还是仍然 potentially normalizeable；如果在当前 scope 中已经确定它不能继续 normalize，就标成 `IsRigid::Yes`，以后不用再重复尝试 normalization。

normalization意思是把一个alias变成一个更加明确类型的过程

当然只是表示当前的scope里面确定不能继续normalize，不过如果在其他scope内可以继续reveal opaque，就可能可以继续normalize了

`IsRigid` 从设计上就不是 alias 的永久属性，而是一个对于当前 `TypingEnv` 成立的属性。如果进入另一个 `TypingEnv`，因为 `ParamEnv` 或 `TypingMode` 发生变化，需要强制把 rigid aliases 恢复成 non-rigid。

rustc 会有不同 `TypingMode`，比如现在能看到：

```text
TypingMode::Typeck
TypingMode::PostBorrowck
TypingMode::PostAnalysis
TypingMode::Codegen
TypingMode::Coherence
TypingMode::ErasedNotCoherence
...
```

不同 context 下，Rust 的 typing rules 有一些差异。

比如 `Typeck` 主要负责正常用户代码类型检查，而 `PostAnalysis` / `Codegen` 已经处于后期阶段，可以 reveal 更多 opaque 信息。文档也明确说，在 analysis 之后可以 reveal opaque hidden type，只是不应该让这种具体信息泄露成用户可观察的类型错误。

GPT做的流程示意

```text
               TypingMode
                   │
                   │ 决定当前允许使用什么类型信息
                   ▼
             TypingEnv
                   │
                   │ 尝试 normalization
                   ▼
               Alias
          ┌────────┴────────┐
          │                 │
       Opaque           Projection
    impl Trait       <T as Trait>::Assoc
          │                 │
          └────────┬────────┘
                   ▼
         当前还能继续展开吗？
             /           \
           能             不能
           │               │
           ▼               ▼
      继续 normalize   IsRigid::Yes
```

Opaque 能否被 reveal 是依赖于不同的 Typing Mode

---

rust-lang/rust #158993
这个PR是`rerun in original typing mode if we meet any opaques in post analysis`
修改的代码就这一块：

```diff
(
    RerunCondition::OpaqueInStorageOrAnyOpaqueHasInferAsHidden(_),
    TypingMode::PostAnalysis | TypingMode::Codegen,
-) => RerunDecision::No,
+) => RerunDecision::Yes,
```

把原先已经推断为No的改为Yes，也就是需要一次Rerun；普通的 `OpaqueInStorage` 已经会在 PostAnalysis/Codegen 下重跑，可它的组合版本却不会，这是一个逻辑bug

