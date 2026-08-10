# 把`Arc<Trait>`向下转型为`Arc<Struct>`

读了一个新的博客，讲的是如何把一个包含动态类型的高效地downcast回到它原本的类型

博客给出了具体的代码实现，很简洁，同时也给出了相应的汇编代码。我对于汇编的理解不是很好，但是在AI的帮助下，我还是理解了这个博客，然后我自己记录一下

## why downcast

Rust 里面，`Arc<T>` 有一个`into_inner`的方法，如果这个Arc的引用计数为1，就会消耗掉当前这个Arc的所有权，然后把里面的数据T交出

但是`into_inner`只能用于编译期已知大小的`Sized`的类型。对于`dyn MyTrait`类型是不可以的。

如果完全确定这个`Arc<dyn MyTrait>` 底层就是 `MyStruct` 还想要给他解包出来，就需要使用donwcast来向下转型。

## 第一版

Rust 提供了`dyn Any` 的安全的向下转型的方法，但是如果Trait不是来自Any，就无法使用这个安全的API。 一个很显然的想法就是利用unsafe和裸指针
```rust
unsafe fn downcast(arc: Arc<dyn MyTrait>) -> Arc<MyStruct> {
	let ptr = Arc::into_raw(arc);
	
	unsafe { Arc::from_raw(ptr.cast()) }
}
```
其中 `Arc<T>::from_raw` 要求 这个指针必须是从`Arc<U>::into_raw`生成的，而且指针的大小和对齐凡事必须和T相通，这里很显然满足了这个要求，所以这个unsafe操作是安全的

作者为了严谨起见，把这个代码放到Compiler Explorer里面生成了汇编,查看向上转型和向下转型的区别：

```assembly
// upcast
mov rax, rdi
lea rdx, [rip + .vtable]
ret

//downcast
mov rax, qword ptr[rsi + 16] // 从虚标里面读一个东西
dec rax   // 减去1
and rax, -16 // 按位与
add rax, rdi // 加上原指针
ret
```
downcast操作里面很麻烦，加上了很多难以理解的指令

### 分析这些指令

一个Arc 里面有一个ArcInner， ArcInner大致长这样：
```rust
struct ArcInner<T: ?Sized> {
    strong: Atomic<usize>,
    weak: Atomic<usize>,
    data: T,
}

```

这里的问题就出现内存的对齐上面。CPU为了读取效率，内存起始地址必须是特定数字的倍数，如果T需要32字节对齐，就需要进行额外的填充

```
+-------+-------+---------------+
|strong | weak  |   <padding>   |
+-------+-------+---------------+
0       8      16              32
+-------------------------------+
|             data              |
+-------------------------------+
32                             64
```

调用`into_raw` 时， 返回的是指向data的指针，但是调用`from_raw`时，需要找到ArcInner的头部，需要操作引用计数，所以需要从data的指针地址减去一个偏移量。
这个偏移量取决于T的对齐方式，这就是这段奇怪的汇编代码的来源

data地址 = ArcInner地址 + 16 + padding
ArcInner 地址 = data地址 - 16 - padding

按理来说 into_raw 加上padding+16 ; from_raw 减去16和padding，这是相互抵消的，完全没必要这么操作，如果里面真的是MyStruct的话，直接转换过去就行了，什么算数运算都不需要，直接返回原始的指针就可以了。

但是为什么编译器不知道呢？或者怎么才能让编译器知道呢？

因为编译器不能编译期计算出来padding是多少，从类型上来看，`dyn MyTrait`对应着无数个具体的类型，编译器就不能直接去做这种优化

所以，为了让编译器知道这个，作者引入了`std::hint::assert_unchecked`

Rust 拥有一个非常强大的接口，以 `assert_unchecked` 提示的形式向编译器传达信息,如果我们断言 `data` 在 `Arc<dyn MyTrait>` 中的对齐方式与 `MyStruct` 的对齐方式相等，编译器应当拥有足够的信息来移除不必要的算术运算

```rust
#[unsafe(no_mangle)]
pub unsafe fn downcast_with_hint(arc: Arc<dyn MyTrait>) -> Arc<MyStruct> {
    unsafe {
        std::hint::assert_unchecked(
            std::mem::align_of_val(arc.as_ref()) ==
            std::mem::align_of::<MyStruct>(),
        )
    };
    let ptr = Arc::into_raw(arc);
    unsafe { Arc::from_raw(ptr.cast()) }
}
```

