# -*- coding: utf-8 -*-
"""產出第 3／4／5 站的候選字庫草稿（一次性工具）。

來源：維基教科書《倉頡輸入法/取碼原則》例字表（權威教材）
覆核：Unicode Unihan kCangjie（三代碼）
常用度：kGradeLevel（教育部年級）、kBigFive／kHKGlyph（港台常用字集）
"""
import urllib.request, zipfile, io, re

ROOT = 'C:/wb/P5_typing-game'
RAW = 'C:/Users/ekeong/AppData/Local/Temp/cjraw.txt'

RAD2LET = {'日': 'A', '月': 'B', '金': 'C', '木': 'D', '水': 'E', '火': 'F', '土': 'G',
           '竹': 'H', '戈': 'I', '十': 'J', '大': 'K', '中': 'L', '一': 'M', '弓': 'N',
           '人': 'O', '心': 'P', '手': 'Q', '口': 'R', '尸': 'S', '廿': 'T', '山': 'U',
           '女': 'V', '田': 'W', '卜': 'Y', '難': 'X', '重': 'X'}

# ---------- 1. Unihan ----------
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(
    "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip", timeout=300).read()))
cj, grade, big5, hkg, strokes = {}, {}, set(), set(), {}
for n in z.namelist():
    for line in z.read(n).decode('utf-8', 'replace').splitlines():
        if line.startswith('#') or line.count('\t') < 2:
            continue
        cp, f, v = line.split('\t')[:3]
        try:
            ch = chr(int(cp[2:], 16))
        except Exception:
            continue
        if f == 'kCangjie':
            cj.setdefault(ch, []).append(v)
        elif f == 'kGradeLevel':
            grade[ch] = v
        elif f == 'kBigFive':
            big5.add(ch)
        elif f == 'kHKGlyph':
            hkg.add(ch)
        elif f == 'kTotalStrokes':
            strokes[ch] = v.split()[0]
print("Unihan：kCangjie %d ｜ kGradeLevel %d ｜ kBigFive %d ｜ kHKGlyph %d"
      % (len(cj), len(grade), len(big5), len(hkg)))

def norm(s):
    return (s or '').replace('Z', 'X')

def unihan_letters(ch):
    v = cj.get(ch)
    return norm(v[0].split()[0]) if v else ''

def common_tag(ch):
    g = grade.get(ch)
    if g:
        return int(g), ('小%s' % g)
    if ch in hkg:
        return 6, 'HK字形'
    if ch in big5:
        return 7, 'Big5'
    return 99, '罕用'

# ---------- 2. 教材例字 ----------
lines = open(RAW, encoding='utf-8').read().split('\n')

def clean(s):
    s = re.sub(r'-\{([^}]*)\}-', r'\1', s)
    s = re.sub(r'\[\[Image:[^\]]*\]\]', '', s)
    s = re.sub(r"'''", '', s)
    while re.search(r'\{\{[^{}]*\}\}', s):
        s = re.sub(r'\{\{([^{}|]*\|)?([^{}]*)\}\}', r'\2', s)
    s = re.split(r'[（(]', s)[0]
    s = s.replace('・', '').replace('·', '').replace('　', '').replace(' ', '')
    return s.lstrip('|!').strip()

def img_chars(line):
    out = []
    for c in re.findall(r'\[\[Image:[^|\]]*\|[^|\]]*\|([^\]]+)\]\]', line):
        c = re.sub(r'-\{(.*)\}-', r'\1', c.strip())
        if len(c) == 1:
            out.append(c)
    return out

def cells(line):
    return [clean(c) for c in line.strip().lstrip('|').lstrip('!').split('||')]

