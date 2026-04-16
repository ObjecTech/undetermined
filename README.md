# 🚀 Mail Organizer for OWA | OWA 邮件整理器

<div align="center">

**一个强大的 Chrome 扩展，让 OWA 邮件管理变得简单高效**

A powerful Chrome extension that makes email management in OWA simple and efficient

[功能特性](#功能特性--features) • [安装步骤](#安装步骤--installation) • [使用说明](#使用说明--usage)

</div>

---

## 📋 功能特性 / Features

### 核心功能 / Core Features

#### 🏷️ 智能归档 / Smart Archive
- 自动识别并归档当前页面可见的邮件
- 支持自定义归档类别
- 支持基于关键词的自动规则

#### ⚡ 优先级排序 / Priority Sorting
自动将重要邮件置顶，排序规则：
- ⭐ 手动标记的高优先级邮件
- 📅 接近截止日期 / 紧急措辞的邮件
- 📌 本周需要跟进的邮件
- 📧 普通邮件

#### 🤖 AI 智能摘要 / AI Summary Panel
- 为当前选中的邮件提供简洁的 AI 摘要
- 采用 DeepSeek OpenAI 兼容端点
- 作为邮件内容的辅助参考

### 高级功能 / Advanced Features

#### 📏 灵活的自动规则 / Flexible Auto Rules
支持多种关键词匹配规则：
- 发件人包含关键词 → 自动分类
- 主题包含关键词 → 自动分类
- 邮件内容包含关键词 → 自动分类

#### 🎯 手动覆盖设置 / Manual Overrides
可针对单个邮件进行以下设置：
- 归档类别
- 优先级标记
- 截止日期

#### 🖱️ 快速导航 / Quick Navigation
- 点击邮件卡片可快速定位 OWA 中的原邮件行
- 直观的卡片式界面设计

---

## 📦 安装步骤 / Installation

### 第一步：克隆项目 / Step 1: Clone Repository

```bash
git clone https://github.com/ObjecTech/Esmail
cd Esmail
```

### 第二步：加载扩展 / Step 2: Load Extension

1. **打开 Chrome** / Open Chrome
   
2. **访问扩展管理页面** / Go to Extensions Page
   ```
   chrome://extensions/
   ```

3. **启用开发者模式** / Enable Developer Mode
   - 点击右上角 "开发者模式" 切换开关
   - Click the "Developer mode" toggle in the top-right corner

4. **加载扩展** / Load Unpacked
   - 点击 "加载已解压的扩展程序" / Click "Load unpacked"
   - 选择项目文件夹 / Select the project folder

✅ **完成！** / **Done!** 扩展已添加到 Chrome 中。

---

## 🎯 使用说明 / Usage Guide

### 基本工作流 / Basic Workflow

1. **打开 OWA** / Open OWA
   - 在 Outlook Web Access 中打开你的邮箱

2. **打开扩展面板** / Open Extension Panel
   - 点击 Chrome 工具栏中的扩展图标

3. **查看组织后的邮件** / View Organized Emails
   - 邮件按优先级自动排序显示
   - 可配置的自动规则自动分类

4. **自定义设置** / Customize
   - 调整优先级和分类
   - 设置自动归档规则
   - 配置 AI 摘要选项

### 快速技巧 / Pro Tips

- 💡 点击邮件卡片可在 OWA 中快速定位原邮件
- 💡 设置高优先级以确保重要邮件不被遗漏
- 💡 使用关键词规则自动整理来自特定发件人的邮件
- 💡 AI 摘要功能帮助你快速了解邮件内容

---

## ⚙️ 重要说明 / Important Notes

### 工作范围 / Scope
- ✅ **能做的** / Can do: 组织当前页面可见的邮件
- ❌ **不能做的** / Cannot do: 直接修改服务器上的真实文件夹或归档状态

### 兼容性 / Compatibility

| 项目 | 说明 |
|------|------|
| **邮件系统** | 仅适用于 OWA (Outlook Web Access) |
| **浏览器** | Chrome / Chromium 内核浏览器 |
| **范围** | 仅整理当前加载页面的邮件 |

### 已知限制 / Known Limitations

⚠️ 如果 OWA 的 DOM 结构有重大变化，扩展的选择器可能需要更新。

---

## 🔧 开发 / Development

### 项目结构 / Project Structure

```
Esmail/
├── manifest.json          # 扩展配置文件
├── popup.html             # 弹窗界面
├── popup.js               # 弹窗逻辑
├── content.js             # 内容脚本
├── background.js          # 后台脚本
├── styles.css             # 样式表
└── README.md             # 本文件
```

### 技术栈 / Tech Stack

- **语言** / Language: JavaScript
- **框架** / Framework: Vanilla JS (no dependencies)
- **API**: DeepSeek OpenAI-compatible API
- **平台** / Platform: Chrome Web Store APIs

---

## 📝 许可证 / License

此项目基于 MIT 许可证发布。

This project is released under the MIT License.

---

## 🤝 贡献 / Contributing

欢迎提交 Issue 和 Pull Request！

Issues and Pull Requests are welcome!

---

## 📧 联系方式 / Contact

如有问题或建议，欢迎在 GitHub 提交 Issue。

For questions or suggestions, please open an issue on GitHub.

---

<div align="center">

⭐ 如果这个项目对你有帮助，请给个 Star！

**Made with ❤️ by ObjecTech**

</div>
