---
title: 用 Radix Tree 给 Router 做索引：一个 TypeScript 简化实现
description: 从一棵压缩前缀树出发，实现路由的注册、分裂与精确查找，并看看它和顺序扫描 Router 的边界。
date: 2026-08-18
order: 2
authors:
  - maokaihe
---

上一篇里，`recognize` 每次请求都会按注册顺序遍历所有路由。这个方案非常直白，也保留了 Actix Web 的“先注册先生效”语义；但路由越来越多时，匹配成本自然会变成 `O(n)`。

这一篇换一个角度：先不处理 `{id}`、guard、method，也不试图复刻完整框架，只给**纯字符串路径的精确匹配**做一个 Radix Tree（压缩前缀树）索引。实现不长，但“插入时如何拆节点”很值得亲手写一遍。

:::note[边界]
下面的 `Router` 只支持完整字符串匹配：`/users/42` 与 `/users/{id}` 是两个普通字符串，不会解析参数。动态段、优先级、HTTP method 等属于下一层路由策略，而不是这棵树本身。
:::

## 为什么不是普通 Trie

普通 Trie 一条边只放一个字符。注册 `/apple`、`/apply` 时，树会变成 `a → p → p → l`，然后才分叉到 `e` 与 `y`。当 key 是 URL 这类长字符串时，单字符节点很多，而且绝大多数都只有一个孩子。

Radix Tree 把这段“只有一个孩子”的路径压缩到一条边里：

```text
普通 Trie
root → a → p → p → l → e *
                      └→ y *

Radix Tree
root → appl
          ├→ e *
          └→ y *
```

因此节点保存的不是单个字符，而是一段 `prefix`。查询时仍然从根向下走；区别只在于每一步会消费一整段公共前缀。

## 节点与 Router

先把节点定义得足够小：一段压缩前缀、子节点、终点标记和可选 handler。

```typescript
interface RadixNode<T> {
    prefix: string;
    children: RadixNode<T>[];
    isEnd: boolean;
    handler?: T;
}

class Router<T> {
    private root: RadixNode<T>;

    constructor() {
        this.root = {
            prefix: "",
            children: [],
            isEnd: false,
        };
    }
}
```

`root` 不代表任何路径，所以它的 `prefix` 固定为空。`isEnd` 与 `children` 必须分开：`/user` 注册后又注册 `/user/profile`，`user` 既是一个完整路由，也仍然有孩子。

`handler?: T` 也正好表达这个关系：非终点没有 handler；终点有 handler。严格来说，调用方不应该向 `add` 传 `undefined` 作为 handler，否则 `find` 无法区分“路由不存在”和“注册的值就是 `undefined`”。实际项目里可改用 `Map` 或专门的 sentinel 来消除这个歧义。

## 核心工具：公共前缀长度

插入时不需要直接比较所有情况；先算出当前边与待插入字符串共享了多少字符即可。

```typescript
// Length of the shared prefix between two strings
private commonPrefixLength(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    let i = 0;
    while (i < len && a[i] === b[i]) {
        i++;
    }
    return i;
}
```

例如 `apple` 与 `apply` 的结果是 `4`，`apple` 与 `app` 的结果是 `3`，`apple` 与 `banana` 则是 `0`。这一个数字足以把插入分成五种情形。

## 插入：五种情形

公开的 `add` 只从根开始，真正的工作交给递归 `insert`：

```typescript
public add(pattern: string, handler: T): void {
    this.insert(this.root, pattern, handler);
}
```

对父节点的每个孩子，比较 `child.prefix` 和新 `pattern` 的公共前缀长度。根据两者的关系，插入可以分成下列五种情形。

