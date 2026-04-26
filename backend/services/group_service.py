# StockPulse 組別服務
# 處理組別的 CRUD 操作

import uuid
import logging
from typing import List, Dict, Any, Optional

from data import get_cursor

logger = logging.getLogger(__name__)


class GroupService:
    """組別服務類"""
    
    @staticmethod
    def create_group(user_id: str, name: str, color: str = '#666666') -> Dict[str, Any]:
        """
        創建新組別
        
        Args:
            user_id: 用戶 ID
            name: 組別名稱
            color: 組別顏色（可選）
            
        Returns:
            dict: {
                'success': bool,
                'group': dict or None,
                'message': str
            }
        """
        try:
            group_id = str(uuid.uuid4())
            
            with get_cursor() as cursor:
                cursor.execute(
                    '''INSERT INTO groups (id, user_id, name, color)
                       VALUES (?, ?, ?, ?)''',
                    (group_id, user_id, name, color)
                )
                
                logger.info(f"[GROUP] 創建組別成功: {group_id} ({name})")
                
                return {
                    'success': True,
                    'group': {
                        'id': group_id,
                        'user_id': user_id,
                        'name': name,
                        'color': color,
                        'stock_count': 0
                    },
                    'message': '組別創建成功'
                }
                
        except Exception as e:
            logger.error(f"[GROUP] 創建組別失敗: {e}")
            return {
                'success': False,
                'group': None,
                'message': f'創建失敗: {str(e)}'
            }
    
    @staticmethod
    def get_user_groups(user_id: str) -> List[Dict[str, Any]]:
        """
        獲取用戶的所有組別
        
        Args:
            user_id: 用戶 ID
            
        Returns:
            list: 組別列表
        """
        try:
            with get_cursor() as cursor:
                cursor.execute(
                    '''SELECT g.id, g.name, g.color, g.sort_order,
                              COUNT(gs.id) as stock_count
                       FROM groups g
                       LEFT JOIN group_stocks gs ON g.id = gs.group_id
                       WHERE g.user_id = ?
                       GROUP BY g.id
                       ORDER BY g.sort_order, g.created_at''',
                    (user_id,)
                )
                
                rows = cursor.fetchall()
                groups = []
                
                for row in rows:
                    groups.append({
                        'id': row['id'],
                        'name': row['name'],
                        'color': row['color'],
                        'sort_order': row['sort_order'],
                        'stock_count': row['stock_count']
                    })
                
                logger.info(f"[GROUP] 獲取組別: user={user_id}, count={len(groups)}")
                return groups
                
        except Exception as e:
            logger.error(f"[GROUP] 獲取組別失敗: {e}")
            return []
    
    @staticmethod
    def get_group_with_stocks(group_id: str) -> Optional[Dict[str, Any]]:
        """
        獲取組別及其包含的股票
        
        Args:
            group_id: 組別 ID
            
        Returns:
            dict: 組別信息及股票列表，或 None
        """
        try:
            with get_cursor() as cursor:
                # 獲取組別信息
                cursor.execute(
                    '''SELECT id, user_id, name, color, sort_order
                       FROM groups WHERE id = ?''',
                    (group_id,)
                )
                
                row = cursor.fetchone()
                if not row:
                    return None
                
                group = {
                    'id': row['id'],
                    'user_id': row['user_id'],
                    'name': row['name'],
                    'color': row['color'],
                    'sort_order': row['sort_order'],
                    'stocks': []
                }
                
                # 獲取組別內的股票
                cursor.execute(
                    '''SELECT s.code, s.name, s.market,
                              gs.added_at
                       FROM stocks s
                       JOIN group_stocks gs ON s.code = gs.stock_code
                       WHERE gs.group_id = ?
                       ORDER BY gs.added_at''',
                    (group_id,)
                )
                
                rows = cursor.fetchall()
                for stock_row in rows:
                    group['stocks'].append({
                        'code': stock_row['code'],
                        'name': stock_row['name'],
                        'market': stock_row['market'],
                        'added_at': stock_row['added_at']
                    })
                
                return group
                
        except Exception as e:
            logger.error(f"[GROUP] 獲取組別股票失敗: {e}")
            return None
    
    @staticmethod
    def update_group(group_id: str, name: str = None, color: str = None) -> Dict[str, Any]:
        """
        更新組別
        
        Args:
            group_id: 組別 ID
            name: 新名稱（可選）
            color: 新顏色（可選）
            
        Returns:
            dict: {
                'success': bool,
                'message': str
            }
        """
        try:
            updates = []
            params = []
            
            if name is not None:
                updates.append('name = ?')
                params.append(name)
            
            if color is not None:
                updates.append('color = ?')
                params.append(color)
            
            if not updates:
                return {
                    'success': False,
                    'message': '沒有需要更新的字段'
                }
            
            params.append(group_id)
            
            with get_cursor() as cursor:
                cursor.execute(
                    f'''UPDATE groups SET {', '.join(updates)}
                        WHERE id = ?''',
                    params
                )
                
                if cursor.rowcount == 0:
                    return {
                        'success': False,
                        'message': '組別不存在'
                    }
                
                logger.info(f"[GROUP] 更新組別成功: {group_id}")
                return {
                    'success': True,
                    'message': '組別更新成功'
                }
                
        except Exception as e:
            logger.error(f"[GROUP] 更新組別失敗: {e}")
            return {
                'success': False,
                'message': f'更新失敗: {str(e)}'
            }
    
    @staticmethod
    def delete_group(group_id: str) -> Dict[str, Any]:
        """
        刪除組別
        
        注意：刪除組別會同時刪除組別-股票關聯，但不會刪除股票本身
        
        Args:
            group_id: 組別 ID
            
        Returns:
            dict: {
                'success': bool,
                'message': str
            }
        """
        try:
            with get_cursor() as cursor:
                # 刪除組別-股票關聯（級聯刪除，但明確寫更安全）
                cursor.execute(
                    'DELETE FROM group_stocks WHERE group_id = ?',
                    (group_id,)
                )
                
                # 刪除組別
                cursor.execute(
                    'DELETE FROM groups WHERE id = ?',
                    (group_id,)
                )
                
                if cursor.rowcount == 0:
                    return {
                        'success': False,
                        'message': '組別不存在'
                    }
                
                logger.info(f"[GROUP] 刪除組別成功: {group_id}")
                return {
                    'success': True,
                    'message': '組別刪除成功'
                }
                
        except Exception as e:
            logger.error(f"[GROUP] 刪除組別失敗: {e}")
            return {
                'success': False,
                'message': f'刪除失敗: {str(e)}'
            }
    
    @staticmethod
    def add_stock_to_group(group_id: str, stock_code: str) -> Dict[str, Any]:
        """
        將股票加入組別
        
        Args:
            group_id: 組別 ID
            stock_code: 股票代碼
            
        Returns:
            dict: {
                'success': bool,
                'message': str
            }
        """
        try:
            with get_cursor() as cursor:
                # 檢查組別是否存在
                cursor.execute('SELECT id FROM groups WHERE id = ?', (group_id,))
                if not cursor.fetchone():
                    return {
                        'success': False,
                        'message': '組別不存在'
                    }
                
                # 檢查股票是否存在
                cursor.execute('SELECT code FROM stocks WHERE code = ?', (stock_code,))
                if not cursor.fetchone():
                    return {
                        'success': False,
                        'message': '股票不存在'
                    }
                
                # 添加關聯
                cursor.execute(
                    '''INSERT OR IGNORE INTO group_stocks (id, group_id, stock_code)
                       VALUES (?, ?, ?)''',
                    (str(uuid.uuid4()), group_id, stock_code)
                )
                
                logger.info(f"[GROUP] 股票加入組別: {stock_code} -> {group_id}")
                return {
                    'success': True,
                    'message': '股票已加入組別'
                }
                
        except Exception as e:
            logger.error(f"[GROUP] 加入組別失敗: {e}")
            return {
                'success': False,
                'message': f'加入失敗: {str(e)}'
            }
    
    @staticmethod
    def remove_stock_from_group(group_id: str, stock_code: str) -> Dict[str, Any]:
        """
        從組別移除股票
        
        Args:
            group_id: 組別 ID
            stock_code: 股票代碼
            
        Returns:
            dict: {
                'success': bool,
                'message': str
            }
        """
        try:
            with get_cursor() as cursor:
                cursor.execute(
                    '''DELETE FROM group_stocks
                       WHERE group_id = ? AND stock_code = ?''',
                    (group_id, stock_code)
                )
                
                if cursor.rowcount == 0:
                    return {
                        'success': False,
                        'message': '股票不在組別中'
                    }
                
                logger.info(f"[GROUP] 股票移除組別: {stock_code} <- {group_id}")
                return {
                    'success': True,
                    'message': '股票已從組別移除'
                }
                
        except Exception as e:
            logger.error(f"[GROUP] 移除失敗: {e}")
            return {
                'success': False,
                'message': f'移除失敗: {str(e)}'
            }
