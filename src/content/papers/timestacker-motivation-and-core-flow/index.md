---
title: "TimeStacker：动机与核心流程梳理"
description: "从多尺度 Patch、频域 Patch Attention、时域聚合与 Channel Independence 出发，梳理 TimeStacker 的设计动机、模型结构与完整数据流。"
date: 2026-08-13
authors:
  - maokaihe
tags:
  - Time Series
  - Frequency Domain
  - Forecasting
  - Paper Notes
---

## 1. 任务定义

给定历史多变量时间序列：

$$
X_{t-T+1:t}\in\mathbb{R}^{D\times T}
$$

其中：

- $D$：变量数量；
- $T$：历史输入长度。

目标是预测未来长度为 $H$ 的序列：

$$
\hat{X}_{t+1:t+H}\in\mathbb{R}^{D\times H}
$$

TimeStacker 采用 **Channel Independence（CI）**。不同变量独立通过同一套网络参数：

$$
\hat{y}_d=f_\theta(x_d),\qquad d=1,\dots,D
$$

因此模型不显式建模变量之间的相关性，而是对每个变量独立建模，并在不同变量之间共享参数。

---

# 2. 核心动机

## 2.1 非平稳时间序列的频率随时间变化

非平稳时间序列的统计特性会随时间改变，其频率组成也会动态变化。论文将非平稳信号表示为：

$$
x(t)=a_0(t)+
\sum_{n=1}^{\infty}
\left[
a_n(t)\cos(2\pi n f_0t)
+
b_n(t)\sin(2\pi n f_0t)
\right]
$$

其中 $a_n(t)$、$b_n(t)$ 随时间变化，因此不同时间区间中的频率结构可能不同。

所以，对非平稳时间序列而言，只在整个历史窗口上进行一次全局频域分析不足以描述频率随时间的变化，需要对局部时间区间进行频率建模。

---

## 2.2 Patch 用于局部频率分析

给定单变量历史序列：

$$
X=[x_1,x_2,\dots,x_T]\in\mathbb{R}^{T}
$$

选择 patch size $p$，将序列切分为：

$$
k=\frac{T}{p}
$$

个非重叠 patch：

$$
X_p=
[\xi_1,\xi_2,\dots,\xi_k]
\in\mathbb{R}^{k\times p}
$$

其中每个 patch：

$$
\xi_i\in\mathbb{R}^{p}
$$

代表一个局部时间区间。

随后可以分别对每个 patch 做 FFT，从而获得局部频率特征。

---

## 2.3 单一 Patch Size 存在时间—频率分辨率矛盾

时频分析受到不确定性原理限制：

$$
\Delta t\cdot\Delta f\geq\frac{1}{4\pi}
$$

因此无法同时获得任意高的时间分辨率和频率分辨率。

对于 patch：

- 大 patch：覆盖时间范围长，频率分辨率高，更适合描述长期周期和全局模式；
- 小 patch：覆盖时间范围短，时间分辨率高，更适合描述局部变化。

因此不存在一个对所有非平稳模式都最优的固定 patch size。

TimeStacker 的核心思路不是寻找一个最优 patch，而是使用多个不同尺度：

$$
p_1>p_2>\dots>p_L
$$

并按从大到小的顺序串行堆叠多个 Stacker Block。

---

# 3. 整体结构

TimeStacker 主要由以下部分组成：

$$
\boxed{
\text{Normalization}
\rightarrow
\text{StackerBlock}_{p_1}
\rightarrow
\text{StackerBlock}_{p_2}
\rightarrow
\dots
\rightarrow
\text{StackerBlock}_{p_L}
\rightarrow
\text{Linear Predictor}
\rightarrow
\text{Denormalization}
}
$$

每个 Stacker Block 对应一个 patch size $p_l$。

Stacker Block 内部只有两个主要模块：

1. Smooth Layer；
2. Inter-Patch Frequency-Based Attention（FreqAttention）。

没有标准 Transformer 中的：

- Transformer Encoder；
- Multi-Head Attention；
- FFN / MLP Block；
- Patch Embedding；
- Position Embedding；
- Decoder。

---

# 4. 输入归一化

对于输入窗口 $X$，模型首先计算均值和标准差：

$$
\mu=\operatorname{Mean}(X)
$$

$$
\sigma=\operatorname{Std}(X)
$$

然后进行归一化：

$$
X^{(1)}
=
\frac{X-\mu}{\sigma}
$$

预测完成后再恢复：

$$
\hat{X}
=
\hat{X}'\sigma+\mu
$$

对于多变量输入，每个变量分别计算自己的 $\mu$ 和 $\sigma$。

---

# 5. Channel Independence

假设模型输入：

