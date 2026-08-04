---
title: "backdrop-filter 会让后代的 position: fixed 失效"
description: "一个隐蔽的 CSS 层叠陷阱：backdrop-filter 会创建新的包含块，让子元素的 fixed 退化成相对定位。"
date: 2026-08-04
tags: [CSS, 前端, 踩坑, containing-block]
---

## 现象

给一个 Web App 加左下角浮动按钮（「支持与反馈」），CSS 写的老实标准：

```css
.support-fab {
  position: fixed;
  left: 20px;
  bottom: 20px;
}
```

DOM 结构大致是：

```html
<div class="app">
  <aside class="tree-col">
    <!-- 树形列表 -->
    <button class="support-fab">💛 支持与反馈</button>
  </aside>
  <main>...</main>
</div>
```

打开浏览器 —— **按钮凭空消失**。DevTools 里能看到 DOM 存在、`display:` 不是 `none`、类名对得上、样式规则也匹配到。但视觉上就是没有。

## 排查

`grep` 出 `<button class="support-fab">` 在渲染产物里 —— 存在。字符串在，但用户看不见。这个时候必须扔掉 grep，回到浏览器 DevTools 一层一层往上翻祖先。

翻到 `.tree-col` 时看到这一行：

```css
.tree-col {
  backdrop-filter: blur(50px);
  overflow-y: auto;
}
```

问题锁定。

## 根因

CSS 规范里有一条容易被忘的规则：

> **如果一个元素设置了 `filter`、`backdrop-filter`、`transform`、`perspective`、`will-change` 或 `contain: paint` 中的任何一个，它就会为所有后代（包括 `position: fixed` 的后代）创建新的「包含块」（containing block）。**

换句话说，一旦祖先带了这些属性中的任何一个，子孙的 `position: fixed` 就不再是相对**视口**定位，而是**相对这个祖先**定位。`fixed` 事实上退化成了「特殊版的 `absolute`」。

再叠加 `.tree-col { overflow-y: auto }` —— 侧边栏可以纵向滚动，而按钮的 `bottom: 20px` 被算成「相对 tree-col 底部」，加上溢出裁剪，按钮就滑出可视区、被裁掉了。

规范链接（供二次核对）：

- [MDN: `position: fixed`](https://developer.mozilla.org/en-US/docs/Web/CSS/position#fixed) 里 "Note" 段有相关说明
- [CSS Containment Module Level 3 §2.1](https://www.w3.org/TR/css-contain-3/) 及 CSS Filter Effects 规范

## 修复

方案很直接：**把 `fixed` 元素挪到不会创建包含块的祖先里**。最保险是提到 `<body>` 直接子级：

```html
<body>
  <div class="app">
    <aside class="tree-col">...</aside>
    <main>...</main>
  </div>
  <!-- 提到这里 -->
  <button class="support-fab">💛 支持与反馈</button>
</body>
```

按钮立刻出现在左下角。

## 教训

**「DOM 里 grep 得到 ≠ 用户看得见」**。做自动化验收的时候，如果判据是「HTML 里存在 `class="support-fab"`」就放行，这类 bug 一律漏掉。真要验「用户能看见」，得走 DOM 快照 + 元素可视矩形（`getBoundingClientRect()`）或者直接跑 Playwright 截图对比。

这条陷阱容易踩，因为几乎所有主流 UI 库都在用 `backdrop-filter` 做毛玻璃效果 —— Apple 风、玻璃拟态、深色模式都爱这一口。装 `fixed` 按钮时留意一下祖先。

**触发这条陷阱的属性完整清单**（值得贴到脑子里）：

- `transform` 非 `none`
- `perspective` 非 `none`
- `filter` 非 `none`
- `backdrop-filter` 非 `none`
- `will-change` 包含 `transform` / `perspective` / `filter`
- `contain: paint` 或 `contain: layout` / `contain: strict`
- 部分浏览器：`clip-path` 非 `none`

看到祖先带这些属性中的任何一个，子孙 `fixed` 就不安全 —— 该提就提，别怀疑规范。

—— 马启航Marvis
