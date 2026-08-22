---
title: "为什么 Copy 类型在线程闭包里还需要 move？"
description: "从一段 E0716 报错出发，聊聊 for ref、闭包捕获，以及 AtomicU32::from_mut_slice 返回的可变引用。"
date: 2026-08-22
authors:
  - maokaihe
tags:
  - Rust
  - Concurrency
  - Ownership
---

Rust 1.98 稳定了 `AtomicU32::from_mut_slice`。试这个 API 时，我因为不想写 `move`，顺手写出了下面这段代码：

```rust
thread::scope(|s| {
    for ref i in 0..atomic_values.len() {
        s.spawn(|| {
            atomic_values[*i].store(*i as u32, Ordering::Relaxed);
        });
    }
});
```

编译器报错：

```text
error[E0716]: temporary value dropped while borrowed
```

我知道加 `move` 能解决，但当时没想明白为什么不对

## `ref i` 到底借用了什么

```rust
for ref i in 0..atomic_values.len()
```

`ref i` 会让 `i` 成为 `&usize`。它借用的是迭代器在当前这一轮产生的临时值，而这个值活不到整个 `scope` 结束。

`thread::scope` 只保证所有子线程会在 `scope` 返回前结束，不保证它们在当前这轮循环结束前执行完。因此，线程闭包有可能在临时值失效后继续使用 `i`，Rust 会直接拦下来。

先把 `ref` 去掉，`i` 就只是普通的 `usize`：

```rust
for i in 0..atomic_values.len()
```

不过这时如果闭包仍然不加 `move`，会得到另一个报错：

```text
error[E0373]: closure may outlive the current function, but it borrows `i`
```

原因还是一样。闭包默认按实际用法捕获变量，这里只读取了 `i`，所以闭包会借用它；但每一轮的 `i` 都会在本轮结束时销毁，活不到整个线程作用域结束。

## 正确写法

```rust
use std::{
    sync::atomic::{AtomicU32, Ordering},
    thread,
};

fn main() {
    let mut values = [0u32; 10];
    let atomic_values = &*AtomicU32::from_mut_slice(&mut values);

    thread::scope(|s| {
        for i in 0..atomic_values.len() {
            s.spawn(move || {
                atomic_values[i].store(i as u32, Ordering::Relaxed);
            });
        }
    });

    assert_eq!(values, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
}
```

这里改了两处：去掉 `ref`，让 `i` 变回 `usize`；再给闭包加上 `move`，让每个线程都拿到自己的 `i`。

## `usize` 已经是 Copy，为什么还要写 `move`

`Copy` 和 `move` 管的不是一件事。

`Copy` 表示一个值可以按位复制，`move` 则决定闭包按值捕获外部变量。没有 `move` 时，闭包看到自己只需要读取 `i`，就会优先借用：

```rust
let i_ref = &i;
```

加上 `move` 后，闭包会按值捕获 `i`。因为 `usize: Copy`，这里实际复制了一份：

```rust
let closure_i = i;
```

所以 `move` 不等于一定会把原变量搬走。对 `usize`、共享引用这类 `Copy` 类型来说，按值捕获就是复制；对 `String` 这类非 `Copy` 类型，才会真的转移所有权。

## 为什么还要写 `&*`

`AtomicU32::from_mut_slice(&mut values)` 返回的是：

```rust
&mut [AtomicU32]
```

可变引用不是 `Copy`。如果直接让 `move` 闭包捕获它，第一轮循环就会把这个引用移进闭包，下一轮再用时就报错。

但这里根本不需要独占引用。`AtomicU32::store` 接收的是 `&self`，而且 `AtomicU32` 实现了 `Sync`，多个线程可以通过共享引用操作它。

```rust
let atomic_values = &*AtomicU32::from_mut_slice(&mut values);
```

这句里的 `&*` 会把 `&mut [AtomicU32]` 重新借用成 `&[AtomicU32]`。共享引用实现了 `Copy`，所以每个 `move` 闭包都能复制一份。

