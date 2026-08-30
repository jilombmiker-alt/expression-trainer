# P0 API 契约

## 1. 共同约定

- 本地地址：`http://127.0.0.1:4173`
- JSON 响应使用 UTF-8；动态结果禁止缓存。
- 所有失败响应统一为：

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "给用户看的中文说明",
    "retryable": false,
    "fieldErrors": { "可选字段名": "可选字段错误" }
  }
}
```

- 页面在过渡期兼容旧的顶层 `message`，新增接口只应使用统一结构。
- 不把模型 Key、原始堆栈、系统路径或完整用户语音写入错误响应。

## 2. 语音

### `GET /api/speech/health`

返回语音引擎、模型、能力和不可用原因。`available=false` 表示页面应使用浏览器识别或手动输入降级，不能假装已完成高精度识别。

### `POST /api/speech/transcribe`

- Body：单个 WebM、MP4 或 OGG 音频。
- Header：对应的 `Content-Type`，也允许 `application/octet-stream`。
- 服务会检查真实文件头；内容不是音频或声明格式不符时返回 415。
- 成功结果包含 `text / confidence / segments / pauses / durationMs / needsConfirmation`。

## 3. 长音频任务

1. `POST /api/audio/tasks`：创建任务，传 `contentType` 和可选 `hotwords`。
2. `PUT /api/audio/tasks/{id}/chunks/{index}`：按 0 开始连续上传分段。
3. `POST /api/audio/tasks/{id}/complete`：结束上传并进入处理。
4. `GET /api/audio/tasks/{id}`：查询 `status / progress / result / error`。
5. `DELETE /api/audio/tasks/{id}`：取消未完成任务。

状态为 `uploading / queued / converting / transcribing / completed / failed / cancelled`。服务重启后，未完成处理不会伪装成功，而会转换为可重试失败。

## 4. 语义评估

### `GET /api/semantic/health`

返回真实模型是否配置。没有 Key 时只允许显示“暂定分析”，不能宣称真实 AI 判断已验收。

### `POST /api/semantic/evaluate`

输入原文、用户转述、知识点及当前规则分析；输出逐知识点证据、遗漏、冲突和改进建议。模型输出必须经过后端结构校验。

## 5. 知识训练

### `POST /api/training/from-source`

输入用户资料及标题，输出同一知识包下的第一轮长段转述材料和第二轮 30 秒速记材料，并保留来源说明。资料过短、字段错误或生成失败均使用共同错误结构。
