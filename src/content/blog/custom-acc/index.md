---
title: "ACC 自定义涂装制作流程"
description: "记录 Assetto Corsa Competizione PC 版自定义涂装的文件结构、制作步骤和图层关系。"
date: 2026-08-25
authors:
  - maokaihe
tags:
  - ACC
  - Sim Racing
  - Livery
---

记录一下在 ACC 里面自己做涂装的流程。这里说的是使用车辆模板制作完全自定义的涂装，不只是游戏内置的颜色和图案组合。

## 文件结构

ACC 的自定义涂装主要涉及 `Cars` 和 `Liveries` 两个目录：

```text
Documents/
└── Assetto Corsa Competizione/
    └── Customs/
        ├── Cars/
        │   └── <车辆配置>.json
        └── Liveries/
            └── <customSkinName>/
                ├── decals.json
                ├── decals.png
                ├── sponsors.json
                └── sponsors.png
```

`Cars` 里面的 JSON 负责记录车型、车号、车队名和涂装目录名，`Liveries` 里面则是实际使用的纹理和材质配置。

## 创建车辆配置

1. 在游戏的车辆选择界面点击添加，创建一辆自定义车辆，填写车队名、车号等信息并保存。
2. 打开 `Customs/Cars`，这里会出现一个新的 JSON 文件。如果文件比较多，可以按修改时间找到刚刚生成的文件。
3. 打开这个 JSON，找到 `teamName` 和 `customSkinName`。

```json
{
  "teamName": "Aurora Racing",
  "customSkinName": "aurora_racing_296"
}
```

这里只展示需要关注的字段，原文件里的其他字段不要删除。

- `teamName` 是游戏车辆选择界面中显示的车队名。
- `customSkinName` 是 ACC 要读取的 `Liveries` 子目录名。

为了方便管理，可以把它们设置成含义相近的名字，但不需要完全一样。关键是 `customSkinName` 必须和 `Liveries` 下面的文件夹名称一致。

ACC 生成的车辆 JSON 一般是 UTF-16 编码，建议用 VS Code 或 Notepad++ 修改，保存时不要意外改变编码。

## 准备涂装目录

在 `Customs/Liveries` 下面创建一个与 `customSkinName` 同名的文件夹，例如：

```text
Customs/Liveries/aurora_racing_296/
```

正常情况下，回到游戏重新选择并保存这辆车后，这个目录中会生成 `decals.json` 和 `sponsors.json`。有些车辆模板或涂装包也会直接提供这两个文件。

这两个 JSON 并不是负责不同的车身区域，而是分别控制对应纹理层的材质效果，例如粗糙度、清漆和金属度：

| 配置文件 | 对应纹理 |
| --- | --- |
| `decals.json` | `decals.png` |
| `sponsors.json` | `sponsors.png` |

## 制作和导出涂装

打开下载好的 ACC 对应车辆模板，一般使用 Photoshop，也可以使用其他支持图层和透明 PNG 的软件。

设计时可以保留 UV 线框和背景层作为定位参考。导出之前要把车辆网格、背景颜色和其他辅助图层隐藏掉，也就是模板里常见的 `UV` 和 `BG`，然后保持模板原始尺寸导出透明 PNG。

- 车漆、色块、渐变和迷彩等主体设计导出为 `decals.png`。
- 赞助商 Logo、车队标识和文字等贴花导出为 `sponsors.png`。

把导出的 PNG 放到对应的 `Liveries/<customSkinName>` 文件夹中即可。

## 两个图层的关系

ACC 会先应用游戏内设置的基础涂装，再叠加 `decals.png`，最后叠加 `sponsors.png`。所以同一个位置有内容时，`sponsors` 会盖在 `decals` 上面。

一般可以把车身设计放到 `decals`，把 Logo 放到 `sponsors`，这样两层可以使用不同的材质效果，也比较方便后续修改。

当然，也可以把全部设计都放到 `sponsors.png`，让 `decals.png` 保持透明，这个没有强制要求。

## 修改后没有更新

ACC 第一次读取 PNG 时会自动生成 DDS 缓存。如果修改 PNG 后游戏里还是旧涂装，可以退出当前车辆的展示界面，然后删除涂装目录里自动生成的 `decals_*.dds` 和 `sponsors_*.dds`，让游戏下次加载时重新生成。

不要删除自己制作的 PNG 和 JSON 文件。