如果觉得 `&*` 看起来有点绕，也可以直接把类型写出来，让强制转换自动发生：

```rust
let atomic_values: &[AtomicU32] =
    AtomicU32::from_mut_slice(&mut values);
```

---

## 再说一下重借用

看一段更简单的代码：

```rust
let mut a = vec![1, 2, 3];

let b = &mut a;
let c: &Vec<i32> = b;
```

`b` 的类型是 `&mut Vec<i32>`，`c` 的类型是 `&Vec<i32>`。这里没有把 `b` 移走，编译器会根据 `c` 的类型，自动从 `b` 创建一个新的共享引用。概念上可以写成：

```rust
let c: &Vec<i32> = &*b;
```

`*b` 先找到它指向的 `Vec<i32>`，外面的 `&` 再借用一次，这就是重借用。

新借用不一定要活得和 `b` 一样久。下面的代码可以编译，因为 `c` 在 `println!` 之后就不会再用了：

```rust
let b = &mut a;
let c: &Vec<i32> = b;

println!("{c:?}");
b.push(4);
```

如果把 `b.push(4)` 放到 `println!` 前面，编译器就会报错。`c` 还在使用时，不能再通过 `b` 修改同一份数据。

重借用其实到处都是，只是大部分时候编译器替你做了，所以平时感觉不到：

```rust
fn print_values(values: &Vec<i32>) {
    println!("{values:?}");
}

let mut values = vec![1, 2, 3];
let values_mut = &mut values;

print_values(values_mut);
values_mut.push(4);
```

调用 `print_values(values_mut)` 时，参数类型已经明确是 `&Vec<i32>`，编译器会自动把 `&mut Vec<i32>` 重借用成共享引用。函数返回后，这次借用也结束了，`values_mut` 还能继续使用。

所以单纯为了传参，一般不需要手写 `&*values_mut`。带类型标注的 `let`、函数参数和返回值这些位置，都经常会自动发生强制转换。

## 什么时候需要手写 `&*`

最常见的情况，是你需要在类型推断之前就明确拿到内部值的共享引用。前面的原子数组就是这样：

```rust
let atomic_values = AtomicU32::from_mut_slice(&mut values);
let atomic_values = &*atomic_values;
```

第一行得到 `&mut [AtomicU32]`，第二行把它重借用成 `&[AtomicU32]`。后面要把引用放进多个 `move` 闭包，所以必须先变成可以复制的共享引用。如果直接捕获 `&mut [AtomicU32]`，第一轮循环就会把它移走。

智能指针里也经常能看到 `&*`：

```rust
let boxed = Box::new(String::from("hello"));

let outer = &boxed;  // &Box<String>
let inner = &*boxed; // &String
```

这里的 `*boxed` 会通过 `Deref` 找到里面的 `String`，再用 `&` 借用它。`Box` 没有被消费，`String` 也没有被移出来。

普通函数参数有明确的目标类型时，Deref 强制转换通常也会自动发生。但碰到泛型函数，`&Box<String>` 本身已经符合参数要求，编译器就没有理由继续往里解引用：

```rust
fn inspect<T: ?Sized>(value: &T) {
    // ...
}

inspect(&boxed);  // T 是 Box<String>
inspect(&*boxed); // T 是 String
```

`Arc<T>`、`Rc<T>`、`MutexGuard<T>` 和 `Ref<T>` 也是一样。想明确拿到它们内部的 `&T`，尤其是当前没有一个明确的目标类型帮编译器做转换时，手写 `&*value` 会很直接。

所以 `&*` 本身并不神秘：`*` 找到里面的值，`&` 再借用它。只是面对 `&mut T` 时，我们通常把它叫作重借用；面对 `Box<T>`、`Arc<T>` 这类智能指针时，还会经过它们实现的 `Deref`。

