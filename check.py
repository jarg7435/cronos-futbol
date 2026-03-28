with open('js/00_firebase_init.js', 'r', encoding='utf-8') as f:
    code = f.read()

import jsbeautifier # if available, else just check basic
try:
    opens = code.count('{')
    closes = code.count('}')
    print(f"Braces: {opens} open, {closes} close")
    op = code.count('(')
    cp = code.count(')')
    print(f"Parentheses: {op} open, {cp} close")
except Exception as e:
    print(e)
