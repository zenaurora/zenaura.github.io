# astro-erudite 项目结构与实现原理

本文档面向需要维护或二次开发本项目的人，重点说明源码结构、数据流、页面生成逻辑和关键实现机制。

## 1. 项目定位

这是一个基于 Astro 6 的静态博客/作品集模板。项目使用 Astro Content Collections 管理内容，使用 Markdown 作为主要内容格式，构建时生成静态 HTML、RSS、sitemap 和 robots.txt。

项目特点：

- 不依赖 React/Vue/Svelte 等 UI 框架。
- 不使用 Tailwind 等 CSS 框架，样式由原生 CSS 文件和 Astro 组件局部样式组成。
- Markdown 渲染链路使用 Satteri，并扩展了代码高亮、数学公式、callout、外链处理和子文章标题命名空间。
- 博客支持普通文章和“系列文章”。系列文章会渲染成一个连续阅读页面，同时每个子文章也有独立 URL。
- 页面交互由少量原生浏览器脚本完成，例如主题切换、目录滚动高亮、系列文章 URL 同步。

## 2. 顶层目录

```text
.
├── astro.config.ts          # Astro 配置、Markdown 处理链路、sitemap 集成
├── package.json             # 脚本、依赖和 Node 版本约束
├── tsconfig.json            # TypeScript 严格配置和 @/* 路径别名
├── biome.json               # Biome 格式化配置
├── src/
│   ├── content.config.ts    # Content Collections schema
│   ├── consts.ts            # 站点元信息、导航和社交链接
│   ├── pages/               # Astro 文件路由
│   ├── content/             # Markdown 内容和内容资产
│   ├── layouts/             # 页面骨架
│   ├── components/          # UI 组件和少量浏览器端脚本
│   ├── lib/                 # 内容查询、Markdown 插件和工具函数
│   ├── styles/              # 全局 CSS 设计系统
│   └── assets/              # 源码内引用的图标、字体、logo
└── public/                  # 原样复制到站点根路径的静态资源
```

## 3. 运行和构建

`package.json` 中定义了常用命令：

```bash
bun dev
bun run build
bun run preview
bun run format
bun run format:check
```

项目要求 Node `>=22.12.0`，锁文件为 `bun.lock`，说明推荐用 Bun 安装和运行。

构建时，Astro 会：

1. 读取 `src/pages` 下的页面路由。
2. 读取 `src/content.config.ts` 中定义的内容集合。
3. 根据各页面的 `getStaticPaths()` 生成动态路由。
4. 通过配置好的 Markdown 处理链路把 Markdown 编译为 HTML。
5. 输出静态站点到 `dist/`。

## 4. 全局配置

### 4.1 `astro.config.ts`

核心配置如下：

- `site` 设置生产站点 URL，用于 canonical、RSS、sitemap 等绝对链接。
- `prefetch: { prefetchAll: true }` 开启全站链接预取。
- `@astrojs/sitemap` 生成 sitemap，并过滤：
  - 子文章 URL：`/blog/父文章/子文章`
  - 标签页：`/tags/...`
- `markdown.processor` 使用 `@astrojs/markdown-satteri`。

Markdown 插件链路分两层：

- `mdastPlugins`
  - `calloutDirective`
  - `inlineExpressiveCode`
  - `temmlMath`
- `hastPlugins`
  - `externalLinks`
  - `blockExpressiveCode`
  - `headingNamespace`

这意味着 Markdown 先在 Markdown AST 层处理 callout、内联代码和数学公式，再在 HTML AST 层处理外链、代码块和标题 id。

### 4.2 `src/consts.ts`

这里集中放站点级配置：

- `SITE`：站点标题、描述、作者、语言方向、默认 Open Graph 图片、首页 featured 数量。
- `NAVIGATION`：侧边栏主导航。
- `SOCIALS`：页脚或社交组件使用的链接和 SVG 图标。

如果要改站点名称、导航项、社交链接，优先改这个文件。

