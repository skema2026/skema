"""검사기가 진짜 버그를 잡는지 확인: 운영 함수에 일부러 버그를 넣고 algo_sim을 돌린다.

    cd backend && python bench/mutants.py   (버그마다 위반이 1건 이상 나와야 정상)
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import algo_sim as sim
import app.schedule.study_blocks as sb
import app.schedule.reschedule as rs
import app.schedule.free_slots as fs

def run(name, patch, unpatch):
    patch()
    try:
        r = sim.run(300, 7)
    finally:
        unpatch()
    print(f"{name:42s} -> 잡힌 위반 {sum(r['violations'].values()):5d}건  {list(r['violations'])[:4]}")
    return r

orig_pref_sb, orig_pref_rs = sb.by_preference, rs.by_preference
orig_free = sim.free_slot_starts
orig_take = rs._take_slots
orig_choose = sb.choose_days
orig_cand = sb.candidate_days

muts = [
  ("M1 저녁 우선 대신 아침부터", lambda: (setattr(sb,'by_preference',sorted), setattr(rs,'by_preference',sorted)), lambda: (setattr(sb,'by_preference',orig_pref_sb), setattr(rs,'by_preference',orig_pref_rs))),
  ("M2 빈 시간 계산이 수업을 무시", lambda: setattr(sim,'free_slot_starts', lambda busy,w,s,earliest=0: orig_free([],w,s,earliest)), lambda: setattr(sim,'free_slot_starts',orig_free)),
  ("M3 수면 시간 무시(0~24시 전부)", lambda: setattr(sim,'free_slot_starts', lambda busy,w,s,earliest=0: orig_free(busy,0,24*60,earliest)), lambda: setattr(sim,'free_slot_starts',orig_free)),
  ("M4 다시 짜기가 마감 무시", lambda: setattr(rs,'_take_slots', lambda free,deadline,need,split: orig_take(free, deadline+__import__('datetime').timedelta(days=30), need, split)), lambda: setattr(rs,'_take_slots',orig_take)),
  ("M5 주 며칠 설정 무시(매일)", lambda: setattr(sb,'choose_days', lambda days,free,dpw: list(days)), lambda: setattr(sb,'choose_days',orig_choose)),
  ("M6 시험 당일까지 배치", lambda: setattr(sb,'candidate_days', lambda ex,today,sdb: orig_cand(ex+__import__('datetime').timedelta(days=1),today,sdb)), lambda: setattr(sb,'candidate_days',orig_cand)),
  ("M7 지금 이전 칸도 사용", lambda: setattr(sim,'free_slot_starts', lambda busy,w,s,earliest=0: orig_free(busy,w,s,0)), lambda: setattr(sim,'free_slot_starts',orig_free)),
]
for m in muts:
    run(*m)
