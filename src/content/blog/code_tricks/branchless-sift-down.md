---
title: "无分支的堆下沉 sift-down"
description: "把二叉堆 sift-down 里选孩子的不可预测分支换成一次加法"
date: 2026-07-22
order: 1
authors:
  - maokaihe
tags:
  - branchless
  - heap
  - performance
---

二叉堆的核心操作就一个：sift-down（下沉）——把一个节点顺着树往下挪到它该待的位置。堆排序、top-k、k 路归并全靠它，是个实打实的热循环。

分享一个小技巧：sift-down 里“选哪个孩子往下走”会引入一个分支预测器很难猜准的分支，用一点小算术就能把它干掉。（代码里的 `less(a, b)` 就是比较函数，a 该排在 b 前面就返回 true。）

## 之前：一个猜不准的分支

sift-down 每往下一层，都要先在两个孩子里选出更小的那个（min-heap），再拿它和父节点比。朴素写法长这样：

```typescript title="naive.ts" {7-10}
function siftDown<T>(heap: T[], pos: number, less: (a: T, b: T) => boolean): void {
  const n = heap.length;
  while (true) {
    let child = 2 * pos + 1; // 左孩子
    if (child >= n) return;  // 没有孩子了

    // 在左右孩子里选更小的：这一步基本是 50/50，预测器猜不准
    if (child + 1 < n && less(heap[child + 1], heap[child])) {
      child += 1;
    }

    if (!less(heap[child], heap[pos])) return; // 已满足堆性质
    [heap[pos], heap[child]] = [heap[child], heap[pos]];
    pos = child;
  }
}
```

问题就在高亮那几行：“左右哪个孩子更小”这个比较结果几乎是随机的，分支预测器命中率接近一半。而 sift-down 是排序 / 归并里的热循环，每一次 mispredict 都要清空流水线，白白搭上十几个周期。

## 现在：把分支换成一次加法

改进的写法靠两点把这个分支干掉：

1. **把“右孩子存在”变成循环不变量**：循环条件写成 `child + 1 < n`，这样循环体里两个孩子一定都在，不用再判断“有没有右孩子”。
2. **用算术选孩子**：`child += less(右, 左) ? 1 : 0`。右孩子更小就 +1 走到右边，否则 +0 留在左边。一次加法代替一次跳转。

```typescript title="branchless.ts" {6-8}
function siftDown<T>(heap: T[], pos: number, less: (a: T, b: T) => boolean): void {
  const n = heap.length;
  let child = 2 * pos + 1;

  // 不变量：右孩子一定存在，循环体里不再判断“有没有右孩子”
  while (child + 1 < n) {
    // 无分支选更小的孩子：右 < 左 → +1 指向右孩子，否则 +0 留在左孩子
    child += less(heap[child + 1], heap[child]) ? 1 : 0;

    if (!less(heap[child], heap[pos])) return; // 已满足堆性质
    [heap[pos], heap[child]] = [heap[child], heap[pos]];
    pos = child;
    child = 2 * pos + 1;
  }

  // 收尾：堆大小为偶数时，最后一个父节点只有左孩子，循环覆盖不到，单独补一次
  if (child + 1 === n && less(heap[child], heap[pos])) {
    [heap[pos], heap[child]] = [heap[child], heap[pos]];
  }
}
```

- 热循环里那个不可预测的分支没了，换成一次加法，CPU 不用赌方向。
- 代价只是循环外多补一个“独生子”分支 —— 它整趟 sift-down 最多执行一次，而且方向固定，完全可预测。
- 比较函数只是个普通参数 `less`，谁用谁传——要 min 要 max、按哪个字段排都行，编译器也容易把它内联进去。
