#!/usr/bin/env python3
import re

with open('bridge1024.ts', 'r') as f:
    content = f.read()

# Pattern to find submitSignature calls
# We need to find: .submitSignature(...).accounts({...})
# and add .preInstructions([...]) before .signers([...])

# Replace pattern: find .accounts({...}).signers([...]) after submitSignature
# and insert .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])

pattern = r'(\.submitSignature\([^)]*\)[\s\S]*?\.accounts\([^)]*\{[^}]*\}[^)]*\))'
replacement = r'\1\n          .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])'

content = re.sub(pattern, replacement, content)

with open('bridge1024.ts', 'w') as f:
    f.write(content)

print("Added compute budget to all submitSignature calls")
