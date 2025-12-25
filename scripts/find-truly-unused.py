#!/usr/bin/env python3
# AI : Script to find truly unused exports by filtering out false positives from ts-prune
# AI : Only shows exports that are NOT referenced anywhere in the codebase

import subprocess
import re
import os
from pathlib import Path, PureWindowsPath
from typing import List, Dict, Optional, Tuple

# ANSI color codes for terminal output
class Color:
    CYAN = '\033[96m'
    YELLOW = '\033[93m'
    GREEN = '\033[92m'
    RED = '\033[91m'
    RESET = '\033[0m'

def colored(text: str, color: str) -> str:
    """Return colored text"""
    return f"{color}{text}{Color.RESET}"

def remove_comments(content: str) -> str:
    """Remove single-line and multi-line comments from TypeScript/JavaScript code"""
    # Remove single-line comments (// ...)
    lines = content.split('\n')
    lines_without_single_comments = []
    
    for line in lines:
        # Find the first occurrence of // not inside a string
        match = re.search(r'^(.+?)//', line)
        if match:
            lines_without_single_comments.append(match.group(1))
        else:
            lines_without_single_comments.append(line)
    
    content_no_single = '\n'.join(lines_without_single_comments)
    
    # Remove multi-line comments (/* ... */)
    content_no_multi = re.sub(r'/\*[\s\S]*?\*/', '', content_no_single)
    
    return content_no_multi

def normalize_path(path: str) -> str:
    """Normalize a path for consistent comparison"""
    return str(Path(path).resolve()).lower()

def search_in_files(export_name: str, search_paths: List[str], definition_file_path: str) -> Optional[str]:
    """
    Search for export name in TypeScript/Vue files
    Returns the file path where it was found, or None if not found
    """
    # Normalize definition file for comparison
    definition_normalized = normalize_path(definition_file_path)
    
    for search_path in search_paths:
        search_dir = Path(search_path)
        if not search_dir.exists():
            continue
        
        # Find all .ts, .tsx, and .vue files recursively
        for ext in ['**/*.ts', '**/*.tsx', '**/*.vue']:
            for file_path in search_dir.glob(ext):
                # Normalize current file path
                current_normalized = normalize_path(str(file_path))
                
                # Skip the file where it's defined
                if current_normalized == definition_normalized:
                    continue
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # Remove comments
                    content_no_comments = remove_comments(content)
                    
                    # Search for the export name as a whole word
                    pattern = r'\b' + re.escape(export_name) + r'\b'
                    if re.search(pattern, content_no_comments):
                        return str(file_path)
                except Exception as e:
                    # Skip files that can't be read
                    continue
    
    return None

def run_ts_prune() -> List[str]:
    """Run ts-prune and return output lines"""
    print(colored("Running ts-prune...", Color.CYAN))
    try:
        result = subprocess.run(
            ['bunx', 'ts-prune'],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent
        )
        # Filter lines that contain front, back, or shared
        lines = [
            line for line in result.stdout.split('\n')
            if any(folder in line for folder in ['\\front\\', '\\back\\', '\\shared\\'])
        ]
        return lines
    except subprocess.CalledProcessError as e:
        print(f"Error running ts-prune: {e}")
        return []

def parse_ts_prune_line(line: str) -> Optional[Tuple[str, str, str]]:
    """
    Parse ts-prune output line
    Returns (file_path, line_number, export_name) or None if not a valid line
    """
    # Pattern: path:line - exportName (optional: used in module)
    match = re.match(r'^(.+?):(\d+) - (.+?)(\s+\(used in module\))?$', line)
    if not match:
        return None
    
    file_path = match.group(1)
    line_number = match.group(2)
    export_name = match.group(3).strip()
    used_in_module = match.group(4)
    
    # Skip if marked as "used in module"
    if used_in_module:
        return None
    
    return (file_path, line_number, export_name)

def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    # Run ts-prune
    ts_prune_output = run_ts_prune()
    
    truly_unused = []
    false_positives = []
    
    search_paths = [
        str(project_root / 'front'),
        str(project_root / 'back'),
        str(project_root / 'shared')
    ]
    
    for line in ts_prune_output:
        parsed = parse_ts_prune_line(line)
        if not parsed:
            continue
        
        relative_file_path, line_number, export_name = parsed
        
        print(colored(f"Checking: {export_name} (in {relative_file_path})", Color.YELLOW))
        
        # Build absolute path from the relative Windows path in ts-prune output
        # ts-prune outputs paths like "\front\src\file.ts"
        definition_file = str(project_root / relative_file_path.lstrip('\\'))
        
        # Search for usage
        found_in = search_in_files(export_name, search_paths, definition_file)
        
        if found_in:
            print(colored(f"  -> False positive (used elsewhere)", Color.GREEN))
            false_positives.append({
                'export': export_name,
                'file': relative_file_path,
                'line': line_number,
                'found_in': found_in
            })
        else:
            print(colored(f"  -> TRULY UNUSED", Color.RED))
            truly_unused.append({
                'export': export_name,
                'file': relative_file_path,
                'line': line_number
            })
    
    # Print results
    print()
    print(colored("=" * 44, Color.CYAN))
    print(colored("TRULY UNUSED EXPORTS:", Color.RED))
    print(colored("=" * 44, Color.CYAN))
    print()
    
    if not truly_unused:
        print(colored("No truly unused exports found!", Color.GREEN))
    else:
        for item in truly_unused:
            print(colored(f"{item['file']}:{item['line']} - {item['export']}", Color.RED))
        print()
        print(colored(f"Total: {len(truly_unused)} truly unused exports", Color.RED))
    
    print()
    print(colored("=" * 44, Color.CYAN))
    print(colored("SUMMARY", Color.CYAN))
    print(colored("=" * 44, Color.CYAN))
    print(colored(f"False positives (used elsewhere): {len(false_positives)}", Color.GREEN))
    print(colored(f"Truly unused exports: {len(truly_unused)}", Color.RED))

if __name__ == '__main__':
    main()
