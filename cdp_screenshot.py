#!/usr/bin/env python3
"""
使用 Chrome DevTools Protocol 截图
"""
import json
import base64
import websocket

def get_websocket():
    """连接到 Chrome DevTools Protocol"""
    ws_url = "ws://localhost:9222/devtools/page/4A95A59EB702B381D55C9EB8F361E6D1"
    ws = websocket.create_connection(ws_url)
    return ws

def send_cmd(ws, method, params=None):
    """发送 CDP 命令"""
    id = 1
    msg = {"id": id, "method": method}
    if params:
        msg["params"] = params
    ws.send(json.dumps(msg))
    
    # 接收响应
    while True:
        resp = ws.recv()
        data = json.loads(resp)
        if data.get("id") == id:
            return data

def main():
    print("连接到 Chrome...")
    ws = get_websocket()
    print("已连接")
    
    # 刷新页面
    print("刷新页面...")
    send_cmd(ws, "Page.reload")
    
    import time
    time.sleep(3)
    
    # 截图
    print("截图...")
    result = send_cmd(ws, "Page.captureScreenshot", {"format": "png"})
    
    if "result" in result and "data" in result["result"]:
        with open("/tmp/test-kline-screenshot.png", "wb") as f:
            f.write(base64.b64decode(result["result"]["data"]))
        print("截图已保存到 /tmp/test-kline-screenshot.png")
    else:
        print("截图失败:", result)
    
    # 获取页面文本
    print("\n获取页面文本...")
    eval_result = send_cmd(ws, "Runtime.evaluate", {
        "expression": "document.body.innerText.substring(0, 800)"
    })
    if "result" in eval_result:
        print(eval_result["result"].get("result", {}).get("value", "N/A"))
    
    ws.close()

if __name__ == "__main__":
    main()