## 5. 内容模型

内容集合定义在 `src/content.config.ts`。

### 5.1 authors 集合

来源目录：`src/content/authors`

每个作者是一个 Markdown 文件，字段包括：

- `name`
- `pronouns`
- `avatar`
- `bio`
- `mail`
- `socials`

博客文章通过 `reference("authors")` 引用作者，因此作者 id 必须和作者文件名匹配。

### 5.2 blog 集合

来源目录：`src/content/blog`

字段包括：

- `title`
- `description`
- `date`
- `order`
- `tags`
- `authors`
- `image`
- `draft`

`draft: true` 的文章不会出现在 `getPosts()` 和 `getSubposts()` 的结果中。

文章可以有两种组织方式：

```text
src/content/blog/a-post.md

src/content/blog/my-series/
├── index.md
├── child-a.md
└── child-b.md
```

第二种结构中，`my-series/index.md` 是父文章，`child-a.md` 和 `child-b.md` 是子文章。

### 5.3 projects 集合

来源目录：`src/content/projects`

字段包括：

- `name`
- `description`
- `link`
- `tags`
- `image`
- `startDate`
- `endDate`

项目页按照 `startDate` 倒序展示。

## 6. 内容查询封装

主要逻辑在 `src/lib/content.ts`。

### 6.1 `getPosts()`

读取 `blog` 集合中非 draft 的内容，然后：

1. 过滤掉子文章。
2. 按发布日期倒序排序。

这里的“子文章”由 `src/lib/utils.ts` 中的 `isSubpost(id)` 判断，只要 id 中包含 `/` 就视为子文章。

因此：

- `introducing-v2` 是普通文章或父文章。
- `v1-posts/callouts-component` 是子文章。

### 6.2 `getSubposts()`

读取 `blog` 集合中 id 深度为 2 的非 draft 文章，也就是 `父id/子id` 形式的内容。

排序规则：

1. `order` 小的排前面。
2. 没有 `order` 时放到后面。
3. `order` 相同再按日期升序。

返回值是一个 `Map<string, CollectionEntry<"blog">[]>`，key 是父文章 id，value 是该父文章下的子文章列表。

### 6.3 `getTags()`

标签不是单独维护的集合，而是从博客文章派生出来：

1. 先读取父文章列表。
2. 再读取子文章分组。
3. 对每个父文章，把父文章和它的子文章组成一个 chain。
4. 收集 chain 中出现过的所有 tag。
5. 每个 tag 对应到父文章，而不是对应到子文章。

这意味着某个子文章使用了标签 `astro`，标签页 `/tags/astro` 中展示的是它所属的父文章。

## 7. 页面路由

Astro 使用文件路由，核心页面在 `src/pages`。

### 7.1 首页 `src/pages/index.astro`

首页是一个静态介绍页，使用词典条目的视觉形式介绍 astro-erudite。它只引用 `Layout` 和 `MetaPage`，没有读取内容集合。

### 7.2 博客列表 `src/pages/blog/index.astro`

调用 `getPosts()` 获取父文章列表，然后用 `BlogCard` 渲染。

子文章不会直接显示在博客列表中。

### 7.3 博客详情 `src/pages/blog/[...id].astro`

这是项目最关键的页面。

`getStaticPaths()` 的流程：

1. 调用 `getPosts()` 得到所有父文章。
2. 调用 `getSubposts()` 得到子文章分组。
3. 对每个父文章构造 `chain = [parent, ...subposts]`。
4. 为 chain 中的每一篇文章都生成一个静态路径。
5. 每个路径的 props 都带上完整 chain，以及上一篇/下一篇父文章。

这带来一个重要效果：

- 访问 `/blog/my-series` 会渲染完整系列。
- 访问 `/blog/my-series/child-a` 也会渲染同一个完整系列。
- 子文章 URL 只是初始滚动位置、当前面包屑、标题和 canonical 的不同。

