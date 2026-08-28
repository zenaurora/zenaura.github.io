---
title: "从复数乘法到 rotate_half：RoPE 是怎么实现的"
description: "从二维旋转的复数形式出发，推导 rotate_half，并对比 split-half 与相邻维度配对两种 RoPE 实现。"
date: 2026-08-28
order: 3
authors:
  - maokaihe
tags:
  - LLM
  - Transformer
  - RoPE
  - PyTorch
draft: true
---

读 RoPE 代码时，经常会看到下面两行：

```python
q_embed = q * cos + rotate_half(q) * sin
k_embed = k * cos + rotate_half(k) * sin
```

公式不难，`rotate_half` 这个名字却很容易让人误会。它不是“只旋转一半维度”，而是利用维度重排，算出整个向量旋转 $90^\circ$ 后的方向。真正旋转多少度，仍然由 `cos` 和 `sin` 决定。

## RoPE 在 Transformer 中的位置

原始 Transformer 的绝对位置编码在进入第一层之前直接加到 token embedding 上，后续各层接收到的隐藏状态已经带有位置信息。RoPE 的插入位置不同：它位于每一层多头注意力内部，在当前层完成 query、key 投影并拆分 attention head 之后、计算 attention score 之前执行：

$$
h^{(l)}
\xrightarrow{W_Q^{(l)},W_K^{(l)}}
q^{(l)},k^{(l)}
\xrightarrow{R(m)}
\widetilde q^{(l)},\widetilde k^{(l)}
\xrightarrow{\widetilde q\widetilde k^T}
\text{attention score}
$$

其中，$h^{(l)}$ 是第 $l$ 层的输入隐藏状态，$W_Q^{(l)}$ 和 $W_K^{(l)}$ 是这一层的 query、key 投影矩阵，$m$ 是 token 位置，$R(m)$ 是该位置对应的旋转矩阵。对第 $a$ 个 attention head，可以写成

$$
\widetilde q_{m,a}=R(m)q_{m,a},
\qquad
\widetilde k_{m,a}=R(m)k_{m,a}
$$

标准实现中，各个 head 共用同一套旋转角；$R(m)$ 由位置 $m$ 和 head 内的维度编号决定，不包含 head 编号 $a$。但每层都会重新投影出自己的 query 和 key，所以每个采用 RoPE 的注意力层都要再次执行旋转。这里重复的是旋转操作，不是为每一层或每个 head 学习一套新的 RoPE 参数：提前算好的 `cos` 和 `sin` 通常可以在层之间复用。

## 从复数乘以 $i$ 开始

先看二维向量 $(a,b)$。我们可以暂时把它记成复数

$$
z=a+ib
$$

这只是数学上的记法：$a$ 仍是第一个实数维度，$b$ 仍是第二个实数维度，程序不必真的使用复数类型。

把 $z$ 乘以虚数单位 $i$：

$$
iz=i(a+ib)=ia+i^2b=-b+ia
$$

因为 $i^2=-1$，新的实部和虚部分别是 $-b$ 与 $a$：

$$
(a,b)\longrightarrow(-b,a)
$$

这恰好是二维向量逆时针旋转 $90^\circ$。例如 $(3,4)$ 经过变换后得到 $(-4,3)$，长度仍然是 $5$，只是方向变了。

如果把这个操作记为 $J$，那么

$$
J
\begin{bmatrix}
a\\b
\end{bmatrix}
=
\begin{bmatrix}
0&-1\\
1&0
\end{bmatrix}
\begin{bmatrix}
a\\b
\end{bmatrix}
=
\begin{bmatrix}
-b\\a
\end{bmatrix}
$$

`rotate_half` 做的就是这个 $Jx$。

## $90^\circ$ 怎么变成任意角度

位置 $m$ 在第 $i$ 个二维子空间中的旋转角为

$$
\phi_i=m\theta_i
$$

$m$ 是 token 的位置，$\theta_i$ 是这一组维度的旋转频率。根据欧拉公式：

$$
e^{i\phi_i}=\cos\phi_i+i\sin\phi_i
$$

将 $z=a+ib$ 乘上它并展开：

$$
\begin{aligned}
(a+ib)(\cos\phi_i+i\sin\phi_i)
&=(a\cos\phi_i-b\sin\phi_i)\\
&\quad+i(a\sin\phi_i+b\cos\phi_i)
\end{aligned}
$$

换回二维向量就是

$$
\begin{bmatrix}
a'\\b'
\end{bmatrix}
=
\cos\phi_i
\begin{bmatrix}
a\\b
\end{bmatrix}
+
\sin\phi_i
\begin{bmatrix}
-b\\a
\end{bmatrix}
$$

因此完整旋转可以写成

$$
R(\phi_i)x=x\cos\phi_i+Jx\sin\phi_i
$$