$$
X\in\mathbb{R}^{B\times D\times T}
$$

其中：

- $B$：batch size；
- $D$：变量数；
- $T$：历史长度。

CI 将变量维并入 batch 维：

$$
[B,D,T]
\rightarrow
[BD,T]
$$

因此所有变量被视为独立的单变量序列，同时通过同一套 TimeStacker 参数。

模型内部不会计算：

$$
D\times D
$$

的变量关系。

---

# 6. 多尺度 Stacker 机制

设 Patch Size List 为：

$$
P=\{p_1,p_2,\dots,p_L\}
$$

并满足：

$$
p_1>p_2>\dots>p_L
$$

每个 $p_l$ 都要求能够整除 $T$。

第 $l$ 层的 patch 数量：

$$
k_l=\frac{T}{p_l}
$$

TimeStacker 的关键不是并行提取多个尺度后拼接，而是串行处理：

$$
X^{(1)}
\xrightarrow{p_1}
X^{(2)}
\xrightarrow{p_2}
X^{(3)}
\xrightarrow{p_3}
\dots
\xrightarrow{p_L}
X^{(L+1)}
$$

每一层输出重新恢复为长度 $T$ 的序列，再使用更小的 patch size 重新切分。

因此每一层处理的都是上一层已经更新过的完整序列。

---

# 7. Stacker Block

第 $l$ 个 Stacker Block 可以写为：

$$
\operatorname{StackerBlock}_l(X)
=
\operatorname{FreqAttn}
\left(
\operatorname{SmoothLayer}_l(X)+X
\right)
+X
$$

包含两个残差结构：

$$
X
\rightarrow
\operatorname{SmoothLayer}(X)+X
$$

以及：

$$
X
\rightarrow
\operatorname{FreqAttn}(\cdot)+X
$$

---

# 8. Smooth Layer

Smooth Layer 使用一维卷积：

$$
\operatorname{SmoothLayer}_l(X)
=
W_l*X+b_l
$$

其卷积核大小等于当前 patch size：

$$
\text{kernel size}=p_l
$$

作用是利用一个局部时间窗口对序列进行平滑，降低异常点和局部噪声对后续频率关系建模的影响。

经过残差后：

$$
X_s
=
\operatorname{SmoothLayer}_l(X)+X
$$

形状保持：

$$
X_s\in\mathbb{R}^{T}
$$

或在 batch / CI 场景下：

$$
X_s\in\mathbb{R}^{BD\times T}
$$

---

# 9. Patch 切分

对第 $l$ 层：

$$
p_l=\text{当前 patch size}
$$

$$
k_l=\frac{T}{p_l}
$$

将长度为 $T$ 的序列 reshape 为：

$$
X_p^{(l)}
\in
\mathbb{R}^{k_l\times p_l}
$$

在 batch 和 CI 情况下：

$$
X_p^{(l)}
\in
\mathbb{R}^{BD\times k_l\times p_l}
$$

其中：

- $k_l$：patch 数量；
- $p_l$：每个 patch 中的时间点数量。

---

# 10. FreqAttention

FreqAttention 的核心思想是：

$$
\boxed{
\text{在频域计算 patch 之间的相似度，
在时域完成 Value 聚合}
}
$$

即：

$$
\text{Time-domain Patch}
\rightarrow
\text{FFT}
\rightarrow
Q,K
\rightarrow
\text{Patch Similarity}
$$

然后使用得到的相关矩阵去聚合时域 Value。

---

## 10.1 对每个 Patch 做 FFT

对 patch 的最后一个维度进行 Fourier Transform：

$$
\tilde{X}^{(l)}
=
\mathcal{F}
\left(
X_p^{(l)}
\right)
$$

对于实数输入，FFT 后只需要保留：

$$
F_l
=
\left\lfloor\frac{p_l}{2}\right\rfloor+1
$$

个非负频率分量。

因此：

$$
X_p^{(l)}
\in
\mathbb{R}^{k_l\times p_l}
$$

变为：

$$
\tilde{X}^{(l)}
\in
\mathbb{C}^{k_l\times F_l}
$$

---

## 10.2 生成 Q 和 K

TimeStacker 不使用标准 Transformer 的完整线性投影，而是使用逐频率的可学习参数：

$$
W_q,W_k
\in
\mathbb{R}^{F_l}
$$

计算：

$$
Q
=
W_q\odot\tilde{X}^{(l)}
$$

$$
K
=
W_k\odot\tilde{X}^{(l)}
$$

其中 $\odot$ 表示 Hadamard Product，即逐元素乘法。

因此 $W_q$ 和 $W_k$ 可以看作可学习的频率滤波参数，用于调整不同频率成分在相似度计算中的重要程度。

---

# 11. Patch 间频域 Attention