| 关系           | 例子                | 要做的事                          |
| ------------ | ----------------- | ----------------------------- |
| 完全相同         | `app` / `app`     | 覆盖该节点的 handler                |
| 旧边是新 key 的前缀 | `app` / `apple`   | 把 `le` 继续插入 `app` 的孩子         |
| 新 key 是旧边的前缀 | `apple` / `app`   | 将旧节点缩为 `app`，旧后缀 `le` 成为孩子    |
| 只部分重合        | `apple` / `apply` | 提取共同部分 `appl`，分出 `e`、`y` 两个孩子 |
| 没有公共前缀        | `apple` / `banana` | 继续检查兄弟；均不匹配时追加一条新边       |

没有任何公共前缀时，继续检查下一个兄弟；所有兄弟都不匹配，直接追加一条新边即可。

完整实现如下：

```typescript
interface RadixNode<T> {
    prefix: string;
    children: RadixNode<T>[];
    isEnd: boolean;
    handler?: T;
}

class Router<T> {
    private root: RadixNode<T>;

    constructor() {
        this.root = {
            prefix: "",
            children: [],
            isEnd: false,
        };
    }

    // Length of the shared prefix between two strings
    private commonPrefixLength(a: string, b: string): number {
        const len = Math.min(a.length, b.length);
        let i = 0;
        while (i < len && a[i] === b[i]) {
            i++;
        }
        return i;
    }

    public add(pattern: string, handler: T): void {
        this.insert(this.root, pattern, handler);
    }

    private insert(parent: RadixNode<T>, pattern: string, handler: T): void {
        for (let i = 0; i < parent.children.length; i++) {
            const child = parent.children[i];
            const commonLength = this.commonPrefixLength(child.prefix, pattern);

            // No shared prefix: check the next sibling
            if (commonLength === 0) continue;

            // Exact match: same prefix; attach handler to this child
            if (commonLength === child.prefix.length && commonLength === pattern.length) {
                child.isEnd = true;
                child.handler = handler;
                return;
            }

            // Child's prefix fully covers the new pattern: recurse with the remainder
            if (commonLength === child.prefix.length) {
                this.insert(child, pattern.slice(commonLength), handler);
                return;
            }

            // New pattern fully covers the child: shrink child to the leftover suffix
            // child: apple, pattern: app
            if (commonLength === pattern.length) {
                const oldChild: RadixNode<T> = {
                    prefix: child.prefix.slice(commonLength),
                    children: child.children,
                    isEnd: child.isEnd,
                    handler: child.handler,
                };
                child.prefix = pattern;
                child.children = [oldChild];
                child.isEnd = true;
                child.handler = handler;
                return;
            }

            // Partial overlap: split at the shared prefix into two children
            const oldChild: RadixNode<T> = {
                prefix: child.prefix.slice(commonLength),
                children: child.children,
                isEnd: child.isEnd,
                handler: child.handler,
            };
            const newChild: RadixNode<T> = {
                prefix: pattern.slice(commonLength),
                children: [],
                isEnd: true,
                handler,
            };
            child.prefix = pattern.slice(0, commonLength);
            child.children = [oldChild, newChild];
            child.isEnd = false;
            child.handler = undefined;
            return;
        }

        // No matching child exists: append a new sibling
        parent.children.push({
            prefix: pattern,
            children: [],
            isEnd: true,
            handler,
        });
    }

    // Exact-match lookup; returns the handler only if the path ends on a terminal node
    public find(path: string): T | undefined {
        return this.search(this.root, path);
    }

    private search(parent: RadixNode<T>, path: string): T | undefined {
        for (const child of parent.children) {
            if (!path.startsWith(child.prefix)) continue;
            const remaining = path.slice(child.prefix.length);
            if (remaining.length === 0) {
                return child.isEnd ? child.handler : undefined;
            }
            return this.search(child, remaining);
        }
        return undefined;
    }

    // Debug: print the tree; terminal nodes are marked with "*"
    public print(): void {
        this.printNode(this.root, 0);
    }

    private printNode(node: RadixNode<T>, depth: number): void {
        if (node !== this.root) {
            console.log(`${" ".repeat(depth * 2)}${node.prefix}${node.isEnd ? " *" : ""}`);
        }
        for (const child of node.children) {
            this.printNode(child, depth + 1);
        }
    }
}
```

