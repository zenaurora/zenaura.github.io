---
title: "条件白化生成模型与概率时间序列预测"
description: "梳理 CW-Gen 中 JMCE 的均值、协方差估计方式，以及 conditional whitening 之前的训练流程与损失函数。"
date: 2026-08-12
authors:
  - maokaihe
tags:
  - Time Series
  - Diffusion Model
  - Probabilistic Forecasting
  - Paper Notes
draft: true
---

现在时间序列存在的问题：

1. Non-stationarity：不平稳
2. Heteroscedasticity：不同时间段的波动大小不同
3. Inter-variable dependency：多个变量之间可能存在相关性
4. Distribution shift：分布会随着不同的工况、环境发生变动


尽管基于局部均值和方差的统计归一化方法被广泛采用，但其存在固有局限性。首先，时间序列常包含噪声和缺失值，使得此类统计量不可靠。其次，这些统计量是在有限上下文中计算的：RevIN 依赖全长度历史，而 SAN 使用补丁级特征，但两者均无法保证与未来样本的实际分布对齐。此外，仅依赖高斯假设（均值和方差）可能无法捕捉更全面的分布特征。为克服这些局限性，我们主张利用全局性、非统计信息。APT 采用时间戳作为外部先验以缓解局部误差。时间戳易于获取，且与现实世界的时间语义强相关，例如高峰时段的交通拥堵、夜间的高电视收视率，或周末购物中心人流的增加。因此，它们隐式编码了统计归一化单独无法捕捉的全局信息。

---

论文：*Conditionally Whitened Generative Models for Probabilistic Time Series Forecasting*

我既然已经能根据历史 $C$ 估计出未来的大致均值和协方差，为什么不用一个更接近真实未来分布的高斯作为生成模型的先验？

之前扩散模型的问题就是：标准 DDPM 最后都会把数据逐渐加噪到

$$
X_1 \approx \mathcal N(0, I),
$$

然后在推理时令

$$
X_1 \sim \mathcal N(0, I),
$$

从这个标准正态开始反向去噪。

TMDM / CARD 的思路是只预测条件均值。

NsDiff 进一步预测均值和方差，但它使用的是**对角协方差矩阵**：

$$
\Sigma = \operatorname{diag}(\sigma_1^2, \sigma_2^2, \ldots, \sigma_d^2).
$$

也就是说，它**没有表示变量之间的相关关系**。

CW-Gen 则进一步预测完整的协方差矩阵。

---

这里有一个关键点需要修正：**JMCE 并不是“直接输出协方差矩阵”**。论文写的是

$$
\hat\mu_{X\mid C},\hat L_{1\mid C},\ldots,\hat L_{T_f\mid C}
= \operatorname{JMCE}(C).
$$

然后再计算

$$
\boxed{
\hat\Sigma_{X_0,t\mid C}
= \hat L_{t\mid C}\hat L_{t\mid C}^{\top}
}.
$$

其中 $L_t$ 是下三角矩阵。因此准确地说，**网络直接预测的是未来序列 $\hat\mu$ 和每个未来时刻的下三角矩阵 $L_t$，预测协方差 $\hat\Sigma_t$ 是由 $L_tL_t^\top$ 算出来的。**这样做是为了保证得到的协方差矩阵是半正定的。JMCE 本身用的是一个 **non-autoregressive model**，论文实际实现选择 **Non-stationary Transformer** 作为 backbone；论文没有进一步规定最后具体是几个 Linear head，所以这里不能再往下脑补。

JMCE 在整个架构中的位置是：

```text
历史 C ─────────────► JMCE
                       │
              ┌────────┴────────┐
              ▼                 ▼
        μ_hat ∈ R^{d×Tf}   L_1,...,L_Tf
                              │
                              ▼
                        Σ_hat_t=L_tL_tᵀ
              └────────┬────────┘
                       ▼
              Conditional Whitening
                       ▼
              Diffusion / Flow Model
```

所以 **JMCE 是生成模型之前的一个先验估计模块**。论文默认训练方式也是先独立训练 JMCE，再用训练好的 JMCE 给每个样本产生 $(\hat\mu,\hat\Sigma)$，然后才训练 CW-Diff/CW-Flow。

你说“来一批训练样本，用滑动窗口切片”，这里最好区分两个 window。普通 forecasting 的一个训练样本是

$$
(C,X_0),
$$

其中

$$
C\in\mathbb R^{d\times T_h}
$$

是历史序列，

$$
X_0\in\mathbb R^{d\times T_f}
$$

是紧接着的真实未来序列。论文主实验里通常 $T_h=168,T_f=192$。然后**另外**在真实未来 $X_0$ 上计算 sliding-window covariance，得到

$$
\tilde\Sigma_{X_0,1},
\tilde\Sigma_{X_0,2},
\dots,
\tilde\Sigma_{X_0,T_f}.
$$

这些 $\tilde\Sigma_t$ 才是协方差分支的监督真值。论文明确写 Algorithm 1 第一步是 “Calculate sliding-window covariances of $X_0$”；它没有在正文里给出窗口边界处的具体计算公式，所以不能进一步声称它具体怎么 padding。

