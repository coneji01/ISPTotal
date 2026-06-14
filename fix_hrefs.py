import re, sys

pages = ["SmartoltConfigured", "SmartoltUnconfigured"]

for page in pages:
    path = f"views/pages/{page}.ejs"
    try:
        with open(path, "r", encoding="utf-8") as f:
            c = f.read()
        
        # Replace href="#" with href="javascript:void(0)"
        c = c.replace('href="#"', 'href="javascript:void(0)"')
        c = c.replace("href='#'", "href='javascript:void(0)'")
        
        with open(path, "w", encoding="utf-8") as f:
            f.write(c)
        
        print(f"{page}.ejs: OK")
    except Exception as e:
        print(f"{page}.ejs: ERROR - {e}", file=sys.stderr)
        sys.exit(1)

print("Done!")
