#!/usr/bin/env python3
"""
StockPulse WebSocket 測試腳本
測試 WebSocket 連接、init action、報價廣播
"""

import asyncio
import json
import time
import sys
sys.path.insert(0, 'backend')

from websockets.client import connect as ws_connect

BACKEND_URL = "ws://127.0.0.1:18792/ws/quote"
TEST_CODES = ['HK.00700', 'HK.00981', 'HK.00005', 'HK.01810', 'HK.02382']

async def test_websocket_flow():
    """測試 WebSocket 完整流程"""
    print("=" * 60)
    print("StockPulse WebSocket 測試")
    print("=" * 60)
    
    try:
        print(f"\n[1] 連接 {BACKEND_URL}...")
        async with ws_connect(BACKEND_URL) as ws:
            print(f"[2] 連接成功，等待片刻...")
            await asyncio.sleep(0.5)  # 等待一下
            
            # 直接發送 init action（不等 greeting）
            print(f"\n[3] 發送 init action...")
            init_msg = {"action": "init", "codes": TEST_CODES}
            await ws.send(json.dumps(init_msg))
            print(f"    已發送: {init_msg}")
            
            # 等待 init_result
            print(f"\n[4] 等待 init_result...")
            try:
                result = await asyncio.wait_for(ws.recv(), timeout=10.0)
                print(f"    收到: {result}")
            except asyncio.TimeoutError:
                print("    ❌ Timeout - 沒有收到 init_result")
                return False
            
            # 等待一段時間看是否有報價
            print(f"\n[6] 等待報價（10秒）...")
            quotes_received = []
            start = time.time()
            
            while time.time() - start < 10:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                    data = json.loads(msg)
                    print(f"    收到消息: type={data.get('type')}, code={data.get('code')}")
                    if data.get('type') == 'quote':
                        quotes_received.append(data)
                except asyncio.TimeoutError:
                    print("    (等待中...)")
                    break
            
            print(f"\n[7] 測試結果:")
            print(f"    收到 greeting: ✓")
            print(f"    收到 init_result: ✓" if result else "    收到 init_result: ✗")
            print(f"    收到報價數量: {len(quotes_received)}")
            
            if quotes_received:
                print(f"\n    報價詳情:")
                for q in quotes_received[:3]:
                    print(f"      {q.get('code')}: {q.get('last_price')}")
                return True
            else:
                print(f"\n    ❌ 沒有收到任何報價")
                return False
                
    except Exception as e:
        print(f"\n❌ 錯誤: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_direct_futu():
    """測試直接連接 FutuOpenD"""
    print("\n" + "=" * 60)
    print("測試直接連接 FutuOpenD")
    print("=" * 60)
    
    try:
        from futu import OpenQuoteContext, SubType
        
        print("\n[1] 連接 FutuOpenD...")
        ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
        print("    連接成功")
        
        print("\n[2] 訂閱 HK.00700...")
        ret, data = ctx.subscribe(['HK.00700'], [SubType.QUOTE])
        print(f"    訂閱結果: ret={ret}")
        
        if ret == 0:
            print("\n[3] 等待報價（3秒）...")
            time.sleep(3)
            ret, quote = ctx.get_stock_quote(['HK.00700'])
            print(f"    報價結果: ret={ret}")
            if ret == 0:
                print(f"    報價: {quote}")
        else:
            print(f"    ❌ 訂閱失敗: {data}")
        
        ctx.close()
        return ret == 0
        
    except Exception as e:
        print(f"\n❌ 錯誤: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    print("\n" + "=" * 60)
    print("測試1: 直接 WebSocket 測試")
    print("=" * 60)
    ws_ok = await test_websocket_flow()
    
    print("\n" + "=" * 60)
    print("測試2: 直接 FutuOpenD 測試")
    print("=" * 60)
    futu_ok = await test_direct_futu()
    
    print("\n" + "=" * 60)
    print("總結")
    print("=" * 60)
    print(f"WebSocket 測試: {'✓ 通過' if ws_ok else '❌ 失敗'}")
    print(f"FutuOpenD 測試: {'✓ 通過' if futu_ok else '❌ 失敗'}")
    
    return ws_ok and futu_ok

if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0 if result else 1)
