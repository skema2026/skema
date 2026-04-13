import sys, re
from pathlib import Path

HAN_RE = re.compile(r"[\u3400-\u9FFF\uF900-\uFAFF]")
COMMON_MAP = {
    '怨듭쑀': '공유', '濡쒓렇': '로그', '媛뺤쓽': '과목', '寃쎌슦': '경우',
    '二쇱감': '주차', '쒓컙': '시간', '쇱젙': '일정', '쒗뿕': '시험', '몄쬆': '인증',
}

def fix_text(s: str) -> str:
    for k, v in COMMON_MAP.items():
        s = s.replace(k, v)
    return HAN_RE.sub('', s)

def fix_ts_file(path: Path) -> bool:
    src = path.read_text(encoding='utf-8', errors='replace')
    out = []
    i = 0
    n = len(src)
    changed = False
    in_s = None
    esc = False
    while i < n:
        ch = src[i]
        nxt = src[i+1] if i+1 < n else ''
        # block comment
        if ch == '/' and nxt == '*':
            j = src.find('*/', i+2)
            if j == -1: j = n-2
            seg = src[i:j+2]
            fixed = seg[:2] + fix_text(seg[2:-2]) + seg[-2:]
            if fixed != seg: changed = True
            out.append(fixed)
            i = j + 2
            continue
        # line comment
        if ch == '/' and nxt == '/':
            j = src.find('\n', i)
            if j == -1: j = n
            seg = src[i:j]
            fixed = fix_text(seg)
            if fixed != seg: changed = True
            out.append(fixed)
            i = j
            continue
        # string begin
        if not in_s and ch in ('"', "'", '`'):
            in_s = ch
            out.append(ch)
            i += 1
            start = i
            # accumulate until matching quote (naive, escapes handled)
            buf = []
            while i < n:
                ch2 = src[i]
                buf.append(ch2)
                i += 1
                if ch2 == '\\':
                    if i < n:
                        buf.append(src[i]); i += 1
                    continue
                if ch2 == in_s:
                    content = ''.join(buf[:-1])
                    fixed = fix_text(content)
                    if fixed != content: changed = True
                    out.append(fixed); out.append(in_s)
                    in_s = None
                    break
            continue
        out.append(ch)
        i += 1
    if changed:
        path.write_text(''.join(out), encoding='utf-8')
    return changed

if __name__ == '__main__':
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    changed = []
    for ext in ('*.ts','*.tsx','*.js','*.jsx'):
        for p in root.rglob(ext):
            if any(part in {'.git','node_modules','.next','dist','build'} for part in p.parts):
                continue
            if fix_ts_file(p):
                changed.append(str(p))
    print('\n'.join(changed))
