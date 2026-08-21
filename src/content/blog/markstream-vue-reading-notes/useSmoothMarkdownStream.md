---
title: "useSmoothMarkdownStream 控制器结构解析"
description: "SmoothMarkdownStreamController 返回值字段拆解:source / visible / done / caughtUp / pendingChars 各驱动哪段渲染逻辑。"
date: 2026-08-21
order: 1
authors:
  - maokaihe
tags:
  - markstream-vue
  - Vue
  - Source Code Reading
draft: true
---

先看useSmoothMarkdownStream hook的返回值的结构体：

```typescript
export interface SmoothMarkdownStreamControllerVue {

/** 上游 enqueue() 累计的全部 markdown 文本(可能比 visible 长很多) */

source: Ref<string>

/** 已揭示的字符串 —— 下游 parse / render 真正吃这个 */

visible: Ref<string>

/** 上游是否调用过 finish();注意 done=true 并不等于"完成",还要等 visible 追上 */

done: Ref<boolean>

/** 派生:真正的"流已结束" = done && caughtUp */

final: ComputedRef<boolean>

/** 派生:visible 已追平 source,即 pendingChars === 0 */

caughtUp: ComputedRef<boolean>

/** 派生:source.length - visible.length,积压字符数;驱动 pacing 自适应 */

pendingChars: ComputedRef<number>

/** 推入一段新文本,触发围栏扫描 + RAF 主循环 */

enqueue: (chunk: string) => void

/** 标记流结束;传 flush:true 立即全吐,否则让 RAF 自然追上 */

finish: (options?: { flush?: boolean }) => void

/** 强制把 visible 拉到 source 末尾(忽略 pacing),用于"跳到结尾"按钮 */

flush: () => void

/** 重置整个控制器;若新字符串以旧 source 为前缀则增量追加,否则完全替换 */

reset: (initialMarkdown?: string) => void

/** 暂停 —— 停掉 RAF,不再 reveal 字符 */

pause: () => void

/** 恢复 —— 重走 startDelay 重新启动 RAF */

resume: () => void

}
```

source 就是上游的给的信息，是需要渲染的数据，但是因为需要做一个smooth的平滑，不能一下子全都渲染完，控制每一帧渲染的数量。
上游传过来done了不代表结束，而是必须等待visible的部分=source的长度之后才结束（即caughtup）
