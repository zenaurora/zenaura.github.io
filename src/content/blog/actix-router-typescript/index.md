---
title: "用 TypeScript 简单实现一个 Actix Web 的 Router"
description: "用一段一百多行的 TypeScript 把 Actix Web 的 ResourceDef / Router / recognize 思路抄一遍，看看 Rust 的路由设计落到动态语言里是什么样。"
date: 2026-08-06
authors:
  - maokaihe
tags:
  - TypeScript
  - Actix Web
  - Router
  - Source Code Reading
---

## 引言

Actix Web 的路由设计没有使用常见的Radix树，然后我用AI帮我分析一下actix的实现方式，写一个简化版本的。源代码是Rust写的，最近vibe做项目用TS比较多，
所以就用TS来实现了一下，同时巩固一下对TS类型系统使用方式的理解。

代码写完之后用Minimax帮我写了一下博客，然后有的地方我补充了一点。

完整代码不长，主要由三块组成：

- `ResourceDef`：URL 模式的编译产物，分静态和动态两种。
- `Router<T, U>`：注册路由的容器，泛型 `T` 是 handler，`U` 是 guard。
- `recognize`：根据请求路径找到第一条匹配的路由，必要时再过 guard。

下面按这条线把代码拆开讲。

## 整体形态

先看一眼顶层结构：

```typescript
interface ResourceDef {
    tp: Pattern,
    raw: string,
}

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

`ResourceDef` 是路由的"模式描述"。`raw` 保留原始字符串只是为了调试和日志；真正用于匹配的是 `tp` 这棵 union。

这里做了一个很关键的分支：`/api/users` 这种完全没有占位符的模式，单独走 `StaticPattern`，匹配时直接 `===` 字符串相等；`/user/{id:\d+}/x/{name}` 这种带 `{}` 的，才走 `DynamicPattern`，靠正则去匹配。

把静态和动态分开不是性能优化——至少不全是。**更主要的原因是它在类型上更诚实**：静态路径根本没有"参数"这个概念，下游不必再写 `params ?? {}` 之类的判空。TypeScript 的 discriminated union 把这种差异直接落到了类型上，匹配方一看 `rdef.tp.kind === 'static'` 就能确定 `params` 必为 `null`。

在Rust里面这两个Pattern是使用枚举来实现的，不过由于只有rust可以实现类似
```rust
enum Pattern {
    Static(StaticPattern),
    Dynamic(DynamicPattern),
    ...
}
```
TS的枚举enum没有rust这样强大，但是TS有很好用的和类型，使用`|`来实现，这点其实我也是很喜欢的。

不过相应地，discriminated union 还是要靠 `kind` 字段来"打标签"，匹配的时候也只能写 `if (r.kind === '...')` 链——`kind` 字段到底是不是多余的、有没有更好的写法，这个话题我另开了一篇 sub blog：

:::tip[延伸阅读]
[绕过 `kind` 字段：ts-pattern、never 与 Pattern Matching 提案 →](/blog/actix-router-typescript/kind-field-alternatives)
:::

## 把模式字符串编译成 `ResourceDef`

`new_resourcedef` 是这套设计的入口：把 `"/user/{id:\d+}/x/{name}"` 这样的字符串，编译成一个 `ResourceDef`。

```typescript
function new_resourcedef(pattern: string): ResourceDef {
    if (!pattern.includes("{")) {
        return {
            tp: { kind: 'static', value: pattern },
            raw: pattern,
        };
    }

    const paramRegex = /\{([a-zA-Z0-9_]+)(?::([^}]+))?\}/g;
    let regexStr = "^";
    let last_index = 0;
    const names: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = paramRegex.exec(pattern)) !== null) {
        const staticPart = pattern.slice(last_index, match.index);
        regexStr += escapeReGex(staticPart);

        const paramName = match[1];
        const customRegex = match[2] || "[^/]+";
        names.push(paramName);
        regexStr += `(${customRegex})`;

        last_index = paramRegex.lastIndex;
    }

    regexStr += escapeReGex(pattern.slice(last_index));
    regexStr += "$";

    return {
        tp: {
            kind: 'dynamic',
            rg: new RegExp(regexStr),
            names,
        },
        raw: pattern,
    };
}
```

思路非常直接：**用 `g` 标志的正则把 `{}` 当作占位符一段段扫出来，每扫到一个，就把它前后的文本当作静态片段，把 `{}` 内部替换成捕获组**。

几个要点：

1. **占位符语法**：`{name}` 走默认 `[^/]+`，`{name:regex}` 走自定义正则。Actix Web 的语法就是这样，抄过来手感一致。
2. **静态片段必须转义**：用户写的 `/user/{id}`，中间的 `/` 是字面量。但如果哪天用户在路径里写了 `.` 或者 `?`，它是字面量，不是正则元字符。所以 `staticPart` 要过一遍 `escapeReGex`，否则它会被当成正则语义。
3. **`names` 和捕获组的顺序对齐**：第 `i` 个名字对应第 `i+1` 个捕获组（`match[0]` 是整串）。后面 `matchPath` 会依赖这个对应关系。
4. **首尾锚点 `^` 和 `$`**：不加锚点，`/user/alice` 也会匹配 `/user/{id}`，那就出事了。

5. TS里面返回值是一个结构体的时候，是使用名义子类型的方式，也就是只要字段一样，就是看作是一个类型，这在Go里面好像叫做Duck Type
6. TS里面正则表达式是原生就有的一个RegExp，感觉还是挺好用的


`escapeReGex` 也很朴素：

```typescript
function escapeReGex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

