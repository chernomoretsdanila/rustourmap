"""Воспроизведение расчёта балла безопасности по исходным значениям индексов.

Запуск:  python tools/calc.py            — пересчёт и сверка с data/safety.json
         python tools/calc.py --report   — дополнительно AHP, порог стоп-критерия,
                                           корреляции с Госдепом и анализ чувствительности
         python tools/calc.py --csv      — выгрузка исходных значений в data/raw_values.csv
"""
import csv
import json
import math
import statistics as st
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data' / 'safety.json'

# Матрица попарных сравнений (шкала Саати), порядок факторов: GTI, Crime, GPI, CPI, FSI, HCI, EPI
AHP = [[1, 3, 3, 5, 7, 7, 7],
       [1/3, 1, 1, 3, 5, 5, 5],
       [1/3, 1, 1, 3, 5, 5, 5],
       [1/5, 1/3, 1/3, 1, 3, 3, 3],
       [1/7, 1/5, 1/5, 1/3, 1, 3, 3],
       [1/7, 1/5, 1/5, 1/3, 1/3, 1, 1],
       [1/7, 1/5, 1/5, 1/3, 1/3, 1, 1]]
RI = {3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45}


def normalize(x, lo, hi, direction):
    v = (hi - x) / (hi - lo) if direction == 'risk' else (x - lo) / (hi - lo)
    return 100 * min(1.0, max(0.0, v))


def jenks(values, k=5):
    """Естественные границы Дженкса (динамическое программирование, Fisher-Jenks)."""
    x = sorted(values)
    n = len(x)
    pre = [0.0] * (n + 1)
    pre2 = [0.0] * (n + 1)
    for i, v in enumerate(x):
        pre[i + 1] = pre[i] + v
        pre2[i + 1] = pre2[i] + v * v

    def ssd(i, j):  # сумма квадратов отклонений на отрезке x[i..j]
        s, s2, m = pre[j + 1] - pre[i], pre2[j + 1] - pre2[i], j - i + 1
        return s2 - s * s / m

    inf = float('inf')
    D = [[inf] * n for _ in range(k + 1)]
    B = [[0] * n for _ in range(k + 1)]
    for j in range(n):
        D[1][j] = ssd(0, j)
    for q in range(2, k + 1):
        for j in range(q - 1, n):
            for i in range(q - 1, j + 1):
                v = D[q - 1][i - 1] + ssd(i, j)
                if v < D[q][j]:
                    D[q][j], B[q][j] = v, i
    breaks, j = [], n - 1
    for q in range(k, 1, -1):
        i = B[q][j]
        breaks.append(x[i - 1])
        j = i - 1
    return sorted(breaks)


def level_by_score(s, br):
    for lvl, b in ((1, br[3]), (2, br[2]), (3, br[1]), (4, br[0])):
        if s > b:
            return lvl
    return 5


def compute(data, weights=None, threshold=None):
    m = data['meta']
    w = weights or m['weights']
    thr = m['stop_rule']['threshold'] if threshold is None else threshold
    res = {}
    for iso, c in data['countries'].items():
        norm = {f: normalize(c['raw'][f], *m['ranges'][f], m['direction'][f]) for f in w}
        res[iso] = {'normalized': norm, 'score': sum(norm[f] * w[f] for f in w)}
    br = jenks([r['score'] for r in res.values()])
    for r in res.values():
        r['stop'] = any(r['normalized'][f] < thr for f in m['stop_rule']['fields'])
        r['level'] = 5 if r['stop'] else level_by_score(r['score'], br)
    return res, br


def ranks(a):
    order = sorted(range(len(a)), key=lambda i: a[i])
    r = [0.0] * len(a)
    i = 0
    while i < len(a):
        j = i
        while j + 1 < len(a) and a[order[j + 1]] == a[order[i]]:
            j += 1
        for q in range(i, j + 1):
            r[order[q]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a, b):
    return st.correlation(ranks(a), ranks(b))


def check(data):
    res, br = compute(data)
    bad = 0
    for iso, c in data['countries'].items():
        r = res[iso]
        if abs(round(r['score'], 1) - c['score']) > 0.05 or r['level'] != c['level']:
            bad += 1
            print(f'расхождение {iso}: балл {r["score"]:.2f} / {c["score"]}, уровень {r["level"]} / {c["level"]}')
    print('границы Дженкса:', [round(b, 2) for b in br], '| в файле:', data['meta']['jenks_breaks'])
    print('стран:', len(res), '| расхождений:', bad)
    return res


