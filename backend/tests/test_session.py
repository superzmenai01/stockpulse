"""
StockPulse 測試

運行方式:
    ~/.futu_venv/bin/python3 -m pytest backend/tests/ -v
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from backend.ws.session import Session


class TestSessionManager:
    """SessionManager 測試"""
    
    def test_create_and_get_session(self):
        """測試創建和獲取 Session"""
        from backend.ws.session import SessionManager
        
        manager = SessionManager()
        session = manager.create_session()
        
        assert manager.get_session(session.id) is not None
        assert manager.get_session(session.id).id == session.id
    
    def test_remove_session(self):
        """測試移除 Session"""
        from backend.ws.session import SessionManager
        
        manager = SessionManager()
        session = manager.create_session()
        session_id = session.id
        
        manager.remove_session(session_id)
        assert manager.get_session(session_id) is None
    
    def test_all_sessions(self):
        """測試獲取所有 Session"""
        from backend.ws.session import SessionManager
        
        manager = SessionManager()
        session1 = manager.create_session()
        session2 = manager.create_session()
        
        all_sessions = manager._sessions
        assert len(all_sessions) >= 2
        assert session1.id in all_sessions
        assert session2.id in all_sessions


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
