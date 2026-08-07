---
title: "绕过 `kind` 字段：ts-pattern、never 与 Pattern Matching 提案"
description: "TypeScript 的 discriminated union 是不是非要带 `kind` 字段？三种 workaround 试一下"
date: 2026-08-06
order: 1
authors:
  - maokaihe
tags:
  - TypeScript
  - Pattern Matching
---

## 引言

在抄 Actix Web Router 那一篇里，路由模式被分成了两种：

```typescript
interface StaticPattern {
    kind: 'static',
    value: string,
}

interface DynamicPattern {
    kind: 'dynamic',
    rg: RegExp,
    names: string[],
}

type Pattern = StaticPattern | DynamicPattern;
```

每次加成员要加 `kind: 'xxx'`、匹配要写 `if (r.kind === '...')`。写多了觉得有点啰嗦——Rust 有原生 `match`，TypeScript 没有；要丢掉 `kind` 字段，又拿不到原生穷尽性检查。

下面是三种 workaround：从"拉库"到"零依赖"再到"等标准"。

## 库：`ts-pattern`

最成熟的方案是 [`ts-pattern`](https://github.com/gvergnaud/ts-pattern)。它提供 `match(v).with(...)` 链式 API，对 discriminated union 特别友好：

```typescript
import { match } from 'ts-pattern';

function matchPath(rdef: ResourceDef, path: string) {
    return match(rdef.tp)
        .with({ kind: 'static' }, ({ value }) => ({
            matched: value === path,
            params: null,
        }))
        .with({ kind: 'dynamic' }, ({ rg, names }) => {
            const m = rg.exec(path);
            if (!m) return { matched: false, params: null };
            const params: Record<string, string> = {};
            names.forEach((n, i) => { params[n] = m[i + 1]; });
            return { matched: true, params };
        })
        .exhaustive();
}
```

最关键的是末尾的 `.exhaustive()`——少写一个分支，编译期就报错。也就是说，`kind` 字段的"判别"工作被库接过去了，而"忘了处理某个分支"这种 bug 直接在编译阶段被卡住。代价是引入一个外部依赖。

## 不拉库：`never` + `switch` 收口

不想拉依赖的话，传统做法是 `never` + `switch`：

```typescript
function assertNever(x: never): never {
    throw new Error(`Unhandled: ${JSON.stringify(x)}`);
}

function matchPath(rdef: ResourceDef, path: string) {
    switch (rdef.tp.kind) {
        case 'static':
            return { matched: rdef.tp.value === path, params: null };
        case 'dynamic': {
            const m = rdef.tp.rg.exec(path);
            if (!m) return { matched: false, params: null };
            const params: Record<string, string> = {};
            rdef.tp.names.forEach((n, i) => { params[n] = m[i + 1]; });
            return { matched: true, params };
        }
        default:
            return assertNever(rdef.tp);  // 漏 case 时这里会编译报错
    }
}
```

`assertNever` 的参数是 `never`，编译器会逼着你把所有 case 走完。将来加 `kind: 'regex-literal'` 之类的新分支时，`switch` 漏掉哪个、`default` 里就立刻"开骂"。`kind` 字段没消失，但 `if` 链变成了 `switch` + 穷尽性检查，啰嗦程度比纯 `if` 要好不少。

## 未来：TC39 的 Pattern Matching 提案

ECMAScript 早就有 [Pattern Matching 提案](https://github.com/tc39/proposal-pattern-matching)，目前还在 Stage 1。提案语法长这样：

```javascript
match (rdef.tp) {
    when ({ kind: 'static', value }) {
        return { matched: value === path, params: null };
    }
    when ({ kind: 'dynamic', rg, names }) {
        return { matched: rg.test(path), params: ... };
    }
}
```

写起来几乎和 Rust 一样自然，编译器原生穷尽性检查，听起来是终极解。但要等到所有主流运行时都支持，估计还有几年——目前还得靠 Babel 插件才能跑。所以至少短期内，前两条 workaround 还得顶着用。

## 总结

- 项目已经用了 `ts-pattern`：直接上，`.exhaustive()` 把穷尽性握在手里。
- 不想加依赖、又愿意保留 `kind`：用 `never` 兜底。
- 等 stdlib：还有得等。

`kind` 字段本身不丑——只是当 union 成员越来越多时，人为维护的"标签 + `if` 链"会越来越容易出错。把"穷尽性"交给编译器 / 库来做，正是这三种方案共同的卖点。
