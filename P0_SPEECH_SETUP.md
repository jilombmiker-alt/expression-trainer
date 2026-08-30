# P0 高精度语音与语义服务

页面默认可以直接使用文字输入；启动 P0 服务后，会自动检测 FunASR 和可选语义模型。任何服务不可用时，界面都会明确回退，不会生成虚假的转录、停顿或模型结论。

## 启动页面和接口

```bash
npm run web:p0
```

打开：`http://127.0.0.1:4173/concept-editorial.html?theme=v0`

## 启用 FunASR

推荐使用项目独立环境安装；`imageio-ffmpeg` 会提供项目内置的音频转换程序，不要求修改系统环境：

```bash
python3 -m venv .venv-funasr
.venv-funasr/bin/python -m pip install --upgrade pip setuptools wheel
.venv-funasr/bin/python -m pip install -r services/requirements-speech.txt
```

首次启动 `npm run web:p0` 时，服务会在 `.model-cache` 中准备并预热转录、VAD 和标点模型；完成预热后才会对页面报告“高精度中文转录已就绪”。可通过环境变量替换模型：`FUNASR_MODEL`、`FUNASR_VAD_MODEL`、`FUNASR_PUNC_MODEL`。

当前默认环境约占 892MB，三类默认模型缓存约占 2.1GB；两者都已加入 `.gitignore`，不会被误提交到代码仓库。

## 启用语义模型（可选）

服务支持 OpenAI-compatible `chat/completions` 接口：

- `EXPRESSION_LLM_BASE_URL`
- `EXPRESSION_LLM_API_KEY`
- `EXPRESSION_LLM_MODEL`
- `EXPRESSION_LLM_TIMEOUT_SECONDS`（默认 30 秒）
- `EXPRESSION_LLM_RETRIES`（默认重试 1 次，最多 2 次）

可复制项目根目录的 `.env.example` 查看完整配置名。服务不会自动读取或向前端返回 Key；本地启动前请通过终端或安全运行环境设置真实值。

语义 Prompt 位于 `services/prompts/semantic_assessment_v1.txt`。模型输出必须逐概念返回状态和转录证据，经过后端结构校验后才会进入评分。

未配置时，页面使用“知识点覆盖 + 信息关系”的本地混合判定，并标注为暂定结果。

## P0 数据边界

- 停顿仅来自带时间戳的录音识别结果；文字输入不估算停顿。
- 置信度低于 0.72，或模型未返回置信度时，必须由用户核对转录稿后才能评分。
- 模型语义判断必须返回逐概念证据；无有效证据时回退到本地混合判定。
