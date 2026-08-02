---
title: "Rust 中的观察者模式：所有权、共享状态与 Channel"
description: "观察者模式在 Rust 中并不复杂；真正的设计难点在于监听器的归属、共享可变状态与并发边界。"
date: 2026-08-02
authors:
  - maokaihe
tags:
  - Rust
  - Design Patterns
---

## 引言

观察者模式描述的是一种很常见的关系：发布者维护一组订阅者，状态变化时依次通知它们。日志、指标收集、GUI 事件和领域事件都会用到这种关系。

在带垃圾回收的面向对象语言里，事件总线通常只需保存一组对象引用，再逐个调用回调。对象何时释放、谁还能修改它，以及多个线程如何访问它们，往往留给运行时或约定处理。Rust 把这些问题放回 API 设计中：事件总线是拥有监听器、借用监听器，还是与其他组件共享监听器？通知是否会修改状态？这套关系会不会跨线程？

这些选择决定的并不只是类型签名，也决定了取消订阅、重入回调和并发访问的复杂度。本文从最简单的实现开始，逐步讨论所有权模型，并说明什么时候 channel 比回调更合适。

## 发布者拥有监听器

如果监听器只属于事件总线，直接由总线拥有它们即可。这里不需要生命周期参数、引用计数或锁：

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

`EventBus` 拥有每个 `Box<dyn Listener>`，监听器会随总线一起释放。`publish` 使用 `&mut self`，也准确表达了通知可能修改监听器的内部状态。

这就是完整且实用的观察者模式。当业务关系本来就是“总线创建并管理这些回调”时，不必为了套用某种架构而引入 `Arc<Mutex<_>>` 或 channel。

## 当监听器不归总线所有

现实中的监听器往往并非为某一个总线而创建。一个 `Logger` 可能既订阅事件，也要被其他代码直接调用；一个 UI 组件可能需要订阅多个事件源。此时，监听器的所有权就不能再由总线单方面决定。

### 借用监听器

一种选择是让总线保存监听器的可变借用：

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

这段代码可以编译，但 `'a` 表示：只要 `EventBus` 仍可能通知某个监听器，该监听器就一直处于独占可变借用中。

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

总线在这里并不是“记住”了一个可被任意访问的对象，而是持有它的独占访问权。借用很适合生命周期紧密绑定的短期回调；监听器需要长期独立存在时，通常不适合作为默认方案。

### 共享监听器

当监听器确实需要被多个组件共享，或需要跨线程使用时，可以将所有权放进 `Arc`，并用 `Mutex` 保护可变状态：

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

这种方式解决了共享所有权，但也引入引用计数、加锁和锁中毒。回调执行期间持有监听器的锁：慢回调会阻塞同一监听器的其他访问；回调若重入并再次锁定自己，也可能死锁。单线程版本 `Rc<RefCell<_>>` 的取舍类似，只是把借用检查从编译期推迟到运行时，违规时会 panic。

若事件总线本身也要被多个线程共享，还要保护订阅列表。例如可以把 `Vec<SharedListener>` 放进 `RwLock`，并用 `Arc` 包裹这一内部状态。注意，类型不能写成 `Vec<dyn Listener>`：trait object 的大小未知，必须通过 `Box`、`Arc` 等指针间接存储。

是否需要在外部使用 `Arc<EventBus>`，取决于是否真的有多个所有者需要持有总线；它不是让 `EventBus` 可克隆的必需条件。先明确谁拥有总线、谁能订阅，再选择同步边界。

### 对订阅列表做 snapshot

无论监听器是否可变，都不应在持有订阅列表锁时执行回调。更稳妥的做法是：在很短的读锁范围内复制一份 `Arc` 列表，释放列表锁后再逐一通知。这样，慢回调不会阻塞新的订阅或取消订阅。

如果通知只需要不可变访问，监听器自身不必额外套 `Mutex`：

```rust
use std::sync::{Arc, RwLock};

trait Listener: Send + Sync {
    fn update(&self, message: &str);
}

struct EventBus {
    listeners: RwLock<Vec<Arc<dyn Listener>>>,
}

impl EventBus {
    fn publish(&self, message: &str) {
        let listeners = self.listeners.read().unwrap().clone();

        for listener in listeners {
            listener.update(message);
        }
    }
}
```

snapshot 解决的是“如何安全遍历订阅列表”，而不是“如何可变访问监听器”。若 `update` 的签名是 `&mut self`，同一个监听器仍需要独占访问；常见形式就是 `RwLock<Vec<Arc<Mutex<dyn Listener + Send>>>>`：外层锁保护订阅列表，内层锁只保护各自的监听器。反过来，若能将接口设计为 `update(&self, event: &Event)`，并把真正的可变状态封装在监听器内部，就可以省掉总线层的每监听器 `Mutex`。

## 经典实现的成本在哪里

传统观察者模式往往把以下关系藏在对象图里：

1. 总线到底拥有、借用还是共享监听器？
2. `update` 是否会修改监听器状态，谁可以同时修改它？
3. 如何用稳定的订阅句柄取消订阅？
4. 回调里再次发布、订阅或取消订阅时，当前迭代和锁是否仍然安全？
5. 跨线程时，哪些类型必须满足 `Send`、`Sync`？

Rust 要求这些关系在类型和 API 上显式出现。代价是复杂性比 Java 中的 `List<Listener>` 更早显现；收益是生命周期、共享可变性和并发边界不会被悄悄埋进回调链里。

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

这里的所有权关系很清楚：总线拥有发送端，每个订阅者拥有接收端；丢弃接收端就是取消订阅；发送失败时也能顺手清理失效订阅。事件以值传递，而不是通过共享对象上的回调执行。

channel 并不是无成本的观察者模式替代品。上面的 `mpsc::channel()` 是无界队列，慢消费者可能导致积压；每个订阅者都要得到一份消息；发布也不再意味着“所有监听器已经同步处理完”。在异步程序中，Tokio 的 `broadcast` 等有界 channel 提供了另一组取舍，例如容量控制和落后消费者的显式错误。

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

观察者模式、闭包和 channel 解决的是不同的问题。设计时先区分三种需求：

- 发布者拥有监听器，且需要同步通知：使用 `Box<dyn Listener>` 或闭包。
- 监听器与总线生命周期紧密绑定：可以借用 trait object，但要接受独占借用范围。
- 独立组件之间需要跨线程或异步传递事件：使用 channel，并根据背压、丢失策略和延迟选择具体实现。

当监听器既要被总线回调，又要被其他地方独立共享和修改时，传统观察者模式的隐性成本会集中显现。Rust 的价值不在于阻止这种设计，而在于迫使我们明确所有权和同步边界，并据此选择更贴合实际需求的模型。