把正则元字符加反斜杠。注意它必须放在 `new_resourcedef` 调 `escapeReGex(pattern.slice(last_index))` 之后才能正确收尾——最后一个占位符之后那段静态文本也得被转义。

## 真正干活：`matchPath`

`ResourceDef` 编译完了，匹配就只需要一个函数：

```typescript
function matchPath(rdef: ResourceDef, path: string): {
    matched: boolean;
    params: Record<string, string> | null
} {
    if (rdef.tp.kind === 'static') {
        return {
            matched: rdef.tp.value === path,
            params: null,
        };
    }

    const match = rdef.tp.rg.exec(path);
    if (!match) {
        return { matched: false, params: null };
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < rdef.tp.names.length; i++) {
        params[rdef.tp.names[i]] = match[i + 1];
    }

    return { matched: true, params };
}
```

读起来几乎不用解释：

- 静态模式直接 `===`，没有正则。
- 动态模式跑 `RegExp.exec`，没命中就 `matched: false`。
- 命中后，把 `names[i]` 映射到 `match[i + 1]`。这就是为什么 `names` 的顺序必须和捕获组顺序严格一致——这个一对一映射是整个机制的核心约定。

- 感觉没有直接的模式匹配的话，还要另加一个`kind`字段，去做if判断，感觉有点麻烦，我问了一下AI有没有相关的解决办法：

## 容器：`Router<T, U>`

`add` 把 pattern 编译、塞进一个数组；`getRoutes` 把它原样返回。没什么设计可言，唯一值得注意的是两个泛型：

```typescript
interface RouterInner<T, U> {
    resource: ResourceDef,
    handler: T,
    guard: U | null;
}

export class Router<T, U> {
    private inner: RouterInner<T, U>[] = [];

    public add(pattern: string, handler: T, guard: U | null = null): void {
        const resourceDef = new_resourcedef(pattern);
        this.inner.push({ resource: resourceDef, handler, guard });
    }

    public getRoutes(): RouterInner<T, U>[] {
        return this.inner;
    }
}
```

`T` 是 handler 类型，`U` 是 guard 类型。Actix Web 把 handler 写成 `async fn`、guard 写成 `Predicate`，靠宏展开成 trait object；这里我们偷懒用泛型，让 `add("/user", fetchUser, ["admin"])` 这种调用顺手就把 `T` 和 `U` 推出来，使用方不必关心 trait 边界。

`Router` 本身**不做匹配**。它只负责把模式和 handler 配对存起来，留给 `recognize` 决定谁先谁后。这一点很重要——它意味着匹配顺序、guard 校验这些"路由层策略"独立于"路由注册"，将来想换成 trie 或者 radix tree，只需替换 `recognize`，`Router` 不用动。

## 路由匹配入口：`recognize`

`recognize` 才是真正有策略的地方：

```typescript
export interface MatchResult<T> {
    handler: T;
    params: Record<string, string> | null;
    rdef: ResourceDef;
}

export function recognize<T, U>(
    router: Router<T, U>,
    reqPath: string,
    reqContext: any,
    checkGuard: (reqCtx: any, guard: U) => boolean
): MatchResult<T> | null {
    const cleanPath = reqPath.split('?')[0];
    for (const route of router.getRoutes()) {
        const { matched, params } = matchPath(route.resource, cleanPath);

        if (!matched) continue;

        if (route.guard && checkGuard && reqContext) {
            if (!checkGuard(reqContext, route.guard)) continue;
        }

        return {
            handler: route.handler,
            params,
            rdef: route.resource,
        };
    }
    return null;
}
```

三件事：

1. **剥离 query string**：`/users?limit=10` 的 `?limit=10` 不属于路径匹配的范围，先 `split('?')[0]` 砍掉。
2. **顺序扫 + 命中即返回**：按注册顺序逐条匹配，第一条 match 又过了 guard 的就是答案。这就是 Actix Web"先注册先生效"的语义。
3. **把 guard 抽成回调**：`checkGuard` 是外面传进来的谓词——它可能是"用户是否登录"、"是否带有某个 token"、"请求 method 是不是 GET"。`recognize` 本身不需要知道这些逻辑，它只关心"guard 通过没"。