页面渲染时：

1. 对 chain 中每篇文章执行 `render(entry)`。
2. 解析作者引用 `getEntries(entry.data.authors)`。
3. 收集每篇文章的 headings，生成目录 sections。
4. 渲染文章 header、作者、日期、标签、banner 和正文。
5. 如果是系列文章，挂载 `SeriesReader` 处理滚动同步。

子文章的 canonical 会指向父文章，避免搜索引擎把同一篇连续文档的多个 URL 当作重复内容。

### 7.4 标签页

`src/pages/tags/index.astro`：

- 调用 `getTags()`。
- 展示所有标签及每个标签对应的父文章数量。
- 设置 `noindex`。

`src/pages/tags/[...id].astro`：

- `getStaticPaths()` 从 `getTags()` 中生成每个标签页。
- 展示该标签下的父文章列表。
- 设置 `noindex`。

### 7.5 作者页

`src/pages/authors/index.astro`：

- 读取 `authors` 集合。
- 按作者名排序。
- 使用 `AuthorCard` 展示。

`src/pages/authors/[...id].astro`：

- 为每个作者生成页面。
- 读取父文章列表，并筛选引用当前作者的文章。
- 展示作者信息和文章列表。
- 设置 `noindex`。

### 7.6 项目页

`src/pages/projects/index.astro`：

- 读取 `projects` 集合。
- 按 `startDate` 倒序排序。
- 使用 `ProjectCard` 展示。

### 7.7 RSS 和 robots

`src/pages/rss.xml.ts`：

- 调用 `getPosts()`。
- 只输出父文章到 RSS。

`src/pages/robots.txt.ts`：

- 返回简单的 robots.txt。
- 引用 `sitemap-index.xml`。

## 8. 布局系统

### 8.1 `src/layouts/Layout.astro`

所有主要页面共用这个布局。

它做了几件事：

1. 引入全局 CSS：
   - reset
   - fonts
   - colors
   - typography
   - callout
   - layout
   - shape
2. 输出 `<html lang dir>`。
3. 使用 `MetaHead` 生成基础 head。
4. 组织页面网格：
   - 左侧 `Sidebar`
   - 中间主内容
   - 右侧可选 `TableOfContents`
   - 底部 `Footer`

布局使用 CSS Grid 和自定义元素名，例如 `page-grid`、`page-header`、`page-content`。这些不是 Web Components，只是语义化的自定义标签，样式由 CSS 选择器控制。

桌面端：

- 左侧导航固定。
- 右侧目录固定。
- 中间内容在网格列中滚动。

移动端：

- 头部变为 sticky 顶栏。
- 目录变为可展开的顶部条。
- 主内容居中限制宽度。

### 8.2 `Sidebar`

`src/components/Sidebar.astro` 负责：

- logo 和站点名。
- 主导航。
- 当前 section 高亮。
- 面包屑。
- 主题切换按钮。
- 文章上一篇/下一篇操作 slot。

它通过当前 `Astro.url.pathname` 判断当前导航 section。

### 8.3 `MetaHead`、`MetaPage`、`MetaPost`

`MetaHead` 是基础 head：

- charset、viewport。
- favicon、manifest。
- RSS 和 sitemap 链接。
- 字体 preload。
- 主题初始化脚本。

`MetaPage` 用于普通页面：

- title
- description
- canonical
- Open Graph
- Twitter card
- 可选 noindex

`MetaPost` 用于文章页面：

- article 类型的 Open Graph。
- 文章作者。
- 发布时间。
- 文章图片或默认文章图。
- 子文章 canonical 指向父文章。

## 9. Markdown 扩展机制

Markdown 处理是本项目的核心扩展点。

### 9.1 Callout

实现文件：`src/lib/callout.ts`

它使用 Satteri 的 mdast 插件识别 container directive，例如：

```markdown
:::note[Title]
Content
:::
```

支持的类型：

