import urllib.request
import re

html_content = open("index.html").read()

# Let's see if something that app.js references in DOM is missing
# app.js references document.getElementById(...)
ids_in_app = re.findall(r'getElementById\("([^"]+)"\)', open("app.js").read())
ids_in_html = re.findall(r'id="([^"]+)"', html_content)

missing = set(ids_in_app) - set(ids_in_html)
print("Missing IDs that app.js looks for:", missing)
