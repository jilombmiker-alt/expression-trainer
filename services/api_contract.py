"""Shared P0 HTTP response contracts."""


def error_payload(code, message, retryable=False, field_errors=None):
    error = {
        "code": str(code or "unknown_error"),
        "message": str(message or "请求处理失败。"),
        "retryable": bool(retryable),
    }
    if isinstance(field_errors, dict) and field_errors:
        error["fieldErrors"] = {str(key): str(value) for key, value in field_errors.items()}
    return {"error": error}
