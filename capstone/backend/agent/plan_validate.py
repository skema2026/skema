WEATHER_KW = ("날씨","기상","야외","우천","비","맑음")
WEATHER_TOOLS = ("get_weather","web_search")

def adjust_plan_if_needed(plan:dict, user_input:str)->bool:
    steps = plan.get("steps",[])
    if not steps: return False
    needs_weather = any(k in user_input for k in WEATHER_KW)
    if not needs_weather: return False
    # 이미 weather tool 먼저면 패스
    if steps[0]["tool"] in WEATHER_TOOLS:
        return False
    # create_event 가 0번째면 weather step 삽입
    if steps[0]["tool"] == "create_event":
        # location 추출 간단(“서울” 검색)
        location = "서울" if "서울" in user_input else "Seoul"
        steps.insert(0, {"tool":"get_weather","args":{"location":location}})
        return True
    return False