使用 Q 和 K 计算不同 patch 之间的相关性：

$$
A_f
=
\operatorname{Softmax}
\left(
\frac{QK^\top}{\sqrt{d_k}}
\right)
$$

其中：

$$
A_f
\in
\mathbb{R}^{k_l\times k_l}
$$

矩阵元素：

$$
A_{f,ij}
$$

表示第 $i$ 个 patch 在聚合信息时，对第 $j$ 个 patch 的权重。

因此 TimeStacker 的 FreqAttention 本质上是：

$$
\boxed{
\text{利用频域表示计算历史 patch 之间的注意力关系}
}
$$

其 Attention 的节点仍然是时间序列中的历史 patch，只是相似度不是在时域特征上计算，而是在频域特征上计算。

---

# 12. Value 在时域中计算

TimeStacker 不在频域中直接完成信息聚合。

Value 来自原始时域 patch：

$$
V=X_p^{(l)}W_v
$$

然后：

$$
O
=
A_fV
$$

因此：

$$
A_f
\in
\mathbb{R}^{k_l\times k_l}
$$

$$
V
\in
\mathbb{R}^{k_l\times p_l}
$$

最终：

$$
O
\in
\mathbb{R}^{k_l\times p_l}
$$

即：

$$
O_i
=
\sum_{j=1}^{k_l}
A_{f,ij}V_j
$$

也就是说：

$$
\boxed{
\text{频域负责确定“哪些历史 patch 相似”，
时域负责传递真正的序列内容}
}
$$

论文认为这种设计能够避免完全在频域中进行特征变换带来的 Fourier transform error 和 spectral leakage 问题。

---

# 13. FreqAttention 输出

FreqAttention 可以写为：

$$
\operatorname{FreqAttn}(X)
=
\operatorname{Softmax}
\left(
\frac{
(W_q\odot\tilde{X})
(W_k\odot\tilde{X})^\top
}{
\sqrt{d_k}
}
\right)
XW_v
$$

Stacker Block 最终输出：

$$
X_{\text{out}}
=
\operatorname{FreqAttn}
\left(
\operatorname{SmoothLayer}(X)+X
\right)
+
X
$$

然后重新 flatten：

$$
[k_l,p_l]
\rightarrow
[T]
$$

进入下一层 Stacker Block。

---

# 14. 多尺度处理的完整数据流

假设：

$$
T=96
$$

Patch Size List：

$$
P=(96,48,32,24,16,12)
$$

则各层的 patch 数量为：

$$
1,\ 2,\ 3,\ 4,\ 6,\ 8
$$

完整流程：

第一层：

$$
[96]
\rightarrow
[1,96]
\rightarrow
FFT
\rightarrow
A_f^{(1)}
\rightarrow
[1,96]
\rightarrow
[96]
$$

第二层：

$$
[96]
\rightarrow
[2,48]
\rightarrow
FFT
\rightarrow
A_f^{(2)}
\rightarrow
[2,48]
\rightarrow
[96]
$$

第三层：

$$
[96]
\rightarrow
[3,32]
\rightarrow
FFT
\rightarrow
A_f^{(3)}
\rightarrow
[3,32]
\rightarrow
[96]
$$

继续：

$$
[4,24]
\rightarrow
[6,16]
\rightarrow
[8,12]
$$

最终仍然得到：

$$
X^{(L)}
\in
\mathbb{R}^{96}
$$

---

# 15. 最终预测

所有 Stacker Block 处理完成后，TimeStacker 使用一个线性层直接完成多步预测：

$$
\hat{Y}'
=
W_{\text{pred}}X^{(L)}+b
$$

其中：

$$
W_{\text{pred}}
\in
\mathbb{R}^{H\times T}
$$

因此：

$$
[T]
\rightarrow
[H]
$$

例如：

$$
[96]
\rightarrow
[720]
$$

TimeStacker 是直接多步预测，不进行自回归解码。

最后执行反归一化：

$$
\hat{Y}
=
\hat{Y}'\sigma+\mu
$$

得到最终预测结果。

---

# 16. 多变量情况下的完整形状

输入：

$$
X\in\mathbb{R}^{B\times D\times T}
$$

Channel Independence：

$$
[B,D,T]
\rightarrow
[BD,T]
$$

第 $l$ 层 patchify：

$$
[BD,T]
\rightarrow
[BD,k_l,p_l]
$$

FFT：

$$
[BD,k_l,p_l]
\rightarrow
[BD,k_l,F_l]
$$

其中：

$$
F_l=
\left\lfloor\frac{p_l}{2}\right\rfloor+1
$$

Frequency Attention：

$$
A_f
\in
\mathbb{R}^{BD\times k_l\times k_l}
$$

