#!/bin/bash
# Chrome DevTools Protocol via curl

TARGET="ws://localhost:9222/devtools/page/3E491DE44C8E5DEE9FCD4311F677AE1B"

# First get the page ID
PAGE_ID=$(curl -s http://localhost:9222/json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for tab in data:
    if 'localhost:3000' in tab.get('url', ''):
        print(tab['id'])
")

echo "Page ID: $PAGE_ID"

# Try a simple evaluation using websocat or similar
# Since we don't have proper tools, let's try using node with the chrome-remote-interface package
