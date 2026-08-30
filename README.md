# 🚀 宇宙无敌表达训练系统 - 本地桌面版

## P0 验收补强（当前浏览器版本）

- 技术取舍：`docs/P0_TECHNICAL_ADAPTATION.md`
- P0 产品基线：`docs/PRD_P0_EXPRESSION_TRAINER.md`
- 前端技术适配：`docs/FRONTEND_TECHNICAL_ADAPTATION.md`
- 第 1 阶段前端开发：`docs/FRONTEND_STAGE_01_DEVELOPMENT.md`
- 第 2 阶段真实闭环：`docs/FRONTEND_STAGE_02_DEVELOPMENT.md`
- 第 3 阶段 Agent 交互：`docs/FRONTEND_STAGE_03_DEVELOPMENT.md`
- 第 4 阶段质量准备：`docs/FRONTEND_STAGE_04_DEVELOPMENT.md`
- 上线阶段 01 · BYOK：`docs/DEPLOYMENT_STAGE_01_BYOK.md`
- 五个步骤：`docs/P0-01_*` 至 `docs/P0-05_*`
- API 契约：`docs/P0_API_CONTRACT.md`
- 工程验收台账：`docs/P0_ENGINEERING_ACCEPTANCE.md`
- 产品经理验收：`docs/P0_ACCEPTANCE_CHECKLIST.md`
- 基础本地服务：`npm run web:p0:core`
- 高精度语音本地服务：先按 `services/requirements-speech-tested.txt` 配置环境，再运行 `npm run web:p0`
- 前端测试：`npm run test:web`
- 后端测试：`PYTHONPYCACHEPREFIX=/tmp/expression-pyc python3 -m unittest discover -s services -p 'test_*.py' -v`

P0 已包含高精度转录校准入口、分段长录音任务、草稿恢复、来源约束知识生成和 BYOK 多模型接入。自动化基线为 58 项前端测试与 21 项后端测试，并增加真实 Chrome 核心闭环。真人麦克风、用户自有的真实模型 Key、3/10 分钟长录音和真实 OpenKB 仍必须按验收清单完成，不得用自动化测试冒充。

### 浏览器 BYOK

运行 `npm run web:p0:core` 后从页面右下角进入“设置”，或访问 `http://127.0.0.1:4173/settings.html?section=model`。用户可以选择 OpenAI、DeepSeek、Anthropic Claude 或 Google Gemini，自行填写模型名和 API Key。默认要求 BYOK；用户未接入模型就开始训练时，会先进入设置中的模型接入项，因此不会消耗产品方模型额度。当前免费预览版只在服务端内存保存密钥，8 小时、主动断开或服务重启后失效。

## 新增：语流浏览器体验版

本仓库的 `web/` 目录包含一个不依赖 Electron 的浏览器交互原型，覆盖：

- 浏览器语音输入与低置信候选确认
- 浏览器环境 / 麦克风权限 / 语音服务三步检查和音量反馈
- 语气助词、填充词、衔接词、犹豫表达和常用语分类
- “第一点 / 第二点 / 第三点”、结论、举例、总结的逻辑框架识别
- 忠实清理对照稿（不增加原文观点）
- 逐句朗读与限时阅读复述两层训练
- 4 篇原创中文通读范本和浏览器本地训练记录
- 奶油果冻、经典文稿、清爽呼吸、霓虹声场 4 套可即时切换的视觉方向

启动方式：

```bash
npm run web
```

然后访问 `http://127.0.0.1:4173/`。当前表达分析为本地规则版，AI 深度改写和模型级 ASR 增强尚未接入；界面内也明确展示了这一边界。完整设计调研和取舍见 `web/DESIGN_RESEARCH.md`。

注意：本次收到的源码中 `models/` 只有占位文件。桌面版 Sherpa-ONNX 识别必须先按下文下载完整模型，否则 `lib/asr.js` 会在初始化时报告模型缺失。