sec, res, i = '(root)', {}, 0
while i < len(lines):
    ln = lines[i]
    m = re.match(r'^(=+)\s*(.+?)\s*\1\s*$', ln)
    if m:
        sec = m.group(2); res.setdefault(sec, []); i += 1; continue
    mc = re.match(r'^\|\s*\{\{:倉頡輸入法/S\d+[SB]\|([^}|]+)\}\}', ln)
    if mc:
        ch = re.sub(r'-\{(.*)\}-', r'\1', mc.group(1).strip())
        code = clean(lines[i + 2]) if i + 2 < len(lines) else ''
        expl = ''
        if i + 4 < len(lines):
            cand = lines[i + 4].strip()
            if (cand.startswith('|') and not cand.startswith(('|-', '|}', '!'))
                    and 'S14' not in cand and 'S50' not in cand):
                expl = clean(cand)
        if len(ch) == 1 and re.fullmatch(r'[\u3400-\u9fff]+', code or ''):
            res.setdefault(sec, []); res[sec].append([ch, code, expl])
        i += 1; continue
    if ln.strip().startswith('!') and '例字' in ln:
        chs, j = [], i + 1
        while j < len(lines) and not lines[j].strip().startswith(('|-', '!', '|}')):
            chs += img_chars(lines[j]); j += 1
        cds, k = [], j
        while k < len(lines) and not lines[k].strip().startswith('|}'):
            if lines[k].strip().startswith('!') and '正確取碼' in lines[k]:
                k += 1
                while k < len(lines) and not lines[k].strip().startswith(('|-', '!', '|}')):
                    cds += [c for c in cells(lines[k]) if c]; k += 1
                break
            k += 1
        if chs and len(chs) == len(cds):
            res.setdefault(sec, []); res[sec] += [[c, d, ''] for c, d in zip(chs, cds)]
        i = j; continue
    i += 1

# ---------- 3. 既有字庫 ----------
src = open(ROOT + '/js/data.js', encoding='utf-8').read()
def pool(name):
    m = re.search(r'"%s"\s*:\s*\[' % name, src); s = m.end()
    n = re.search(r'\n  "', src[s:])
    return src[s:s + (n.start() if n else len(src))]
existing = {}
for name, label in (('connected_words', '站1 連體字'), ('split_words', '站2 分體字'),
                    ('special_words', '站6 難字複合')):
    for ch in re.findall(r'"char"\s*:\s*"(.)"', pool(name)):
        existing[ch] = label

# ---------- 4. 組站 ----------
def uniq(rows):
    seen, out = set(), []
    for ch, code, expl in rows:
        if len(ch) != 1 or ch in seen:
            continue
        seen.add(ch); out.append((ch, code, expl))
    return out

STATIONS = [
    ('abbrev', '站 3', '精簡＋先繁後簡原則', 'abbrev_words', 30,
     uniq(res.get('精簡原則', []) +
          [('丰', '手十', '取碼「十十十」不如「手十」精簡'),
           ('衣', '卜竹女', '取碼「卜竹女人」不如「卜竹女」精簡')] +
          res.get('先繁後簡原則', []) +
          res.get('部分省略', [])),
     None,
     None),
    ('feature', '站 4', '字形特徵原則', 'feature_words', 28,
     uniq(res.get('區塊分則', []) + res.get('轉角分則', []) +
          res.get('對稱分則', []) + res.get('跨越分則', [])),
     None, None),
    ('omit', '站 5', '包含省略原則', 'omit_words', 25,
     uniq(res.get('包含省略', []) + res.get('複雜的外框例字', [])),
     uniq(res.get('不適用包含省略的字形', [])),
     '附錄：教材列為「不適用包含省略」的對照字（可用來出辨別題，非本站例字）'),
]
NOTE3 = ('> 其中 **10 字取自「部分省略」例字表**（勤僅艱漢郵睡腥慧豐逢）—— '
         '該節屬「省略原則」，因與「精簡原則」同屬取碼從簡的思路而納入，'
         '以達到「每站 25–35 字」的既定目標。如要剔除，說一聲即可。')

def info(ch, code, expl):
    codes = list(code)
    letters = ''.join(RAD2LET.get(c, '?') for c in codes)
    u = unihan_letters(ch)
    pr, tag = common_tag(ch)
    return {'ch': ch, 'codes': codes, 'letters': letters, 'full': code,
            'u': u or '—', 'agree': (u == letters), 'pr': pr, 'tag': tag,
            'strokes': strokes.get(ch, ''), 'dup': existing.get(ch, ''),
            'expl': expl}

