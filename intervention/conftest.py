import sys
from pathlib import Path

# Make intervention/src/ importable as bare module names
# (rollback_engine, commit_guard, intervention_coordinator, etc.)
sys.path.insert(0, str(Path(__file__).parent / "src"))