> 👉 **在线版已上线：[exprtrain.online](https://exprtrain.online)**，无需安装，打开浏览器即用。支持中英双语。

一个帮你训练口语表达精准度的本地桌面应用。实时语音识别 → 词库匹配 → AI反馈，全程离线+本地处理。

## 功能

- 🎤 **实时语音识别**：基于 Sherpa-ONNX，完全离线，中文优化
- 📝 **全屏字幕显示**：黑底大字，实时显示你说的每一句话
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代
- 🤖 **AI反馈**：支持 Groq/OpenAI/DeepSeek/Ollama 多后端
- 📊 **分析报告**：6维度深度分析（逻辑/直接性/填充词/密度/词汇/亮点）

## 安装

### 1. 克隆项目 & 安装依赖

```bash
cd expression-trainer
npm install
```

### 2. 下载语音识别模型

需要下载 Sherpa-ONNX 的 streaming paraformer 中英双语模型：

```bash
cd models

# 方法一：使用 wget
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
tar xvf sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2

# 方法二：使用 huggingface
# https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en
```

下载后 `models/` 目录应包含：
```
models/
└── sherpa-onnx-streaming-paraformer-bilingual-zh-en/
    ├── encoder.int8.onnx
    ├── decoder.int8.onnx
    └── tokens.txt
```
### 3. 启动应用

```bash
npm start
```

### 4. 配置 AI 后端

启动后点击右上角 ⚙️ 进入设置页面。

推荐配置：

| 后端 | 费用 | 速度 | 获取方式 |
|------|------|------|----------|
| DeepSeek | 极低 | 快 | [platform.deepseek.com](https://platform.deepseek.com) |
| OpenAI | 中等 | 快 | [platform.openai.com](https://platform.openai.com) |
| Ollama | 免费 | 取决于硬件 | [ollama.com](https://ollama.com) 本地运行 |

**推荐 deepseek**：生成报告质量高，且成本极低。

## 使用说明

1. **点击「开始录制」** → 对着麦克风说话
2. **实时字幕**会在屏幕中央显示你说的内容
3. **左侧面板**实时统计填充词/犹豫词/笼统词
4. **右侧面板**每50字会给出AI实时反馈
5. **说完后点击「结束」** → 可以点「生成报告」获取完整分析

## 字幕颜色含义

| 颜色 | 含义 |
|------|------|
| 🔴 红色波浪下划线 | 填充词（嗯、啊、那个、然后…） |
| 🟠 橙色 | 犹豫词（可能、也许、我觉得…） |
| 🟡 黄色虚线 | 笼统词（有精准替代建议） |
| 🟢 绿色 | 有力表达（好句子！） |

## 技术架构

```
┌─────────────────────────────────────────┐
│ Electron 主进程                          │
│  ├── Sherpa-ONNX (离线语音识别)          │
│  ├── 词库匹配 (emotion-lexicon.json)     │
│  └── AI反馈 (多后端 HTTP API)            │
├─────────────────────────────────────────┤
│ 渲染进程 (Chromium)                      │
│  ├── 全屏字幕显示                        │
│  ├── 实时统计面板                        │
│  └── 分析报告弹窗                        │
└─────────────────────────────────────────┘
```

## 词库说明

`data/emotion-lexicon.json` 基于大连理工情感词库7大类结构，包含：

- **130+ 情绪词**：分类（喜怒哀惧恶惊）+ 强度（1-9）
- **笼统词→精准词映射**：25组高频替代建议
- **填充词表**：24个常见口头禅
- **犹豫词表**：19个弱化表达
- **程度词梯度**：弱→中→强→极 四级
- **画面化描述**：10组「抽象→具象」转换
- **犹豫→直接转换**：8组对照示例

## 开发

```bash
# 开发模式（带DevTools）
npm run dev

# 目录结构
├── main.js              # Electron主进程
├── preload.js           # preload脚本
├── src/
│   ├── index.html       # 主界面
│   ├── settings.html    # 设置页
│   ├── styles.css       # 样式
│   ├── app.js           # 前端逻辑
│   └── settings.js      # 设置逻辑
├── lib/
│   ├── asr.js           # 语音识别
│   ├── lexicon.js       # 词库匹配
│   ├── ai-feedback.js   # AI反馈
│   └── prompts.js       # Prompt模板
├── data/
│   └── emotion-lexicon.json
└── models/              # Sherpa-ONNX模型（需下载）
```

## 系统要求

- macOS 12+ / Windows 10+ / Linux
- Node.js 18+
- 麦克风权限
- （可选）网络连接（用于AI反馈，词库分析可离线）

## License

MIT
