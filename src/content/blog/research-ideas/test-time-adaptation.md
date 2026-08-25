---
title: "Idea 3：Test-Time Adaptation / Test-Time Training"
description: "在测试阶段利用自监督信号或已经揭示的真实值，只更新少量参数，使预测模型持续适应分布变化。"
date: 2026-08-13
order: 3
authors:
  - maokaihe
tags:
  - Time Series
  - Research Ideas
  - Test-Time Adaptation
  - Online Forecasting
---

## 先区分 Conditional Adaptation 与 TTA

在 Condition-aware Parameter Modulation 中：

$$
X\rightarrow(\gamma_X,\beta_X)\rightarrow\hat Y.
$$

不同测试样本会得到不同参数，但这个过程属于 **feed-forward conditional adaptation**。严格来说，它通常不叫 Test-Time Training，因为测试阶段没有执行梯度更新。

真正的 Test-Time Adaptation / Test-Time Training（TTA / TTT）会在测试阶段更新参数：

$$
\theta'
=\theta-
\eta\nabla_{\theta}\mathcal L_{\text{test}},
$$

然后使用更新后的模型预测：

$$
\hat Y=f_{\theta'}(X).
$$

## 只更新少量参数

对于时间序列预测，不一定要更新整个 forecasting backbone。更稳妥的做法是冻结主干，只更新少量适应参数：

$$
\theta_{\text{adapt}}
=\{\gamma,\beta,\text{Adapter},\text{Gate},\text{LoRA},\ldots\}.
$$

这样可以降低在线优化的计算成本，也能减少少量测试样本导致模型漂移的风险。

## 测试阶段的训练信号从哪里来

这个方向的核心问题是：

> **测试阶段没有当前 future ground truth，应该使用什么信号更新模型？**

### 情况一：没有未来标签

可以利用当前已观测 context 构造 masked reconstruction、backcasting 或 consistency objective：

$$
\mathcal L_{\mathrm{TTA}}
=\mathcal L_{\text{reconstruction}}
+\lambda\mathcal L_{\text{consistency}}.
$$

这类方法不需要等待真实未来出现，但需要确认辅助目标的改善确实能够迁移到 forecasting objective。

### 情况二：在线 Forecasting

过去预测的 future 会随着时间推进逐渐成为已知值，因此可以利用 matured / revealed targets：

$$
\mathcal L_{\mathrm{TTA}}
=\mathcal L\left(
\hat Y_{\text{old}},
Y_{\text{old}}
\right).
$$

这种信号与最终预测目标更加一致，但必须严格定义哪些 ground truth 在当前时间点已经可用，避免发生未来信息泄漏。

## 与已有工作的关系

| 工作 | 与这个 Idea 的关系 |
| --- | --- |
| **Test-Time Training（ICML 2020）** | TTT 的经典工作：把无标签测试样本构造成 self-supervised task，在预测之前通过 self-supervised loss 更新模型。 |
| **SAF — Self-Adaptive Forecasting** | 时间序列中直接相关的 TTT 工作。它使用 backcasting：mask 当前已经观察到的历史数据，再恢复这些数据，以 self-supervised loss 在预测前适应模型。 |
| **TAFAS** | 面向时间序列预测的 TTA，通过 partially observed ground truth 和 Gated Calibration Module 在线适应 forecasting model。 |
| **PETSA** | 参数高效 TTA，只更新 forecasting backbone 前后的轻量 calibration modules，而不更新完整模型。 |
| **COSA** | 冻结 source forecaster，只使用轻量 output-space adapter 对预测结果进行 context-aware correction。 |
| **FAC** | 重新讨论时间序列 TTA 的 evaluation / adaptation protocol，只利用已经完全成熟的历史 ground truth，并提出 Frequency-Aware Calibration，只更新轻量频域 correction module。 |

## 与 Condition-aware Modulation 结合

Condition Network 可以先根据当前工况产生适应参数的初始化：

$$
X
\xrightarrow{\text{Condition Encoder}}
\theta_X^{(0)}
\xrightarrow{\text{Test-Time Optimization}}
\theta_X^*.
$$

这相当于把 feed-forward adaptation 和 gradient-based adaptation 串联起来：前者快速给出适合当前 condition 的参数起点，后者再使用当前测试信号做少量修正。

## 需要回答的问题

1. 哪一种无标签辅助任务与 forecasting performance 最一致？
2. 哪些参数适合在线更新，更新几步才不会导致模型漂移？
3. 使用 revealed targets 时，怎样设计严格且无信息泄漏的评估协议？
4. 什么情况下应该触发适应，什么情况下应该保留原模型？
5. Condition Encoder 能否进一步预测更新强度、学习率或需要更新的参数子集？
