---
title: "从正余弦编码到 RoPE、NoPE 与 HoPE"
description: "梳理绝对位置编码、RoPE、ALiBi、长上下文扩展，以及近年来自适应和弱位置编码方案的设计思路。"
date: 2026-08-27
order: 2
authors:
  - maokaihe
tags:
  - LLM
  - Transformer
  - Position Encoding
  - Long Context
draft: true
---

Transformer 使用自注意力机制，内部没有直接的位置的概念，因此需要进行位置嵌入

RNN因为是按照顺序来进行处理的，所以天然有时间的感知；CNN是卷积核一个一个滑动处理的，所以有位置的感知

----

## 绝对位置编码

Transformer论文提出的时候 用的是正余弦位置编码，如果序列长度在训练的时候没有见过，可以顺着正余弦的周期进行插值和外推，并且不用像可学习嵌入那样带来额外的大量训练参数

大多数实现中 正余弦编码和词向量相加的方式输入到后续层中的
公式：

$$
\begin{aligned}
PE_{(pos, 2i)} &= \sin\left(\frac{pos}{10000^{2i/d_{\text{model}}}}\right), \\
PE_{(pos, 2i+1)} &= \cos\left(\frac{pos}{10000^{2i/d_{\text{model}}}}\right)
\end{aligned}
$$

其中 $pos$ 是 token 在序列中的位置，$i$ 是维度对的索引，$d_{\text{model}}$ 是词向量的维度。偶数维使用正弦，奇数维使用余弦；不同的 $i$ 对应不同频率。

---

## 相对位置编码

早期有一些方案，近几年流行的是rope，旋转位置编码

思想就是在query和key进行点积之前，先做一个在二维平面的旋转，

公式和矩阵表示：

先把向量的每两个维度看成一个二维子空间。对第 $i$ 个二维子空间，定义频率

$$
\theta_i = 10000^{-2i/d}, \qquad i=0,1,\ldots,\frac{d}{2}-1
$$

位置 $m$ 上的二维向量 $\boldsymbol{x}_m^{(i)} = [x_{m,2i}, x_{m,2i+1}]^T$ 会旋转 $m\theta_i$：

$$
\operatorname{RoPE}\!\left(\boldsymbol{x}_m^{(i)},m\right)
=
\underbrace{
\begin{bmatrix}
\cos(m\theta_i) & -\sin(m\theta_i) \\
\sin(m\theta_i) & \cos(m\theta_i)
\end{bmatrix}
}_{R(m\theta_i)}
\begin{bmatrix}
x_{m,2i} \\
x_{m,2i+1}
\end{bmatrix}
$$


RoPE 不会在整个高维空间里一次完成一个复杂旋转，而是把偶数维向量拆成多个互不影响的二维向量。假设 $\boldsymbol{x}_m\in\mathbb{R}^d$ 且 $d$ 为偶数，可以按相邻维度切分：

$$
\boldsymbol{x}_m
= (x_{m,0},x_{m,1})
\oplus (x_{m,2},x_{m,3})
\oplus \cdots
\oplus (x_{m,d-2},x_{m,d-1})
$$

这里的 $\oplus$ 表示把这些二维向量重新拼接起来。第 $i$ 组 $(x_{m,2i},x_{m,2i+1})$ 使用角度 $m\theta_i$ 独立旋转，因此完整的高维旋转矩阵就是一个块对角矩阵：

$$
R_m=
\begin{bmatrix}
R(m\theta_0) & 0 & \cdots & 0 \\
0 & R(m\theta_1) & \cdots & 0 \\
\vdots & \vdots & \ddots & \vdots \\
0 & 0 & \cdots & R(m\theta_{d/2-1})
\end{bmatrix}
$$

例如 $d=6$ 时，向量被切成三组：

$$
(x_0,x_1),\qquad (x_2,x_3),\qquad (x_4,x_5)
$$

位置为 $m$ 时，这三组分别旋转 $m\theta_0$、$m\theta_1$ 和 $m\theta_2$。由于 $\theta_0>\theta_1>\theta_2$，前面的维度旋转更快，适合表达较短的位置变化；后面的维度旋转更慢，适合表达较长的位置变化。旋转完成后再把三组结果拼回一个六维向量，向量维度不会改变。

