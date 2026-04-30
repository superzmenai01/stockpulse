#!/usr/bin/python3
"""Debug chart modal via Chrome CDP"""

from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://localhost:9222")
        page = browser.pages[0]
        
        print(f"Page: {page.url}")
        
        # Find stock rows
        rows = page.query_selector_all('[class*="compactRow"]')
        print(f"Found {len(rows)} stock rows")
        
        if rows:
            rows[0].click()
            page.wait_for_timeout(1500)
            
            modal = page.query_selector('.ant-modal')
            print(f"Modal open: {modal is not None}")
            
            state = page.evaluate("""() => {
                const charts = document.querySelectorAll('[class*="chart"]');
                const panels = document.querySelectorAll('[class*="panel"]');
                const modals = document.querySelectorAll('.ant-modal');
                return {
                    chartCount: charts.length,
                    panelCount: panels.length,
                    modalCount: modals.length,
                    panelClasses: Array.from(panels).map(p => p.className).slice(0, 5)
                };
            }""")
            print(f"State: {state}")
            
            page.screenshot(path='/Users/zmenai/stockpulse/debug-screenshot.png')
            print("Screenshot saved")

if __name__ == '__main__':
    main()
