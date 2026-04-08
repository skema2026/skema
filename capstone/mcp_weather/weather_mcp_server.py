# weather_mcp_server.py
import json, socket, threading, requests, time, datetime as dt

HOST = "0.0.0.0"
PORT = 7001

TOOL_SPEC = [{
  "name": "get_weather",
  "description": "도시명으로 현재 기온/조건 조회",
  "input_schema": {
    "type": "object",
    "properties": {
      "location": {"type": "string"},
      "units": {"type": "string", "enum": ["metric","imperial"], "default": "metric"}
    },
    "required": ["location"]
  }
}]

def resolve_city(city: str):
    # 매우 단순: Open-Meteo geocoding → lat,lon
    url = "https://geocoding-api.open-meteo.com/v1/search"
    r = requests.get(url, params={"name": city, "count": 1, "language": "en"})
    d = r.json()
    if not d.get("results"):
        raise ValueError(f"City '{city}' not found")
    item = d["results"][0]
    return item["latitude"], item["longitude"], item["name"]

def fetch_weather(lat, lon, units):
    params = {
        "latitude": lat,
        "longitude": lon,
        "current_weather": True
    }
    r = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=7)
    cw = r.json().get("current_weather", {})
    temp_c = cw.get("temperature")
    # 단순 변환
    if units == "imperial":
        temp = temp_c * 9/5 + 32
    else:
        temp = temp_c
    code = cw.get("weathercode")
    return {
        "temp": round(temp, 2),
        "conditions_code": code,
        "windspeed": cw.get("windspeed"),
        "raw": cw
    }

def handle_rpc(req):
    method = req.get("method")
    if method == "handshake":
        return {"protocol": "mcp/1", "capabilities": {"tools": TOOL_SPEC}}
    if method == "list_tools":
        return {"tools": TOOL_SPEC}
    if method == "call_tool":
        name = req["params"]["name"]
        args = req["params"].get("args", {})
        if name == "get_weather":
            city = args["location"]
            units = args.get("units","metric")
            lat, lon, label = resolve_city(city)
            data = fetch_weather(lat, lon, units)
            return {"result": {
                "location": label,
                "units": units,
                "temp": data["temp"],
                "windspeed": data["windspeed"],
                "conditions_code": data["conditions_code"],
                "fetched_at": dt.datetime.utcnow().isoformat()+"Z"
            }}
        raise ValueError(f"Unknown tool {name}")
    return {"error": "unknown_method"}

def client_thread(conn, addr):
    buf = b""
    while True:
        chunk = conn.recv(65536)
        if not chunk: break
        buf += chunk
        # 간단 프로토콜: \n\n 구분 (데모용)
        while b"\n\n" in buf:
            raw, buf = buf.split(b"\n\n", 1)
            if not raw.strip(): continue
            try:
                req = json.loads(raw.decode())
                resp_payload = {"jsonrpc":"2.0","id":req.get("id")}
                try:
                    result = handle_rpc(req)
                    resp_payload["result"] = result
                except Exception as e:
                    resp_payload["error"] = {"message": str(e)}
                conn.sendall((json.dumps(resp_payload)+"\n\n").encode())
            except Exception as e:
                conn.sendall(json.dumps({"jsonrpc":"2.0","error":{"message":str(e)}}).encode()+b"\n\n")
    conn.close()

def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind((HOST, PORT))
    s.listen()
    print(f"[MCP-Weather] listening on {PORT}")
    while True:
        c,a = s.accept()
        threading.Thread(target=client_thread, args=(c,a), daemon=True).start()

if __name__ == "__main__":
    main()