这里最容易写错的是“分裂”时旧节点的状态转移。不能直接丢掉原来的 `children`、`isEnd` 和 `handler`，它们都属于 `oldSuffix` 那个新建的 `oldChild`。共同前缀节点只是新产生的中间节点：除非新 pattern 恰好在这里结束，否则它本身不是终点。

以依次插入 `apple`、`apply` 为例，第二次插入结束后结构是：

```text
root
└─ appl
   ├─ e *
   └─ y *
```

再插入 `app`，会触发“新 key 是旧边前缀”的分支：

```text
root
└─ app *
   └─ l
      ├─ e *
      └─ y *
```

这也是 `isEnd` 必不可少的原因：`app` 不是叶子，但它是一个合法路由。

## 查找：只在终点返回 handler

查找过程和插入相反：找到以当前 path 开头的边，消费掉这段前缀，再向下递归。路径恰好消耗完时，必须检查 `isEnd`；否则 `/app` 会把只注册过 `/apple` 的树误判为命中。

同一父节点下的边不会拥有相同的首字符：一旦发生重合，插入时已经把它们拆成共同的中间节点。因此命中第一条 `startsWith` 的边后，可以直接向下走，不必回溯检查其他兄弟。

这个版本假定注册的 `pattern` 非空。若允许 `add("")`，空前缀会让 `search` 在根节点不消耗任何字符地递归；最简单的 API 约束是拒绝空 pattern，或专门把根节点当作空路径的终点处理。

## 跑起来

可以用一组覆盖四种插入分支的 key 做最小验证：

```typescript
const router = new Router<string>();

router.add("/apple", "apple");
router.add("/apply", "apply"); // partial overlap
router.add("/app", "app"); // new pattern covers an existing edge
router.add("/app/store", "store"); // existing edge covers the new pattern
router.add("/banana", "banana"); // no shared prefix
router.add("/app", "app v2"); // exact match: overwrite handler

console.log(router.find("/app")); // "app v2"
console.log(router.find("/apple")); // "apple"
console.log(router.find("/apply")); // "apply"
console.log(router.find("/app/store")); // "store"
console.log(router.find("/ap")); // undefined
console.log(router.find("/banana")); // "banana"

router.print();
```

## 它解决了什么，没有解决什么

对于单纯的静态字符串 key，这棵树把每次请求“扫描所有路由”的工作变成了“沿路径比较若干段前缀”。在分支数较低、路径共享前缀较多的常见场景里，查找更接近路径长度，而不是注册路由总数。每一层仍然要线性扫描 `children`，所以这不是严格的 `O(|path|)`；需要时可将孩子改成按首字符索引的 `Map`。

但 Radix Tree 不是直接替换上一篇 `recognize` 的按钮。后者的核心语义是注册顺序、动态 pattern 和 guard；而树的核心是假设一条输入字符串沿某条唯一边前进。要把两者结合，需要明确冲突规则，例如静态 `/user/me` 是否优先于参数 `/user/{id}`、多个动态 pattern 谁优先、guard 失败后能否继续尝试其他候选。那些是路由器的策略层，应该建立在索引之上，而不是偷偷写进节点分裂逻辑。

## 总结

这份实现的关键不在递归本身，而在三个不变量：

1. 每条边保存一段非空的压缩前缀。
2. 同一节点的孩子不会共享首字符。
3. 节点是否是一个完整 key，由 `isEnd` 单独表示。

守住这三个条件，插入就只剩四种关系，查找也只需沿着唯一候选边向下消费路径。它是一个很好的“索引层”练习：先让数据结构只负责快速缩小候选集合，再把 pattern、优先级和 guard 留给真正的路由策略。
