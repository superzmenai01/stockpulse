"""conftest.py — 全局 pytest fixtures (Stage 1+ Trade Journal followup)

確保每個 test 之前:
1. init_trade_journal_table() 觸發 — 加 4 個 followup column (actual_exit_date / actual_exit_price / is_correct / updated_at)
2. 清 trade_journal table — 避免之前 test run 留低 entry conflict UNIQUE constraint

不影響其他 test (其他 test 用唔同 table)。

Spec: docs/research/AS-03-cycle-detection/MODULE-J-TRADE-JOURNAL.md
"""
import pytest

from models.trade_journal import get_connection, init_trade_journal_table


@pytest.fixture(autouse=True, scope="session")
def _reset_trade_journal_session():
    """Trade Journal test 專用 fixture: session 開始 reset schema + 清 data 1 次.

    大少 15:04 揀 Full scope 後加 — Trade Journal 之前冇 conftest 處理 schema migration,
    TestClient 唔會 trigger FastAPI lifespan,所以 init_trade_journal_table() 從未跑。
    結果 column (is_correct / actual_exit_date etc) 唔存在,PUT endpoint 500。

    呢個 fixture 解決:
    1. 確保 4 個 followup column 存在 (init_trade_journal_table() 內部 call _ensure_columns)
    2. 清 trade_journal table (DELETE FROM),避免之前 test run 留低 entry 撞 UNIQUE

    Scope=session (唔係 function) 因為:
    - existing test_trade_journal.py 嘅 3 個 test (duplicate_409 / list_filter / get_by_id) 依賴
      test_post_add 嘅 entry,function scope 會清晒
    - 5 個 followup test 自我 cleanup (POST + DELETE),唔影響其他 test
    """
    init_trade_journal_table()
    with get_connection() as conn:
        conn.execute("DELETE FROM trade_journal")
        conn.commit()
