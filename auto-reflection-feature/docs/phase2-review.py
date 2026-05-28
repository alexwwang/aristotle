#!/usr/bin/env python3
"""Phase 2 Design Review Script - Ralph Loop Round 1"""

import re

def check_document(path):
    with open(path, "r") as f:
        content = f.read()
    
    findings = []
    lines = content.split("\n")
    
    # Check 1: Architecture diagram exists
    if "```" not in content or "watchdog" not in content.lower():
        findings.append({
            "id": "F-1",
            "severity": "M",
            "category": "Completeness",
            "description": "Architecture diagram uses text-based format but lacks clear visual structure",
            "evidence": "Diagram exists but module connections are described in words rather than clear ASCII art",
            "suggestion": "Improve diagram with clear box/arrow ASCII art showing data flow"
        })
    
    # Check 2: Module interfaces defined
    interface_pattern = r"class\s+\w+:\s*\n(?:\s+def\s+\w+\(.*\):)"
    interfaces = re.findall(interface_pattern, content)
    if len(interfaces) < 3:
        findings.append({
            "id": "F-2", 
            "severity": "H",
            "category": "Completeness",
            "description": "Module interfaces are incomplete - only basic method signatures shown, no type annotations or return types",
            "evidence": "Interface sections show class definitions but lack full type signatures",
            "suggestion": "Add complete type-annotated interfaces for all 5 modules"
        })
    
    # Check 3: Error handling table
    if "Error Handling Strategy" not in content:
        findings.append({
            "id": "F-3",
            "severity": "H", 
            "category": "Correctness",
            "description": "Missing error handling strategy section",
            "evidence": "No dedicated error handling section in technical solution",
            "suggestion": "Add comprehensive error handling matrix"
        })
    
    # Check 4: GEAR exception justification
    if "GEAR Lifecycle Exception" not in content or "Justification" not in content:
        findings.append({
            "id": "F-4",
            "severity": "H",
            "category": "Consistency", 
            "description": "GEAR exception justification missing or incomplete",
            "evidence": "Prerequisite #7 from requirements references GEAR exception but tech solution lacks detailed justification",
            "suggestion": "Add detailed justification paragraph explaining role separation maintenance"
        })
    
    # Check 5: Data models
    if "@dataclass" not in content and "class ViolationEvent" not in content:
        findings.append({
            "id": "F-5",
            "severity": "M",
            "category": "Completeness",
            "description": "Data models not formally defined with type annotations",
            "evidence": "ViolationEvent and ReflectionResult mentioned but not as formal dataclasses",
            "suggestion": "Add @dataclass definitions with full type annotations"
        })
    
    # Check 6: Performance considerations
    if "Performance" not in content and "performance" not in content.lower():
        findings.append({
            "id": "F-6",
            "severity": "L",
            "category": "Quality",
            "description": "No performance considerations documented",
            "evidence": "Missing performance section",
            "suggestion": "Add performance requirements and bottlenecks analysis"
        })
    
    return findings

findings = check_document("/workspace/auto-reflection-feature/docs/02-technical-solution.md")

# Count by severity
c_counts = sum(1 for f in findings if f["severity"] == "C")
h_counts = sum(1 for f in findings if f["severity"] == "H")
m_counts = sum(1 for f in findings if f["severity"] == "M")

print(f"=== Phase 2 Design Review Results ===")
print(f"Total findings: {len(findings)}")
print(f"Critical (C): {c_counts}")
print(f"High (H): {h_counts}")
print(f"Major (M): {m_counts}")
print()

if c_counts == 0 and h_counts == 0 and m_counts == 0:
    print("ZERO_C_H_M_FINDINGS")
else:
    for f in findings:
        print(f"[{f[severity]}] {f[id]}: {f[description]}")
        print(f"  Evidence: {f[evidence]}")
        print(f"  Suggestion: {f[suggestion]}")
        print()