最容易误解的是 $\hat\mu$ 的监督目标。**它不是拿某个窗口算出来的均值作为标签。它的标签就是完整的真实未来序列 $X_0$。**论文的损失直接写成

$$
\boxed{
\mathcal L_2
= \mathbb E_{(X_0,C)}
\left\lVert
X_0-\hat\mu_{X\mid C}
\right\rVert_2^2
}.
$$

也就是说 JMCE 根据历史 $C$ 输出一条 $d\times T_f$ 的未来序列 $\hat\mu$，然后直接和真实未来 $X_0$ 做平方误差。之所以把它称作 **conditional mean estimator**，是因为在平方误差意义下，最优回归函数对应

$$
\mathbb E[X_0\mid C].
$$

但在一个具体训练样本上，并不存在一个额外计算出来的“真实 conditional mean”；**监督标签就是 $X_0$ 本身。**

协方差分支则不同。它的监督标签确实是**从真实未来 $X_0$ 计算出来的**：

$$
\tilde\Sigma_{X_0,t}.
$$

网络预测：

$$
\hat L_t
\quad\Rightarrow\quad
\hat\Sigma_t=\hat L_t\hat L_t^\top.
$$

然后比较

$$
\tilde\Sigma_t
\quad\text{和}\quad
\hat\Sigma_t.
$$

论文对 JMCE 的完整损失是：

$$
\boxed{
\mathcal L_{\mathrm{JMCE}}
= \mathcal L_2
+ \mathcal L_{\mathrm{SVD}}
+ \lambda_{\min}\sqrt{dT_f}\,\mathcal L_F
+ w_{\mathrm{Eigen}}
\sum_{t=1}^{T_f}
R_{\lambda_{\min}}(\hat\Sigma_t)
}.
$$

其中

$$
\mathcal L_2
= \mathbb E
\left\lVert
X_0-\hat\mu_{X\mid C}
\right\rVert_2^2
$$

负责 **conditional mean / future sequence estimation**；

$$
\boxed{
\mathcal L_F
= \mathbb E
\sum_{t=1}^{T_f}
\left\lVert
\tilde\Sigma_{X_0,t}
- \hat\Sigma_{X_0,t\mid C}
\right\rVert_F
}.
$$

是 Frobenius norm，约束预测协方差和真实 sliding-window covariance 的整体矩阵误差；

$$
\boxed{
\mathcal L_{\mathrm{SVD}}
= \mathbb E
\sum_{t=1}^{T_f}
\left\lVert
\tilde\Sigma_{X_0,t}
- \hat\Sigma_{X_0,t\mid C}
\right\rVert_*
}.
$$

这里 $\lVert\cdot\rVert_*$ 是 nuclear norm，即矩阵奇异值之和。它不是另一个随意加的 MSE，而是来自论文 Theorem 1 中对 covariance estimation error 的理论约束。

最后一项是特征值正则：

$$
\boxed{
R_{\lambda_{\min}}(\hat\Sigma_t)
= \sum_{i=1}^{d}
\operatorname{ReLU}
\left(
\lambda_{\min}
- \hat\lambda_{t,i}
\right)
}.
$$

其中 $\hat\lambda_{t,i}$ 是预测协方差 $\hat\Sigma_t$ 的特征值。如果某个特征值小于预设的 $\lambda_{\min}$，就进行惩罚。这是为了避免 $\hat\Sigma_t$ 接近奇异矩阵，因为后面的 conditional whitening 会使用它的逆或逆平方根；太小的特征值会导致数值不稳定。论文主实验设置 $\lambda_{\min}=0.1,\;w_{\mathrm{Eigen}}=50$。

 JMCE 一次训练迭代的流程：

```text
训练样本：(C, X0)
          │
          ├── 从真实 X0 计算：
          │      Σ̃1,...,Σ̃Tf        ← covariance GT
          │
          ▼
      JMCE(C)
          │
          ├── μ_hat                 ← 网络直接输出
          │
          └── L_hat1,...,L_hatTf   ← 网络直接输出
                      │
                      ▼
                 Σ_hat_t=L_tL_tᵀ
                      │
        ┌─────────────┴──────────────┐
        │                            │
μ_hat vs X0                 Σ_hat_t vs Σ̃_t
        │                            │
        ▼                            ▼
       L2                    LF + LSVD
                                     │
                            eigenvalue penalty
        └─────────────┬──────────────┘
                      ▼
                   L_JMCE
                      ▼
                   backward
```


> **对于一个训练样本 $(C,X_0)$，JMCE 只输入历史 $C$，同时预测完整未来条件均值序列 $\hat\mu_{X\mid C}$ 和未来每个时刻的下三角矩阵 $L_t$。$\hat\mu$ 直接以真实未来 $X_0$ 为监督；协方差监督 $\tilde\Sigma_t$ 则由真实未来 $X_0$ 通过 sliding-window covariance 计算得到。网络不直接输出 $\hat\Sigma_t$，而是输出 $L_t$，再通过 $\hat\Sigma_t=L_tL_t^\top$ 构造预测协方差。**