把 `checkGuard` 抽象成函数而不是写死在 `recognize` 里，好处是 guard 们可以共享一套判定逻辑（比如所有 `["admin"]` 类型的 guard 都走同一个 `isAdmin`），而 `recognize` 不用 import 任何业务模块。

## 跑起来

把这些拼起来，可以这样用：

```typescript
type Handler = (params: Record<string, string>) => string;
type Guard = string;

const router = new Router<Handler, Guard>();

router.add("/api/users", () => "list users");
router.add("/user/{id:\\d+}", (params) => `get user ${params.id}`, "auth");
router.add("/user/{id:\\d+}/posts/{slug}", (params) => {
    return `user ${params.id} post ${params.slug}`;
});

const checkGuard = (ctx: any, guard: Guard) => ctx.roles?.includes(guard);

recognize(router, "/api/users",          null,                checkGuard);
// → { handler: list users, params: null, rdef: ... }

recognize(router, "/user/42",            { roles: ["auth"] }, checkGuard);
// → { handler: get user 42, params: { id: "42" }, rdef: ... }

recognize(router, "/user/42/posts/hello",{ roles: ["auth"] }, checkGuard);
// → { handler: user 42 post hello, params: { id: "42", slug: "hello" }, rdef: ... }

recognize(router, "/user/42?x=1",        { roles: ["auth"] }, checkGuard);
// → params: { id: "42" }，query 部分被剥掉

recognize(router, "/user/abc",          { roles: ["auth"] }, checkGuard);
// → null，`\d+` 不匹配 "abc"

recognize(router, "/user/42",            { roles: [] },       checkGuard);
// → null，guard 失败就跳过
```

整段代码跑下来不到 200 行，但 `StaticPattern` / `DynamicPattern` 分支、占位符语法、guard 回调这几个 Actix Web 的关键设计都搬过来了。

## 几个值得讲的细节

**正则 `g` 标志的 `lastIndex` 陷阱**。`paramRegex` 用了 `/g`，所以 `paramRegex.exec` 每调用一次都会从 `lastIndex` 继续。这个特性在这里帮我们省掉了手动维护扫描指针，但它也意味着这个 `RegExp` 对象**不能用并发**——如果两个请求同时 `new_resourcedef` 同一个 pattern，`lastIndex` 会被互相覆盖。所以正确做法是 `new_resourcedef` 内部每次 `new RegExp(paramRegex.source, paramRegex.flags)` 出一份新的，或者干脆用 `String.prototype.matchAll` 拿迭代器而不是反复 `exec`。抄代码时这点容易踩。

**`\\d+` 在字符串里写成 `"\\d+"` 是常规操作**。TypeScript 里的 `String.prototype.replace` 和 `new RegExp` 接收的是字符串而不是正则字面量，所以转义得自己写两层。Actix Web 用 `regex::Regex` 字符串构造也会撞到相同问题，只不过 Rust 字符串字面量已经把 `\` 转义过一次了。

**没有优先级，只有顺序**。`/user/{id}` 和 `/user/me` 同时注册，命中谁取决于谁先 `add`。这是 Actix Web 的真实行为，没做 trie 之前也没有"静态优先"的魔法；如果业务上需要 `/user/me` 抢先，必须先注册、并且写一条同样字面的精确匹配。

**`recognize` 是 `O(n)`**。每来一个请求都把注册的路由从头扫一遍，直到命中或全部失配。理解这层语义之后再谈索引，就知道索引是在不破坏“先注册先生效”的前提下，尽量缩小候选集合；它不是把路由策略直接替换掉。

:::tip[延伸阅读]
[用 Radix Tree 给 Router 做索引：一个 TypeScript 简化实现 →](/blog/actix-router-typescript/radix-router-simplified-impl)
:::

## 总结

整套设计的精髓可以压成几句话：

1. **模式先编译，再匹配**。注册时把 `"/user/{id:\d+}"` 编译成 `RegExp + names`，匹配时只剩一行 `exec`。
2. **静态与动态分类型**。没有参数的路径根本不走正则，连"未来会不会有几个参数"这种不确定性都消灭在类型层。
3. **匹配和守卫分两层**。`Router` 只存，`recognize` 才决定顺序；guard 又是回调，`recognize` 不用关心业务规则。

把 Rust 那种带生命周期、trait object、宏展开的复杂实现压到 200 行 TypeScript，关键不是省代码，而是**保留设计骨架**——哪些事该分离、哪些信息该在编译期固定下来、哪些责任该留给注册方。读原版 Actix Web 源码时容易陷在语法细节里，反倒是这种"用别的语言再抄一遍"的方式，能把骨架看得更清楚。