out, summary, snippets = [], [], []
assigned = {}
out.append('# 字庫草稿：站 3 / 4 / 5\n')
out.append('| 項目 | 內容 |')
out.append('|---|---|')
out.append('| 例字來源 | 維基教科書《倉頡輸入法/取碼原則》—— 逐節例字表 |')
out.append('| 碼覆核 | Unicode Unihan `kCangjie`（實測＝**三代**，與本專案一致） |')
out.append('| 常用度判準 | `kGradeLevel`（教育部年級）→ `kHKGlyph`（香港字形）→ `kBigFive` |')
out.append('| 狀態 | **尚未寫入 `js/data.js`**，請先審閱 |\n')

for key, sta, name, arr, target, core, extra, extitle in STATIONS:
    rows = [info(*r) for r in core]
    for r in rows:
        if r['ch'] in assigned:
            r['dup'] = r['dup'] or ('已歸 %s' % assigned[r['ch']])
    good = [r for r in rows if not r['dup'] and r['pr'] < 99]
    good.sort(key=lambda r: (r['pr'], int(r['strokes'] or 99)))
    pick, rest = good[:target], good[target:]
    for r in pick:
        assigned[r['ch']] = sta
    flagged = [r for r in rows if r['dup'] or r['pr'] >= 99]
    summary.append((sta, name, len(rows), len(good), len(pick),
                    sum(1 for r in rows if not r['agree'])))

    out.append('\n---\n\n## %s · %s\n' % (sta, name))
    if sta == '站 3':
        out.append(NOTE3 + '\n')
    out.append('教材例字共 **%d** 個 → 扣掉生僻／與既有字庫重複後剩 **%d** 個 → 本站建議取 **%d** 個。\n'
               % (len(rows), len(good), len(pick)))
    out.append('### 建議字表（%d 字）\n' % len(pick))
    out.append('| # | 字 | 字根 | 全碼 | 常用度 | 覆核 |')
    out.append('|---|---|---|---|---|---|')
    for n, r in enumerate(pick, 1):
        out.append('| %d | **%s** | %s | %s (%s) | %s | %s |' % (
            n, r['ch'], '·'.join(r['codes']), r['full'], r['letters'], r['tag'],
            '✓' if r['agree'] else '⚠Unihan=' + r['u']))
    if rest:
        out.append('\n### 備選（%d 字，可替換上表）\n' % len(rest))
        out.append('　' + '　'.join('%s(%s)' % (r['ch'], r['tag']) for r in rest))
    if flagged:
        out.append('\n### 已排除／需注意（%d 字）\n' % len(flagged))
        out.append('| 字 | 理由 |')
        out.append('|---|---|')
        for r in flagged:
            why = []
            if r['dup']:
                why.append('已在 %s' % r['dup'])
            if r['pr'] >= 99:
                why.append('罕用（非小學字）')
            if not r['agree']:
                why.append('碼與 Unihan 不符（Unihan=%s）' % r['u'])
            out.append('| %s | %s |' % (r['ch'], '；'.join(why)))
    if extra:
        out.append('\n### %s\n' % (extitle or '附錄'))
        out.append('　' + '　'.join('%s(%s)' % (e[0], ''.join(RAD2LET.get(c, '?') for c in e[1]))
                                   for e in extra[:40]))
    snippets.append((arr, pick))

out.append('\n---\n\n## 可直接貼進 `js/data.js` 的片段\n')
out.append('> `autoDeriveWordKeys` **實際上從未被呼叫**，所以 `keys`／`full` 必須明確寫入。\n')
out.append('```js\n')
for arr, pick in snippets:
    out.append('  "%s": [\n' % arr)
    for r in pick:
        sec_txt = {'abbrev_words': '精簡／先繁後簡原則', 'feature_words': '字形特徵原則',
                   'omit_words': '包含省略原則'}[arr]
        secret = '【%s】「%s」取%s。全碼：%s (%s)。' % (
            sec_txt, r['ch'],
            '＋'.join('【%s(%s)】' % (c, RAD2LET.get(c, '?')) for c in r['codes']),
            r['full'], r['letters'])
        secret += ('　' + r['expl']) if r['expl'] else '〔取碼理由待補〕'
        out.append('    { "char": "%s", "codes": [%s], "keys": [%s], "full": "%s (%s)", "secret": "%s" },\n' % (
            r['ch'], ', '.join('"%s"' % c for c in r['codes']),
            ', '.join('"%s"' % RAD2LET.get(c, '?') for c in r['codes']),
            r['full'], r['letters'], secret))
    out.append('  ],\n')
