---
title: "LLM 中的 Embedding"
description: "从早期词向量讲到大语言模型中的 token embedding，以及输入输出权重共享的作用。"
date: 2026-08-27
order: 1
authors:
  - maokaihe
tags:
  - LLM
  - NLP
  - Embedding
draft: true
---

Word Embedding 是NLP里面常用的技术，把word映射到高维空间之后，然后训练让语义相近的word接近

早期有One-Hot，Co-Matrix，还有Wrod2Vec，FastText。但是对于LLM来说，使用的是一个tokenid -> vec的映射，在Transformer论文里面，input之后接一个input embedding，然后embedding之后在进行位置编码。

在代码里面里面就是nn.Embedding.

在早期GPT2时代，会使用一个叫Tied Embedding的方法，重用输入端embedding，因为当时模型参数比较小，但是词表大导致embedding大，显存用的太多
