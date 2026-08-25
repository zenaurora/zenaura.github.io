---
title: "Idea 2：Condition-aware Dynamic Variable Grouping"
description: "根据当前输入窗口预测未来变量关系，在组内采用 CD 建模、组间保持 CI，减少无关变量带来的噪声。"
date: 2026-08-13
order: 2
authors:
  - maokaihe
tags:
  - Time Series
  - Research Ideas
  - Channel Dependency
  - Dynamic Grouping
---

## 核心思想

不在 Channel-Independent（CI）和 Channel-Dependent（CD）之间做固定二选一，而是根据**当前输入窗口**，动态判断哪些变量之间存在值得利用的关系。

首先学习当前窗口中的变量关系：

$$
R(X)=g_{\phi}(X),
\qquad
R\in\mathbb R^{D\times D},
$$

其中 $R_{ij}$ 表示当前 condition 下变量 $i,j$ 之间的关系强度。然后根据 $R$ 得到动态分组：

$$
G_1,G_2,\ldots,G_K.
$$

整体建模原则是：

$$
\boxed{
\text{Group 内采用 Channel-Dependent 建模，Group 间保持 Channel-Independent}
}.
$$

这样可以只引入真正有用的跨变量信息，降低 irrelevant channels 带来的噪声。进一步地，关系矩阵

$$
R=R(X)
$$

应随每个输入窗口动态变化，而不是让整个数据集共享一个固定 grouping。

## 如何监督变量关系

Relation Network 可以使用真实未来窗口计算出的 correlation / covariance 作为辅助监督：

$$
\mathcal L
=\mathcal L_{\text{forecast}}
+\lambda\mathcal L_{\text{relation}}.
$$

例如：

$$
\mathcal L_{\text{relation}}
=\left\lVert R(X)-R_{\text{future}}\right\rVert_F.
$$

这里可以借鉴 JMCE 的思路：不是直接从历史窗口计算当前 correlation，而是**根据历史预测未来变量关系**。JMCE 所做的事情之一，就是预测未来的 conditional covariance。

## Hard Grouping 与 Soft Interaction Mask

除了把变量划分成离散 Group，还可以学习连续的动态交互矩阵：

$$
M(X)\in[0,1]^{D\times D}.
$$

然后用它调制跨变量 attention：

$$
\operatorname{Attention}_{ij}
\leftarrow
M_{ij}(X)\cdot\operatorname{Attention}_{ij}.
$$

这时模型不再回答“变量属于哪个组”，而是在动态决定：

> 当前工况下，变量 $i$ 应该从哪些变量获取信息？

## 与已有工作的关系

| 工作                                 | 与这个 Idea 的关系                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Channel Clustering Module（CCM）** | 与这个 Idea 最接近。它从 CI / CD trade-off 出发，根据 channel intrinsic similarity 动态进行 channel clustering，以避免 CD 混入 irrelevant channels。 |
| **DGCformer**                      | 使用 GCN + Autoencoder 对相关变量进行 graph clustering；Group 内使用 CD，不同 Group 之间使用 CI。整体思想与 Group Forecasting 高度接近。                   |
| **DUET**                           | 使用 Channel-Soft-Clustering，在频域通过 metric learning 学习 channel relationship，并进行 sparsification，以降低 noisy channels 的影响。         |
| **CrossGNN 等 channel-relation 模型** | 研究跨变量依赖以及 noisy channel interaction，但重点更多是设计 relation modeling，不一定显式进行动态 Group。                                             |

## 可能的研究区别

单纯进行 channel clustering 的创新空间已经比较有限。更值得研究的是：

$$
\boxed{
\text{当前 Condition}
\rightarrow
\text{预测未来 Variable Relation}
\rightarrow
\text{动态 Group 或 Interaction Mask}
}.
$$

也就是说，grouping 不仅要利用 channel dependency，还要做到 **sample-dependent / condition-dependent**。

## 需要回答的问题

1. 使用 hard grouping 还是 soft interaction mask？
2. 如何防止所有变量被退化地分到同一组，或 interaction mask 变得过密？
3. 未来 correlation / covariance 是否足以代表“对预测有用”的因果或互补关系？
4. Relation Encoder 能否与参数调制模块共享 condition representation？