一些代码实现不是把相邻维度配成一组，而是先把向量切成前后两半，再把 $x_i$ 与 $x_{i+d/2}$ 配对。两种方式只是维度排列不同；只要频率、配对方式以及 query 和 key 的处理保持一致，数学效果是等价的。

实际放进多头注意力时，这里的 $d$ 通常是单个注意力头的维度 $d_{\text{head}}$，每个头分别对自己的 query 和 key 做旋转。有些模型只旋转前 $d_{\text{rotary}}$ 个维度，剩余维度保持不变，这被称为 partial RoPE。

对于位置 $m$ 的 query 和位置 $n$ 的 key，旋转后分别变成 $R_mq_m$ 和 $R_nk_n$。它们的点积满足：

$$
\begin{aligned}
(R_mq_m)^T(R_nk_n)
&= q_m^T R_m^T R_n k_n \\
&= q_m^T R_{n-m} k_n
\end{aligned}
$$

因此，注意力分数中的位置信息只与相对距离 $n-m$ 有关，而不是绝对位置 $m$、$n$ 本身。

RoPE 计算高效，attention score 又能自然带上相对位置信息。它的公式可以计算任意位置，但这不等于模型一定能直接处理任意长度：如果训练序列很短，推理时突然出现很大的位置，旋转角就会进入训练时没有见过的区域。





### ALiBi

ALiBi 的全称是 Attention with Linear Biases。

在自注意力中，常见的打分函数是：
$$
\operatorname{score}_h(i,j)
= \frac{q_i^{(h)T}k_j^{(h)}}{\sqrt{d_k}}
$$

ALiBi 在计算 score 时，加入一个与 query 和 key 的距离相关的线性惩罚：

$$
\operatorname{score}_h(i,j)
= \frac{q_i^{(h)T}k_j^{(h)}}{\sqrt{d_k}}
- m_h(i-j), \qquad j \le i
$$

其中 $m_h>0$ 是第 $h$ 个注意力头预先设定的斜率，$i-j$ 是在因果注意力中当前 query 与历史 key 的距离。距离越远，惩罚越大；原始 ALiBi 使用固定斜率，不把它作为可训练参数。

ALiBi 不需要保存位置向量，也不用像 RoPE 那样旋转 query 和 key，实现上只是在 attention score 中加一个线性项。它对训练长度之外的序列有较好的外推能力，不过“距离越远，惩罚越大”本身也是一种较强的先验；后面的 FIRE 和 HoPE 都在重新考虑这种固定的远距离衰减是否总是合适。


## RoPE 的长上下文扩展

RoPE 在训练长度内很好用，麻烦出在长度外推。模型如果只在长度 $L$ 内训练过，推理时却遇到远大于 $L$ 的位置，旋转角 $m\theta_i$ 就可能落到训练阶段从未见过的范围。Position Interpolation、NTK-aware RoPE、YaRN 和 LongRoPE 都在处理这个问题。它们没有抛弃 RoPE，只是重新安排不同频率的旋转速度。目前 Hugging Face Transformers 也把这些方案作为不同的 [RoPE 类型](https://huggingface.co/docs/transformers/main/en/internal/rope_utils) 提供。

### Position Interpolation

Position Interpolation（PI）的做法最直接。设模型训练时的最大长度为 $L$，希望扩展到 $L'$，缩放倍数为

$$
s=\frac{L'}{L}
$$

推理时不再使用原位置 $m$，而是使用压缩后的位置

$$
m'=\frac{m}{s}=m\frac{L}{L'}
$$

其中 $m$ 是 token 在新序列中的位置，$m'$ 是送入 RoPE 的位置。这样，当 $m\le L'$ 时总有 $m'\le L$，旋转角重新回到训练范围内。它的缺点也很明显：所有频率都按同一个比例压缩，会损失相邻位置之间的分辨率。[Position Interpolation 论文](https://arxiv.org/abs/2306.15595)

### NTK-aware RoPE

NTK-aware RoPE 不直接缩放位置，而是修改 RoPE 的频率基数。原本

$$
\theta_i=b^{-2i/d}
$$

扩展 $s$ 倍后，将基数改成

$$
b'=b\,s^{d/(d-2)},
\qquad
\theta_i'=(b')^{-2i/d}
$$

