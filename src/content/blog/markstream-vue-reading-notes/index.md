---
title: "markstream-vue 源码阅读笔记"
description: "想在 LLM 时代读一读 markstream-vue 的源码，看看流式 markdown 渲染在前面那段是怎么设计的。"
date: 2026-08-21
authors:
  - maokaihe
tags:
  - markstream-vue
  - Vue
  - Source Code Reading
---

7月份就想做一个markstream-vue的源码阅读，因为偶然在推上刷到了，正好现在LLM流行的时代，软件都用了类似的相关技术，于是正好想学习一下里面的设计原理，借助AI的帮助下可以让我在源码里面更好阅读。然后后来一直在做别的事情，还有学校的事情忙着，没什么时间静下心来读代码。今天是8月21号了，好不容易闲下来做点自己想学的，于是借助AI先帮我总结一下我应该从哪里开始看。

这个整个流程的大致逻辑就是：
从LLM的SSE传过来的chunk，处理得到markdown字符串，然后对string进行parsing，得到一个具体的Node，然后NodeRender把Node渲染成DOM。
然后大致里面的细节有smoothStreaming，有一个当前source（需要渲染的）和visible（实际展现的）的概念；以及统计渲染耗时，动态的调整batchsize的大小。对于一节涉及到是否闭合的markdown来说，不能拿过来就立刻渲染，需要设计延迟等待等等。
还有如何减少内存分配，减少内存中JS Object的数量，把新的东西append到已经有的Object里，减少开销。

大致流程就是这样，我跟着ai总结看的，现在我会开始看源码了，我每天看一点就会写点自己从中学到的设计思想或者单纯的代码技巧，还有我没了解过的vue的知识点。希望能在两个月写完吧，因为快要开学了，不一定又有什么乱七八糟的事情折磨人了。
