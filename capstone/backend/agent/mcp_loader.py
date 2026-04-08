# backend/agent/mcp_loader.py
import socket, json
from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel, create_model
from langchain_core.tools import BaseTool

DELIM = b"\n\n"

class MCPClient:
    def __init__(self, host="mcp-weather", port=7001, timeout=3.0):
        self.host = host
        self.port = port
        self.timeout = timeout

    def _rpc(self, method: str, params: Optional[dict] = None) -> dict:
        req = {"jsonrpc": "2.0", "id": method, "method": method}
        if params:
            req["params"] = params
        data = (json.dumps(req, ensure_ascii=False) + "\n\n").encode()
        with socket.create_connection((self.host, self.port), timeout=self.timeout) as s:
            s.sendall(data)
            buf = b""
            s.settimeout(self.timeout)
            while True:
                chunk = s.recv(65536)
                if not chunk:
                    break
                buf += chunk
                while DELIM in buf:
                    raw, buf = buf.split(DELIM, 1)
                    if not raw.strip():
                        continue
                    msg = json.loads(raw.decode())
                    if msg.get("id") == method:
                        return msg
        raise RuntimeError(f"MCP rpc timeout: {method}")

    def handshake(self) -> dict:
        return self._rpc("handshake")

    def list_tools(self) -> List[dict]:
        resp = self._rpc("list_tools")
        return resp.get("result", {}).get("tools", [])

    def call_tool(self, name: str, args: dict) -> Any:
        resp = self._rpc("call_tool", {"name": name, "args": args})
        # 서버 응답 구조: {"result":{"result":{...}}}
        return resp.get("result", {}).get("result")

def load_mcp_tools(host="mcp-weather", port=7001, timeout=3.0, prefix: str = "") -> List[BaseTool]:
    """MCP 서버에서 tool schema 읽어 LangChain BaseTool 로 변환."""
    out: List[BaseTool] = []
    try:
        client = MCPClient(host, port, timeout)
        hs = client.handshake()
        # 프로토콜 확인 (선택)
        if hs.get("result", {}).get("protocol") != "mcp/1":
            print(f"[MCP] unexpected protocol: {hs}")
        specs = client.list_tools()
    except Exception as e:
        print(f"[MCP] connect failed: {e}")
        return out

    for spec in specs:
        try:
            tool_name = prefix + spec["name"]  # prefix 필요없으면 제거
            schema: Dict[str, Any] = spec.get("input_schema", {})
            props: Dict[str, Any] = schema.get("properties", {})
            required = schema.get("required", [])

            # 동적 pydantic 모델 구성
            fields = {}
            for k, v in props.items():
                py_type = str  # 간단 매핑 (enum 등 추가 가능)
                default = ( ... if k in required else None )
                # create_model 포맷: {field_name: (type, default)}
                fields[k] = (py_type, default)
            ArgsModel: Type[BaseModel] = create_model(
                f"MCPArgs_{tool_name}", **fields  # type: ignore
            )

            # 런타임 함수 (클로저로 tool_name, client 캡처)
            def _run(self, **kwargs):
                return client.call_tool(spec["name"], kwargs)

            async def _arun(self, **kwargs):
                return _run(self, **kwargs)

            # type() 로 동적 클래스 생성 (스코프 문제 회피)
            ToolCls = type(
                f"MCP_{tool_name}_Tool",
                (BaseTool,),
                {
                    "name": tool_name,
                    "description": spec.get("description", "(MCP tool)"),
                    "args_schema": ArgsModel,
                    "_run": _run,
                    "_arun": _arun,
                },
            )
            out.append(ToolCls())
        except Exception as e:
            print(f"[MCP] load failed for {spec.get('name')}: {e}")
    if not out:
        print("[MCP] No tools loaded.")
    else:
        names = ", ".join(t.name for t in out)
        print(f"[MCP] Loaded tools: {names}")
    return out
