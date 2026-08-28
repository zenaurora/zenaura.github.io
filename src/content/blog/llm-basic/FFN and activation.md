
---
title: "FFN 与激活函数"
description: "整理 Transformer 前馈网络的基本结构，以及 ReLU、GeLU、Swish 和 SiLU 等激活函数。"
date: 2026-08-28
order: 4
authors:
  - maokaihe
tags:
  - LLM
  - Transformer
  - FFN
  - Activation Function
draft: true
---

标准的FFN公式：

$$
FFN(x) = ReLU(xW_1 + b_1)W_2 + b_2
$$
其他激活函数包括

### Tanh

### Sigmoid

### GeLU

曲线相比ReLU更加平滑，在负值区域有一定的保留
计算更加复杂，速度比ReLU慢
### Swish

Swish中包含了Sigmoid

$$
Sigmoid(x) = \sigma(x) = \frac{1}{1+e^{-x}}
$$

$$
Swish(x) = x \times \sigma(\beta x)
$$

如果$\beta =1$ ,$Swish(x) = \frac{x}{1+e^{-x}}$ 这个激活函数也叫SiLU


### GeLU
