---
title: "文章与论文分享（一）"
description: "先分享 Niko Matsakis 与 withoutboats 的博客：两位作者都长期讨论 Rust 语言设计。"
date: 2026-08-05
authors:
  - maokaihe
tags:
  - Rust
  - Programming Languages
  - Reading
---

这个系列会陆续收录值得阅读的技术文章、博客与论文。第一篇先放两个 Rust 相关博客：Niko Matsakis 的 [baby steps](https://smallcultfollowing.com/babysteps/blog/) 与 withoutboats 的 [博客](https://without.boats/blog/)。

## Niko Matsakis

Niko Matsakis 长期参与 Rust 的语言设计。他把博客取名为 *baby steps*，用来记录还在推演中的想法和设计笔记。文章经常从一个具体的使用痛点出发，逐步讨论类型系统、借用检查、所有权、语言演进与向后兼容之间的取舍。

近年的内容主要包括：

- 借用检查、别名与所有权模型；
- `view types`、引用计数等 Rust 语言演进提案；
- 用实验性语言 Dada 讨论权限、共享、内部引用等设计；
- Rust 生态与开发工具，例如 crate、agent 工作流和 Symposium。

很多文章是提案或思考过程，不代表语言已经确定会这样演进；它们很适合用来理解 Rust 的设计背景。

## withoutboats

[withoutboats](https://without.boats/blog/) 同样长期撰写 Rust 与编程语言设计相关的文章。博客常从一个看似局部的技术问题切入，例如 `Pin`、生成器、引用或异步清理，然后追溯到语言模型和接口设计本身。

主要关注的主题有：

- Rust 所有权与引用的概念模型；
- async Rust、协程、生成器与异步清理；
- `Pin`、自引用值和固定引用的易用性；
- effect system、迭代器等更广泛的编程语言设计问题。

如果正在学习 async Rust 或尝试理解 `Pin`，这个博客是很好的延伸阅读。文章里的提案也仍在讨论中，适合重点关注它们在解决什么问题、又引入了什么取舍。