- `note`
- `tip`
- `warning`
- `caution`
- `important`

插件会把 directive 转成 `<details data-callout="...">`，并自动生成 `<summary>`、标题和 SVG 图标。样式由 `src/styles/callout.css` 控制。

### 9.2 数学公式

实现文件：`src/lib/math.ts`

`temmlMath()` 处理：

- inline math
- block math

公式通过 Temml 渲染为 MathML。块级公式会包在 `<math-display>` 中，方便 CSS 控制。

### 9.3 代码高亮

实现文件：

- `src/lib/expressive-code/index.ts`
- `src/lib/expressive-code/config.ts`
- `src/lib/expressive-code/inline.ts`

代码块使用 `satteri-expressive-code` 和 Expressive Code 渲染，开启：

- GitHub light/dark 主题。
- 行号。
- 可折叠区块。
- 自动换行。

命令行类语言默认关闭行号。

内联代码支持额外标注，例如：

```markdown
`const x = 1{:ts}`
`keyword{:.keyword}`
```

前者按语言高亮，后者按 TextMate scope 上色。

### 9.4 外链处理

实现文件：`src/lib/external-links.ts`

所有 `http://` 或 `https://` 链接会被自动加上：

- `target="_blank"`
- `rel="nofollow noreferrer noopener"`

站内链接不会被改写。

### 9.5 子文章标题命名空间

实现文件：`src/lib/heading-namespace.ts`

系列文章会把多个 Markdown 文件渲染到同一个页面。如果不同子文章里都有同名标题，默认 heading id 可能冲突。

该插件会识别子文章文件路径，并把子文章内的标题 id 改成：

```text
子文章slug-标题slug
```

这样目录锚点和页面跳转不会互相冲突。

## 10. 客户端交互

项目几乎没有复杂前端状态，交互主要在组件内用原生脚本实现。

### 10.1 主题切换

实现文件：`src/components/ThemeToggle.astro`

支持主题：

- `light`
- `solarized-light`
- `lake`
- `dark`
- `gruvbox-dark`
- `everforest`
- `nord`
- `blackgold`
- `catppuccin`
- `dracula`
- `tokyo-night`
- `rose-pine`
- `synthwave`
- `monokai`
- `anthropic`
- `rose`
- `sunset`
- `sea`
- `lavender`
- `cursor`

点击按钮会循环切换主题，并把结果存入 `localStorage.theme`。`MetaHead` 中的 inline script 会在页面早期读取这个值，写入 `document.documentElement.dataset.theme`，避免页面加载后再闪烁切换。

颜色变量主要定义在 `src/styles/color.css`。

### 10.2 目录滚动高亮

实现文件：`src/components/TableOfContents.astro`

目录数据来自文章渲染结果里的 `headings`。

浏览器端脚本负责：

- 根据滚动进度更新移动端圆形进度。
- 使用 `IntersectionObserver` 判断当前可见内容块。
- 给当前目录链接加 `data-active` 和 `aria-current`。
- 展开当前系列分组。
- 移动端打开目录时自动滚动到当前 active 项。
- 滚过文章标题后显示右侧目录标题。

### 10.3 系列文章 URL 同步

实现文件：`src/components/SeriesReader.astro`

这个组件只在 `chain.length > 1` 时渲染。

它解决两个问题：

1. 当用户直接访问子文章 URL 时，页面加载后自动滚动到对应子文章。
2. 当用户在连续文档中滚动到不同子文章时，使用 `history.replaceState()` 同步地址栏和 document title。

它还拦截同页系列内链接点击，使点击子文章链接时不触发完整页面跳转，而是滚动到目标 article 并同步 URL。

## 11. 样式组织

全局样式在 `src/styles`：

- `reset.css`：浏览器默认样式重置。
- `fonts.css`：字体声明。
- `color.css`：颜色 token 和主题变量。
- `layout.css`：网格、空间尺度等布局变量。
- `shape.css`：圆角等形状变量。
- `typography*.css`：正文、标题、列表、表格、内联元素等排版。
- `callout.css`：callout 组件样式。

