---
title: 探索：Markdown特殊情况的书写语法
published: 2026-10-29
description: ''
image: ''
tags: [Markdown]
category: 'Web'
draft: true 
lang: 'zh-CN'
---
# 引言
~~neon在写周报。~~ neon想在列表里插入一个多行代码块，但是发现：

```md
- 引入了Moe Counter![counter](moe_counter.png)
    - ```html
    <img src="https://count.getloli.com/@neonmz-blog?theme=gelbooru&padding=5&offset=0&align=top&scale=1.0&pixelated=1&darkmode=auto" />
    ```
    - [相关资源](https://count.getloli.com/)
```

这样不能正常渲染（不仅列表炸了，这个`<img>`还作为元素插入的文档...

经过一阵的“学习” ~~（问AI）~~，获得了正确的写法：

```md
- 引入了Moe Counter![counter](moe_counter.png)
    ```html
    <img src="https://count.getloli.com/@neonmz-blog?theme=gelbooru&padding=5&offset=0&align=top&scale=1.0&pixelated=1&darkmode=auto" />
    ```
    - [相关资源](https://count.getloli.com/)
```

得到了以下结论：
- 代码块不能放在列表项的首行（`-`开头的那行），需要换行写在新的一行
- 整个代码块需要正确缩进
- 一般不允许首行为空的列表项
- 代码块可以直接写在父列表项的下方，但是必须和子列表项一样缩进（否则子列表项不解析）

因此，neon决定就此机会，好好的学习一下Markdown的语法，让以后的文档书写更加的顺畅。

# Markdown的基础语法
To be continued...