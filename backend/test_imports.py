"""Quick import sanity check — run with venv Python."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

errors = []
modules = [
    "app.main",
    "app.auth.models",
    "app.auth.schemas",
    "app.auth.service",
    "app.schedule.models",
    "app.schedule.schemas",
    "app.schedule.service",
    "app.ai_chat.service",
    "app.ai_chat.router",
]
for mod in modules:
    try:
        __import__(mod)
        print(f"  OK  {mod}")
    except Exception as e:
        print(f"  ERR {mod}: {e}")
        errors.append(mod)

if errors:
    print(f"\nFailed: {errors}")
    sys.exit(1)
else:
    print("\nAll imports OK!")
