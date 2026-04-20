#!/bin/sh
# _python.sh — cross-platform Python JSON helper for wicked-testing
# Per CLAUDE.md global rules: all shell JSON output goes through this pattern.
#
# Usage:
#   sh scripts/_python.sh <inline-python-expression>
#
# Handles: macOS (python3), Linux (python3), WSL (python3 or python), Windows Git Bash (python)
#
# Pattern: always prefer python3, fall back to python
#
# Example:
#   sh scripts/_python.sh "import json,sys; sys.stdout.write(json.dumps({'ok': True}))"
#
# For native PowerShell on Windows (no WSL/Git Bash), a separate hook entry
# with "shell": "powershell" is required. See CLAUDE.md for details.

EXPR="${1}"

if [ -z "${EXPR}" ]; then
  echo '{"ok":false,"error":"No Python expression provided to _python.sh"}' >&2
  exit 1
fi

# NOTE: This script is internal to wicked-testing. EXPR is always plugin-generated,
# never user-supplied. Expressions must use single-quoted Python string literals and
# must not contain shell metacharacters (backticks, $(...), unescaped double quotes).
# Callers that need to embed double-quote characters must escape them before passing.
python3 -c "${EXPR}" 2>/dev/null || python -c "${EXPR}"
