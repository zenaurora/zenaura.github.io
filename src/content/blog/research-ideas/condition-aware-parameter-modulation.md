---
title: "Idea 1：Condition-aware Parameter Modulation"
description: "根据当前输入窗口生成少量动态参数，让固定的预测主干随工况改变内部计算行为。"
date: 2026-08-13
order: 1
authors:
  - maokaihe
tags:
  - Time Series
  - Research Ideas
  - Parameter Modulation
  - Hypernetwork
protected: true
---

## 核心思想

从当前多变量历史窗口

$$
X\in\mathbb R^{D\times T}
$$

中提取当前状态：

$$
z=g_{\phi}(X),
$$

再由 Condition Encoder / Parameter Generator 根据 $z$ 生成少量动态参数：

$$
\theta_X=h_{\psi}(z).
$$

这些参数不替代 forecasting backbone，而是用来调制固定的主干模型：

$$
\hat Y=f_{\Theta}(X;\theta_X).
$$

这里的 $\Theta$ 是跨样本共享的主干参数，$\theta_X$ 则随当前输入窗口变化。

## 可以动态生成什么

Parameter Generator 可以生成：

- normalization 的 $\gamma$ 和 $\beta$；
- hidden feature 的 scale / bias；
- residual gate；
- Adapter 参数；
- LoRA scaling；
- 不同 forecasting expert 的 routing weight。

为了控制复杂度，可以先从轻量调制开始。例如，对中间特征做仿射变换：

$$
H'=\gamma(X)\odot H+\beta(X),
$$

或者动态控制 Adapter 的贡献：

$$
H'=H+\alpha(X)\operatorname{Adapter}(H).
$$

这两种方式都不需要为每个样本生成完整的主干网络参数。

## 与已有工作的关系

| 工作                                             | 与这个 Idea 的关系                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **CW-Gen / JMCE**                              | 根据当前历史 $C$ 预测未来条件均值 $\hat\mu(C)$ 和协方差 $\hat\Sigma(C)$，再据此改变后续生成模型所处理的数据分布。核心同样是 context → adaptive parameters / statistics。               |
| **Dish-TS**                                    | 使用 CONET 将输入序列映射为可学习的 distribution coefficients，并分别建模 input / output distribution，是“根据当前 instance 动态预测统计参数”的直接相关工作。                       |
| **SAN**                                        | 在局部 temporal slice 上进行 adaptive normalization，并使用轻量网络预测不断变化的统计属性。                                                                         |
| **Non-stationary Transformer**                 | 从原始非平稳输入中提取 de-stationary information，再动态修正 Transformer attention，属于“根据当前序列产生调制信息”的相邻思路。                                                  |
| **External Data-Enhanced Meta-Representation** | 使用 hypernetwork 根据 contextual signal 动态调制 base network 的少量参数，与 condition → parameter generator → backbone 的结构非常接近，不过主要使用外部信息作为 condition。 |

## 可能的研究区别

已有 normalization 方法更多是在预测

$$
\mu,\sigma
$$

等数据分布参数。这个 Idea 希望进一步研究：

$$
\boxed{
X
\rightarrow z_{\text{condition}}
\rightarrow \text{model parameters}
\rightarrow \text{Forecast Backbone}
}.
$$

换句话说，condition 不只改变输入数据的 normalization，还会**直接改变预测网络内部的计算行为**。

## 需要回答的问题

这个方向最终需要回答几个关键问题：

1. 哪一种 condition representation 能稳定描述当前工况？
2. 调制哪一层、哪一种参数，能够在表达能力和稳定性之间取得平衡？
3. 动态参数究竟带来了真正的 condition adaptation，还是只增加了模型容量？
4. 参数调制能否与动态变量交互、test-time adaptation 共享同一个 condition representation？