out.append('```\n')

# ---------- 5. 可選：直接寫進 js/data.js ----------
import sys
if '--write-data' in sys.argv:
    def entry(r, arr):
        rec = {'abbrev_words': '精簡／先繁後簡原則', 'feature_words': '字形特徵原則',
               'omit_words': '包含省略原則'}[arr]
        secret = '【%s】「%s」取%s。全碼：%s (%s)。' % (
            rec, r['ch'],
            '＋'.join('【%s(%s)】' % (c, RAD2LET.get(c, '?')) for c in r['codes']),
            r['full'], r['letters'])
        secret += ('　' + r['expl']) if r['expl'] else '〔取碼理由待補〕'
        keys = [RAD2LET.get(c, '?') for c in r['codes']]
        L = ['    {', '      "char": "%s",' % r['ch'], '      "codes": [']
        L += ['        "%s"%s' % (c, ',' if i < len(r['codes']) - 1 else '')
              for i, c in enumerate(r['codes'])]
        L += ['      ],', '      "secret": "%s",' % secret, '      "keys": [']
        L += ['        "%s"%s' % (k, ',' if i < len(keys) - 1 else '')
              for i, k in enumerate(keys)]
        L += ['      ],', '      "full": "%s (%s)"' % (r['full'], r['letters']), '    },']
        return '\n'.join(L)

    file = ROOT + '/js/data.js'
    cur = open(file, encoding='utf-8').read()
    # 舊正則要求區塊結尾是「\n  ],」（帶逗號），故最後一個鍵（結尾為「\n  ]」不帶逗號）
    # 永遠刪不掉，每跑一次就疊一份重複區塊。改成結尾逗號可有可無，並清掉殘留空行。
    cur = re.sub(r'\n  "(?:abbrev|feature|omit)_words": \[.*?\n  \]\s*,?', '', cur, flags=re.S)
    cur = re.sub(r'\n{3,}', '\n\n', cur)          # 收斂殘留空行
    blocks = []
    for arr, pick in snippets:
        body = '\n'.join(entry(r, arr) for r in pick)
        body = body.rstrip(',')
        blocks.append('  "%s": [\n%s\n  ]' % (arr, body))
    joined = ',\n\n'.join(blocks)
    # 插入點＝DATA 物件結尾的「};」。移除區塊後會在結尾留下多餘空行與尾端逗號，
    # 若不先收乾淨，新區塊會與舊逗號黏成語法錯誤（`], ,`）。故以結尾為準重組。
    ends = re.findall(r'\n\};\n', cur)
    assert len(ends) == 1, '找不到唯一插入點'
    at = cur.index('\n};\n')
    head = cur[:at].rstrip().rstrip(',')
    cur = head + ',\n\n' + joined + '\n};' + cur[at + len('\n};') - 1:]
    open(file, 'w', encoding='utf-8').write(cur)
    print('已寫入 js/data.js：%s' % '、'.join('%s %d 字' % (a, len(p)) for a, p in snippets))
out.append('\n> ⚠ `keys`／`full` 由本腳本直接產生，**不要依賴 `js/cangjie.js` 的 `autoDeriveWordKeys`**：\n'
           '> 該函式實際上從未被任何地方呼叫（2026-10-13 查證），新增字庫時 `keys`／`full` 必須寫明。')

open(ROOT + '/docs/WORD_BANK_DRAFT.md', 'w', encoding='utf-8').write('\n'.join(out))
print('\n=== 已寫出 docs/WORD_BANK_DRAFT.md ===')
for sta, name, n, good, pick, bad in summary:
    print('%s %-16s 教材 %3d 字｜可用 %3d｜建議 %2d｜碼不符 %d' % (sta, name, n, good, pick, bad))
