import sys, tokenize, io, re
from pathlib import Path

HAN_RE = re.compile(r"[\u3400-\u9FFF\uF900-\uFAFF]")

# Conservative replacements for frequent mojibake → Hangul
COMMON_MAP = {
    '怨듭쑀': '공유', '濡쒓렇': '로그', '媛뺤쓽': '과목', '寃쎌슦': '경우',
    '二쇱감': '주차', '쒓컙': '시간', '쇱젙': '일정', '쒗뿕': '시험', '몄쬆': '인증',
}

def fix_text(s: str) -> str:
    for k, v in COMMON_MAP.items():
        s = s.replace(k, v)
    return HAN_RE.sub('', s)

def fix_python_file(path: Path) -> bool:
    src = path.read_text(encoding='utf-8', errors='replace')
    lines = src.splitlines(keepends=True)
    result = []
    changed = False
    in_doc = False
    doc_delim = ''
    for ln in lines:
        stripped = ln.lstrip()
        if not in_doc and stripped.startswith('#'):
            fixed = fix_text(ln)
            if fixed != ln:
                changed = True
            result.append(fixed)
            continue
        if not in_doc and ("'''" in ln or '"""' in ln):
            # enter docstring; fix this line too
            if ln.count("'''") and ln.find("'''") != -1:
                s3 = ln.find("'''")
            else:
                s3 = 10**9
            if ln.count('"""') and ln.find('"""') != -1:
                d3 = ln.find('"""')
            else:
                d3 = 10**9
            doc_delim = "'''" if s3 < d3 else '"""'
            in_doc = True
            fixed = fix_text(ln)
            if fixed != ln:
                changed = True
            result.append(fixed)
            if ln.count(doc_delim) >= 2:
                in_doc = False
            continue
        if in_doc:
            fixed = fix_text(ln)
            if fixed != ln:
                changed = True
            result.append(fixed)
            if doc_delim in ln:
                in_doc = False
            continue
        result.append(ln)
    if changed:
        path.write_text(''.join(result), encoding='utf-8')
    return changed

if __name__ == '__main__':
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    changed_files = []
    for p in root.rglob('*.py'):
        if any(part in {'.git','node_modules','venv','.venv','__pycache__'} for part in p.parts):
            continue
        if fix_python_file(p):
            changed_files.append(str(p))
    print('\n'.join(changed_files))