def report(data, base):
    n = len(AHP)
    g = [math.prod(row) ** (1 / n) for row in AHP]
    w = [x / sum(g) for x in g]
    lam = sum(sum(AHP[i][j] * w[j] for j in range(n)) / w[i] for i in range(n)) / n
    ci = (lam - n) / (n - 1)
    print(f'\nAHP: вектор {[round(x, 3) for x in w]}, lambda_max = {lam:.3f}, CI = {ci:.3f}, '
          f'RI = {RI[n]}, CR = {ci / RI[n]:.3f}')

    c = data['countries']
    print('\nПорог стоп-критерия -> страны пятого уровня:')
    for thr in (10, 15, 20, 25, 30):
        res, _ = compute(data, threshold=thr)
        names = sorted(c[k]['name_ru'] for k, r in res.items() if r['level'] == 5)
        print(f'  {thr}: {len(names)} — {", ".join(names)}')

    adv = [k for k in c if c[k].get('us_advisory')]
    rho = spearman([base[k]['score'] for k in adv], [c[k]['us_advisory'] for k in adv])
    t = rho * math.sqrt((len(adv) - 2) / (1 - rho ** 2))
    print(f'\nСпирмен с уровнями Госдепа: rho = {rho:.3f}, n = {len(adv)}, t = {t:.2f}')

    keys = list(c)
    W = data['meta']['weights']
    w_gti = dict(W, GTI=0.2)
    for f in W:
        if f != 'GTI':
            w_gti[f] = W[f] * 0.8 / (1 - W['GTI'])
    print('\nЧувствительность к весам:')
    for name, ww in (('равные веса', {f: 1 / len(W) for f in W}), ('GTI = 20%', w_gti)):
        res, br = compute(data, weights=ww)
        r_base = spearman([base[k]['score'] for k in keys], [res[k]['score'] for k in keys])
        r_adv = spearman([res[k]['score'] for k in adv], [c[k]['us_advisory'] for k in adv])
        moved = [k for k in keys if res[k]['level'] != base[k]['level']]
        jumps = [c[k]['name_ru'] for k in moved if abs(res[k]['level'] - base[k]['level']) > 1]
        print(f'  {name}: rho с базовым = {r_base:.3f}, rho с Госдепом = {r_adv:.3f}, '
              f'сменили уровень {len(moved)}, более чем на один: {jumps}')


def export_csv(data):
    m = data['meta']
    fields = list(m['weights'])
    out = ROOT / 'data' / 'raw_values.csv'
    with open(out, 'w', encoding='utf-8-sig', newline='') as fh:
        wr = csv.writer(fh, delimiter=';')
        wr.writerow(['iso', 'страна'] + [f'{f} ({m["sources"][f]})' for f in fields] + ['восстановлено'])
        for iso, c in sorted(data['countries'].items(), key=lambda x: x[1]['name_ru']):
            wr.writerow([iso, c['name_ru']] + [str(c['raw'][f]).replace('.', ',') for f in fields]
                        + [', '.join(c.get('imputed') or [])])
    print('записан', out)
    src = ROOT / 'data' / 'sources.csv'
    with open(src, 'w', encoding='utf-8-sig', newline='') as fh:
        wr = csv.writer(fh, delimiter=';')
        wr.writerow(['поле', 'индекс и издание', 'организация', 'URL', 'дата обращения'])
        for row in SOURCES:
            wr.writerow(row)
    print('записан', src)


SOURCES = [
    ['GTI', 'Global Terrorism Index 2026', 'Institute for Economics and Peace',
     'https://www.visionofhumanity.org/maps/global-terrorism-index/', '11.09.2026'],
    ['Crime', 'Numbeo Crime Index by Country 2026', 'Numbeo',
     'https://www.numbeo.com/crime/rankings_by_country.jsp', '11.09.2026'],
    ['GPI', 'Global Peace Index 2026', 'Institute for Economics and Peace',
     'https://www.visionofhumanity.org/maps/', '11.09.2026'],
    ['CPI', 'Corruption Perceptions Index 2025', 'Transparency International',
     'https://www.transparency.org/en/cpi/', '11.09.2026'],
    ['FSI', 'Fragile States Index 2024', 'Fund for Peace', 'https://fragilestatesindex.org', '11.09.2026'],
    ['HCI', 'Numbeo Health Care Index by Country 2026', 'Numbeo',
     'https://www.numbeo.com/health-care/rankings_by_country.jsp', '11.09.2026'],
    ['EPI', 'Environmental Performance Index 2024', 'Yale Center for Environmental Law and Policy',
     'https://epi.yale.edu', '11.09.2026'],
    ['us_advisory', 'Travel Advisories: уровни по состоянию на 11.09.2026 (даты предупреждений - data/us_advisories.csv)',
     'U.S. Department of State', 'https://travel.state.gov', '05.11.2026'],
    ['ru_trips_2025', 'Выездной туризм граждан РФ за 2025 г. (данные Погранслужбы ФСБ России)',
     'Российский союз туриндустрии',
     'https://rst.ru/novosti/novosti-turizm/eksperty-rst-ocenili-statistiku-vyezdnogo-turizma-za-2025-god.html',
     '04.11.2026'],
]


if __name__ == '__main__':
    data = json.loads(DATA.read_text(encoding='utf-8'))
    base = check(data)
    if '--report' in sys.argv:
        report(data, base)
    if '--csv' in sys.argv:
        export_csv(data)
