---
title: "Research Ideas：面向非平稳多变量时间序列的动态预测"
description: "围绕条件参数调制、动态变量分组与测试时自适应，探索能够随当前工况改变预测行为的多变量时间序列模型。"
date: 2026-08-13
authors:
  - maokaihe
tags:
  - Time Series
  - Research Ideas
  - Non-stationarity
  - Multivariate Forecasting
protected: true
---

## 总体动机

现有多变量时间序列预测主要面临两个问题：

1. **时间非平稳性**：训练阶段学到的固定模型，难以持续适应测试阶段不断变化的工况和数据分布。
2. **变量依赖的双刃剑问题**：Channel-Independent（CI）建模更加鲁棒，但会忽略变量间的有用信息；Channel-Dependent（CD）建模能够利用跨变量信息，却容易引入无关变量和噪声。

这个系列的核心目标是：

> **让预测模型根据当前输入窗口的 condition，动态决定“模型应该如何预测”以及“哪些变量之间应该交互”；如果仍然无法适应当前分布，再在 test time 对少量参数进行在线调整。**

## 三个研究方向

| Idea | 核心问题 | 主要机制 |
| --- | --- | --- |
| Condition-aware Parameter Modulation | 当前状态下，模型应该怎么预测？ | 根据输入窗口生成少量动态参数，调制固定的 forecasting backbone |
| Condition-aware Dynamic Variable Grouping | 当前状态下，模型应该看哪些变量？ | 预测未来变量关系，动态决定变量分组或 interaction mask |
| Test-Time Adaptation / Training | 训练时学到的动态规则仍然不够时，如何继续适应？ | 使用自监督信号或已经揭示的标签，只更新少量适应参数 |

三个方向并不是互斥的。它们可以共享同一个 Condition / Relation Encoder：

```text
                  Multivariate Context X
                           │
                           ▼
              Condition / Relation Encoder
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        Condition State z       Relation Matrix R
                │                     │
                ▼                     ▼
       γ / β / Adapter           Dynamic Groups
                │                     │
                └──────────┬──────────┘
                           ▼
                     CI Backbone
                           │
                           ▼
                          Ŷ
```

它们分别解决三个层面的问题：

$$
\begin{aligned}
\text{Idea 1: }& X \rightarrow z \rightarrow \text{动态调制参数}, \\
\text{Idea 2: }& X \rightarrow R \rightarrow \text{动态变量交互}, \\
\text{Idea 3: }& X \rightarrow \mathcal L_{\mathrm{TTA}}
\rightarrow \nabla \rightarrow \theta_{\mathrm{adapt}}'.
\end{aligned}
$$

## 可能的统一主线

一个更完整的方案是把条件建模和测试时自适应结合起来：

$$
X
\xrightarrow{\text{Condition Encoder}}
\theta_X^{(0)}
\xrightarrow{\text{Test-Time Optimization}}
\theta_X^*.
$$

Condition Network 首先根据当前工况直接产生一组较好的 adaptation parameters，然后只对这组少量参数进行一步或数步 test-time optimization。

因此，整体研究主线可以概括为：

$$
\boxed{
\text{Static CI Forecasting}
\rightarrow
\text{Condition-aware Forecasting}
\rightarrow
\text{Selective Channel Interaction}
\rightarrow
\text{Test-Time Adaptive Forecasting}
}.
$$

从现有工作密度看，Idea 2 的 channel grouping 已经有 CCM、DGCformer、DUET 等直接相关工作；Idea 3 的 TTA 也已经形成 TAFAS、PETSA、COSA、FAC 等路线。相对而言，更值得继续挖掘的是 **Idea 1 与 Idea 2 / Idea 3 的结合**：让统一的 condition representation 同时决定模型参数、变量关系，以及 test-time adaptation 的初始化或强度。

这是基于当前文献脉络得到的研究方向判断，而不是已有论文已经给出的结论。后续的三篇子博客会分别展开这三个 Idea。
