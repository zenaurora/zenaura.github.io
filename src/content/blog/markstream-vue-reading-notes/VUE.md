---
title: "markstream-vue 里的 Effect Scope 和 Performance API"
description: "读源码时遇到的两个 API：用 onScopeDispose 回收副作用，以及用 performance.mark 和 measure 统计耗时。"
date: 2026-08-22
order: 2
authors:
  - maokaihe
tags:
  - markstream-vue
  - Vue
  - Source Code Reading
---

读 markstream-vue 源码时遇到了两个之前不太熟的 API，顺手记一下。

## 用 Effect Scope 清理副作用

Vue 3.2 加入了 [Effect Scope](https://vuejs.org/api/reactivity-advanced.html#effectscope)，可以把 `watch`、`computed` 这类响应式副作用收进同一个作用域，再一次性清理。

组件本身已经有一个 Effect Scope，组件卸载时，Vue 会自动停止里面的响应式副作用。不过 composable 里可能还会创建订阅、控制器之类的资源，它们也需要跟着组件一起销毁。源码里用了下面这种写法：

```ts
if (getCurrentScope()) {
  onScopeDispose(() => {
    unsubscribe()
    controller.destroy()
  })
}
```

`getCurrentScope()` 用来检查当前有没有活跃的 Effect Scope。比如这段代码在组件的 `setup()` 中执行，就能拿到组件的作用域。

`onScopeDispose()` 则把清理函数注册到当前作用域。等组件卸载或这个作用域被手动停止时，`unsubscribe()` 和 `controller.destroy()` 会一起执行。它有点像 `onUnmounted()`，但不依赖组件，可以直接用在 composable 里。

这段判断也很实在：有 Vue 作用域时就自动注册清理；不在任何作用域里时不注册，资源要由调用方自己处理。

## 用 Performance API 统计耗时

我一开始把 `performance` 记成了 Node 内置 API。更准确地说，它来自 Web Performance API，浏览器可以直接使用；Node 也通过 `node:perf_hooks` 提供了兼容实现。

### `performance.now()`

`performance.now()` 返回从 `performance.timeOrigin` 开始经过的毫秒数，适合测量一段代码花了多久。它不是当前时间戳。

```ts
const start = performance.now()
await parseMarkdown(markdown)
const duration = performance.now() - start
```

### `performance.mark()`

`mark()` 会在性能时间线上记一个带名字的时间点：

```ts
performance.mark("parse-start")
await parseMarkdown(markdown)
performance.mark("parse-end")
```

每次调用都会生成一个 `PerformanceMark`，里面有 `name`、`startTime`、`entryType` 和 `detail` 等字段。

### `performance.measure()`

`measure()` 用来计算两个 mark 之间的耗时：

```ts
const measure = performance.measure(
  "parse-cost",
  "parse-start",
  "parse-end",
)

console.log(measure.duration)
```

也可以直接传开始和结束时间：

```ts
const measure = performance.measure("manual", {
  start: 100,
  end: 350,
})

console.log(measure.duration) // 250
```

相比自己到处保存开始时间，`mark()` 和 `measure()` 会把结果留在性能时间线上，调试时更容易统一查看。
