const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = browser.contexts()[0];
    
    let targetPage = null;
    for (const page of context.pages()) {
        if (page.url().includes('test-kline')) {
            targetPage = page;
            break;
        }
    }
    
    if (targetPage) {
        console.log('找到页面:', targetPage.title());
        
        // 刷新
        await targetPage.reload();
        console.log('已刷新');
        
        await targetPage.waitForTimeout(3000);
        
        // 截图
        await targetPage.screenshot({ path: '/tmp/test-kline-after.png' });
        console.log('截图保存到 /tmp/test-kline-after.png');
        
        // 获取内容
        const text = await targetPage.innerText('body');
        console.log('页面内容预览:', text.substring(0, 800));
        
        // 获取 Console 日志
        const logs = await targetPage.evaluate(() => {
            return window.__consoleLogs || 'no logs';
        });
        console.log('Console logs:', logs);
        
    } else {
        console.log('未找到 test-kline 页面');
        // 列出所有页面
        console.log('所有页面:');
        for (const page of context.pages()) {
            console.log(' -', page.url());
        }
    }
    
    await browser.close();
})();
