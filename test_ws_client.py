#!/usr/bin/env python3
"""
測試 WebSocket 客戶端
連接到後端，發送 init 請求，接收實時報價
"""

import asyncio
import json
import time
import websockets

async def test_ws_client():
    """測試 WebSocket 客戶端"""
    uri = "ws://127.0.0.1:18792/ws/quote"
    
    print(f"連接到 {uri}")
    
    try:
        async with websockets.connect(uri) as ws:
            print("✅ WebSocket 連接成功！")
            
            # 發送 init 請求
            init_msg = {
                "action": "init",
                "codes": ["HK.00700", "HK.00981"]
            }
            await ws.send(json.dumps(init_msg))
            print(f"📤 發送: {init_msg}")
            
            # 接收消息（最多 15 秒）
            print("📥 等待接收消息 (15 秒)...")
            start_time = time.time()
            message_count = 0
            
            while time.time() - start_time < 15:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1)
                    message_count += 1
                    data = json.loads(msg)
                    print(f"📥 收到 #{message_count}: {data.get('type', 'unknown')}")
                    
                    # 打印詳細內容
                    if data.get('type') == 'quote':
                        print(f"   股票: {data.get('code')} - {data.get('name')}")
                        print(f"   價格: {data.get('last_price')}")
                        print(f"   升跌: {data.get('change')} ({data.get('pct_change')}%)")
                    elif data.get('type') == 'init_result':
                        print(f"   成功: {data.get('success')}")
                        print(f"   訊息: {data.get('message')}")
                    
                except asyncio.TimeoutError:
                    elapsed = int(time.time() - start_time)
                    print(f"⏳ 等待中... ({elapsed}/15 秒，已收到 {message_count} 條消息)")
                    continue
            
            print(f"\n📊 總共收到 {message_count} 條消息")
            
    except Exception as e:
        print(f"❌ 錯誤: {e}")


if __name__ == "__main__":
    asyncio.run(test_ws_client())
