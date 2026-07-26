"""
StockPulse Mini App Backend
Connects to FutuOpenD and serves REST API for Telegram Mini App
"""
import os
import json
import asyncio
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# === CONFIG ===
PORT = 18793
WATCHLIST_FILE = os.path.join(os.path.dirname(__file__), 'data', 'watchlist.json')
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

# === ENUM ===
class SubType:
    K_1M = '1K'
    K_5M = '5K'
    K_15M = '15K'
    K_30M = '30K'
    K_60M = '60K'
    K_DAY = 'DK'
    K_WEEK = 'WK'
    K_MON = 'MK'

class AuType:
    QFQ = 'qfq'
    HFQ = 'hfq'
    NONE = 'none'

# === INIT ===
os.makedirs(DATA_DIR, exist_ok=True)
app = Flask(__name__, static_folder='../frontend')
CORS(app)

# === WATCHLIST CRUD ===
def load_watchlist():
    if not os.path.exists(WATCHLIST_FILE):
        return {'stocks': [], 'alerts': []}
    try:
        with open(WATCHLIST_FILE, 'r') as f:
            return json.load(f)
    except:
        return {'stocks': [], 'alerts': []}

def save_watchlist(data):
    with open(WATCHLIST_FILE, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def init_futu():
    """延遲初始化，等asyncio事件循環運行"""
    global quote_ctx, trd_ctx
    if 'quote_ctx' not in globals() or quote_ctx is None:
        from futu import OpenQuoteContext
        quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
    return quote_ctx

# === FUTU CONTEXT ===
quote_ctx = None

def get_quote_ctx():
    global quote_ctx
    if quote_ctx is None:
        try:
            from futu import OpenQuoteContext
            quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
        except Exception as e:
            print(f"Futu init error: {e}")
            return None
    return quote_ctx

# === ROUTES ===

@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route('/api/status')
def status():
    """檢查服務狀態和富途連接"""
    ctx = get_quote_ctx()
    return jsonify({
        'status': 'ok',
        'futu_connected': ctx is not None,
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    })

@app.route('/api/watchlist', methods=['GET'])
def get_watchlist():
    """獲取自選列表"""
    data = load_watchlist()
    return jsonify(data)

@app.route('/api/watchlist', methods=['POST'])
def add_stock():
    """添加股票到自選"""
    body = request.json
    code = body.get('code', '').strip().upper()
    name = body.get('name', code)
    market = body.get('market', 'HK')
    
    if not code:
        return jsonify({'error': '股票代碼不能為空'}), 400
    
    # 標準化代碼格式
    if market == 'HK' and not code.startswith('HK.'):
        code = f'HK.{code}'
    elif market == 'US' and not code.startswith('US.'):
        code = f'US.{code}'
    elif market == 'SH' and not code.startswith('SH.'):
        code = f'SH.{code}'
    elif market == 'SZ' and not code.startswith('SZ.'):
        code = f'SZ.{code}'
    
    data = load_watchlist()
    
    # 檢查是否已存在
    if any(s['code'] == code for s in data.get('stocks', [])):
        return jsonify({'error': '股票已存在於自選列表'}), 400
    
    data.setdefault('stocks', [])
    data['stocks'].append({
        'code': code,
        'name': name,
        'market': market,
        'added_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    })
    
    save_watchlist(data)
    
    # 自動訂閱
    ctx = get_quote_ctx()
    if ctx:
        try:
            ret, _ = ctx.subscribe([code], [SubType.K_DAY], subscribe_push=False)
            print(f"Subscribed {code}: ret={ret}")
        except Exception as e:
            print(f"Subscribe error: {e}")
    
    return jsonify({'success': True, 'stock': code})

@app.route('/api/watchlist/<code>', methods=['DELETE'])
def remove_stock(code):
    """刪除股票"""
    data = load_watchlist()
    original_count = len(data.get('stocks', []))
    data['stocks'] = [s for s in data.get('stocks', []) if s['code'] != code]
    
    if len(data['stocks']) == original_count:
        return jsonify({'error': '股票不在列表中'}), 404
    
    save_watchlist(data)
    return jsonify({'success': True})

@app.route('/api/watchlist/<code>', methods=['PATCH'])
def update_stock(code):
    """更新股票資訊（如備註）"""
    body = request.json
    data = load_watchlist()
    
    for stock in data.get('stocks', []):
        if stock['code'] == code:
            stock.update({k: v for k, v in body.items() if k in ['name', 'note', 'alert_above', 'alert_below']})
            save_watchlist(data)
            return jsonify({'success': True})
    
    return jsonify({'error': '股票不在列表中'}), 404

@app.route('/api/quote/<codes>')
def get_quote(codes):
    """獲取股票報價（多個代碼用逗號分隔）"""
    ctx = get_quote_ctx()
    if ctx is None:
        return jsonify({'error': '富途連接失敗'}), 500
    
    code_list = [c.strip() for c in codes.split(',')]
    
    try:
        ret, data = ctx.get_market_snapshot(code_list)
        if ret != 0:
            return jsonify({'error': f'獲取報價失敗: {data}'}), 500
        return jsonify({'success': True, 'data': data.to_dict('records') if hasattr(data, 'to_dict') else data})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/kline/<code>')
def get_kline(code):
    """獲取K線數據"""
    ctx = get_quote_ctx()
    if ctx is None:
        return jsonify({'error': '富途連接失敗'}), 500
    
    ktype = request.args.get('type', 'DK')  # DK=日K, 1K=1分鐘
    num = int(request.args.get('num', 100))
    
    try:
        ret, data = ctx.get_cur_kline(code, num, SubType[ktype], AuType.QFQ)
        if ret != 0:
            return jsonify({'error': f'獲取K線失敗: {data}'}), 500
        return jsonify({'success': True, 'data': data.to_dict('records') if hasattr(data, 'to_dict') else data})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/alert', methods=['POST'])
def add_alert():
    """設置價格警報"""
    body = request.json
    code = body.get('code', '').upper()
    alert_type = body.get('type')  # 'above' or 'below'
    price = float(body.get('price', 0))
    
    if not code or not alert_type or price <= 0:
        return jsonify({'error': '參數不完整'}), 400
    
    data = load_watchlist()
    data.setdefault('alerts', [])
    data['alerts'].append({
        'id': f"{code}_{alert_type}_{price}",
        'code': code,
        'type': alert_type,
        'price': price,
        'enabled': True,
        'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    })
    save_watchlist(data)
    return jsonify({'success': True})

@app.route('/api/alert/<alert_id>', methods=['DELETE'])
def delete_alert(alert_id):
    """刪除警報"""
    data = load_watchlist()
    data['alerts'] = [a for a in data.get('alerts', []) if a['id'] != alert_id]
    save_watchlist(data)
    return jsonify({'success': True})

@app.route('/api/alerts')
def get_alerts():
    """獲取所有警報"""
    data = load_watchlist()
    return jsonify(data.get('alerts', []))

@app.route('/api/positions')
def get_positions():
    """獲取持倉（需要登入）"""
    ctx = get_quote_ctx()
    if ctx is None:
        return jsonify({'error': '富途連接失敗'}), 500
    
    try:
        from futu import TrdContext, TrdMarket, TrdEnv
        trd_ctx = ctx  # OpenQuoteContext包含交易功能
        ret, data = ctx.position_list_query(trd_market=TrdMarket.HK, trd_env=TrdEnv.SIMULATE)
        if ret != 0:
            # 嘗試真實帳戶
            ret, data = ctx.position_list_query(trd_market=TrdMarket.HK, trd_env=TrdEnv.REAL)
        return jsonify({'success': True, 'data': data.to_dict('records') if hasattr(data, 'to_dict') else data})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# === STATIC FILES ===
@app.route('/<path:path>')
def static_files(path):
    if os.path.exists(os.path.join('../frontend', path)):
        return send_from_directory('../frontend', path)
    return jsonify({'error': 'Not found'}), 404

# === MAIN ===
if __name__ == '__main__':
    print(f"🚀 StockPulse Mini App Backend starting on port {PORT}")
    print(f"📂 Data file: {WATCHLIST_FILE}")
    print(f"🌐 Open http://localhost:{PORT} for the Mini App")
    app.run(host='0.0.0.0', port=PORT, debug=False)