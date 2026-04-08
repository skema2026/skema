import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import app.main
    print("IMPORT OK")
except Exception as e:
    print(f"IMPORT ERROR: {e}")
    import traceback
    traceback.print_exc()
