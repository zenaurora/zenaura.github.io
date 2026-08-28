---
title: "LLM 基础笔记"
description: "从 BBPE、WordPiece 和 Unigram 等分词方法开始，整理理解大语言模型所需的基础概念。"
date: 2026-08-27
authors:
  - maokaihe
tags:
  - LLM
  - NLP
  - Tokenization
draft: true
---

## BBPE

byte-level BPE

BPE是字符级别的，BBPE是字节级别的，通过UTF-8编码编码这个字符，理论上可以表示世界上所有的字符

流程和BPE类似：

1. 构建初始词表
2. 计算频率，计算所有的子词对在文本中出现的概率
3. 合并频率最高的子词对
4. 重复2和3直到达到预定的词汇表大小，或者其他规则

理论上任何 UTF-8 文本都能表示，不需要 `[UNK]`，即使有一个很奇怪的字符进来了，也可以进行表示

## WordPiece

Bert使用的，感觉现在没人用了吧？

思想和BPE类似，只是不再只看出现次数了，它使用了PMI来计算一个类似互信息分数：

$$
PMI(A,B) = \frac{freq(AB)}{freq(A)freq(B)}
$$
然后根据这个来选择合并

## UniGram