这里 $b$ 通常为 $10000$，$d$ 是参与旋转的维度，$i$ 是二维维度对的索引。$i$ 较小时频率变化较小，因此局部位置分辨率保留得更多；$i$ 较大时频率下降得更多，用来容纳更远的位置。相比 PI 的统一缩放，它对频率的处理是不均匀的。

### YaRN

[YaRN](https://arxiv.org/abs/2309.00071) 的全称是 Yet another RoPE extensioN。它延续了 NTK-by-parts 的思路：高频负责区分相邻 token，不宜过度压缩；低频负责较长距离，可以做更多插值。可以把它简化表示为

$$
\widetilde{\theta}_i
=\gamma_i\theta_i
+(1-\gamma_i)\frac{\theta_i}{s},
\qquad 0\le\gamma_i\le1
$$

$\theta_i$ 是原始频率，$s$ 是上下文扩展倍数，$\gamma_i$ 由频率区间决定。高频维度的 $\gamma_i$ 接近 $1$，更接近原始 RoPE；低频维度的 $\gamma_i$ 接近 $0$，更接近位置插值；中间频段平滑过渡。YaRN 还会根据扩展倍数调整 attention 的缩放，避免上下文变长后注意力分布发生太大漂移。

### LongRoPE

[LongRoPE](https://arxiv.org/abs/2402.13753) 继续放宽限制，不再使用统一缩放倍数或预设的频段规则，而是为每个 RoPE 维度搜索独立的缩放因子：

$$
\widetilde{\theta}_i=\frac{\theta_i}{\lambda_i},
\qquad
\lambda_0,\lambda_1,\ldots,\lambda_{d/2-1}
\text{ 可以不同}
$$

$\lambda_i$ 是第 $i$ 个二维子空间的缩放因子。LongRoPE 还发现序列开头的一小段位置适合少插值或不插值，因此会同时搜索保留的起始 token 数量 $\hat n$。论文再通过分阶段扩展和少量长文本微调，把模型实验中的上下文窗口扩展到了 2.048M token。这个结果说明频率维度和 token 位置都不必采用完全一致的缩放策略。

## RoPE 之外的位置编码

上面的方案都在回答“怎样把 RoPE 用到更长的序列”。另一批工作问得更基础：位置是否一定是固定的 token 距离，以及每一层是否都需要显式位置编码。

### FIRE

[FIRE](https://proceedings.iclr.cc/paper_files/paper/2024/hash/2f55a8b7b1c2c6312eb86557bb9a2bd5-Abstract-Conference.html)（Functional Interpolation for Relative Positions）不再手工规定距离与 attention bias 的关系，而是交给一个小型 MLP 学习：

$$
b_{\text{FIRE}}(i,j)
=f_\phi\!\left(
\frac{\psi(i-j)}{\psi(\max\{L,i\})}
\right),
\qquad
\psi(x)=\log(cx+1)
$$

$i$、$j$ 分别是 query 和 key 的位置，$i-j$ 是相对距离；$L$ 是可学习的阈值，$c>0$ 控制对数变换，$f_\phi$ 是参数为 $\phi$ 的 MLP。归一化后的输入被限制在训练时熟悉的范围内，最后把得到的偏置加到 attention score：

$$
\operatorname{score}(i,j)
=\frac{q_i^Tk_j}{\sqrt{d_k}}
+b_{\text{FIRE}}(i,j)
$$

FIRE 学习的是一条“距离到偏置”的函数，而不是每个位置各自的 embedding。论文证明它可以表示 ALiBi、T5 Relative Position Bias 和 Kerple 等多种已有形式。

### CoPE

[CoPE](https://arxiv.org/abs/2405.18719)（Contextual Position Encoding）不再默认每遇到一个 token，位置就增加 $1$。对于 query $q_i$ 和之前的 key $k_j$，它先计算一个软门控：

$$
g_{ij}=\sigma(q_i^Tk_j)
$$

$\sigma$ 是 sigmoid 函数，$g_{ij}$ 越接近 $1$，表示当前 query 认为第 $j$ 个 token 越应该被计入位置。随后累加这些门控，得到从 $j$ 到当前位置 $i$ 的上下文位置：

$$
p_{ij}=\sum_{k=j}^{i}g_{ik}
$$

如果所有 $g_{ik}$ 都等于 $1$，它就退化为普通的 token 距离；如果只有句号、名词或某类事件的门控较大，$p_{ij}$ 统计的就是句子、名词或事件的数量。$p_{ij}$ 可能是小数，因此 CoPE 会在相邻的整数位置 embedding 之间做插值。不同注意力头可以学习不同的计数方式，这正是它与固定相对位置编码的主要区别。

### DAPE

[DAPE](https://openreview.net/forum?id=rnUEUbRxVu)（Data-Adaptive Positional Encoding）认为，同样的距离在不同输入中不应该总产生同一个偏置。它同时读取内容相似度和已有的位置先验。记

$$
S(X)=\frac{XW_Q(XW_K)^T}{\sqrt{d_k}}
$$

其中 $X$ 是输入表示，$W_Q$、$W_K$ 是 query 和 key 的投影矩阵，$S(X)$ 是普通的 attention score，$B$ 是 ALiBi、FIRE 等方法提供的静态位置偏置。DAPE 常用的残差形式为

$$
A_{\text{DAPE}}(X)
=S(X)+B+f_\phi(S(X),B)
$$

$f_\phi$ 是一个小型两层神经网络，它根据当前样本的语义关系动态修正 $B$。因此相同的 token 距离可以在代码、对话或长文档中得到不同的位置偏置。

### NoPE 与 iRoPE

NoPE 直接去掉显式位置编码。对于 decoder-only Transformer，这并不意味着模型完全看不到顺序，因为 causal mask 已经规定第 $i$ 个 token 只能访问它之前的位置：

$$
M_{ij}=
\begin{cases}
0, & j\le i \\
-\infty, & j>i
\end{cases}
$$

$i$ 是 query 位置，$j$ 是 key 位置。不同位置可访问的历史长度不同，模型可以从这种信息流中学出一部分隐式位置。[NoPE 的长度泛化研究](https://arxiv.org/abs/2404.12224)发现，它在一些外推实验中比显式位置编码退化得慢，但仍然存在自己的有效长度上限，因此不能把“没有位置 OOD”理解成“长度可以无限扩展”。

Meta 在 Llama 4 中采用了 [iRoPE](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)：大多数层继续使用 RoPE，中间穿插不使用位置编码的 attention 层。这个设计保留了 RoPE 的局部顺序信息，同时让部分层少受固定位置模式约束。它代表的是 RoPE 与 NoPE 的混合，而不是用 NoPE 完全替换 RoPE。

### HoPE

[HoPE](https://aclanthology.org/2025.acl-long.1123/)（High-frequency rotary Position Encoding）关注 RoPE 的长期衰减倾向。远处的信息不一定不重要，但某些低频旋转分量会让超长距离上的 attention 受到固定位置模式影响。HoPE 保留高频旋转，把其余分量换成与位置无关的部分。可以把它的结构简化写成

$$
R_m^{\text{HoPE}}
=\operatorname{diag}\!\left(
R(m\theta_0),\ldots,R(m\theta_{r-1}),
I,\ldots,I
\right)
$$

$r$ 是高频分量的截断位置，$R(m\theta_i)$ 是原来的二维 RoPE 旋转，$I$ 是不随位置变化的二维单位矩阵。这样局部范围仍有清楚的位置差异，而较低频的维度不再持续编码超远距离。论文在最大 3B 参数的模型上验证了这种设计。




### 参考的一些解释说明

因为“随距离衰减”是外推的关键，所以base的性质与大模型的长度外推息息相关，如NTK-Aware Scaled RoPE、NTK-by-parts、Dynamic NTK等长度外推方法，本质上都是通过改变base，从而影响每个位置对应的旋转角度，进而影响模型的位置编码信息，最终达到长度外推的目的。


## 小结

| 路线 | 方法 | 处理的问题 |
| --- | --- | --- |
| RoPE 缩放 | PI、NTK-aware、YaRN、LongRoPE | 怎样把已有 RoPE 模型扩展到更长上下文 |
| 可学习偏置 | FIRE、DAPE | 位置偏置是否应该由数据学习和动态调整 |
| 上下文位置 | CoPE | 位置是否必须等于 token index |
| 减少位置约束 | NoPE、iRoPE、HoPE | 超长距离是否需要在所有维度、所有层编码位置 |


---