代码中的 `x * cos` 是原方向，`rotate_half(x) * sin` 是与原方向垂直的方向。两者按角度加权后，就得到旋转 $\phi_i$ 的结果。当 $\phi_i=90^\circ$ 时，`cos` 为 $0$、`sin` 为 $1$，结果才完全等于 `rotate_half(x)`。

## GPT-NeoX style：前后两半配对

[GPT-NeoX](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gpt_neox/modeling_gpt_neox.py) 使用 split-half 布局，[Llama 的实现](https://github.com/huggingface/transformers/blob/main/src/transformers/models/llama/modeling_llama.py)也采用了同样的方式。它们先把最后一个维度分成前后两半：

```python
def rotate_half(x):
    x1 = x[..., : x.shape[-1] // 2]
    x2 = x[..., x.shape[-1] // 2 :]
    return torch.cat((-x2, x1), dim=-1)
```

假设一个 head 有 $8$ 个维度，布局可以写成

$$
x=[a_0,a_1,a_2,a_3,b_0,b_1,b_2,b_3]
$$

前后两半按列配对，即 $(a_0,b_0)$、$(a_1,b_1)$，以此类推。调用 `rotate_half` 后得到

$$
Jx=[-b_0,-b_1,-b_2,-b_3,a_0,a_1,a_2,a_3]
$$

为了让每一对维度使用同一个角度，频率也要按相同布局复制：

```python
freqs = position_ids[..., None] * inv_freq
emb = torch.cat((freqs, freqs), dim=-1)
cos, sin = emb.cos(), emb.sin()
```

如果 `q`、`k` 的形状是 `[batch, heads, seq_len, head_dim]`，那么 `cos`、`sin` 通常整理成 `[batch, 1, seq_len, head_dim]`，依靠广播应用到每个 attention head：

```python
def apply_rope(q, k, cos, sin):
    q = q * cos + rotate_half(q) * sin
    k = k * cos + rotate_half(k) * sin
    return q, k
```

RoPE 通常只处理 query 和 key，因为位置信息需要进入二者的点积。value 不参与旋转。有些模型还只旋转 `head_dim` 的前一部分，剩余维度原样通过，这就是 partial RoPE。

## GPT-J style：相邻维度配对

[RoFormer 论文](https://arxiv.org/abs/2104.09864)中的旋转矩阵按相邻维度组成二维块，[GPT-J 的实现](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gptj/modeling_gptj.py)也使用这种布局：$(x_0,x_1)$、$(x_2,x_3)$、$(x_4,x_5)$。对应代码是

```python
def rotate_half_interleaved(x):
    x1 = x[..., 0::2]
    x2 = x[..., 1::2]
    return torch.stack((-x2, x1), dim=-1).flatten(-2)
```

此时输入

$$
[x_0,x_1,x_2,x_3]
$$

会变成

$$
[-x_1,x_0,-x_3,x_2]
$$

这种布局需要把每个角度连续复制两次，通常使用 `repeat_interleave`，不能照搬 split-half 使用的 `cat(freqs, freqs)`。

## 两种布局为什么等价

GPT-J style 的向量排列是

$$
x_{\text{J}}
=[a_0,b_0,a_1,b_1,\ldots,a_{r-1},b_{r-1}]
$$

把下标为 $0,2,4,\ldots$ 的维度放到前面，再接上 $1,3,5,\ldots$ 的维度，就得到 GPT-NeoX style：

$$
x_{\text{N}}
=[a_0,a_1,\ldots,a_{r-1},b_0,b_1,\ldots,b_{r-1}]
$$

用置换矩阵 $P$ 表示这次重排，有 $x_{\text{N}}=Px_{\text{J}}$。两种旋转矩阵之间的关系是

$$
R_{\text{N}}(m)=P R_{\text{J}}(m)P^T
$$

$R_{\text{J}}(m)$ 是相邻维度布局的旋转矩阵，$R_{\text{N}}(m)$ 是前后两半布局的旋转矩阵，$m$ 是 token 位置。因为置换矩阵满足 $P^TP=I$，同步重排 query 和 key 后，attention 内积保持不变：

$$
\begin{aligned}
&\left(R_{\text{N}}(m)Pq\right)^T
 \left(R_{\text{N}}(n)Pk\right)\\
&\qquad=
\left(R_{\text{J}}(m)q\right)^T
\left(R_{\text{J}}(n)k\right)
\end{aligned}
$$

这就是“两种实现等价”的准确含义：它们只是对同一批二维旋转换了一套坐标排列。无论选择哪一种，都有 $R(m)^TR(n)=R(n-m)$，因此 attention score 中的位置部分仍然只依赖相对距离 $n-m$。

但它们对同一个未经重排的张量不会给出相同数值。已经训练好的 checkpoint 也不能只替换 `rotate_half`：query、key 投影的输出排列、二维配对方式以及 `cos/sin` 的排列必须一起转换，否则代码可以正常运行，位置频率却会配到错误的维度上。
