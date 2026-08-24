---
title: "RLHF 与 RLVR：偏好奖励和可验证奖励"
description: "比较 RLHF 与 RLVR 的奖励来源、训练成本及验证器设计中的风险。"
date: 2026-08-23
authors:
  - maokaihe
tags:
  - LLM
  - RLHF
  - RLVR
  - Reinforcement Learning
---

RLHF 和 RLVR 都是**大模型后训练（post-training）里用强化学习优化模型行为的方法**，区别主要在于

RLHF的奖励主要是人类的一种偏好
RLVR的奖励来自于答案的验证

早期的主流是RLHF，后来逐渐变成了RLVR ——基于可验证奖励的强化学习（Reinforcement Learning with Verifiable Rewards）

RLHF存在的问题就是很多东西不是一种可以验证是否正确的东西，需要依赖人的偏好和观点来决定奖励；但是对于数学，代码和逻辑推理的部分，其实是有一个答案可以验证的，所以在这个领域LLM进步很快。基于RLVR的方式可以实现更低成本的，更加快速的模型训练方式。

一般来说，RLHF需要额外训练一个Reward Model，这个model学习了人类的偏好数据；而RLVR往往可以使用一个单纯的Verifier给出对错这样的奖励。

但是Verifier设计很重要，如果设计的有漏洞，给了模型可以钻空子的机会，就会导致reward曲线很好，但是实际效果不行的问题。因此如果reward高但是人工评估差的样本需要进行人工审查

RL在训练的时候存在模型输出多样性变差的情况，这时候需要及时干预。

对于reasoning数据，需要审查是否存在过程是不对的，但是结果是对的情况，用prm打分可以帮助发现这种数据。（PRM（Process Reward Model）是在生成过程中，分步骤对每一步进行打分的更细粒度奖励模型）
