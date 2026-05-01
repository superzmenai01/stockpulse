# StockPulse Data Module

# Note: database.py has been removed.
# Each model (models/stock.py, models/group.py, etc.) has its own get_connection()
# pointing to stocks.db. This avoids circular imports and keeps modules independent.

__all__ = []