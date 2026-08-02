---
title: "为什么经典观察者模式在 Rust 中常常不合适？"
description: "观察者模式并非不能用于 Rust；问题在于监听器需要共享、独立存活或跨线程时，所有权与同步成本会立刻暴露。"
date: 2026-08-02
authors:
  - maokaihe
tags:
  - Rust
  - Design Patterns
draft: true
---

## 引言

“Rust 不适合观察者模式”并不准确。一个发布者拥有一组监听器、在事件发生时依次通知它们，这种最简单的观察者模式在 Rust 中很好写。

真正容易变得别扭的，是经典面向对象实现暗含的另一层关系：监听器既要被事件总线调用，又要继续被其他组件独立持有、修改，甚至跨线程共享。Java 会把这层共享关系隐藏在对象引用和垃圾回收之后；Rust 则要求程序明确选择所有权、借用和同步方式。

下面从简单实现开始，看看成本是从哪里出现的，以及什么时候 channel 会是更好的模型。

## 发布者拥有监听器：其实很直接

如果监听器只属于事件总线，最自然的做法是把它们直接放进总线。这里没有生命周期、引用计数或锁：

```rust
trait Listener {
    fn update(&mut self, message: &str);
}

struct EventBus {
    listeners: Vec<Box<dyn Listener>>,
}

impl EventBus {
    fn new() -> Self {
        Self { listeners: Vec::new() }
    }

    fn subscribe(&mut self, listener: impl Listener + 'static) {
        self.listeners.push(Box::new(listener));
    }

    fn publish(&mut self, message: &str) {
        for listener in &mut self.listeners {
            listener.update(message);
        }
    }
}
```

`EventBus` 拥有每个 `Box<dyn Listener>`，因此监听器和总线有相同的生命周期。发布时使用 `&mut self`，也准确表达了：通知监听器可能修改其内部状态。

这已经是可用的观察者模式。若业务关系本来就是“总线创建并管理这些回调”，不必为了套用某种架构而引入 `Arc<Mutex<_>>` 或 channel。

## 麻烦从“监听器不归总线所有”开始

现实中的监听器往往不是专门为总线创建的。比如一个 `Logger` 既要订阅事件，也可能被其他代码直接调用。此时总线究竟应该拥有它、借用它，还是与别处共享它？这才是 Rust 要求回答的问题。

### 借用监听器：关系最明确，也最严格

可以让总线保存监听器的可变借用：

```rust
trait Listener {
    fn update(&mut self, message: &str);
}

struct EventBus<'a> {
    listeners: Vec<&'a mut dyn Listener>,
}

impl<'a> EventBus<'a> {
    fn new() -> Self {
        Self { listeners: Vec::new() }
    }

    fn subscribe(&mut self, listener: &'a mut dyn Listener) {
        self.listeners.push(listener);
    }

    fn publish(&mut self, message: &str) {
        for listener in &mut self.listeners {
            listener.update(message);
        }
    }
}
```

它能编译，但 `'a` 表示：只要 `EventBus` 仍可能通知某个监听器，该监听器就一直处于独占可变借用中。

```rust
struct Logger;

impl Listener for Logger {
    fn update(&mut self, message: &str) {
        println!("{message}");
    }
}

fn main() {
    let mut logger = Logger;
    let mut bus = EventBus::new();

    bus.subscribe(&mut logger);
    bus.publish("first event");

    // logger.update("direct call");
    // 错误：`logger` 仍被 `bus` 可变借用。
}
```

这不是编译器故意为难人，而是事实本身：总线没有“记住”一个可随时任意访问的对象，它持有的是独占访问权。借用方案很适合生命周期本来就紧密绑定的短期回调；若监听器要长期独立存在，通常不是好默认值。

### 共享监听器：可以，但要承担运行时成本

当监听器确实需要被多个组件共享，或需要跨线程使用时，可以使用 `Arc<Mutex<_>>`：

```rust
use std::sync::{Arc, Mutex};

trait Listener: Send {
    fn update(&mut self, message: &str);
}

type SharedListener = Arc<Mutex<dyn Listener>>;

struct EventBus {
    listeners: Vec<SharedListener>,
}

impl EventBus {
    fn subscribe(&mut self, listener: SharedListener) {
        self.listeners.push(listener);
    }

    fn publish(&self, message: &str) {
        for listener in &self.listeners {
            listener.lock().unwrap().update(message);
        }
    }
}
```