组件内 `<style>` 负责该组件的局部布局和细节。项目大量使用自定义标签名作为样式 hook，例如 `entry-info`、`post-meta`、`page-grid`。

整体样式思路是：

- 全局 CSS 定义设计系统和文章排版。
- Astro 组件局部 CSS 定义组件结构。
- 不引入 class-heavy 的 CSS 框架。

## 12. 静态资源

`src/assets`：

- 被源码 import 的资源。
- 包括 SVG 图标、字体和 logo。
- 经过 Vite/Astro 资源管线处理。

`public`：

- favicon、manifest、Open Graph 默认图片等。
- 构建时原样复制到站点根路径。
- 适合用绝对路径引用，例如 `/favicon.svg`、`/static/opengraph-image.png`。

`src/content/**/assets`：

- 与 Markdown 内容共置的图片。
- 通过 frontmatter 的 `image: ./assets/banner.png` 或 Markdown 内部引用。

## 13. 典型请求链路

以访问 `/blog/v1-posts/callouts-component` 为例：

1. Astro 根据 `src/pages/blog/[...id].astro` 匹配路由。
2. 构建期 `getStaticPaths()` 已为这个 id 生成静态页面。
3. props 中包含：
   - 当前子文章 `post`
   - 父文章和全部子文章组成的 `chain`
   - 上一篇/下一篇父文章
4. 页面 render 阶段对 chain 中每篇文章调用 `render(entry)`。
5. Markdown 经过 Satteri 和项目自定义插件变成 HTML。
6. 页面输出完整系列文章。
7. `MetaPost` 为子文章设置 canonical 到父文章 `/blog/v1-posts`。
8. `SeriesReader` 在浏览器端把页面滚动到 `callouts-component` 对应 article。
9. 用户继续滚动时，URL 会在父文章和不同子文章之间自动同步。

## 14. 常见修改入口

新增博客文章：

- 在 `src/content/blog` 下新增 `.md` 或 `目录/index.md`。
- frontmatter 必须符合 `blog` schema。

新增系列子文章：

- 在某个父文章目录下新增同级 `.md`。
- 可用 `order` 控制顺序。

新增作者：

- 在 `src/content/authors` 下新增作者 Markdown。
- 在文章 frontmatter 的 `authors` 中引用作者 id。

新增项目：

- 在 `src/content/projects` 下新增项目 Markdown。

修改站点信息和导航：

- 改 `src/consts.ts`。

修改主题颜色：

- 改 `src/styles/color.css`。

修改文章排版：

- 优先看 `src/styles/typography*.css`。

修改 Markdown 能力：

- 改 `astro.config.ts` 中的 Markdown 插件链路。
- 插件实现位于 `src/lib`。

修改页面骨架：

- 改 `src/layouts/Layout.astro`。
- 再按需调整 `Sidebar`、`TableOfContents`、`Footer`。

## 15. 设计上的几个关键取舍

### 静态优先

内容、列表、标签、作者页、RSS 和 sitemap 都在构建期生成。这样部署简单，运行时不需要服务器数据库。

### 内容模型集中

Content Collections 用 Zod schema 约束 frontmatter，能在构建期发现缺字段、类型错误、作者引用不存在等问题。

### 系列文章按父文章聚合

子文章虽然有独立 URL，但列表、标签和 RSS 都以父文章为主。这降低了信息架构复杂度，也避免系列内容在列表里刷屏。

### 轻运行时

项目没有全局前端应用状态。只有确实需要浏览器能力的地方才写脚本，例如滚动观察、URL 替换、localStorage 主题。

### 样式系统自包含

项目用 CSS 变量、原生 CSS 嵌套、媒体查询和自定义标签组织样式，不依赖外部 UI 体系。二次开发时要尽量沿用现有 token 和组件局部样式方式。
