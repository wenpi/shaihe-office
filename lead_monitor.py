#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
晒和云创大健康创业园 · 每日线索监控脚本
运行方式: python3 lead_monitor.py
"""

import os
from datetime import datetime

TODAY = datetime.now().strftime('%Y%m%d')
LEADS_DIR = 'leads'

KEYWORDS = [
    '西湖区办公室出租', '西湖区工位租赁', '西湖区创业园',
    '杭州西湖区办公室', '西湖区注册地址', '杭州办公室出租',
    '杭州创业园工位', '西湖区小型办公室', '杭州西湖区租办公室',
    '大健康创业园', '晒和云创', '西湖区商务中心',
    '杭州工位出租', '西湖区联合办公', '杭州注册地址办公室',
]

PLATFORMS = {
    '小红书': 'https://www.xiaohongshu.com/search_result?keyword={}',
    '抖音':   'https://www.douyin.com/search/{}',
    '微博':   'https://s.weibo.com/weibo?q={}',
    '百度贴吧': 'https://tieba.baidu.com/f/search/res?qw={}',
}

REPLY_SCRIPTS = {
    '通用版': '您好！看到您在找办公室，我们晒和云创大健康创业园在杭州西湖区，综合型创业园，多行业均可入驻。共享工位/独立办公室/整层空间都有，拎包入驻，可注册地址，3个月起租，价格灵活。有兴趣可以来实地看看，电话/微信：13634118522，发"西湖看房"预约即可 😊',
    '大健康版': '您好！我们晒和云创大健康创业园专为大健康、医疗、康养类企业提供优质办公空间，位于杭州西湖区，配套完善，可注册地址，拎包入驻。独立办公室10㎡起，适合初创到成长期各阶段企业。欢迎来电咨询：13634118522（微信同号）',
    '初创版': '您好！创业初期资金有限，我们晒和云创大健康创业园有共享工位和小型独立办公室，3个月起租，押一付三，拎包入驻零装修成本，还可以提供工商注册地址。西湖区地段，交通方便。有需要可以来看看，13634118522（电话/微信）',
    '成长型版': '您好！如果团队在扩张，我们晒和云创大健康创业园有100㎡以上整层空间，可按需改造，长租享优惠。位于杭州西湖区，配套齐全，24小时安保，可注册地址。欢迎预约实地参观，电话/微信：13634118522',
}


def generate_search_links():
    lines = [f'# 每日搜索链接 · {TODAY}\n', '> 晒和云创大健康创业园 · 西湖区\n']
    for kw in KEYWORDS:
        lines.append(f'\n## {kw}\n')
        for name, url_tpl in PLATFORMS.items():
            url = url_tpl.format(kw.replace(' ', '+'))
            lines.append(f'- [{name}]({url})\n')
    path = os.path.join(LEADS_DIR, f'search_links_{TODAY}.md')
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(f'✅ 搜索链接已生成: {path}')


def generate_leads_csv():
    path = os.path.join(LEADS_DIR, f'leads_{TODAY}.csv')
    with open(path, 'w', encoding='utf-8-sig') as f:
        f.write('日期,联系人,电话,需求面积,来源平台,帖子链接,备注,跟进状态\n')
        f.write(f'{TODAY},,,,,,, 待跟进\n')
    print(f'✅ 线索表格已生成: {path}')


def print_scripts():
    print('\n' + '='*50)
    print('📋 回复话术库')
    print('='*50)
    for name, script in REPLY_SCRIPTS.items():
        print(f'\n【{name}】\n{script}\n')


if __name__ == '__main__':
    os.makedirs(LEADS_DIR, exist_ok=True)
    print(f'🔍 晒和云创大健康创业园 · 每日监控 · {TODAY}')
    generate_search_links()
    generate_leads_csv()
    print_scripts()
    print('\n✅ 完成！打开 leads/ 目录查看今日文件。')