这解决了共享所有权，却也明确引入了引用计数、加锁和锁中毒。回调执行期间持有监听器的锁：慢回调会阻塞同一监听器的其他访问；若回调重入并再次尝试锁定自己，也可能死锁。单线程版本 `Rc<RefCell<_>>` 的取舍类似，只是把借用检查从编译期推迟到运行时，违规时会 panic。

如果需要让**事件总线本身**被多个线程共享，还要保护订阅列表。例如可以把 `Vec<SharedListener>` 放进 `RwLock`，并用 `Arc` 包裹这个内部状态。注意类型不能写成 `Vec<dyn Listener>`：trait object 大小未知，必须通过 `Box`、`Arc` 等指针间接存储。

是否需要在外部使用 `Arc<EventBus>`，取决于是否真的有多个所有者要持有总线；它不是“让 `EventBus` 能 clone”的必需条件。应先决定谁拥有总线、谁能订阅，再选择同步边界。

## 为什么经典实现容易失去优势

传统观察者模式通常把以下关系藏在对象图里：

1. 总线到底拥有、借用还是共享监听器？
2. `update` 是否会修改监听器状态，谁可以同时修改它？
3. 如何用稳定的订阅句柄取消订阅？
4. 回调里再次发布、订阅或取消订阅时，当前迭代和锁是否仍然安全？
5. 跨线程时，哪些类型必须满足 `Send`、`Sync`？

Rust 要求这些关系在类型和 API 上显式出现。代价是代码比 Java 中的 `List<Listener>` 更早暴露复杂性；收益是生命周期、共享可变性和并发边界不会被悄悄埋进回调链里。

## Channel：适合独立组件之间传递事件

如果需求不是“立刻调用一批对象的方法”，而是“向彼此独立的组件发送事件”，channel 往往更贴合问题。发布者保留发送端，每个订阅者取得自己的接收端：

```rust
use std::sync::mpsc::{self, Receiver, Sender};

struct EventBus {
    subscribers: Vec<Sender<String>>,
}

impl EventBus {
    fn new() -> Self {
        Self { subscribers: Vec::new() }
    }

    fn subscribe(&mut self) -> Receiver<String> {
        let (sender, receiver) = mpsc::channel();
        self.subscribers.push(sender);
        receiver
    }

    fn publish(&mut self, message: impl Into<String>) {
        let message = message.into();
        self.subscribers
            .retain(|subscriber| subscriber.send(message.clone()).is_ok());
    }
}
```

所有权关系在这里很清楚：总线拥有发送端，每个订阅者拥有接收端；丢弃接收端就是取消订阅；发送失败时也能顺手清理失效订阅。事件以值传递，而不是通过共享对象上的回调执行。

不过 channel 不是免费的观察者模式替代品。上面的 `mpsc::channel()` 是无界队列，慢消费者可能导致积压；每个订阅者都要得到一份消息；发布也不再意味着“所有监听器已经同步处理完”。在异步程序中，Tokio 的 `broadcast` 等有界 channel 能提供另一组取舍，例如容量控制和落后消费者的显式错误。

因此，channel 更适合跨线程、异步或需要让组件彼此解耦的事件流；需要同步通知、并且发布者拥有监听器时，普通回调往往更简单。

## 闭包：小型同步回调的实用选择

如果发布者拥有回调，且不需要复杂的共享对象关系，也可以直接保存闭包：

```rust
struct EventBus {
    listeners: Vec<Box<dyn FnMut(&str)>>,
}

impl EventBus {
    fn subscribe(&mut self, listener: impl FnMut(&str) + 'static) {
        self.listeners.push(Box::new(listener));
    }

    fn publish(&mut self, message: &str) {
        for listener in &mut self.listeners {
            listener(message);
        }
    }
}
```

这里的 `'static` 不代表闭包一定活到程序结束，只表示它没有借用生命周期更短的局部数据。闭包可以拥有捕获的数据，因此很适合简单、局部且同步的通知逻辑。

## 总结

Rust 并没有禁止观察者模式，也没有规定 channel 总是更好。关键是先区分三种不同的需求：

- 发布者拥有监听器，且需要同步通知：使用 `Box<dyn Listener>` 或闭包。
- 监听器与总线生命周期紧密绑定：可以借用 trait object，但要接受独占借用范围。
- 独立组件之间需要跨线程或异步传递事件：使用 channel，并根据背压、丢失策略和延迟选择具体实现。

当监听器既要被总线回调，又要被其他地方独立共享和修改时，传统观察者模式的隐性成本才会集中显现。Rust 的价值不在于让这种设计无法实现，而在于迫使我们把所有权和同步边界写出来，并据此选择更贴合实际需求的模型。