时域 Value：

$$
V
\in
\mathbb{R}^{BD\times k_l\times p_l}
$$

聚合：

$$
A_fV
\rightarrow
[BD,k_l,p_l]
$$

Flatten：

$$
[BD,k_l,p_l]
\rightarrow
[BD,T]
$$

经过所有 Stacker Block 后：

$$
[BD,T]
\rightarrow
[BD,H]
$$

最后恢复变量维：

$$
[BD,H]
\rightarrow
[B,D,H]
$$

---

# 17. 算法流程

```text
Input:
    X ∈ R^(B×D×T)
    Patch Size List P = {p1, p2, ..., pL}

1. 对每个变量进行窗口归一化
    X_norm = (X - μ) / σ

2. Channel Independence
    [B,D,T] → [BD,T]

3. 对每个 patch size p_l：

    3.1 Smooth Layer
        X_s = Conv1D_p_l(X) + X

    3.2 Patchify
        k_l = T / p_l
        X_p = Reshape(X_s)
        [BD,T] → [BD,k_l,p_l]

    3.3 FFT
        X_f = FFT(X_p)
        [BD,k_l,p_l]
        →
        [BD,k_l,floor(p_l/2)+1]

    3.4 Frequency Query / Key
        Q = W_q ⊙ X_f
        K = W_k ⊙ X_f

    3.5 Patch Frequency Attention
        A_f = Softmax(QK^T / sqrt(d_k))

    3.6 Time-domain Value
        V = X_p W_v

    3.7 Patch Aggregation
        O = A_f V

    3.8 Residual
        X_p = O + X_p

    3.9 Flatten
        [BD,k_l,p_l] → [BD,T]

4. Linear Predictor
    [BD,T] → [BD,H]

5. Restore channel dimension
    [BD,H] → [B,D,H]

6. Denormalization
    Y_hat = Y_hat_norm × σ + μ
```

---

# 18. 核心机制总结

TimeStacker 可以压缩为：

$$
\boxed{
\text{Multi-scale Patch}
+
\text{Frequency-domain Patch Attention}
+
\text{Time-domain Aggregation}
+
\text{Channel Independence}
}
$$

核心贡献主要有两点。

## 18.1 多尺度串行 Patch

通过：

$$
p_1>p_2>\dots>p_L
$$

从大窗口逐步切换到小窗口：

- 大 patch 提供较高频率分辨率；
- 小 patch 提供较高时间分辨率；
- 每层基于上一层输出继续建模，而不是多个尺度并行拼接。

## 18.2 频域计算 Patch 关系，时域完成信息聚合

关系矩阵：

$$
A_f
=
\operatorname{Softmax}
\left(
\frac{Q_fK_f^\top}{\sqrt{d_k}}
\right)
$$

由频率特征决定。

真正被聚合的 Value：

$$
V
$$

仍然来自时域 patch。

因此本质上是：

$$
\boxed{
\text{利用频谱相似性寻找历史相关 patch，
再利用这些相关 patch 的时域信息更新当前序列表示}
}
$$

---

# 19. 模型结构的本质

TimeStacker 并不是复杂的 Transformer。

其主要可学习模块只有：

$$
\boxed{
\text{Conv1D}
+
W_q,W_k
+
W_v
+
\text{Linear Predictor}
}
$$

FFT 本身没有参数。

模型也没有传统 Transformer 中的大规模 MLP / FFN。

因此 TimeStacker 的性能主要来自结构设计和频域先验，而不是依赖大规模参数量。

---

# 20. 论文中需要注意的实现不明确点

论文给出了总体公式，但以下实现细节没有完全说明：

1. FFT 输出为复数，但论文没有明确说明 $QK^\top$ 如何转换为实数后进入 Softmax；
2. $W_v$ 的具体张量维度和实现形式描述不够严格；
3. Smooth Layer 的 padding 等卷积细节未明确给出；
4. Patch Size List 是针对不同数据集人工设置的，并非模型自动搜索得到；
5. TimeStacker 采用 Channel Independence，因此不显式建模多变量之间的相关性，这也是论文在 Traffic 和 Electricity 等高维多变量数据集上的主要限制之一。

---

# 21. 一句话流程

$$
\boxed{
X
\rightarrow
\text{Normalize}
\rightarrow
\text{CI}
\rightarrow
\left[
\text{Conv Smooth}
\rightarrow
\text{Patchify}
\rightarrow
\text{FFT}
\rightarrow
\text{Frequency Patch Attention}
\rightarrow
\text{Time-domain Aggregation}
\right]_{\text{large patch}\rightarrow\text{small patch}}
\rightarrow
\text{Linear Forecast}
\rightarrow
\text{Denormalize}
}
$$
